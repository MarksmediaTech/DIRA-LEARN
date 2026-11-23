-- pgTAP tests: self-service password recovery (Supabase Auth recovery code) must not change anyone's role, status, profile or
-- permissions, and no database function or table lets one user change another user's password. Executed locally.
-- Supabase Auth itself (codes, expiry, rate limits) is tested against a real local Supabase by tools/recovery/recovery_check.mjs.
begin;
select plan(12);

insert into auth.users(id, instance_id, aud, role, email)
select ('66666666-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec' || n || '@recovery.test'
  from generate_series(1, 9) n;
update profiles p set role = r.role::role_code, status = 'active', first_name = 'First' || r.n, last_name = 'Last' || r.n
  from (values (1, 'participant'), (2, 'trainer'), (3, 'mentor'), (4, 'programme_director'), (5, 'super_admin'), (6, 'founder'), (7, 'co_founder'),
               (8, 'programme_coordinator'), (9, 'me_officer')) as r(n, role)
 where p.id = ('66666666-0000-0000-0000-0000000000' || lpad(r.n::text, 2, '0'))::uuid;
create temp table before_profiles as select * from profiles where id::text like '66666666-%';
create temp table before_counts as select (select count(*) from profiles) as profiles, (select count(*) from audit_logs where table_name = 'profiles') as profile_audits;

-- What Supabase Auth does to auth.users during a recovery, for every role: store the code, verify it (code cleared, signed in), set the new password.
update auth.users set recovery_token = 'hashed-code-placeholder', recovery_sent_at = now(), updated_at = now() where id::text like '66666666-%';
update auth.users set recovery_token = '', last_sign_in_at = now(), email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id::text like '66666666-%';
update auth.users set encrypted_password = '$2a$10$placeholderhashplaceholderhashplaceholderhashplac', updated_at = now() where id::text like '66666666-%';

select is((select count(*)::int from profiles p join before_profiles b using (id) where to_jsonb(p) = to_jsonb(b)), 9,
          'after a password recovery every profile (role, status, names, organisation) is exactly as before, for all nine roles');
select is((select count(*)::int from profiles), (select profiles::int from before_counts), 'no profile is added or removed by a recovery');
select is((select count(*)::int from audit_logs where table_name = 'profiles'), (select profile_audits::int from before_counts), 'a recovery does not touch the profiles table at all');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal and (t.tgtype & 16) = 16), 0,
          'no DIRA LEARN trigger runs when Supabase Auth updates a user (only the sign-up insert trigger exists)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.prosrc ilike '%encrypted_password%' or p.prosrc ilike '%recovery_token%')), 0,
          'no DIRA LEARN database function reads or writes passwords or recovery codes');

-- A signed-in learner cannot reach passwords or recovery codes, or change anyone's role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select encrypted_password from auth.users limit 1$$, '42501', null, 'a learner cannot read passwords');
select throws_ok($$update auth.users set encrypted_password = 'x' where email = 'rec5@recovery.test'$$, '42501', null, 'a learner cannot set another user''s password');
select throws_ok($$select recovery_token from auth.users limit 1$$, '42501', null, 'a learner cannot read recovery codes');
select throws_ok($$update profiles set role = 'super_admin' where id = '66666666-0000-0000-0000-000000000001'$$, null,
                 'Only a super administrator can change role, status or organisation', 'recovering an account gives no way to raise one''s own role');
-- A staff member is treated the same: no special path.
select set_config('request.jwt.claims', '{"sub":"66666666-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$update auth.users set encrypted_password = 'x' where email = 'rec1@recovery.test'$$, '42501', null, 'a founder cannot set a learner''s password through the database');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok($$select email from auth.users limit 1$$, '42501', null, 'signed-out visitors cannot look up which email addresses exist');
reset role;
select ok(not has_table_privilege('authenticated', 'auth.users', 'SELECT') and not has_table_privilege('anon', 'auth.users', 'SELECT'),
          'the API roles have no access to the accounts table');

select * from finish();
rollback;
