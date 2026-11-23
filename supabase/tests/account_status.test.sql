-- pgTAP tests for migration 20260101000034 (account status enforcement, post-audit fix H1/M1, 20 Nov 2026).
-- Two cohorts, every affected role. "Existing session" = the same JWT claims are used before and after the change:
-- access is decided by the profile as it is now, never by what the token says.
begin;
select plan(50);

-- ---------- fixtures (disposable, rolled back) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('34340000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@m34.test'
from generate_series(1, 10) n;
-- 1 super admin A1, 2 super admin A2, 3 founder, 4 coordinator, 5 trainer TA (cohort A), 6 trainer TB (cohort B),
-- 7 mentor (of L2), 8 learner L1 (A), 9 learner L2 (A), 10 learner L4 (B)
update profiles p set role = r.role::role_code, status = 'active' from (values
  (1, 'super_admin'), (2, 'super_admin'), (3, 'founder'), (4, 'programme_coordinator'), (5, 'trainer'), (6, 'trainer'),
  (7, 'mentor'), (8, 'participant'), (9, 'participant'), (10, 'participant')) r(n, role)
where p.id = ('34340000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid;

set local session_replication_role = replica;   -- plant records directly (test transaction only)
insert into participants(id, profile_id, participant_no, status) values
  ('34341111-0000-0000-0000-000000000008', '34340000-0000-0000-0000-000000000008', 'M34-8', 'active'),
  ('34341111-0000-0000-0000-000000000009', '34340000-0000-0000-0000-000000000009', 'M34-9', 'active'),
  ('34341111-0000-0000-0000-000000000010', '34340000-0000-0000-0000-000000000010', 'M34-10', 'active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at)
select x.id::uuid, (select id from programmes limit 1), x.n, current_date - 7, current_date + 21, 30, now() - interval '7 days', now() + interval '60 days'
from (values ('34342222-0000-0000-0000-00000000000a', 'M34 cohort A'), ('34342222-0000-0000-0000-00000000000b', 'M34 cohort B')) x(id, n);
insert into cohort_enrolments(cohort_id, participant_id, track_id) values
  ('34342222-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000008', (select id from tracks limit 1)),
  ('34342222-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000009', (select id from tracks limit 1)),
  ('34342222-0000-0000-0000-00000000000b', '34341111-0000-0000-0000-000000000010', (select id from tracks limit 1));
insert into trainer_assignments(cohort_id, trainer_id) values
  ('34342222-0000-0000-0000-00000000000a', '34340000-0000-0000-0000-000000000005'),
  ('34342222-0000-0000-0000-00000000000b', '34340000-0000-0000-0000-000000000006');
insert into mentorship_assignments(mentor_id, participant_id) values ('34340000-0000-0000-0000-000000000007', '34341111-0000-0000-0000-000000000009');
insert into session_schedules(id, cohort_id, curriculum_session_id, starts_at, ends_at) values
  ('34343333-0000-0000-0000-00000000000a', '34342222-0000-0000-0000-00000000000a', (select id from curriculum_sessions limit 1), now(), now() + interval '2 hours');
insert into attendance(schedule_id, participant_id, status) values
  ('34343333-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000008', 'present'),
  ('34343333-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000009', 'present');
insert into assignments(id, cohort_id, title, max_score) values
  ('34344444-0000-0000-0000-00000000000a', '34342222-0000-0000-0000-00000000000a', 'M34 task A', 10),
  ('34344444-0000-0000-0000-00000000000b', '34342222-0000-0000-0000-00000000000b', 'M34 task B', 10);
insert into submissions(assignment_id, participant_id, body) values
  ('34344444-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000008', 'L1'),
  ('34344444-0000-0000-0000-00000000000a', '34341111-0000-0000-0000-000000000009', 'L2'),
  ('34344444-0000-0000-0000-00000000000b', '34341111-0000-0000-0000-000000000010', 'L4');
insert into connect_conversations(id, kind, learner_id, facilitator_id) values
  ('34345555-0000-0000-0000-000000000001', 'direct', '34341111-0000-0000-0000-000000000008', '34340000-0000-0000-0000-000000000005');
insert into connect_messages(conversation_id, sender_id, body) values
  ('34345555-0000-0000-0000-000000000001', '34340000-0000-0000-0000-000000000008', 'private message from L1');
insert into storage.objects(bucket_id, name, owner) values ('submissions', '34341111-0000-0000-0000-000000000008/m34.pdf', '34340000-0000-0000-0000-000000000008');
set local session_replication_role = origin;

create temp table m34_ref as select 1 as x; grant select on m34_ref to authenticated, anon;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
  declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create or replace function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"34340000-0000-0000-0000-' || lpad(n::text, 12, '0') || '","role":"authenticated"}', true) $$;

-- ---------- 1. active trainer: baseline ----------
set local role authenticated;
select pg_temp.as_user(5);
select lives_ok($$select check_request()$$, 'an active trainer passes the API pre-request check');
select is((select count(*)::int from submissions where body in ('L1', 'L2', 'L4')), 2, 'active trainer A sees the two cohort-A submissions');
select is((select count(*)::int from cohort_enrolments where cohort_id::text like '3434%'), 2, 'active trainer A sees the cohort-A enrolments');
select pg_temp.as_user(6);
select is((select string_agg(body, ',') from submissions where body in ('L1', 'L2', 'L4')), 'L4', 'trainer B sees only cohort B (cross-cohort isolation)');

-- ---------- 2. deactivation during an existing session ----------
select pg_temp.as_user(1);
select lives_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000005', 'deactivated', 'Contract ended on 20 November')$$,
                'a super administrator deactivates trainer A with a reason');
reset role;
select is((select old_status::text || '>' || new_status::text || ' by ' || (changed_by = '34340000-0000-0000-0000-000000000001')::text
           from account_status_events where profile_id = '34340000-0000-0000-0000-000000000005'), 'active>deactivated by true',
          'the change, its reason and who made it are recorded');
set local role authenticated;
select pg_temp.as_user(5);   -- the same token trainer A had before
select throws_ok($$select check_request()$$, '42501', 'DIRA_ACCOUNT_INACTIVE', 'the existing session is refused by the API pre-request check');
select is((select count(*)::int from submissions), 0, 'deactivated trainer: no submissions (row-level rule, also covers Storage/Realtime)');
select is((select count(*)::int from cohort_enrolments), 0, 'deactivated trainer: no enrolments');
select is((select count(*)::int from attendance), 0, 'deactivated trainer: no attendance');
select is((select count(*)::int from assignments), 0, 'deactivated trainer: no assignments');
select is(pg_temp.changed($q$update assignments set title = 'changed' where id = '34344444-0000-0000-0000-00000000000a'$q$), 0,
          'deactivated trainer cannot edit an assignment');
select throws_ok($$insert into assignments(cohort_id, title, max_score) values ('34342222-0000-0000-0000-00000000000a', 'new', 10)$$, '42501', null,
                 'deactivated trainer cannot create an assignment');
select is((select count(*)::int from connect_messages), 0, 'deactivated trainer: no private messages');
select is((select count(*)::int from storage.objects), 0, 'deactivated trainer: no stored files');
select is((select count(*)::int from profiles), 0, 'deactivated trainer: no profiles, not even their own');
select is((select count(*)::int from my_trainer_cohorts()), 0, 'my_trainer_cohorts() is empty for a deactivated trainer');
reset role; select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from submissions where body in ('L1', 'L2', 'L4')) + (select count(*)::int from connect_messages where body = 'private message from L1')
          + (select count(*)::int from profiles where id = '34340000-0000-0000-0000-000000000005') + (select count(*)::int from auth.users where id = '34340000-0000-0000-0000-000000000005')
          + (select count(*)::int from trainer_assignments where trainer_id = '34340000-0000-0000-0000-000000000005'), 7,
          'nothing is deleted: submissions, the message, the profile, the sign-in account and the assignment all remain');

