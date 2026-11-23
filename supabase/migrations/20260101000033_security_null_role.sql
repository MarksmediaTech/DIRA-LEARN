-- DIRA LEARN: security fix found in the production-readiness audit (20 Nov 2026).
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000033_security_null_role_down.sql
--
-- THE PROBLEM
--   Several role checks were written as  `if app_role() not in (...) then raise ...`.  For a caller without an active profile
--   (a signed-out visitor using the public API key, or a deactivated account) app_role() is NULL, the condition is NULL, and
--   PL/pgSQL does NOT raise. Tested locally: a signed-out visitor could approve a curriculum session with set_curriculum_approval.
--   issue_certificate / revoke_certificate had the same gap. sg_is_acting_lead() returned NULL when no Lead or Deputy is
--   appointed, so `if not sg_is_acting_lead()` did not stop the safeguarding-record route of connect_oversight_read.
--   Supabase also lets signed-out visitors (role anon) call every public function by default.
--
-- THE FIX (no table, row, policy or curriculum content changes)
--   1. The NULL-unsafe role checks now treat an unknown role as "not allowed".
--   2. guard_curriculum_session treats only real trusted sessions (migrations, service role) as trusted, not "no user id".
--   3. sg_is_acting_lead() returns false instead of NULL.
--   4. Signed-out visitors may call only the two functions the public pages need (verify_certificate, first_admin_needed).
--      Signed-in users and the service role keep exactly the access they have now. Trigger functions are not touched.
--   Everything changed is recorded in security_fix_33_backup so the rollback can restore it exactly.

create table security_fix_33_backup (kind text not null, name text not null, data text not null, primary key (kind, name));
alter table security_fix_33_backup enable row level security;      -- no policies: not readable through the API
revoke all on security_fix_33_backup from anon, authenticated;

-- ============ 1-3. NULL-safe role checks ============
insert into security_fix_33_backup(kind, name, data)
select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('set_curriculum_approval', 'issue_certificate', 'revoke_certificate', 'guard_curriculum_session', 'sg_is_acting_lead');

do $$
declare r record; d text; nd text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('set_curriculum_approval', 'issue_certificate', 'revoke_certificate', 'guard_curriculum_session') loop
    d := pg_get_functiondef(r.oid);
    nd := regexp_replace(d, 'app_role\(\)\s+not\s+in\s+(\([^()]*\))', 'coalesce(app_role() not in \1, true)', 'g');
    if r.proname = 'guard_curriculum_session' then
      nd := replace(nd, 'if auth.uid() is null then return new; end if;', 'if is_trusted_session() then return new; end if;');
    end if;
    if nd = d then raise exception 'security fix 33: % was not changed (unexpected definition)', r.proname; end if;
    execute nd;
  end loop;
end $$;

create or replace function sg_is_acting_lead() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and sg_acting_officer() = auth.uid(), false) $$;

-- ============ 4. signed-out visitors: only the functions the public pages use ============
do $$
declare r record; had_public boolean; had_auth boolean; had_service boolean;
begin
  for r in select p.oid, p.oid::regprocedure::text as sig, p.proacl, p.proowner
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
              and p.proname not in ('verify_certificate', 'first_admin_needed')
              and has_function_privilege('anon', p.oid, 'execute') loop
    had_public := exists (select 1 from aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE');
    had_auth := has_function_privilege('authenticated', r.oid, 'execute');
    had_service := has_function_privilege('service_role', r.oid, 'execute');
    insert into security_fix_33_backup(kind, name, data)
    values ('grant', r.sig, json_build_object('public', had_public, 'anon', true, 'authenticated', had_auth, 'service_role', had_service, 'acl', coalesce(r.proacl, acldefault('f', r.proowner))::text)::text);
    execute format('revoke execute on function %s from public, anon', r.sig);
    if had_auth then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if had_service then execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end $$;
