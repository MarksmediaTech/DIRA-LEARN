-- DIRA LEARN: application review workflow + cohort scheduling rules
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.
-- The status workflow below is a DRAFT proposal (the SRS excerpt available to me does not define it); see docs/ASSUMPTIONS_AND_DECISIONS.md.

-- ---------- 1. Fix: applicants submit in one step (the form inserts status 'submitted') ----------
drop policy if exists apps_own_insert on applications;
create policy apps_own_insert on applications for insert to authenticated
  with check (applicant_id = auth.uid() and status in ('draft', 'submitted'));

-- ---------- 2. Application status workflow ----------
create or replace function application_transition_allowed(p_from application_status, p_to application_status)
returns boolean language sql immutable as $$
  select case p_from
    when 'submitted'   then p_to in ('under_review', 'rejected')
    when 'under_review' then p_to in ('shortlisted', 'waitlisted', 'accepted', 'rejected')
    when 'shortlisted' then p_to in ('under_review', 'waitlisted', 'accepted', 'rejected')
    when 'waitlisted'  then p_to in ('shortlisted', 'accepted', 'rejected')
    when 'rejected'    then p_to in ('under_review')       -- reconsideration, note required
    else false                                              -- draft is the applicant's; accepted is final
  end $$;

-- Staff change status through this function so every change is validated and logged.
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
revoke all on function transition_application(uuid, application_status, text) from public;
grant execute on function transition_application(uuid, application_status, text) to authenticated;

-- Direct status edits are blocked unless they come through transition_application, the service role
-- (Edge Functions), or an applicant submitting their own draft.
create or replace function guard_application_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if auth.uid() is null or current_setting('dira.application_transition', true) = 'on' then
      return new;
    end if;
    if auth.uid() = old.applicant_id and old.status = 'draft' and new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
      return new;
    end if;
    raise exception 'Application status can only be changed through the review workflow';
  end if;
  return new;
end $$;
create trigger trg_guard_application_status before insert or update on applications
  for each row execute function guard_application_status();

-- Log the applicant's own submission as the first history entry.
create or replace function log_application_submitted() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
    insert into application_events(application_id, from_status, to_status, actor_id)
      values (new.id, case when tg_op = 'UPDATE' then 'draft'::application_status end, 'submitted', new.applicant_id);
  end if;
  return new;
end $$;
create trigger trg_log_application_submitted after insert or update on applications
  for each row execute function log_application_submitted();

-- Reviewer notes cannot be attributed to someone else.
create or replace function set_event_actor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.actor_id := auth.uid(); end if;
  return new;
end $$;
create trigger trg_event_actor before insert on application_events for each row execute function set_event_actor();

-- Accepted-and-converted participants who are not in any cohort yet.
create view v_unplaced_participants with (security_invoker = true) as
  select p.id as participant_id, p.participant_no, pr.first_name, pr.last_name
  from participants p join profiles pr on pr.id = p.profile_id
  where p.status in ('enrolled', 'active')
    and not exists (select 1 from cohort_enrolments e join cohorts c on c.id = e.cohort_id
                    where e.participant_id = p.id and not c.archived);

-- ---------- 3. Cohort rules ----------
-- Capacity check now locks the cohort row so two coordinators cannot both take the last place.
create or replace function enforce_cohort_capacity() returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; cur int; arch boolean;
begin
  select capacity, archived into cap, arch from cohorts where id = new.cohort_id for update;
  if arch then raise exception 'This cohort is archived'; end if;
  select count(*) into cur from cohort_enrolments where cohort_id = new.cohort_id;
  if cur >= cap then raise exception 'Cohort is at capacity (%)', cap; end if;
  return new;
end $$;

-- A participant belongs to one active (non-archived) cohort at a time.
create or replace function enforce_single_active_cohort() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from cohort_enrolments e join cohorts c on c.id = e.cohort_id
             where e.participant_id = new.participant_id and e.cohort_id <> new.cohort_id and not c.archived) then
    raise exception 'This participant is already enrolled in another active cohort';
  end if;
  return new;
end $$;
create trigger trg_single_cohort before insert on cohort_enrolments for each row execute function enforce_single_active_cohort();

-- Capacity cannot drop below the number already enrolled.
create or replace function guard_cohort_capacity() returns trigger language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  select count(*) into cur from cohort_enrolments where cohort_id = new.id;
  if new.capacity < cur then raise exception 'Capacity cannot be lower than the % participants already enrolled', cur; end if;
  return new;
