-- DIRA LEARN: Phase 7 – Cohort Intelligence.
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000028_cohort_intelligence_down.sql
--
-- Read-only reporting built on the Phase 6 calculation (_learner_metrics), so cohort figures always agree with each
-- learner's own figures. Adds one column: submissions.graded_at (set by the database when work is graded or returned),
-- needed for grading turnaround. Existing submissions keep graded_at empty.
-- WHO SEES WHAT
--   * Intake, cohort/track comparison and support reports: programme staff, executives and M&E officers (aggregates only;
--     application counts are hidden from M&E officers, as on the existing Analytics page).
--   * Facilitator report: programme staff and executives; a facilitator sees only their own rows.
--   * Learner list across cohorts: programme staff and executives only (individual records).
--   * Safeguarding totals: ONLY the designated Safeguarding Lead and Deputy. No names, no details.

-- ============ 1. grading time ============
alter table submissions add column graded_at timestamptz;
create or replace function set_submission_graded_at() returns trigger language plpgsql as $$
begin
  if new.status in ('graded', 'returned') and (new.status is distinct from old.status or new.score is distinct from old.score or new.feedback is distinct from old.feedback) then
    new.graded_at := now();
  else
    new.graded_at := old.graded_at;
  end if;
  return new;
end $$;
-- named to run after trg_guard_submission (triggers run in name order)
create trigger trg_submission_graded_at before update on submissions for each row execute function set_submission_graded_at();

-- ============ 2. access ============
create or replace function ci_can_view() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_staff() or app_role() = 'me_officer', false) $$;

