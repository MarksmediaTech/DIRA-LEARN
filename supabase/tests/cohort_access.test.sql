-- pgTAP tests for migration 20260101000018_cohort_access_windows.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(23);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('77770000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca' || n || '@acc.test' from generate_series(1, 9) n;  -- 9 stays an applicant
update profiles set role='programme_director', status='active' where id = '77770000-0000-0000-0000-000000000001';
update profiles set role='participant', status='active' where id in ('77770000-0000-0000-0000-000000000002','77770000-0000-0000-0000-000000000003','77770000-0000-0000-0000-000000000004','77770000-0000-0000-0000-000000000005','77770000-0000-0000-0000-000000000006');
update profiles set role='trainer', status='active' where id = '77770000-0000-0000-0000-000000000007';
update profiles set role='founder', status='active' where id = '77770000-0000-0000-0000-000000000008';
insert into participants(id, profile_id, participant_no) values
  ('77771111-0000-0000-0000-000000000002','77770000-0000-0000-0000-000000000002','ACC-1'),  -- active now
  ('77771111-0000-0000-0000-000000000003','77770000-0000-0000-0000-000000000003','ACC-2'),  -- scheduled (January-style intake)
  ('77771111-0000-0000-0000-000000000004','77770000-0000-0000-0000-000000000004','ACC-3'),  -- expired
  ('77771111-0000-0000-0000-000000000005','77770000-0000-0000-0000-000000000005','ACC-4'),  -- pending (no opening time)
  ('77771111-0000-0000-0000-000000000006','77770000-0000-0000-0000-000000000006','ACC-5');  -- active cohort, later suspended
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at) values
  ('77772222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Open cohort',      current_date - 5, current_date + 30, 10, now() - interval '5 days', now() + interval '30 days'),
  ('77772222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','Future cohort',    current_date + 60, current_date + 90, 10, now() + interval '60 days', now() + interval '90 days'),
  ('77772222-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','Finished cohort',  current_date - 90, current_date - 60, 10, now() - interval '90 days', now() - interval '60 days'),
  ('77772222-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1','Unscheduled cohort', current_date, current_date + 20, 10, null, null);
insert into cohort_enrolments(cohort_id, participant_id) values
  ('77772222-0000-0000-0000-000000000001','77771111-0000-0000-0000-000000000002'),
  ('77772222-0000-0000-0000-000000000002','77771111-0000-0000-0000-000000000003'),
  ('77772222-0000-0000-0000-000000000003','77771111-0000-0000-0000-000000000004'),
  ('77772222-0000-0000-0000-000000000004','77771111-0000-0000-0000-000000000005'),
  ('77772222-0000-0000-0000-000000000001','77771111-0000-0000-0000-000000000006');
insert into assignments(id, cohort_id, title) values
  ('77773333-0000-0000-0000-000000000001','77772222-0000-0000-0000-000000000001','Open cohort task'),
  ('77773333-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000002','Future cohort task'),
  ('77773333-0000-0000-0000-000000000003','77772222-0000-0000-0000-000000000003','Finished cohort task'),
  ('77773333-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000004','Unscheduled cohort task');

-- ---------- the decision function ----------
-- Updated in V8 audit (migration 23): a trusted server session (reminder jobs) gets the real answer; anon has no EXECUTE at all.
select is(learner_access_state('77771111-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000001')::text, 'active', 'a trusted server session (reminder jobs) gets the real status');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(learner_access_state('77771111-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000001')::text, null, 'a signed-in applicant cannot look up a learner''s access (migration 23 fix)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(learner_access_state('77771111-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000001')::text, 'active', 'staff see: inside the window is active');
select is(learner_access_state('77771111-0000-0000-0000-000000000003','77772222-0000-0000-0000-000000000002')::text, 'scheduled', 'before the opening time is scheduled');
select is(learner_access_state('77771111-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000003')::text, 'expired', 'after the closing time is expired');
select is(learner_access_state('77771111-0000-0000-0000-000000000005','77772222-0000-0000-0000-000000000004')::text, 'pending', 'no opening time is pending');
select is(learner_access_state('77771111-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000003')::text, 'pending', 'a learner not enrolled in that cohort is pending');

-- ---------- learners: own cohort only ----------
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 1, 'an active learner sees only their own cohort''s assignment');
select is(learner_access_state('77771111-0000-0000-0000-000000000003','77772222-0000-0000-0000-000000000002')::text, null, 'a learner cannot ask about another learner''s access');
select is((select status::text from my_learning_access()), 'active', 'my_learning_access shows the learner their own status');

select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 0, 'a SCHEDULED learner cannot read assignments early');
select is((select status::text from my_learning_access()), 'scheduled', 'but can see that their access is scheduled');

select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000004","role":"authenticated"}', true);
-- Since migration 19 (DIRA decision 5) an expired learner can still READ their own cohort's assignment titles and marks, nothing else.
select is((select count(*)::int from assignments), 1, 'an EXPIRED learner reads only their own finished cohort''s assignment (read-only, migration 19)');
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 0, 'a PENDING learner cannot read assignments');

-- ---------- staff actions ----------
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select set_learner_access_override('77771111-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000003', null, now() + interval '10 days', 'x')$$, null, 'A written reason is required', 'a reason is required');
select lives_ok($$select set_learner_access_override('77771111-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000003', null, now() + interval '10 days', 'Approved extension for assessment')$$, 'staff can extend one learner');
select is(learner_access_state('77771111-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000003')::text, 'active', 'the extended learner is active again');
select throws_ok($$select set_learner_access_override('77771111-0000-0000-0000-000000000002','77772222-0000-0000-0000-000000000003', null, null, 'not enrolled here')$$, null, 'The learner is not enrolled in this cohort', 'an override needs an enrolment in that cohort');
select lives_ok($$select set_learner_suspension('77771111-0000-0000-0000-000000000006','77772222-0000-0000-0000-000000000001', true, 'Safeguarding review')$$, 'staff can suspend learning access');
select is((select count(*)::int from learner_access_history('77771111-0000-0000-0000-000000000004')), 1, 'the extension is in the access history');

select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 0, 'a SUSPENDED learner cannot read assignments');
select set_config('request.jwt.claims', '{"sub":"77770000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from assignments), 1, 'extending one learner exposes only that learner''s own cohort (not the open cohort)');
select throws_ok($$select set_learner_access_override('77771111-0000-0000-0000-000000000004','77772222-0000-0000-0000-000000000003', null, now() + interval '99 days', 'self service attempt')$$, null, 'Only a super administrator, Founder, Co-Founder or programme director can change learner access', 'a learner cannot extend their own access');

select * from finish();
rollback;
