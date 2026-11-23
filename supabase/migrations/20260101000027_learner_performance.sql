-- DIRA LEARN: Phase 6 – Individual Learner Performance.
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000027_learner_performance_down.sql
--
-- WHAT IT ADDS
--   * learner_metrics(cohort): one row per learner with attendance, sessions, assignments, scores, the DRAFT weighted result,
--     completion requirements and completion status. It mirrors the Results page calculation exactly (src/features/results),
--     so the learner's view and management reports cannot disagree. No pass mark is applied: none has been approved.
--   * learner_feedback: facilitator feedback on a learner's overall progress, shared with the learner or staff-only.
--   * learner_progress_snapshots: a daily snapshot per learner (taken by the send-emails schedule), for performance history.
--   * performance_settings: DRAFT "may need support" thresholds, editable by executives (management decision pending).
-- WHO SEES WHAT (enforced here, not only on screen)
--   * a learner: only their OWN record, and only while their access to that cohort is Active or Expired (read-only results,
--     as decided for migration 19); shared feedback only.
--   * a facilitator: only learners of cohorts they are assigned to; all feedback for those learners.
--   * a mentor: only their own mentees; shared feedback only.
--   * programme staff and executives: everyone.
--   * M&E officers, applicants and everyone else: no individual records (cohort figures come in Phase 7).

