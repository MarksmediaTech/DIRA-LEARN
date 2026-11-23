-- DIRA LEARN: trainer session flow (delivery reports, completion) + curriculum administration rules
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.

-- ---------- 1. Session delivery reports ----------
create table session_reports (
  schedule_id uuid primary key references session_schedules(id) on delete cascade,
  summary text,            -- what was actually covered
  challenges text,         -- what got in the way
  follow_ups text,         -- what the next session or coordinator should pick up
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create or replace function set_report_meta() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now(); return new; end $$;
create trigger trg_report_meta before insert or update on session_reports for each row execute function set_report_meta();
create trigger aud_reports after insert or update or delete on session_reports for each row execute function audit_row();

alter table session_reports enable row level security;
create or replace function can_manage_schedule(p_schedule uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() or exists (select 1 from session_schedules s where s.id = p_schedule and app_role() = 'trainer'
    and s.cohort_id in (select my_trainer_cohorts())) $$;
create policy sreport_read on session_reports for select to authenticated using (can_manage_schedule(schedule_id) or app_role() = 'me_officer');
create policy sreport_write on session_reports for all to authenticated using (can_manage_schedule(schedule_id)) with check (can_manage_schedule(schedule_id));

-- ---------- 2. Completing a session ----------
-- A session can be marked completed once it has started and attendance is recorded for everyone expected.
-- Expected = all enrolled participants for a core session, or those on that track for a track session.
create or replace function complete_session(p_schedule uuid) returns void language plpgsql security definer set search_path = public as $$
declare s record; tid uuid; missing int;
begin
  if not can_manage_schedule(p_schedule) then raise exception 'You cannot manage this session'; end if;
  select ss.*, cs.track_id as session_track into s from session_schedules ss join curriculum_sessions cs on cs.id = ss.curriculum_session_id
    where ss.id = p_schedule for update of ss;
  if s.id is null then raise exception 'Session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session can be completed (this one is %)', s.status; end if;
  if s.starts_at > now() then raise exception 'This session has not started yet'; end if;
  select count(*) into missing from cohort_enrolments e
    where e.cohort_id = s.cohort_id and (s.session_track is null or e.track_id = s.session_track)
      and not exists (select 1 from attendance a where a.schedule_id = p_schedule and a.participant_id = e.participant_id);
  if missing > 0 then raise exception 'Attendance is missing for % participant(s)', missing; end if;
  update session_schedules set status = 'completed' where id = p_schedule;
end $$;
revoke all on function complete_session(uuid) from public;
grant execute on function complete_session(uuid) to authenticated;

-- ---------- 3. Curriculum administration ----------
-- Coordinators and super admins may edit content (existing RLS). Only super admin and programme director may approve.
-- Editing approved content sends it back to draft so it must be approved again.
create or replace function guard_curriculum_session() returns trigger language plpgsql security definer set search_path = public as $$
declare content_changed boolean;
begin
  if auth.uid() is null then return new; end if;                       -- service role / migrations
  if tg_op = 'INSERT' then
    if new.is_approved and app_role() not in ('super_admin', 'programme_director') then
      raise exception 'Only a super administrator or programme director can approve curriculum content';
    end if;
    return new;
  end if;
  if new.is_approved is distinct from old.is_approved then
    if app_role() not in ('super_admin', 'programme_director') then
      raise exception 'Only a super administrator or programme director can approve curriculum content';
    end if;
  end if;
  content_changed := (new.title, new.description, new.duration_minutes, new.objectives, new.topics, new.activities, new.expected_output, new.assessment_notes, new.week_no, new.session_no, new.track_id)
                     is distinct from
                     (old.title, old.description, old.duration_minutes, old.objectives, old.topics, old.activities, old.expected_output, old.assessment_notes, old.week_no, old.session_no, old.track_id);
  if content_changed and old.is_approved and new.is_approved is not distinct from old.is_approved then
    new.is_approved := false;                                          -- needs re-approval
  end if;
  return new;
end $$;
create trigger trg_guard_curriculum before insert or update on curriculum_sessions for each row execute function guard_curriculum_session();
create trigger aud_curriculum after insert or update or delete on curriculum_sessions for each row execute function audit_row();

-- Director may approve but not edit content under the existing write policy, so approval goes through a function.
create or replace function set_curriculum_approval(p_session uuid, p_approved boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if app_role() not in ('super_admin', 'programme_director') then
    raise exception 'Only a super administrator or programme director can approve curriculum content';
  end if;
  update curriculum_sessions set is_approved = p_approved where id = p_session;
end $$;
revoke all on function set_curriculum_approval(uuid, boolean) from public;
grant execute on function set_curriculum_approval(uuid, boolean) to authenticated;

-- A session that has ever been scheduled keeps its identity: week, number and track cannot change under a live timetable.
create or replace function guard_scheduled_curriculum() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.week_no, new.session_no, new.track_id) is distinct from (old.week_no, old.session_no, old.track_id)
     and exists (select 1 from session_schedules where curriculum_session_id = old.id) then
    raise exception 'This session is already scheduled, so its week, number and track cannot change';
  end if;
  return new;
end $$;
create trigger trg_guard_scheduled_curriculum before update on curriculum_sessions for each row execute function guard_scheduled_curriculum();
