-- pgTAP tests for first-time setup (first_admin_needed / claim_first_admin), as used by the Edge Function bootstrap-first-admin
-- (21 Nov 2026), which calls both with the SERVICE ROLE after creating FIRST_ADMIN_EMAIL through the Auth Admin API.
begin;
select plan(17);

insert into auth.users(id, instance_id, aud, role, email) values
  ('aaaa1111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','first1@test.local'),
  ('aaaa1111-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','first2@test.local'),
  ('aaaa1111-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','first3@test.local');
-- start from "no administrator" whatever else is in the test database (superuser session, so the guards allow it)
update profiles set role = 'programme_director' where role = 'super_admin';
update profiles set role = 'trainer', status = 'active' where id = 'aaaa1111-0000-0000-0000-000000000003';

select is(first_admin_needed(), true, 'setup is open while there is no active super administrator');
select is(claim_first_admin('aaaa1111-0000-0000-0000-000000000001'), true, 'the first applicant can claim');
select is((select role::text || '/' || status::text from profiles where id = 'aaaa1111-0000-0000-0000-000000000001'), 'super_admin/active', 'and becomes an active super administrator');
select is(first_admin_needed(), false, 'setup closes once an administrator exists');
select is(claim_first_admin('aaaa1111-0000-0000-0000-000000000002'), false, 'a second claim is refused');
select is((select role::text from profiles where id = 'aaaa1111-0000-0000-0000-000000000002'), 'applicant', 'and the second account stays an applicant');
select is(has_function_privilege('authenticated', 'claim_first_admin(uuid)', 'execute'), false, 'browsers (signed-in users) cannot call claim_first_admin');
select is(has_function_privilege('anon', 'first_admin_needed()', 'execute'), false, 'anonymous visitors cannot ask whether setup is open');
select is(has_function_privilege('authenticated', 'first_admin_needed()', 'execute'), true, 'signed-in users can ask');

-- if the only administrator were removed, setup reopens, but only applicants can claim
update profiles set role = 'trainer' where id = 'aaaa1111-0000-0000-0000-000000000001';
select is(first_admin_needed(), true, 'setup reopens when no active administrator is left');
select is(claim_first_admin('aaaa1111-0000-0000-0000-000000000003'), false, 'an account that already has a role cannot claim');


-- the exact path bootstrap-first-admin takes: the Auth Admin API creates the user, the sign-up trigger makes an applicant
-- profile, then the function (service role, no user session) asks and claims.
update profiles set role = 'trainer' where role = 'super_admin';
insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaa1111-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','marksmedia.studios@gmail.com', now());
select is((select role::text || '/' || status::text from profiles where id = 'aaaa1111-0000-0000-0000-000000000009'), 'applicant/active', 'an account created by the Auth Admin API gets an active applicant profile');
select is(has_function_privilege('service_role', 'first_admin_needed()', 'execute') and has_function_privilege('service_role', 'claim_first_admin(uuid)', 'execute'), true, 'the service role (Edge Function) may call both');
set local role service_role;
select is(first_admin_needed(), true, 'as the service role: setup is open');
select is(claim_first_admin('aaaa1111-0000-0000-0000-000000000009'), true, 'as the service role: the claim succeeds');
select is(claim_first_admin('aaaa1111-0000-0000-0000-000000000002'), false, 'as the service role: a second claim is refused');
reset role;
select is((select role::text from profiles where id = 'aaaa1111-0000-0000-0000-000000000009'), 'super_admin', 'marksmedia.studios@gmail.com is now the Super Administrator');

select * from finish();
rollback;