-- ---------- 3. reactivation ----------
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000005', 'active', 'Returned for the next intake')$$, 'a super administrator reactivates trainer A');
select pg_temp.as_user(5);
select lives_ok($$select check_request()$$, 'the reactivated trainer passes the pre-request check again');
select is((select count(*)::int from submissions where body in ('L1', 'L2', 'L4')), 2, 'the reactivated trainer sees cohort A again');
reset role;
select is((select count(*)::int from account_status_events where profile_id = '34340000-0000-0000-0000-000000000005'), 2, 'both changes are in the history');

-- ---------- 4. role change takes effect at once ----------
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$update profiles set role = 'mentor' where id = '34340000-0000-0000-0000-000000000005'$$, 'a super administrator changes trainer A to mentor');
select pg_temp.as_user(5);
select is((select count(*)::int from submissions), 0, 'former trainer (now mentor) no longer sees cohort A submissions');
select is(pg_temp.changed($q$update assignments set title = 'changed' where id = '34344444-0000-0000-0000-00000000000a'$q$), 0,
          'former trainer (now mentor) cannot edit cohort A assignments');
select pg_temp.as_user(1);
select lives_ok($$update profiles set role = 'trainer' where id = '34340000-0000-0000-0000-000000000005'$$, '... and back to trainer');
select pg_temp.as_user(5);
select is((select count(*)::int from submissions where body in ('L1', 'L2', 'L4')), 2, 'trainer again: cohort A visible again');