-- ============ 1. settings (draft) ============
create table performance_settings (
  id boolean primary key default true check (id),
  support_attendance_below numeric not null default 75 check (support_attendance_below between 0 and 100),
  support_overdue_at_least int not null default 2 check (support_overdue_at_least between 1 and 50),
  support_score_below numeric check (support_score_below is null or support_score_below between 0 and 100),
  is_approved boolean not null default false,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into performance_settings(id) values (true);
alter table performance_settings enable row level security;
create policy perf_settings_read on performance_settings for select to authenticated using (true);
create policy perf_settings_update on performance_settings for update to authenticated using (is_executive()) with check (is_executive());
create or replace function guard_performance_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now(); return new; end $$;
create trigger trg_guard_performance_settings before update on performance_settings for each row execute function guard_performance_settings();
create trigger aud_performance_settings after update on performance_settings for each row execute function audit_row();

-- ============ 2. the calculation (internal: no permission filter, never granted to users) ============
create or replace function _learner_metrics(p_cohort uuid)
returns table(
  participant_id uuid, participant_no text, display_name text, track_id uuid, track_name text, participant_status text, access_status text,
  attendance_records int, attendance_rate numeric, sessions_attended int, core_attended int, core_total int,
  assignments_expected int, submitted int, graded int, returned int, overdue int, late int,
  tasks_pct numeric, tasks_graded int, tasks_total int, final_pct numeric, final_graded int, final_total int,
  reflection_pct numeric, reflection_graded int, reflection_total int,
  overall numeric, provisional boolean, final_submitted boolean, reflection_submitted boolean,
  completion_met boolean, certified boolean, completion_status text, needs_support boolean, support_reasons text[])
language sql stable security definer set search_path = public as $$
  with s as (select * from performance_settings limit 1),
  en as (
    select e.participant_id, e.track_id, pa.participant_no, pa.status::text as pstatus,
           btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) as name
    from cohort_enrolments e join participants pa on pa.id = e.participant_id left join profiles pr on pr.id = pa.profile_id
    where e.cohort_id = p_cohort),
  sch as (
    select ss.id, ss.curriculum_session_id, ss.status::text as status, cs.track_id as cs_track
    from session_schedules ss left join curriculum_sessions cs on cs.id = ss.curriculum_session_id where ss.cohort_id = p_cohort),
  core as (select count(distinct curriculum_session_id)::int as n from sch where cs_track is null),
  att as (   -- the learner's attendance on sessions that apply to them (core or their track), not cancelled
    select en.participant_id, a.status::text as status, sch.curriculum_session_id, (sch.cs_track is null) as is_core
    from en join sch on sch.status <> 'cancelled' and (sch.cs_track is null or sch.cs_track = en.track_id)
    join attendance a on a.schedule_id = sch.id and a.participant_id = en.participant_id),
  att_sum as (
    select en.participant_id,
      count(a.status) filter (where a.status is not null)::int as records,
      count(a.status) filter (where a.status <> 'excused')::int as counted,
      count(a.status) filter (where a.status in ('present', 'late'))::int as attended,
      count(distinct a.curriculum_session_id) filter (where a.status in ('present', 'late'))::int as sessions,
      count(distinct a.curriculum_session_id) filter (where a.status in ('present', 'late') and a.is_core)::int as core_sessions
    from en left join att a on a.participant_id = en.participant_id group by en.participant_id),
  asg as (   -- assignments that apply to each learner (track rule and individual recipients)
    select en.participant_id, x.id, x.component, x.max_score, x.due_at
    from en join assignments x on x.cohort_id = p_cohort and (x.track_id is null or x.track_id = en.track_id)
    where not exists (select 1 from assignment_recipients r where r.assignment_id = x.id)
       or exists (select 1 from assignment_recipients r where r.assignment_id = x.id and r.participant_id = en.participant_id)),
  lat as (   -- the latest attempt per learner and assignment
    select distinct on (sb.participant_id, sb.assignment_id) sb.participant_id, sb.assignment_id, sb.status::text as status, sb.score
    from submissions sb join asg on asg.id = sb.assignment_id and asg.participant_id = sb.participant_id
    order by sb.participant_id, sb.assignment_id, sb.attempt desc),
  per as (
    select asg.participant_id, asg.id, asg.component, asg.max_score, asg.due_at, lat.status, lat.score,
           case when lat.status = 'graded' and asg.max_score is not null and asg.max_score > 0 and lat.score is not null
                then round(lat.score / asg.max_score * 100, 1) end as pct
    from asg left join lat on lat.participant_id = asg.participant_id and lat.assignment_id = asg.id),
  comp as (
    select participant_id, component,
           round(avg(pct), 1) as pct,
           count(pct)::int as graded_n,
           count(*) filter (where max_score is not null)::int as total_n,
           bool_or(status is not null) as any_submitted
    from per group by participant_id, component),
  asg_sum as (
    select participant_id, count(*)::int as expected, count(status)::int as submitted,
           count(*) filter (where status = 'graded')::int as graded, count(*) filter (where status = 'returned')::int as returned,
           count(*) filter (where status is null and due_at is not null and due_at < now())::int as overdue,
           count(*) filter (where status = 'late')::int as late
    from per group by participant_id),
  base as (
    select en.participant_id, en.participant_no, coalesce(nullif(en.name, ''), 'Participant') as display_name, en.track_id, t.name as track_name, en.pstatus,
      learner_access_state(en.participant_id, p_cohort)::text as access_status,
      coalesce(a.records, 0) as records,
      case when coalesce(a.counted, 0) = 0 then null else round(a.attended::numeric / a.counted * 100, 1) end as engagement,
      coalesce(a.sessions, 0) as sessions, coalesce(a.core_sessions, 0) as core_sessions, (select n from core) as core_total,
      coalesce(x.expected, 0) as expected, coalesce(x.submitted, 0) as submitted, coalesce(x.graded, 0) as graded,
      coalesce(x.returned, 0) as returned, coalesce(x.overdue, 0) as overdue, coalesce(x.late, 0) as late,
      ct.pct as t_pct, coalesce(ct.graded_n, 0) as t_graded, coalesce(ct.total_n, 0) as t_total,
      cf.pct as f_pct, coalesce(cf.graded_n, 0) as f_graded, coalesce(cf.total_n, 0) as f_total,
      cr.pct as r_pct, coalesce(cr.graded_n, 0) as r_graded, coalesce(cr.total_n, 0) as r_total,
      coalesce(cf.any_submitted, false) as f_sub, coalesce(cr.any_submitted, false) as r_sub,
      exists (select 1 from certificates c where c.participant_id = en.participant_id and c.cohort_id = p_cohort and not c.revoked) as certified
    from en left join tracks t on t.id = en.track_id left join att_sum a on a.participant_id = en.participant_id
    left join asg_sum x on x.participant_id = en.participant_id
    left join comp ct on ct.participant_id = en.participant_id and ct.component = 'task'
    left join comp cf on cf.participant_id = en.participant_id and cf.component = 'final_project'
    left join comp cr on cr.participant_id = en.participant_id and cr.component = 'reflection'),
  calc as (
    select b.*,
      case when b.engagement is null or b.t_pct is null or b.f_pct is null or b.r_pct is null then null
           else round((b.engagement * 20 + b.t_pct * 30 + b.f_pct * 40 + b.r_pct * 10) / 100, 1) end as overall,
      (b.sessions >= 6 and b.core_total > 0 and b.core_sessions >= b.core_total and b.f_sub and b.r_sub) as met
    from base b)
  select c.participant_id, c.participant_no, c.display_name, c.track_id, c.track_name, c.pstatus, c.access_status,
    c.records, c.engagement, c.sessions, c.core_sessions, c.core_total,
    c.expected, c.submitted, c.graded, c.returned, c.overdue, c.late,
    c.t_pct, c.t_graded, c.t_total, c.f_pct, c.f_graded, c.f_total, c.r_pct, c.r_graded, c.r_total,
    c.overall, (c.overall is not null and (c.t_graded < c.t_total or c.f_graded < c.f_total or c.r_graded < c.r_total)),
    c.f_sub, c.r_sub, c.met, c.certified,
    case when c.certified then 'certified' when c.pstatus = 'withdrawn' then 'withdrawn' when c.met then 'requirements_met' else 'in_progress' end,
    (c.pstatus <> 'withdrawn' and not c.certified and cardinality(r.reasons) > 0),
    case when c.pstatus = 'withdrawn' or c.certified then '{}'::text[] else r.reasons end
  from calc c cross join s
  cross join lateral (select array_remove(array[
      case when c.engagement is not null and c.engagement < s.support_attendance_below then 'attendance' end,
      case when c.overdue >= s.support_overdue_at_least then 'overdue_work' end,
      case when c.returned > 0 then 'work_returned' end,
      case when s.support_score_below is not null and c.overall is not null and c.overall < s.support_score_below then 'low_score' end], null) as reasons) r
  order by c.display_name $$;