-- ============ 3. intake and recruitment ============
create or replace function ci_intake()
returns table(cohort_id uuid, cohort_name text, intake_label text, season text, start_date date, end_date date,
              recruitment_opens_on date, recruitment_closes_on date, capacity int, enrolled int, withdrawn int, fill_pct numeric,
              tracks jsonb, applications_in_window int, accepted_in_window int, rejected_in_window int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.intake_label, c.season, c.start_date, c.end_date, c.recruitment_opens_on, c.recruitment_closes_on, c.capacity,
    (select count(*)::int from cohort_enrolments e where e.cohort_id = c.id),
    (select count(*)::int from cohort_enrolments e join participants p on p.id = e.participant_id where e.cohort_id = c.id and p.status = 'withdrawn'),
    case when c.capacity > 0 then round(100.0 * (select count(*) from cohort_enrolments e where e.cohort_id = c.id) / c.capacity, 1) end,
    coalesce((select jsonb_agg(jsonb_build_object('track', coalesce(t.name, 'No track yet'), 'learners', x.n) order by t.position nulls last)
              from (select e.track_id, count(*)::int as n from cohort_enrolments e where e.cohort_id = c.id group by e.track_id) x
              left join tracks t on t.id = x.track_id), '[]'::jsonb),
    -- applications are programme-wide, not tied to a cohort: counted by submission date inside the recruitment window
    case when is_staff() and c.recruitment_opens_on is not null and c.recruitment_closes_on is not null then
      (select count(*)::int from applications a where a.programme_id = c.programme_id and a.status <> 'draft'
         and a.submitted_at >= c.recruitment_opens_on and a.submitted_at < c.recruitment_closes_on + 1) end,
    case when is_staff() and c.recruitment_opens_on is not null and c.recruitment_closes_on is not null then
      (select count(*)::int from applications a where a.programme_id = c.programme_id and a.status = 'accepted'
         and a.submitted_at >= c.recruitment_opens_on and a.submitted_at < c.recruitment_closes_on + 1) end,
    case when is_staff() and c.recruitment_opens_on is not null and c.recruitment_closes_on is not null then
      (select count(*)::int from applications a where a.programme_id = c.programme_id and a.status = 'rejected'
         and a.submitted_at >= c.recruitment_opens_on and a.submitted_at < c.recruitment_closes_on + 1) end
  from cohorts c where ci_can_view() order by c.start_date desc $$;

-- ============ 4. cohort and track comparison ============
create or replace function ci_cohort_comparison()
returns table(cohort_id uuid, cohort_name text, track_id uuid, track_name text, level text, start_date date,
              learners int, active_learners int, withdrawn int, avg_attendance numeric, submission_rate numeric, overdue int,
              avg_tasks numeric, avg_final numeric, avg_overall numeric, results_count int,
              requirements_met int, certified int, completion_rate numeric, needs_support int)
language sql stable security definer set search_path = public as $$
  with m as (
    select c.id as cohort_id, c.name as cohort_name, c.start_date, x.*
    from cohorts c cross join lateral _learner_metrics(c.id) x where ci_can_view()),
  grouped as (
    select cohort_id, cohort_name, start_date, track_id, track_name, grouping(track_id, track_name) as g,
      count(*)::int as learners,
      count(*) filter (where participant_status <> 'withdrawn')::int as active_learners,
      count(*) filter (where participant_status = 'withdrawn')::int as withdrawn,
      round(avg(attendance_rate) filter (where participant_status <> 'withdrawn'), 1) as avg_attendance,
      case when sum(assignments_expected) filter (where participant_status <> 'withdrawn') > 0
           then round(100.0 * sum(submitted) filter (where participant_status <> 'withdrawn') / sum(assignments_expected) filter (where participant_status <> 'withdrawn'), 1) end as submission_rate,
      coalesce(sum(overdue) filter (where participant_status <> 'withdrawn'), 0)::int as overdue,
      round(avg(tasks_pct) filter (where participant_status <> 'withdrawn'), 1) as avg_tasks,
      round(avg(final_pct) filter (where participant_status <> 'withdrawn'), 1) as avg_final,
      round(avg(overall) filter (where participant_status <> 'withdrawn'), 1) as avg_overall,
      count(overall) filter (where participant_status <> 'withdrawn')::int as results_count,
      count(*) filter (where completion_status = 'requirements_met')::int as requirements_met,
      count(*) filter (where completion_status = 'certified')::int as certified,
      case when count(*) filter (where participant_status <> 'withdrawn') > 0
           then round(100.0 * count(*) filter (where completion_status in ('requirements_met', 'certified')) / count(*) filter (where participant_status <> 'withdrawn'), 1) end as completion_rate,
      count(*) filter (where needs_support)::int as needs_support
    from m group by grouping sets ((cohort_id, cohort_name, start_date), (cohort_id, cohort_name, start_date, track_id, track_name)))
  select cohort_id, cohort_name, track_id, case when g = 0 then coalesce(track_name, 'No track yet') end, case when g = 0 then 'track' else 'cohort' end, start_date,
    learners, active_learners, withdrawn, avg_attendance, submission_rate, overdue, avg_tasks, avg_final, avg_overall, results_count,
    requirements_met, certified, completion_rate, needs_support
  from grouped order by start_date desc, cohort_name, g desc, track_name nulls first $$;

-- ============ 5. facilitators ============
create or replace function ci_facilitators()
returns table(trainer_id uuid, trainer_name text, cohort_id uuid, cohort_name text, sessions_scheduled int, sessions_completed int,
              sessions_cancelled int, reports_filed int, learners int, avg_attendance numeric, awaiting_grading int,
              graded_with_time int, avg_turnaround_hours numeric, feedback_notes int)
language sql stable security definer set search_path = public as $$
  select ta.trainer_id, btrim(p.first_name || ' ' || p.last_name), c.id, c.name,
    (select count(*)::int from session_schedules s where s.cohort_id = c.id and s.trainer_id = ta.trainer_id),
    (select count(*)::int from session_schedules s where s.cohort_id = c.id and s.trainer_id = ta.trainer_id and s.status = 'completed'),
    (select count(*)::int from session_schedules s where s.cohort_id = c.id and s.trainer_id = ta.trainer_id and s.status = 'cancelled'),
    (select count(*)::int from session_schedules s join session_reports r on r.schedule_id = s.id where s.cohort_id = c.id and s.trainer_id = ta.trainer_id),
    (select count(*)::int from cohort_enrolments e where e.cohort_id = c.id),
    (select round(avg(x.attendance_rate) filter (where x.participant_status <> 'withdrawn'), 1) from _learner_metrics(c.id) x),
    -- latest attempts in this cohort waiting for a grade
    (select count(*)::int from submissions sb join assignments a on a.id = sb.assignment_id
      where a.cohort_id = c.id and sb.status in ('submitted', 'late')
        and not exists (select 1 from submissions n where n.assignment_id = sb.assignment_id and n.participant_id = sb.participant_id and n.attempt > sb.attempt)),
    (select count(*)::int from submissions sb join assignments a on a.id = sb.assignment_id where a.cohort_id = c.id and sb.graded_by = ta.trainer_id and sb.graded_at is not null),
    (select round(avg(extract(epoch from (sb.graded_at - sb.submitted_at)) / 3600)::numeric, 1) from submissions sb join assignments a on a.id = sb.assignment_id
      where a.cohort_id = c.id and sb.graded_by = ta.trainer_id and sb.graded_at is not null),
    (select count(*)::int from learner_feedback f where f.cohort_id = c.id and f.author_id = ta.trainer_id)
  from trainer_assignments ta join cohorts c on c.id = ta.cohort_id join profiles p on p.id = ta.trainer_id
  where is_staff() or (app_role() = 'trainer' and ta.trainer_id = auth.uid())
  order by c.start_date desc, 2 $$;

-- ============ 6. learners across cohorts (staff only) ============
create or replace function ci_learners()
returns table(cohort_id uuid, cohort_name text, participant_id uuid, participant_no text, display_name text, track_name text,
              participant_status text, access_status text, attendance_rate numeric, submitted int, assignments_expected int, overdue int,
              overall numeric, completion_status text, needs_support boolean, support_reasons text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.name, x.participant_id, x.participant_no, x.display_name, x.track_name, x.participant_status, x.access_status, x.attendance_rate,
         x.submitted, x.assignments_expected, x.overdue, x.overall, x.completion_status, x.needs_support, x.support_reasons
  from cohorts c cross join lateral _learner_metrics(c.id) x
  where is_staff() order by c.start_date desc, x.display_name $$;

-- ============ 7. support and interventions (aggregates) ============
create or replace function ci_support()
returns table(cohort_id uuid, cohort_name text, learners int, needs_support int, low_attendance int, with_overdue_work int, with_returned_work int,
              access_scheduled int, access_expired int, access_suspended int, reports_open int, reports_escalated int, reports_closed int,
              active_mutes int, closed_access_support_messages_30d int, feedback_notes int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, count(x.participant_id)::int,
    count(*) filter (where x.needs_support)::int,
    count(*) filter (where 'attendance' = any(x.support_reasons))::int,
    count(*) filter (where 'overdue_work' = any(x.support_reasons))::int,
    count(*) filter (where 'work_returned' = any(x.support_reasons))::int,
    count(*) filter (where x.access_status in ('scheduled', 'pending'))::int,
    count(*) filter (where x.access_status = 'expired')::int,
    count(*) filter (where x.access_status = 'suspended')::int,
    (select count(*)::int from connect_reports r join connect_conversations cv on cv.id = r.conversation_id
      where r.status = 'open' and (cv.cohort_id = c.id or cv.learner_id in (select e.participant_id from cohort_enrolments e where e.cohort_id = c.id))),
    (select count(*)::int from connect_reports r join connect_conversations cv on cv.id = r.conversation_id
      where r.status = 'escalated' and (cv.cohort_id = c.id or cv.learner_id in (select e.participant_id from cohort_enrolments e where e.cohort_id = c.id))),
    (select count(*)::int from connect_reports r join connect_conversations cv on cv.id = r.conversation_id
      where r.status in ('dismissed', 'hidden') and (cv.cohort_id = c.id or cv.learner_id in (select e.participant_id from cohort_enrolments e where e.cohort_id = c.id))),
    (select count(*)::int from connect_mutes mu join participants pa on pa.profile_id = mu.profile_id join cohort_enrolments e on e.participant_id = pa.id
      where e.cohort_id = c.id and mu.until > now()),
    -- private (not safeguarding) messages sent in the last 30 days by learners whose access to this cohort is not active
    (select count(*)::int from connect_messages m join connect_conversations cv on cv.id = m.conversation_id and cv.kind = 'direct'
      join participants pa on pa.id = cv.learner_id
      where m.sender_id = pa.profile_id and m.created_at > now() - interval '30 days'
        and exists (select 1 from cohort_enrolments e where e.cohort_id = c.id and e.participant_id = pa.id)
        and learner_access_state(pa.id, c.id) <> 'active'),
    (select count(*)::int from learner_feedback f where f.cohort_id = c.id)
  from cohorts c left join lateral _learner_metrics(c.id) x on true
  where ci_can_view() group by c.id, c.name, c.start_date order by c.start_date desc $$;

-- ============ 8. safeguarding totals: officers only ============
create or replace function ci_safeguarding_summary()
returns table(cohort_name text, open_count int, acknowledged_or_active int, resolved_or_closed int, urgent int, overdue_ack int, legal_holds int)
language sql stable security definer set search_path = public as $$
  with r as (
    select s.*, (select co.name from cohort_enrolments e join cohorts co on co.id = e.cohort_id where e.participant_id = s.participant_id order by co.start_date desc limit 1) as cohort_name
    from safeguarding_records s where is_safeguarding_officer())
  select coalesce(cohort_name, 'Not linked to a learner'),
    count(*) filter (where status = 'open')::int,
    count(*) filter (where status in ('acknowledged', 'in_progress', 'referred', 'under_review'))::int,
    count(*) filter (where status in ('resolved', 'closed'))::int,
    count(*) filter (where urgency = 'urgent')::int,
    count(*) filter (where status = 'open' and acknowledged_at is null and ack_due_at < now())::int,
    count(*) filter (where legal_hold)::int
  from r group by 1 order by 1 $$;

-- ============ 9. grants ============
revoke all on function ci_can_view(), ci_intake(), ci_cohort_comparison(), ci_facilitators(), ci_learners(), ci_support(), ci_safeguarding_summary() from public, anon;
grant execute on function ci_can_view(), ci_intake(), ci_cohort_comparison(), ci_facilitators(), ci_learners(), ci_support(), ci_safeguarding_summary() to authenticated;
