#!/usr/bin/env python3
"""Checks that every supabase.rpc('x') / .from('x') / storage.from('x') used by the screens exists in the migrated
database and is reachable by signed-in users (role `authenticated`) WITH THE OPERATION THE SCREEN PERFORMS: for every
.from('t') the next query method (.select/.insert/.update/.upsert/.delete) is read and the matching table privilege is
required (upsert = insert + update). Since Supabase stopped granting new tables automatically (production 403 on profiles,
21 Nov 2026) a missing grant is a real production failure, so this check runs against a database built WITHOUT automatic
grants. Usage: python3 -I frontend_contract_check.py <project>   (database: $DIRA_DB, default postgres)"""
import os, re, subprocess, sys

proj = sys.argv[1]
def psql(sql):
    return subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', os.environ.get('DIRA_DB', 'postgres'), '-tAX', '-c', sql],
                          capture_output=True, text=True, check=True).stdout.strip()

rpcs, tables, buckets = {}, {}, {}
for root, _, files in os.walk(os.path.join(proj, 'src')):
    for f in files:
        if not f.endswith(('.ts', '.tsx')) or '.test.' in f: continue
        p = os.path.join(root, f); s = open(p, encoding='utf8').read(); rel = os.path.relpath(p, proj)
        for m in re.finditer(r"\.rpc\(\s*'([a-z_0-9]+)'", s): rpcs.setdefault(m.group(1), set()).add(rel)
        for m in re.finditer(r"storage\.from\(\s*'([a-z0-9-]+)'", s): buckets.setdefault(m.group(1), set()).add(rel)
        for m in re.finditer(r"(?<!storage)\.from\(\s*'([a-z_0-9]+)'\s*\)", s):
            op = re.search(r"\.(select|insert|update|upsert|delete)\(", s[m.end():m.end() + 400])
            ops = {'upsert': ['INSERT', 'UPDATE']}.get(op.group(1), [op.group(1).upper()]) if op else ['SELECT']
            for o in ops: tables.setdefault((m.group(1), o), set()).add(rel)
        # rpc names passed through a helper, e.g. useRpc<T>('ci_intake') or rows<T>('learner_metrics', ...)
        for m in re.finditer(r"(?:useRpc|rows)<[^>]*>\(\s*'([a-z_0-9]+)'", s): rpcs.setdefault(m.group(1), set()).add(rel)

problems = []
for name, where in sorted(rpcs.items()):
    ok = psql(f"select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '{name}'")
    if ok != 't': problems.append(f"rpc {name}: {'missing' if ok == '' else 'not executable by signed-in users'} (used in {', '.join(sorted(where))})")
for (name, op), where in sorted(tables.items()):
    ok = psql(f"select case when to_regclass('public.{name}') is null then 'missing' when has_table_privilege('authenticated', 'public.{name}', '{op}') then 'ok' else 'no {op} grant for signed-in users' end")
    if ok != 'ok': problems.append(f"table/view {name}: {ok} (used in {', '.join(sorted(where))})")
for name in sorted({n for n, _ in tables}):
    ok = psql(f"select coalesce((select relrowsecurity or relkind in ('v','m') from pg_class where oid = to_regclass('public.{name}')), false)")
    if ok != 't': problems.append(f"table {name}: used by the screens but row-level security is not enabled")
for name, where in sorted(buckets.items()):
    ok = psql(f"select count(*) from storage.buckets where id = '{name}'")
    if ok != '1': problems.append(f"storage bucket {name}: missing (used in {', '.join(sorted(where))})")
print(f"frontend contract: {len(rpcs)} database functions, {len({n for n, _ in tables})} tables/views ({len(tables)} table operations), {len(buckets)} storage buckets used by the screens; {len(problems)} problems")
for p in problems: print('  PROBLEM ' + p)
sys.exit(1 if problems else 0)
