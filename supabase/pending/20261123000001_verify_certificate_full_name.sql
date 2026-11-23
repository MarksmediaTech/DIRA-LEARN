-- DIRA LEARN - PENDING database change: public certificate check shows the learner's COMPLETE name (prepared 23 Nov 2026). NOT APPLIED.
-- Apply only after the owner approves it: paste the whole file into the Supabase SQL Editor and Run (one transaction).
--
-- WHY: learners imported from CSV now keep their complete name exactly as entered (stored in profiles.first_name, last_name left
-- empty). The old function builds "first name + space + first letter of last name + full stop", so a complete name such as
-- "Brian Njima Otieno" would show as "Brian Njima Otieno ." on the public certificate check page.
-- WHAT: replaces ONLY the body of verify_certificate(text). Same name, same inputs, same three output columns, same permissions
-- (anon and authenticated may run it; "create or replace" keeps existing grants). The holder is now the complete name:
--   * whole name in first_name, last_name empty  -> "Brian Njima Otieno"   (no extra initial, no full stop)
--   * older split names (first_name + last_name)  -> "Amina Otieno"        (the full surname, no longer just an initial)
-- No table, column, policy, trigger or other function changes. It does not need pending changes 1 or 2.
-- NOTE FOR THE OWNER: this shows the full name to anyone who has a valid certificate number (the old text showed only the
-- first name and an initial). This is the decision recorded in the handover ("display complete names correctly ... including
-- certificate verification").
-- SAFE TO RUN TWICE. Undo: 20261123000001_verify_certificate_full_name_rollback.sql.
do $guard$
begin
  if pg_catalog.to_regprocedure('public.verify_certificate(text)') is null then
    raise exception 'STOP: public.verify_certificate(text) does not exist here. Nothing was changed.';
  end if;
end $guard$;

create or replace function public.verify_certificate(cert_no text) returns table(valid boolean, issued_on date, holder text)
language sql stable security definer set search_path = public as $$
  select not c.revoked, c.issued_on,
         btrim(concat_ws(' ', nullif(btrim(pr.first_name), ''), nullif(btrim(pr.last_name), '')))
  from certificates c join participants p on p.id = c.participant_id join profiles pr on pr.id = p.profile_id
  where c.certificate_no = cert_no $$;

do $check$
begin
  if not has_function_privilege('anon', 'public.verify_certificate(text)', 'execute') then
    raise exception 'STOP: signed-out visitors can no longer run verify_certificate. Rolling back.';
  end if;
end $check$;
