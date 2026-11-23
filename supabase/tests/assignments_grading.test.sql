-- pgTAP tests for assignments, submissions and grading. NOT yet executed.
begin;
select plan(23);
-- V8 audit: PostgreSQL does not allow UPDATE inside a sub-query, so this helper (removed again by the rollback) counts changed rows.
create function _test_rows_changed(q text) returns int language plpgsql as $f$ declare n int; begin execute q; get diagnostics n = row_count; return n; end $f$;
grant execute on function _test_rows_changed(text) to authenticated;

insert into auth.users(id, instance_id, aud, role, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainerA@asg.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@asg.local'),
  ('bbbbbbbb-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@asg.local'),
  ('bbbbbbbb-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainerB@asg.local');
update profiles set role='trainer', status='active' where id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004');
update profiles set role='participant', status='active' where id in ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003');
insert into participants(id, profile_id, participant_no) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','T-A1'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003','T-A2');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Assignments cohort', current_date - 2, current_date + 20, 10);
-- only participant 1 is enrolled; participant 2 is an outsider
insert into cohort_enrolments(cohort_id, participant_id) values ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001');
insert into trainer_assignments(cohort_id, trainer_id) values ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001');
-- A1: marked out of 20, resubmission allowed, due in future.  A2: feedback only, no resubmission, already past due.
insert into assignments(id, cohort_id, title, due_at, allow_resubmission, max_score) values
  ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Quiz one', now() + interval '3 days', true, 20),
  ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','Reflection', now() - interval '1 day', false, null);

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;

-- participant 2 (not enrolled)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$insert into submissions(assignment_id, participant_id, body) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','hello')$$,
  null, null, 'a participant who is not enrolled cannot submit');

-- participant 1
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$insert into submissions(assignment_id, participant_id, body) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','   ')$$,
  null, 'Add your answer or attach a file', 'an empty submission is rejected');
select lives_ok($$insert into submissions(assignment_id, participant_id, body, status, score, attempt) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','My answer','graded',99,5)$$,
  'participant submits (trying to set status, score and attempt)');
select is((select attempt::text || '/' || status::text || '/' || coalesce(score::text, 'none') from submissions where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  '1/submitted/none', 'the database ignores the spoofed status, score and attempt');
select throws_ok($$insert into submissions(assignment_id, participant_id, body) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Again')$$,
  null, 'You can submit again only after your trainer returns your work', 'no second attempt while the work is with the trainer');
select lives_ok($$insert into submissions(assignment_id, participant_id, body) values ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001','Late reflection')$$,
  'participant submits after the due date');
select is((select status::text from submissions where assignment_id = 'eeeeeeee-0000-0000-0000-000000000002'), 'late', 'work after the due date is flagged late');
select is(_test_rows_changed($$update submissions set score = 20, status = 'graded' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$),
  0, 'a participant cannot grade their own work');

-- trainer B (not assigned to the cohort)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from submissions), 0, 'an unassigned trainer sees no submissions');

-- trainer A
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from submissions), 2, 'the cohort trainer sees both submissions');
select throws_ok($$update submissions set body = 'edited' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  null, 'Submitted work cannot be changed', 'a trainer cannot edit submitted work');
-- since migration 38 the command is not granted at all (no RLS policy allows it), so the database refuses it outright
select throws_ok($$delete from submissions where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '42501', null, 'a trainer cannot delete submissions');
select throws_ok($$update submissions set status = 'graded', score = 25 where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'P0001', null, 'a score above the maximum is rejected');
select throws_ok($$update submissions set status = 'returned', feedback = '  ' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  null, 'Say what needs to change before returning the work', 'returning work needs feedback');
select lives_ok($$update submissions set status = 'graded', score = 15, feedback = 'Good' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'trainer grades within range');
select is((select graded_by from submissions where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'the grader is recorded by the database');
select lives_ok($$update submissions set status = 'returned', score = null, feedback = 'Add your sources' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  'trainer returns work for revision');
select throws_ok($$update submissions set status = 'graded', score = 5 where assignment_id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  null, 'This assignment has no marks; give feedback only', 'a feedback-only assignment takes no score');
select throws_ok($$update submissions set status = 'returned', feedback = 'Redo' where assignment_id = 'eeeeeeee-0000-0000-0000-000000000002'$$,
  null, 'This assignment does not allow resubmission', 'work cannot be returned when resubmission is off');

-- participant 1 resubmits
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$insert into submissions(assignment_id, participant_id, body) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Better answer')$$,
  'participant resubmits after the work is returned');

-- trainer A again
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$update submissions set status = 'graded', score = 10 where assignment_id = 'eeeeeeee-0000-0000-0000-000000000001' and attempt = 1$$,
  null, 'Only the latest attempt can be graded', 'an older attempt can no longer be graded');
select throws_ok($$update assignments set max_score = 50 where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  null, 'Cohort, track and maximum score cannot change once submissions exist', 'the marking scale is locked once work is in');
select throws_ok($$delete from assignments where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  null, 'This assignment already has submissions and cannot be deleted', 'an assignment with submissions cannot be deleted');

select * from finish();
rollback;
