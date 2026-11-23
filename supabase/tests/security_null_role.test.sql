-- pgTAP tests for migration 20260101000033 (production-readiness audit, 20 Nov 2026): callers without an active profile
-- (signed-out visitors, deactivated accounts) are refused, and signed-out visitors can call only the public functions.
begin;
select plan(14);

insert into auth.users(id, instance_id, aud, role, email) values
  ('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deact-dir@sec.test'),
  ('44444444-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-dir@sec.test');
update profiles set role = 'programme_director', status = 'deactivated' where id = '44444444-0000-0000-0000-000000000001';
update profiles set role = 'programme_director', status = 'active' where id = '44444444-0000-0000-0000-000000000002';
create temp table ref as select (select id from curriculum_sessions where track_id is null and session_no = 1) as s;
grant select on ref to anon, authenticated;

-- signed-out visitor
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select set_curriculum_approval((select s from ref), true)$$, '42501', null, 'a signed-out visitor cannot approve a curriculum session');
select throws_ok($$select issue_certificate('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')$$, '42501', null, 'a signed-out visitor cannot issue certificates');
select throws_ok($$select revoke_certificate('00000000-0000-0000-0000-000000000000', 'some reason')$$, '42501', null, 'a signed-out visitor cannot revoke certificates');
select throws_ok($$select set_lesson_plan_approval((select s from ref), true)$$, '42501', null, 'a signed-out visitor cannot approve lesson plans');
select lives_ok($$select * from verify_certificate('NO-SUCH-CODE')$$, 'certificate verification stays public');
select throws_ok($$select first_admin_needed()$$, '42501', null, 'the first-administrator check was already for signed-in accounts only, and stays so');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select is_approved from curriculum_sessions where id = (select s from ref)), false, 'the session is still not approved');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
              and p.proname not in ('verify_certificate', 'first_admin_needed', 'check_request') and has_function_privilege('anon', p.oid, 'execute')), 0,
          'signed-out visitors can call no other database function (check_request: migration 34 pre-request check, must run for every request)');

-- deactivated account (signed in, but no active profile)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select set_curriculum_approval((select s from ref), true)$$, null, 'Only a super administrator or programme director can approve curriculum content',
                 'a deactivated programme director cannot approve curriculum sessions');
select throws_ok($$select revoke_certificate('00000000-0000-0000-0000-000000000000', 'some reason')$$, null, 'Only a super administrator or programme director can revoke certificates',
                 'a deactivated programme director cannot revoke certificates');
select is(sg_is_acting_lead(), false, 'the acting-Safeguarding-Lead check answers no, never NULL');

-- an active programme director is unaffected
select set_config('request.jwt.claims', '{"sub":"44444444-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select set_curriculum_approval((select s from ref), true)$$, 'an active programme director can still approve');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select is_approved from curriculum_sessions where id = (select s from ref)), true, '... and the approval is recorded');
select ok(has_function_privilege('authenticated', 'set_curriculum_approval(uuid,boolean)', 'execute') and has_function_privilege('service_role', 'is_staff()', 'execute'),
          'signed-in users and the service role keep their access');

select * from finish();
rollback;
