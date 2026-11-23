-- pgTAP tests for migration 20260101000017_executive_roles.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(20);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('88888888-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x' || n || '@ex.test' from generate_series(1, 7) n;
update profiles set role='founder', status='active' where id = '88888888-0000-0000-0000-000000000001';
update profiles set role='co_founder', status='active' where id = '88888888-0000-0000-0000-000000000002';
update profiles set role='super_admin', status='active' where id = '88888888-0000-0000-0000-000000000003';
update profiles set role='programme_director', status='active' where id = '88888888-0000-0000-0000-000000000004';
update profiles set role='trainer', status='active' where id = '88888888-0000-0000-0000-000000000005';
update profiles set role='participant', status='active' where id = '88888888-0000-0000-0000-000000000006';
-- 07 stays an applicant
insert into system_settings(key, value) values ('exec_test_setting', '1'::jsonb) on conflict (key) do nothing;

-- ---------- helpers as seen by each role ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(is_executive() and is_staff() and not is_admin(), 'founder: executive and staff, but is_admin() (role assignment) stays super-admin only');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(is_executive() and is_staff() and not is_admin(), 'co-founder: executive and staff, but not is_admin()');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(is_executive() and is_staff() and is_admin(), 'super admin keeps every power');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(not is_executive() and is_staff(), 'programme director is staff but not executive');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(not is_executive() and not is_staff(), 'trainer is neither');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(not is_executive() and not is_staff(), 'participant is neither');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000007","role":"authenticated"}', true);
select ok(not is_executive() and not is_staff(), 'applicant is neither');

-- ---------- administrative areas ----------
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((select count(*) from profiles) >= 7, 'founder can read every profile');
select lives_ok($$select * from admin_list_users()$$, 'founder can list accounts');
select lives_ok($$update system_settings set value = '2'::jsonb where key = 'exec_test_setting'$$, 'founder can change settings');
select is((select value::text from system_settings where key = 'exec_test_setting'), '2', 'the founder setting change took effect');
select lives_ok($$select count(*) from audit_logs$$, 'founder can read the audit log');
select is((select count(*)::int from safeguarding_records), 0, 'since migration 24 a founder does not automatically read safeguarding records');

-- ---------- role assignment stays super-admin only ----------
select lives_ok($$update profiles set role = 'super_admin' where id = '88888888-0000-0000-0000-000000000007'$$, 'a founder''s role change is quietly refused by row security');
select is((select role::text from profiles where id = '88888888-0000-0000-0000-000000000007'), 'applicant', 'a founder cannot promote anyone to super admin');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$update profiles set role = 'founder' where id = '88888888-0000-0000-0000-000000000007'$$, 'a co-founder''s role change is quietly refused by row security');
select is((select role::text from profiles where id = '88888888-0000-0000-0000-000000000007'), 'applicant', 'a co-founder cannot create another founder');

-- ---------- other roles stay out ----------
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from admin_list_users()), 0, 'a trainer still gets no rows from admin_list_users');
select set_config('request.jwt.claims', '{"sub":"88888888-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from audit_logs), 0, 'a participant still sees no audit log rows');
select is((select count(*)::int from safeguarding_records), 0, 'a participant still sees no safeguarding records');

select * from finish();
rollback;