revoke all on function _learner_metrics(uuid) from public, anon, authenticated;

-- ============ 3. who may see which learner ============
create or replace function can_view_learner_performance(p_participant uuid, p_cohort uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    is_staff()
    or (app_role() = 'trainer' and p_cohort in (select my_trainer_cohorts()))
    or (app_role() = 'mentor' and mentor_has_mentee(p_participant))
    or (app_role() = 'participant' and p_participant = my_participant_id()
        and learner_access_state(p_participant, p_cohort) in ('active', 'expired')),
    false) $$;

-- Rows the caller may see for one cohort (staff and the cohort's facilitators: all; mentors: mentees; learners: themselves).
create or replace function learner_metrics(p_cohort uuid)
returns table(
  participant_id uuid, participant_no text, display_name text, track_id uuid, track_name text, participant_status text, access_status text,
  attendance_records int, attendance_rate numeric, sessions_attended int, core_attended int, core_total int,
  assignments_expected int, submitted int, graded int, returned int, overdue int, late int,
  tasks_pct numeric, tasks_graded int, tasks_total int, final_pct numeric, final_graded int, final_total int,
  reflection_pct numeric, reflection_graded int, reflection_total int,
  overall numeric, provisional boolean, final_submitted boolean, reflection_submitted boolean,
  completion_met boolean, certified boolean, completion_status text, needs_support boolean, support_reasons text[])
language sql stable security definer set search_path = public as $$
  select m.* from _learner_metrics(p_cohort) m where can_view_learner_performance(m.participant_id, p_cohort) $$;

-- The signed-in learner's own records, one per cohort they may see.
create or replace function my_performance()
returns table(cohort_id uuid, cohort_name text, metrics jsonb)
language sql stable security definer set search_path = public as $$
  select e.cohort_id, co.name, to_jsonb(m)
  from cohort_enrolments e join cohorts co on co.id = e.cohort_id
  cross join lateral (select * from _learner_metrics(e.cohort_id) x where x.participant_id = e.participant_id) m
  where app_role() = 'participant' and e.participant_id = my_participant_id() and can_view_learner_performance(e.participant_id, e.cohort_id)
  order by co.start_date desc $$;

-- ============ 4. facilitator feedback ============
create table learner_feedback (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (length(btrim(body)) between 5 and 2000),
  shared_with_learner boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_learner_feedback on learner_feedback (participant_id, cohort_id, created_at desc);

create or replace function can_give_learner_feedback(p_participant uuid, p_cohort uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (select 1 from cohort_enrolments e where e.participant_id = p_participant and e.cohort_id = p_cohort)
    and (is_staff() or (app_role() = 'trainer' and p_cohort in (select my_trainer_cohorts()))), false) $$;

create or replace function guard_learner_feedback() returns trigger language plpgsql security definer set search_path = public as $$
declare learner_profile uuid;
begin
  if not is_trusted_session() then
    if not can_give_learner_feedback(new.participant_id, new.cohort_id) then
      raise exception 'Only the learner''s facilitators and programme staff can give feedback';
    end if;
    new.author_id := auth.uid();
  end if;
  new.body := btrim(new.body);
  new.created_at := now();
  if new.shared_with_learner then
    select profile_id into learner_profile from participants where id = new.participant_id;
    insert into notifications(user_id, kind, title, body) values (learner_profile, 'feedback', 'New feedback on your progress', 'Open Performance in DIRA LEARN to read it.');
  end if;
  return new;
end $$;
create trigger trg_guard_learner_feedback before insert on learner_feedback for each row execute function guard_learner_feedback();
create or replace function block_feedback_change() returns trigger language plpgsql as $$
begin
  if is_trusted_session() then return coalesce(new, old); end if;
  raise exception 'Feedback cannot be changed or deleted. Add a new note instead';
end $$;
create trigger trg_feedback_no_change before update or delete on learner_feedback for each row execute function block_feedback_change();
create trigger aud_learner_feedback after insert on learner_feedback for each row execute function audit_row();

alter table learner_feedback enable row level security;
create policy lf_read on learner_feedback for select to authenticated using (
  is_staff()
  or (app_role() = 'trainer' and cohort_id in (select my_trainer_cohorts()))
  or (shared_with_learner and app_role() = 'mentor' and mentor_has_mentee(participant_id))
  or (shared_with_learner and app_role() = 'participant' and participant_id = my_participant_id()
      and learner_access_state(participant_id, cohort_id) in ('active', 'expired')));
create policy lf_insert on learner_feedback for insert to authenticated with check (can_give_learner_feedback(participant_id, cohort_id));
-- no update or delete policies: feedback is append-only

-- ============ 5. performance history ============
create table learner_progress_snapshots (
  participant_id uuid not null references participants(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  taken_on date not null,
  attendance_rate numeric, sessions_attended int not null, submitted int not null, graded int not null, overdue int not null,
  overall numeric, completion_status text not null, needs_support boolean not null,
  created_at timestamptz not null default now(),
  primary key (participant_id, cohort_id, taken_on)
);
alter table learner_progress_snapshots enable row level security;
create policy lps_read on learner_progress_snapshots for select to authenticated using (can_view_learner_performance(participant_id, cohort_id));
-- written only by take_progress_snapshots() (no insert/update/delete policies)

-- Run by the send-emails schedule: at most one snapshot per learner per day, for cohorts running now or ended in the last 14 days.
create or replace function take_progress_snapshots() returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; k int;
begin
  for c in select id from cohorts where not archived and start_date <= current_date and end_date >= current_date - 14 loop
    insert into learner_progress_snapshots(participant_id, cohort_id, taken_on, attendance_rate, sessions_attended, submitted, graded, overdue, overall, completion_status, needs_support)
    select m.participant_id, c.id, current_date, m.attendance_rate, m.sessions_attended, m.submitted, m.graded, m.overdue, m.overall, m.completion_status, m.needs_support
    from _learner_metrics(c.id) m
    on conflict (participant_id, cohort_id, taken_on) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

create or replace function learner_performance_history(p_participant uuid, p_cohort uuid)
returns setof learner_progress_snapshots language sql stable security definer set search_path = public as $$
  select * from learner_progress_snapshots s
  where s.participant_id = p_participant and s.cohort_id = p_cohort and can_view_learner_performance(p_participant, p_cohort)
  order by s.taken_on $$;

-- Cohorts the caller may open on the Performance page (mentors cannot list cohorts otherwise).
create or replace function performance_cohorts() returns table(id uuid, name text, start_date date, end_date date) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.start_date, c.end_date from cohorts c
  where is_staff()
     or (app_role() = 'trainer' and c.id in (select my_trainer_cohorts()))
     or (app_role() = 'mentor' and exists (select 1 from cohort_enrolments e join mentorship_assignments m on m.participant_id = e.participant_id
                                            where e.cohort_id = c.id and m.mentor_id = auth.uid()))
  order by c.start_date desc $$;

-- ============ 6. grants ============
revoke all on function can_view_learner_performance(uuid, uuid), learner_metrics(uuid), my_performance(), can_give_learner_feedback(uuid, uuid),
  take_progress_snapshots(), learner_performance_history(uuid, uuid), performance_cohorts() from public, anon;
grant execute on function can_view_learner_performance(uuid, uuid), learner_metrics(uuid), my_performance(), can_give_learner_feedback(uuid, uuid),
  learner_performance_history(uuid, uuid), performance_cohorts() to authenticated;
revoke execute on function take_progress_snapshots() from authenticated;
grant execute on function take_progress_snapshots() to service_role;
