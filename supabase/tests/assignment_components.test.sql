-- pgTAP tests for assignment components (migration 8). NOT yet executed.
begin;
select plan(5);

insert into auth.users(id, instance_id, aud, role, email) values
  ('ffffffff-1000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@comp.local');
update profiles set role='participant', status='active' where id = 'ffffffff-1000-0000-0000-000000000001';
insert into participants(id, profile_id, participant_no, status) values
  ('12121212-1000-0000-0000-000000000001','ffffffff-1000-0000-0000-000000000001','T-C1','active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('13131313-1000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Component cohort', current_date - 2, current_date + 20, 10);
insert into cohort_enrolments(cohort_id, participant_id) values ('13131313-1000-0000-0000-000000000001','12121212-1000-0000-0000-000000000001');

insert into assignments(id, cohort_id, title, max_score) values
  ('14141414-1000-0000-0000-000000000001','13131313-1000-0000-0000-000000000001','No submissions yet', 100),
  ('14141414-1000-0000-0000-000000000002','13131313-1000-0000-0000-000000000001','Has a submission', 100);

select is((select component from assignments where id = '14141414-1000-0000-0000-000000000001'), 'task', 'a new assignment counts as a session task by default');
select throws_ok($$insert into assignments(cohort_id, title, component) values ('13131313-1000-0000-0000-000000000001','Bad','exam')$$, '23514', null, 'an unknown component is rejected');
select lives_ok($$update assignments set component = 'final_project' where id = '14141414-1000-0000-0000-000000000001'$$, 'the component can change while there are no submissions');

insert into submissions(assignment_id, participant_id, body) values ('14141414-1000-0000-0000-000000000002','12121212-1000-0000-0000-000000000001','my work');
select throws_ok($$update assignments set component = 'reflection' where id = '14141414-1000-0000-0000-000000000002'$$, 'P0001', 'The assessment component cannot change once submissions exist', 'the component is locked once work is handed in');
select lives_ok($$update assignments set title = 'Renamed' where id = '14141414-1000-0000-0000-000000000002'$$, 'other fields can still change');

select * from finish();
rollback;
