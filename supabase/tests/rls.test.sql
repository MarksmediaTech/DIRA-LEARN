-- pgTAP RLS tests. Run with `supabase test db` after `supabase db reset`. NOT yet executed.
begin;
select plan(9);

-- fixtures (inserted as the superuser running the test)
insert into auth.users(id, instance_id, aud, role, email) values
  ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@test.local'),
  ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@test.local'),
  ('11111111-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','app@test.local'),
  ('11111111-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@test.local');
update profiles set role='participant', status='active' where id in ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002');
update profiles set role='super_admin', status='active' where id = '11111111-0000-0000-0000-000000000004';
insert into participants(id, profile_id, participant_no) values
  ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','T-1'),
  ('22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002','T-2');
insert into safeguarding_records(summary) values ('test-only record');

-- participant 1
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from participants), 1, 'participant sees only their own participant row');
select is((select count(*)::int from safeguarding_records), 0, 'participant cannot read safeguarding records');
select is((select count(*)::int from audit_logs), 0, 'participant cannot read audit logs');
select throws_ok($$update profiles set role = 'super_admin' where id = '11111111-0000-0000-0000-000000000001'$$, null, 'Only a super administrator can change role, status or organisation', 'participant cannot escalate own role');

-- applicant
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from participants), 0, 'applicant sees no participants');
select is((select count(*)::int from applications), 0, 'applicant sees no one else''s applications');

-- super admin
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from participants), 2, 'super admin sees all participants');
select is((select count(*)::int from safeguarding_records), 1, 'since migration 39 (owner decision 21 Nov 2026) an active super admin reads safeguarding records while no Lead or Deputy is appointed (after an appointment only the officers do: safeguarding_interim_39.test.sql)');
select lives_ok($$select admin_set_account_status('11111111-0000-0000-0000-000000000002', 'deactivated', 'Account no longer needed (test)')$$, 'super admin can change account status (since migration 34: with a reason, through admin_set_account_status)');

select * from finish();
rollback;
