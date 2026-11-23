-- DIRA LEARN: minimum age (management decision of 19 Nov 2026). DIRA LEARN is for participants aged 18 to 25.
-- Applications from people below 18 must not be accepted. Any future programme for minors needs a separately approved policy.
-- STATUS: executed and tested locally. NOT applied to any Supabase project. Rollback: supabase/rollback/20260101000026_minimum_age_down.sql
--
--   * An applicant submitting through the app must give a valid date of birth showing they are at least 18 today.
--   * Nobody (staff, server functions or the SQL editor) can accept an application, or create a participant record,
--     for someone whose recorded date of birth shows they are under 18.
--   * Existing records are not changed. The upper limit of 25 is still checked by the application form only
--     (decision pending: see docs/SAFEGUARDING.md).

create or replace function dob_from_form(f jsonb) returns date language plpgsql immutable as $$
begin return (f ->> 'dateOfBirth')::date; exception when others then return null; end $$;

create or replace function guard_application_min_age() returns trigger language plpgsql security definer set search_path = public as $$
declare dob date := dob_from_form(new.form_data);
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') and not is_trusted_session() then
    if dob is null then raise exception 'Enter your date of birth before submitting your application'; end if;
  end if;
  if new.status in ('submitted', 'accepted') and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and dob is not null and dob > (current_date - interval '18 years')::date then
    raise exception 'DIRA LEARN is for people aged 18 to 25. Applications from people under 18 cannot be accepted';
  end if;
  return new;
end $$;
create trigger trg_application_min_age before insert or update of status, form_data on applications
  for each row execute function guard_application_min_age();

create or replace function guard_participant_min_age() returns trigger language plpgsql as $$
begin
  if new.date_of_birth is not null and (tg_op = 'INSERT' or new.date_of_birth is distinct from old.date_of_birth)
     and new.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'DIRA LEARN participants must be at least 18 years old';
  end if;
  return new;
end $$;
create trigger trg_participant_min_age before insert or update of date_of_birth on participants
  for each row execute function guard_participant_min_age();
