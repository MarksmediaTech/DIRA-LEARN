-- DIRA LEARN - UNDO of 20261123000001_verify_certificate_full_name.sql. Puts back the original verify_certificate(text)
-- (first name + initial of the surname + full stop). No data is changed. Safe to run twice.
do $rollback$
begin
  if pg_catalog.to_regprocedure('public.verify_certificate(text)') is null then
    raise exception 'STOP: public.verify_certificate(text) does not exist here. Nothing was changed.';
  end if;
end $rollback$;

create or replace function public.verify_certificate(cert_no text) returns table(valid boolean, issued_on date, holder text)
language sql stable security definer set search_path = public as $$
  select not c.revoked, c.issued_on, pr.first_name || ' ' || left(pr.last_name,1) || '.'
  from certificates c join participants p on p.id = c.participant_id join profiles pr on pr.id = p.profile_id
  where c.certificate_no = cert_no $$;
