#!/usr/bin/env python3
"""Generates the GRANT section of migration 38 (explicit Data API grants) from the authored intent of migrations 01-37.

Usage: python3 -I tools/release/generate_grants_38.py <database-built-with-legacy-default-grants>  > grants.sql

Migrations 01-37 were written when Supabase still granted every new public table, sequence and function to anon,
authenticated and service_role automatically; each migration REVOKED what it meant to restrict. So, on a database
built with those legacy defaults, the remaining privileges are the authored intent. Supabase no longer grants
anything automatically (new projects since 30 May 2026, all projects since 30 Oct 2026), so the intent must be
written down explicitly. Rules:
  tables/views  authenticated: SELECT/INSERT/UPDATE/DELETE that the legacy intent kept AND (for tables) a permissive
                RLS policy for authenticated allows. Never TRUNCATE, REFERENCES or TRIGGER. Nothing for anon.
                service_role: select, insert, update, delete (server-side Edge Functions; bypasses RLS by design).
  functions     execute for authenticated / anon exactly as the legacy intent kept (trigger functions excluded:
                they need no execute grant); service_role: every function.
  sequences     none for anon/authenticated (added only where a test proves a signed-in code path needs one);
                service_role: usage, select, update.
The output is static SQL, reviewed and committed as migration 38; this script is kept for transparency.
"""
import subprocess, sys

db = sys.argv[1]
def q(sql):
    return [l for l in subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', db, '-tAX', '-F', '\t', '-c', sql],
                                      capture_output=True, text=True, check=True).stdout.splitlines() if l]

ORDER = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
legacy = {}
for t, priv in (l.split('\t') for l in q("""select table_name, privilege_type from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')""")):
    legacy.setdefault(t, set()).add(priv)
policy = {}
for t, cmd in (l.split('\t') for l in q("""select tablename, cmd from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
        and (roles && array['authenticated','public']::name[])""")):
    policy.setdefault(t, set()).update(ORDER if cmd == 'ALL' else [cmd])
kinds = dict(l.split('\t') for l in q("select relname, relkind from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v','m')"))

out = ['-- ---- tables and views: signed-in users (RLS still decides which rows) ----']
none = []
for t in sorted(kinds):
    if kinds[t] in ('v', 'm'):
        privs = [p for p in ORDER if p in legacy.get(t, set()) and p == 'SELECT']
    else:
        privs = [p for p in ORDER if p in legacy.get(t, set()) and p in policy.get(t, set())]
    if privs:
        out.append(f"grant {', '.join(p.lower() for p in privs)} on table public.{t} to authenticated;")
    else:
        none.append(t)
out.append('-- no signed-in access (internal, backup or staging tables; no RLS policy for signed-in users): ' + ', '.join(none))
out.append('')
out.append('-- ---- functions: signed-in users and signed-out visitors (as authored; trigger functions need no grant) ----')
fn = lambda role: q(f"""select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and has_function_privilege('{role}', p.oid, 'execute')
        order by 1""")
for sig in fn('authenticated'):
    out.append(f"grant execute on function {sig} to authenticated;")
for sig in fn('anon'):
    out.append(f"grant execute on function {sig} to anon;")
print('\n'.join(out))
