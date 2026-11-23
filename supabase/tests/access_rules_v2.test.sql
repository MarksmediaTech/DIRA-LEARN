-- pgTAP tests for migration 20260101000019_access_rules_v2.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(17);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('66660000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v2' || n || '@acc2.test' from generate_series(1, 6) n;
update profiles set role='programme_coordinator', status='active' where id = '66660000-0000-0000-0000-000000000001';
update profiles set role='programme_director',    status='active' where id = '66660000-0000-0000-0000-000000000002';
update profiles set role='participant', status='active' where id in ('66660000-0000-0000-0000-000000000003','66660000-0000-0000-0000-000000000004','66660000-0000-0000-0000-000000000005','66660000-0000-0000-0000-000000000006');
insert into participants(id, profile_id, participant_no) values
  ('66661111-0000-0000-0000-000000000003','66660000-0000-0000-0000-000000000003','V2-1'),  -- active
  ('66661111-0000-0000-0000-000000000004','66660000-0000-0000-0000-000000000004','V2-2'),  -- expired
  ('66661111-0000-0000-0000-000000000005','66660000-0000-0000-0000-000000000005','V2-3'),  -- withdrawn
  ('66661111-0000-0000-0000-000000000006','66660000-0000-0000-0000-000000000006','V2-4');  -- scheduled
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at) values
  ('66662222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','V2 open',     current_date - 5,  current_date + 30, 10, now() - interval '5 days',  now() + interval '30 days'),
  ('66662222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','V2 finished', current_date - 90, current_date - 60, 10, now() - interval '90 days', now() - interval '60 days'),
  ('66662222-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','V2 future',   current_date + 60, current_date + 90, 10, now() + interval '60 days', now() + interval '90 days');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('66662222-0000-0000-0000-000000000001','66661111-0000-0000-0000-000000000003'),
  ('66662222-0000-0000-0000-000000000002','66661111-0000-0000-0000-000000000004'),
  ('66662222-0000-0000-0000-000000000001','66661111-0000-0000-0000-000000000005'),
  ('66662222-0000-0000-0000-000000000003','66661111-0000-0000-0000-000000000006');
insert into assignments(id, cohort_id, title) values
  ('66663333-0000-0000-0000-000000000001','66662222-0000-0000-0000-000000000001','V2 open task'),
  ('66663333-0000-0000-0000-000000000002','66662222-0000-0000-0000-000000000002','V2 finished task');
insert into submissions(id, assignment_id, participant_id, body) values
  ('66664444-0000-0000-0000-000000000001','66663333-0000-0000-0000-000000000002','66661111-0000-0000-0000-000000000004','My finished work');
update participants set status = 'withdrawn' where id = '66661111-0000-0000-0000-000000000005';

-- ---------- 1. time zone ----------
select is((select timezone from programmes limit 1), 'Africa/Nairobi', 'the programme time zone defaults to Africa/Nairobi, as the existing reminders use');
select throws_ok($$update programmes set timezone = 'Not/AZone'$$, null, null, 'an unknown time zone is rejected');

-- ---------- 2. withdrawal closes access ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(learner_access_state('66661111-0000-0000-0000-000000000005','66662222-0000-0000-0000-000000000001')::text, 'suspended', 'a withdrawn learner is suspended automatically');
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 0, 'a withdrawn learner cannot read assignments');

-- ---------- 3. who may change access ----------
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not can_manage_learner_access(), 'the coordinator cannot manage learner access');
select throws_ok($$select set_learner_suspension('66661111-0000-0000-0000-000000000003','66662222-0000-0000-0000-000000000001', true, 'coordinator attempt')$$, null, null, 'the coordinator cannot suspend a learner');
select throws_ok($$update cohorts set access_closes_at = now() + interval '200 days' where id = '66662222-0000-0000-0000-000000000001'$$, null, null, 'the coordinator cannot change a cohort''s access times');
select lives_ok($$update cohorts set capacity = 12 where id = '66662222-0000-0000-0000-000000000001'$$, 'the coordinator can still edit other cohort fields');
select lives_ok($$insert into cohorts(programme_id, name, start_date, end_date, capacity) values ('00000000-0000-0000-0000-0000000000a1','Coordinator cohort', current_date, current_date + 10, 5)$$, 'the coordinator can create a cohort without access times');
select is((select count(*)::int from cohort_access_roster('66662222-0000-0000-0000-000000000001')), 2, 'the coordinator can still see the access roster');

select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select set_learner_access_override('66661111-0000-0000-0000-000000000006','66662222-0000-0000-0000-000000000003', now() - interval '1 hour', now() + interval '20 days', 'Early start approved')$$, 'the programme director can change one learner''s access');

-- ---------- 4. notification: tells the learner, never shows the reason ----------
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from notifications where kind = 'access'), 1, 'the learner gets an in-app note when their access changes');
select ok((select body from notifications where kind = 'access' limit 1) not like '%Early start approved%', 'the note never contains the staff reason');

-- ---------- 5. results after expiry ----------
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from submissions), 1, 'an EXPIRED learner can still read their own submission and feedback');
select is((select count(*)::int from assignments), 1, 'and the assignment it belongs to (read-only)');
select throws_ok($$insert into submissions(assignment_id, participant_id, body) values ('66663333-0000-0000-0000-000000000002','66661111-0000-0000-0000-000000000004','Late attempt')$$, null, null, 'but an expired learner cannot submit');

select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from submissions), 0, 'an active learner sees no one else''s submissions');

select * from finish();
rollback;
