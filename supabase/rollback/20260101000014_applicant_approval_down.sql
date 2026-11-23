-- ROLLBACK for 20260101000014_applicant_approval.sql. Not applied automatically (Supabase migrations only go forward).
-- Use only if the approval module has to be backed out. Run in the SQL Editor. It restores the previous function
-- bodies and removes the new functions. It does NOT touch any data: applications already approved or rejected keep
-- their status, participants, history and audit rows; the two email templates are kept (edit or deactivate them in the Emails page).
begin;

drop function if exists decide_application(uuid, text, text);
drop function if exists application_emails();
drop function if exists can_decide_applications();

-- previous guard_profile_privileged (migration 9)
create or replace function guard_profile_privileged() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_trusted_session() then return new; end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.organization_id is distinct from old.organization_id)
     and not is_admin() then
    raise exception 'Only a super administrator can change role, status or organisation';
  end if;
  return new;
end $$;

-- previous transition_application (migration 4)
create or replace function transition_application(p_app uuid, p_to application_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur application_status;
begin
  if not is_staff() then raise exception 'Only programme staff can review applications'; end if;
  select status into cur from applications where id = p_app for update;
  if cur is null then raise exception 'Application not found'; end if;
  if not application_transition_allowed(cur, p_to) then
    raise exception 'An application cannot move from % to %', cur, p_to;
  end if;
  if (p_to = 'rejected' or cur = 'rejected') and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when rejecting or reconsidering an application';
  end if;
  perform set_config('dira.application_transition', 'on', true);
  update applications set status = p_to where id = p_app;
  insert into application_events(application_id, from_status, to_status, note, actor_id)
    values (p_app, cur, p_to, nullif(btrim(p_note), ''), auth.uid());
end $$;

-- previous notify_application_update (migration 9)
create or replace function notify_application_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(user_id, kind, title, body) values (new.applicant_id, 'application', 'There is an update on your application', 'Open My application to read it.');
  return new;
end $$;

commit;
