-- pgTAP tests for migration 20260101000020_individual_assignments.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(16);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('55550000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ia' || n || '@ia.test' from generate_series(1, 6) n;
update profiles set role='programme_coordinator', status='active' where id = '55550000-0000-0000-0000-000000000001';
update profiles set role='trainer', status='active' where id in ('55550000-0000-0000-0000-000000000002','55550000-0000-0000-0000-000000000003');
update profiles set role='participant', status='active' where id in ('55550000-0000-0000-0000-000000000004','55550000-0000-0000-0000-000000000005','55550000-0000-0000-0000-000000000006');
insert into participants(id, profile_id, participant_no) values
  ('55551111-0000-0000-0000-000000000004','55550000-0000-0000-0000-000000000004','IA-A'),   -- recipient
  ('55551111-0000-0000-0000-000000000005','55550000-0000-0000-0000-000000000005','IA-B'),   -- same cohort, not a recipient
  ('55551111-0000-0000-0000-000000000006','55550000-0000-0000-0000-000000000006','IA-C');   -- not in the cohort
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('55552222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','IA cohort',  current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('55552222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','IA other',   current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('55552222-0000-0000-0000-000000000001','55551111-0000-0000-0000-000000000004'),
  ('55552222-0000-0000-0000-000000000001','55551111-0000-0000-0000-000000000005'),
  ('55552222-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000006');
insert into trainer_assignments(cohort_id, trainer_id) values
  ('55552222-0000-0000-0000-000000000001','55550000-0000-0000-0000-000000000002'),
  ('55552222-0000-0000-0000-000000000002','55550000-0000-0000-0000-000000000003');
insert into assignments(id, cohort_id, title, due_at) values
  ('55553333-0000-0000-0000-000000000001','55552222-0000-0000-0000-000000000001','Whole cohort task', now() + interval '5 days'),
  ('55553333-0000-0000-0000-000000000002','55552222-0000-0000-0000-000000000001','One learner task',  now() + interval '5 days');

-- ---------- staff and trainers choose recipients ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$insert into assignment_recipients(assignment_id, participant_id) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000004')$$, 'staff can assign work to one learner');
select throws_ok($$insert into assignment_recipients(assignment_id, participant_id) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000006')$$, null, 'That learner is not enrolled for this assignment', 'a learner from another cohort cannot be chosen');
select is((select count(*)::int from assignment_recipients), 1, 'staff see the recipient list');

select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$insert into assignment_recipients(assignment_id, participant_id) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000005')$$, null, null, 'a trainer of a different cohort cannot choose recipients');
select is((select count(*)::int from assignments), 0, 'a trainer of another cohort sees none of this cohort''s assignments');

select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 2, 'the cohort''s own trainer sees both assignments');
select lives_ok($$insert into assignment_recipients(assignment_id, participant_id) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000004') on conflict do nothing$$, 'the cohort''s own trainer can manage recipients');

-- ---------- learners ----------
select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 2, 'the chosen learner sees the whole-cohort task and their own task');
select is((select count(*)::int from assignment_recipients), 1, 'and sees only their own recipient row');
select lives_ok($$insert into submissions(assignment_id, participant_id, body) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000004','My individual work')$$, 'the chosen learner can submit');
select throws_ok($$insert into assignment_recipients(assignment_id, participant_id) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000005')$$, null, null, 'a learner cannot assign work to anyone');

select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 1, 'a learner who was not chosen sees only the whole-cohort task');
select is((select count(*)::int from assignment_recipients), 0, 'and cannot see who else was chosen');
select throws_ok($$insert into submissions(assignment_id, participant_id, body) values ('55553333-0000-0000-0000-000000000002','55551111-0000-0000-0000-000000000005','Sneaky work')$$, null, 'This assignment was not assigned to you', 'and cannot submit to the individual task');
select lives_ok($$insert into submissions(assignment_id, participant_id, body) values ('55553333-0000-0000-0000-000000000001','55551111-0000-0000-0000-000000000005','Whole cohort work')$$, 'but can still submit the whole-cohort task');

-- ---------- work already submitted cannot be unassigned ----------
select set_config('request.jwt.claims', '{"sub":"55550000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$delete from assignment_recipients where assignment_id = '55553333-0000-0000-0000-000000000002' and participant_id = '55551111-0000-0000-0000-000000000004'$$, null, 'This learner has already submitted, so the assignment cannot be taken away', 'a recipient who has submitted cannot be removed');

select * from finish();
rollback;