-- ---------- 5. removing a trainer from a cohort ----------
reset role; select set_config('request.jwt.claims', '', true);
delete from trainer_assignments where trainer_id = '34340000-0000-0000-0000-000000000005' and cohort_id = '34342222-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.as_user(5);
select is((select count(*)::int from submissions), 0, 'after removal from cohort A the trainer sees no cohort A submissions');
select is((select count(*)::int from cohort_enrolments), 0, '... and no cohort A enrolments');

-- ---------- 6. learners and mentors ----------
select pg_temp.as_user(1);
select lives_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000008', 'deactivated', 'Withdrew from the programme')$$, 'learner L1 is deactivated');
select pg_temp.as_user(8);
select throws_ok($$select check_request()$$, '42501', 'DIRA_ACCOUNT_INACTIVE', 'deactivated learner: existing session refused by the API');
select is((select count(*)::int from submissions), 0, 'deactivated learner: own submissions not readable through the API either');
select is((select count(*)::int from storage.objects), 0, 'deactivated learner: own stored files not readable');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('34345555-0000-0000-0000-000000000001', '34340000-0000-0000-0000-000000000008', 'x')$$,
                 '42501', null, 'deactivated learner cannot send a message');
select is(my_participant_id(), null, 'my_participant_id() is empty for a deactivated learner');
select pg_temp.as_user(9);
select is((select count(*)::int from submissions where body = 'L2'), 1, 'another learner in the same cohort is unaffected');
reset role; select set_config('request.jwt.claims', '', true);
update profiles set status = 'deactivated' where id = '34340000-0000-0000-0000-000000000007';   -- server-side change (trusted session)
set local role authenticated;
select pg_temp.as_user(7);
select is(mentor_has_mentee('34341111-0000-0000-0000-000000000009'), false, 'a deactivated mentor no longer counts as the mentee''s mentor');

-- ---------- 7. guards on the workflow ----------
select pg_temp.as_user(1);
select throws_ok($$update profiles set status = 'deactivated' where id = '34340000-0000-0000-0000-000000000006'$$, 'P0001',
                 'Account status is changed only with Deactivate or Reactivate on the Users page (a reason is required)',
                 'a direct status change (without reason) is refused, even for a super administrator');
select throws_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000006', 'deactivated', 'short')$$, 'P0001',
                 'Give a reason of 10 to 500 characters', 'a reason is required');
select throws_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000001', 'deactivated', 'Trying to lock myself out')$$, 'P0001',
                 'You cannot change the status of your own account', 'nobody can deactivate their own account');
select pg_temp.as_user(4);
select throws_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000006', 'deactivated', 'Coordinator attempt here')$$, '42501', null,
                 'a programme coordinator cannot deactivate accounts');
select pg_temp.as_user(3);
select throws_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000006', 'deactivated', 'Founder attempt here')$$, '42501', null,
                 'a founder cannot deactivate accounts (super administrator only, as before)');
select is((select count(*)::int from account_status_events where profile_id::text like '3434%'), 3, 'executives (founder) can read the status history');
select pg_temp.as_user(9);
select is((select count(*)::int from account_status_events), 0, 'learners cannot read the status history');
select pg_temp.as_user(1);
select throws_ok($$delete from account_status_events$$, '42501', null, 'the status history cannot be deleted through the API');
select throws_ok($$update account_status_events set reason = 'rewritten reason text'$$, '42501', null, 'the status history cannot be rewritten through the API');

-- ---------- 8. signed-out visitors and coverage ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok($$select check_request()$$, 'signed-out visitors pass the pre-request check (their access is limited by RLS and grants as before)');
select throws_ok($$select admin_set_account_status('34340000-0000-0000-0000-000000000006', 'deactivated', 'Anonymous attempt here')$$, '42501', null,
                 'signed-out visitors cannot call admin_set_account_status');
reset role; select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
           and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'dira_active_account' and p.permissive = 'RESTRICTIVE')), 0,
          'every table with row-level security has the active-account rule (new tables must add it too)');
select ok((select 'pgrst.db_pre_request=public.check_request' = any(rolconfig) from pg_roles where rolname = 'authenticator'),
          'check_request() is registered as the Data API pre-request function');

select * from finish();
rollback;
