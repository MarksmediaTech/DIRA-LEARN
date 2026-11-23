-- pgTAP tests for application workflow, capacity and scheduling rules. NOT yet executed.
-- Run with `supabase test db` after `supabase db reset`.
begin;
select plan(12);  -- V8 audit: the file contains 12 checks; the old plan said 13

-- fixtures (as superuser)
insert into auth.users(id, instance_id, aud, role, email) values
  ('33333333-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord@test.local'),
  ('33333333-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer1@test.local'),
  ('33333333-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer2@test.local'),
  ('33333333-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','applicant@test.local'),
  ('33333333-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@test2.local'),
  ('33333333-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@test2.local');
update profiles set role='programme_coordinator', status='active' where id = '33333333-0000-0000-0000-000000000001';
update profiles set role='trainer', status='active' where id in ('33333333-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000003');
update profiles set role='participant', status='active' where id in ('33333333-0000-0000-0000-000000000005','33333333-0000-0000-0000-000000000006');
insert into participants(id, profile_id, participant_no) values
  ('44444444-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000005','T-A1'),
  ('44444444-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000006','T-A2');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('55555555-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Test cohort 1', current_date, current_date + 27, 1),
  ('55555555-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','Test cohort 2', current_date, current_date + 27, 5);
insert into trainer_assignments(cohort_id, trainer_id) values
  ('55555555-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002'),
  ('55555555-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000002');
insert into applications(id, applicant_id, programme_id, status) values
  ('66666666-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1','submitted');

-- applicant cannot approve their own application
-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$update applications set status = 'accepted' where id = '66666666-0000-0000-0000-000000000001'$$, null,
  'Application status can only be changed through the review workflow', 'applicant cannot self-accept');

-- coordinator workflow
select set_config('request.jwt.claims', '{"sub":"33333333-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select transition_application('66666666-0000-0000-0000-000000000001','accepted')$$, null,
  'An application cannot move from submitted to accepted', 'cannot skip review');
select lives_ok($$select transition_application('66666666-0000-0000-0000-000000000001','under_review')$$, 'submitted -> under_review');
select throws_ok($$select transition_application('66666666-0000-0000-0000-000000000001','rejected')$$, null,
  'A note is required when rejecting or reconsidering an application', 'rejection needs a note');
select throws_ok($$update applications set status = 'accepted' where id = '66666666-0000-0000-0000-000000000001'$$, null,
  'Application status can only be changed through the review workflow', 'staff cannot bypass the workflow with a direct update');
select is((select count(*)::int from application_events where application_id = '66666666-0000-0000-0000-000000000001' and to_status = 'under_review'), 1, 'transition is logged');

-- capacity and single active cohort
select lives_ok($$insert into cohort_enrolments(cohort_id, participant_id) values ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001')$$, 'enrol within capacity');
select throws_ok($$insert into cohort_enrolments(cohort_id, participant_id) values ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000002')$$, null, 'Cohort is at capacity (1)', 'full cohort rejects enrolment');
select throws_ok($$insert into cohort_enrolments(cohort_id, participant_id) values ('55555555-0000-0000-0000-000000000002','44444444-0000-0000-0000-000000000001')$$, null,
  'This participant is already enrolled in another active cohort', 'one active cohort per participant');

-- scheduling
select lives_ok($$insert into session_schedules(cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at)
  select '55555555-0000-0000-0000-000000000001', id, '33333333-0000-0000-0000-000000000002', (current_date + 1)::timestamptz + interval '8 hours', (current_date + 1)::timestamptz + interval '10 hours'
  from curriculum_sessions where track_id is null and session_no = 1$$, 'schedule a core session');
select throws_ok($$insert into session_schedules(cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at)
  select '55555555-0000-0000-0000-000000000002', id, '33333333-0000-0000-0000-000000000002', (current_date + 1)::timestamptz + interval '9 hours', (current_date + 1)::timestamptz + interval '11 hours'
  from curriculum_sessions where track_id is null and session_no = 2$$, null, 'The trainer already has a session at that time', 'trainer cannot be double booked');
select throws_ok($$insert into session_schedules(cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at)
  select '55555555-0000-0000-0000-000000000002', id, '33333333-0000-0000-0000-000000000003', (current_date + 2)::timestamptz + interval '8 hours', (current_date + 2)::timestamptz + interval '10 hours'
  from curriculum_sessions where track_id is null and session_no = 2$$, null, 'This trainer is not assigned to the cohort', 'unassigned trainer rejected');

select * from finish();
rollback;
