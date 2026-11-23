-- pgTAP tests for the trainer session flow and curriculum administration. NOT yet executed.
begin;
select plan(11);

insert into auth.users(id, instance_id, aud, role, email) values
  ('77777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord2@test.local'),
  ('77777777-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainerA@test.local'),
  ('77777777-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainerB@test.local'),
  ('77777777-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','director@test.local'),
  ('77777777-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','part@test3.local');
update profiles set role='programme_coordinator', status='active' where id = '77777777-0000-0000-0000-000000000001';
update profiles set role='trainer', status='active' where id in ('77777777-0000-0000-0000-000000000002','77777777-0000-0000-0000-000000000003');
update profiles set role='programme_director', status='active' where id = '77777777-0000-0000-0000-000000000004';
update profiles set role='participant', status='active' where id = '77777777-0000-0000-0000-000000000005';
insert into participants(id, profile_id, participant_no) values ('88888888-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000005','T-S1');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('99999999-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Session test cohort', current_date - 2, current_date + 20, 10);
insert into cohort_enrolments(cohort_id, participant_id) values ('99999999-0000-0000-0000-000000000001','88888888-0000-0000-0000-000000000001');
insert into trainer_assignments(cohort_id, trainer_id) values ('99999999-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002');
insert into session_schedules(id, cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at)
  select 'aaaaaaaa-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000001', id, '77777777-0000-0000-0000-000000000002', now() - interval '3 hours', now() - interval '1 hour'
  from curriculum_sessions where track_id is null and session_no = 1;
-- future session, for the "not started" rule (inserted as superuser; triggers still apply)
insert into session_schedules(id, cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at)
  select 'aaaaaaaa-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000001', id, '77777777-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 2 hours'
  from curriculum_sessions where track_id is null and session_no = 2;

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;
-- trainer B (not assigned) cannot complete or report
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select complete_session('aaaaaaaa-0000-0000-0000-000000000001')$$, null, 'You cannot manage this session', 'unassigned trainer cannot complete a session');
select is((select count(*)::int from session_reports), 0, 'unassigned trainer sees no reports');

-- trainer A
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select complete_session('aaaaaaaa-0000-0000-0000-000000000001')$$, null, 'Attendance is missing for 1 participant(s)', 'cannot complete without attendance');
select lives_ok($$insert into attendance(schedule_id, participant_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001','88888888-0000-0000-0000-000000000001','present')$$, 'trainer records attendance');
select lives_ok($$insert into session_reports(schedule_id, summary) values ('aaaaaaaa-0000-0000-0000-000000000001','Covered all activities')$$, 'trainer writes a delivery report');
select lives_ok($$select complete_session('aaaaaaaa-0000-0000-0000-000000000001')$$, 'complete once attendance is in');
select throws_ok($$select complete_session('aaaaaaaa-0000-0000-0000-000000000002')$$, null, 'This session has not started yet', 'cannot complete a future session');

-- curriculum: coordinator edits, director approves, edits reset approval
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select set_curriculum_approval((select id from curriculum_sessions where track_id is null and session_no = 1), true)$$, null,
  'Only a super administrator or programme director can approve curriculum content', 'coordinator cannot approve');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$select set_curriculum_approval((select id from curriculum_sessions where track_id is null and session_no = 1), true)$$, 'director can approve');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$update curriculum_sessions set expected_output = 'Edited output' where track_id is null and session_no = 1$$, 'coordinator edits content');
select is((select is_approved from curriculum_sessions where track_id is null and session_no = 1), false, 'editing approved content sends it back to draft');

select * from finish();
rollback;