end $$;
create trigger trg_cohort_capacity_guard before update of capacity on cohorts for each row execute function guard_cohort_capacity();

-- A trainer assignment must be a trainer; a track-specific assignment must use a track of the cohort's programme.
create or replace function guard_trainer_assignment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.trainer_id and role = 'trainer' and status = 'active') then
    raise exception 'Only an active trainer account can be assigned to a cohort';
  end if;
  if new.track_id is not null and not exists (
      select 1 from tracks t join cohorts c on c.programme_id = t.programme_id where t.id = new.track_id and c.id = new.cohort_id) then
    raise exception 'Track does not belong to this cohort''s programme';
  end if;
  return new;
end $$;
create trigger trg_guard_trainer_assignment before insert or update on trainer_assignments for each row execute function guard_trainer_assignment();

-- ---------- 4. Session scheduling rules (2-hour cap is already a table constraint) ----------
-- Draft setting: the programme's local time zone, used to decide which calendar day a session falls on.
insert into system_settings(key, value, is_approved, note) values
  ('programme_timezone', '"Africa/Nairobi"', false, 'Assumed from the location of the first user. DIRA Foundation to confirm.')
on conflict (key) do nothing;

-- One live schedule per curriculum session per cohort (cancelled/rescheduled rows are history).
create unique index uq_live_schedule on session_schedules(cohort_id, curriculum_session_id) where status in ('scheduled', 'completed');

create or replace function guard_session_schedule() returns trigger language plpgsql security definer set search_path = public as $$
declare
  cs record; co record; tz text; day date; clash record;
begin
  if tg_op = 'UPDATE' and old.status = 'completed'
     and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.cohort_id <> old.cohort_id or new.curriculum_session_id <> old.curriculum_session_id) then
    raise exception 'A completed session cannot be moved';
  end if;
  if new.status in ('cancelled', 'rescheduled') then return new; end if;

  select * into co from cohorts where id = new.cohort_id;
  select * into cs from curriculum_sessions where id = new.curriculum_session_id;
  if co.archived then raise exception 'This cohort is archived'; end if;
  if cs.programme_id <> co.programme_id then raise exception 'Session belongs to a different programme'; end if;

  select coalesce(trim(both '"' from value::text), 'Africa/Nairobi') into tz from system_settings where key = 'programme_timezone';
  day := (new.starts_at at time zone coalesce(tz, 'Africa/Nairobi'))::date;
  if day < co.start_date or day > co.end_date then
    raise exception 'Session date % is outside the cohort dates (% to %)', day, co.start_date, co.end_date;
  end if;
  if new.trainer_id is not null then
    if not exists (select 1 from trainer_assignments ta where ta.cohort_id = new.cohort_id and ta.trainer_id = new.trainer_id
                   and (ta.track_id is null or ta.track_id = cs.track_id)) then
      raise exception 'This trainer is not assigned to the cohort%', case when cs.track_id is not null then ' for this track' else '' end;
    end if;
    select s.id into clash from session_schedules s
      where s.trainer_id = new.trainer_id and s.status in ('scheduled', 'completed') and s.id is distinct from new.id
        and tstzrange(s.starts_at, s.ends_at) && tstzrange(new.starts_at, new.ends_at) limit 1;
    if found then raise exception 'The trainer already has a session at that time'; end if;
  end if;

  -- Within one cohort, sessions for DIFFERENT tracks may run in parallel; core sessions need the whole cohort.
  select s.id into clash from session_schedules s join curriculum_sessions o on o.id = s.curriculum_session_id
    where s.cohort_id = new.cohort_id and s.status in ('scheduled', 'completed') and s.id is distinct from new.id
      and tstzrange(s.starts_at, s.ends_at) && tstzrange(new.starts_at, new.ends_at)
      and not (cs.track_id is not null and o.track_id is not null and o.track_id <> cs.track_id) limit 1;
  if found then raise exception 'This cohort already has a session at that time'; end if;
  return new;
end $$;
create trigger trg_guard_session_schedule before insert or update on session_schedules for each row execute function guard_session_schedule();

-- ---------- 5. Audit ----------
create trigger aud_applications after insert or update or delete on applications for each row execute function audit_row();
create trigger aud_cohorts after insert or update or delete on cohorts for each row execute function audit_row();
create trigger aud_enrolments after insert or update or delete on cohort_enrolments for each row execute function audit_row();
create trigger aud_trainer_assign after insert or update or delete on trainer_assignments for each row execute function audit_row();
create trigger aud_schedules after insert or update or delete on session_schedules for each row execute function audit_row();
