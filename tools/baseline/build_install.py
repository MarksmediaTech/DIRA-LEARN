#!/usr/bin/env python3
"""Builds the browser-only installation of DIRA LEARN for a NEW Supabase project (21 Nov 2026).

Usage: python3 -I tools/baseline/build_install.py <project>

Input : supabase/baseline/ (the patch-free final state, proved equal to migrations 01-39 + seed by baseline_check.sh)
        supabase/production_init/02_verify_readonly.sql (the read-only verification, adapted here to the baseline history)
Output: supabase/install/  - files to paste, in order, into the Supabase Dashboard SQL Editor:
  STEP-0_precheck_read-only.sql        what is in the project now, and which step to run next (changes nothing)
  STEP-1_schema-part-1-of-2.sql        \
  STEP-2_schema-part-2-of-2.sql         |  the three baseline files, unchanged, cut at statement boundaries into parts
  STEP-3_platform-and-data-part-1.sql   |  small enough to paste (< 420 KB). Each part is ONE transaction (the SQL Editor
  STEP-4_data-part-2.sql               /   sends the whole text as one query): it applies completely or not at all.
  STEP-5_verify_read-only.sql          every check must say ok, verdict READY (changes nothing)
  RECOVERY_remove-incomplete-install.sql  only for a project with NO sign-in accounts: removes a DIRA LEARN install so it
                                       can be repeated from STEP-1 (needs an explicit edit to run)
Every part starts with a guard: it refuses (and changes nothing) unless exactly the parts before it are installed. Progress is
recorded in supabase_migrations.dira_install_steps; the Supabase CLI history (supabase_migrations.schema_migrations) gets the
same three versions as `supabase db push` of supabase/baseline would write. Windows line breaks (CR LF) pasted from Notepad
are removed from stored function bodies at the end of each part (nothing in the baseline searches stored text, so CR LF
cannot break the installation itself; this keeps the stored functions identical to the reference).
"""
import pathlib, re, sys

proj = pathlib.Path(sys.argv[1]).resolve()
B = proj / 'supabase' / 'baseline'; OUT = proj / 'supabase' / 'install'
files = sorted(B.glob('2026112100000[123]_*.sql'))
if len(files) != 3: sys.exit('expected the 3 baseline files')
V = ['20261121000001', '20261121000002', '20261121000003']
LIMIT = 420_000
STEPS = {1: 'schema part 1 of 2', 2: 'schema part 2 of 2', 3: 'platform objects and data part 1 of 2', 4: 'data part 2 of 2'}

def split_file(p):
    t = p.read_text(encoding='utf-8')
    if '\r' in t: sys.exit(f'{p.name}: CR found')
    a = t.index('do $guard$'); b = t.index('end $guard$;\n') + len('end $guard$;\n')
    rest = t[b:]
    hist = re.search(r"^insert into supabase_migrations\.schema_migrations\(version, name\) values \('(\d{14})', '[a-z_]+'\);\n?\Z", rest, re.M)
    if not hist: sys.exit(f'{p.name}: history insert not at the end')
    return t[a:b], rest[:hist.start()], rest[hist.start():].rstrip('\n') + '\n'

g1, body1, h1 = split_file(files[0]); g2, body2, h2 = split_file(files[1]); g3, body3, h3 = split_file(files[2])

# file 1: setup lines (schema/history table/extension/local settings) then the pg_dump body
SET1 = "select pg_catalog.set_config('check_function_bodies', 'false', true);"
i = body1.index(SET1); i = body1.index('\n', i) + 1
setup1, dump = body1[:i], body1[i:]
local1 = ''.join(l + '\n' for l in setup1.splitlines() if 'set_config' in l)
# cut the dump before a "-- Name:" section header close to the middle
heads = [m.start() for m in re.finditer(r'^--\n-- Name: ', dump, re.M)]
cut = min(heads, key=lambda h: abs(h - len(dump) // 2))
dumpA, dumpB = dump[:cut], dump[cut:]
# file 3: local setting, then one insert per table (+ sequences); the two big curriculum texts go to the last part
SET3 = ''   # (no session setting: each table's triggers are paused by ALTER TABLE on the same line as its insert)
if 'session_replication_role' in body3: sys.exit('data file: session_replication_role needs superuser rights (not available in the SQL Editor)')
data_lines = body3.splitlines(keepends=True)
late = [l for l in data_lines if l.startswith('alter table public.curriculum_teaching_notes disable trigger user; insert into public.curriculum_teaching_notes(')]
early = [l for l in data_lines if l not in late]
if len(late) != 1: sys.exit('data file: expected one curriculum_teaching_notes insert')

NORMALIZE = """
-- ----- line endings: remove Windows CR from stored function bodies (does nothing when the text has plain LF) -----
do $crlf$
declare r record;
begin
  for r in select p.oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and position(chr(13) in p.prosrc) > 0 loop
    execute replace(pg_catalog.pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $crlf$;
"""
def steps_guard(step):
    want = ','.join(str(s) for s in range(1, step)) or 'none'
    return f"""do $steps$
declare v text;
begin
  if pg_catalog.to_regclass('supabase_migrations.dira_install_steps') is not null then
    execute 'select string_agg(step::text, '','' order by step) from supabase_migrations.dira_install_steps' into v;
  end if;
  if coalesce(v, 'none') <> '{want}' then
    raise exception 'STOP: this is STEP-{step}. It needs exactly the steps before it installed ({want}); this project has: %. Run STEP-0 to see what to do next. Nothing was changed.', coalesce(v, 'none');
  end if;
end $steps$;
"""
def record(step):
    return f"insert into supabase_migrations.dira_install_steps(step, name) values ({step}, '{STEPS[step]}');\n"
def header(step, title, lines):
    return '\n'.join([f'-- DIRA LEARN - installation in the Supabase SQL Editor, STEP {step} of 5: {title}',
                      '-- Generated by tools/baseline/build_install.py from supabase/baseline - do not edit by hand.',
                      '-- Paste the WHOLE file into a new SQL Editor query and press Run. It is one transaction: if anything fails,',
                      '-- nothing of this step is kept, and you can simply run it again after the cause is fixed.',
                      *['-- ' + l for l in lines], '']) + '\n'
END = lambda step, nxt: f"\nselect 'STEP-{step} installed' as result, '{nxt}' as next_step;\n"

parts = {
 1: header(1, STEPS[1], ['Refuses unless the project is new and empty (no DIRA LEARN tables, no migration history).'])
    + steps_guard(1) + g1 + setup1
    + "create table if not exists supabase_migrations.dira_install_steps (step int primary key, name text not null, installed_at timestamptz not null default now());\n"
    + "revoke all on supabase_migrations.dira_install_steps from public;\n\n"
    + dumpA + '\n' + record(1) + NORMALIZE + END(1, 'Run STEP-2'),
 2: header(2, STEPS[2], ['Refuses unless STEP-1 is installed.'])
    + steps_guard(2) + local1 + '\n' + dumpB + '\n' + h1 + record(2) + NORMALIZE + END(2, 'Run STEP-3'),
 3: header(3, STEPS[3], ['Sign-up trigger, 6 private storage buckets and their policies, realtime, API account check; then the',
                         'reference and curriculum data except the teaching notes. Refuses unless STEPS 1-2 are installed.'])
    + steps_guard(3) + g2 + body2 + h2 + '\n' + g3 + SET3 + ''.join(early) + record(3) + NORMALIZE + END(3, 'Run STEP-4'),
 4: header(4, STEPS[4], ['The curriculum teaching notes, then the installation is recorded as complete. Refuses unless STEPS 1-3 are installed.'])
    + steps_guard(4) + SET3 + ''.join(late) + h3 + record(4) + NORMALIZE + END(4, 'Run STEP-5 (read-only verification)'),
}
OUT.mkdir(exist_ok=True)
for old in OUT.glob('*.sql'): old.unlink()
names = {1: 'STEP-1_schema-part-1-of-2.sql', 2: 'STEP-2_schema-part-2-of-2.sql', 3: 'STEP-3_platform-and-data-part-1.sql', 4: 'STEP-4_data-part-2.sql'}
for k, txt in parts.items():
    if len(txt.encode()) > LIMIT: sys.exit(f'STEP-{k} is {len(txt.encode())} bytes (> {LIMIT})')
    if re.search(r'^\s*\\', txt, re.M): sys.exit(f'STEP-{k}: psql meta-command')
    if re.search(r'^\s*(begin|commit|rollback)\s*;', txt, re.I | re.M): sys.exit(f'STEP-{k}: transaction control')
    (OUT / names[k]).write_text(txt, encoding='utf-8', newline='\n')
# the parts together are exactly the three baseline files (apart from the cut, the step records and the line-ending block)
joined = ''.join(parts[k] for k in parts)
for piece in (g1, setup1, dumpA, dumpB, h1, g2, body2, h2, g3, ''.join(early), late[0], h3):
    if piece not in joined: sys.exit('a baseline piece is missing from the parts')

# ---------------- STEP-0: read-only pre-check ----------------
(OUT / 'STEP-0_precheck_read-only.sql').write_text(f"""-- DIRA LEARN - installation in the Supabase SQL Editor, STEP 0: read-only pre-check (changes nothing)
-- Generated by tools/baseline/build_install.py - do not edit by hand. Run it first, and again whenever you are unsure what to do next.
with s as (
  select current_setting('server_version') as pg,
         (select count(*) from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')) as public_objects,
         case when pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then null
              else (xpath('/row/v/text()', query_to_xml('select string_agg(version, '','' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text end as history,
         case when pg_catalog.to_regclass('supabase_migrations.dira_install_steps') is null then null
              else (xpath('/row/v/text()', query_to_xml('select string_agg(step::text, '','' order by step) as v from supabase_migrations.dira_install_steps', false, true, '')))[1]::text end as steps,
         (select count(*) from auth.users) as accounts,
         exists (select 1 from storage.buckets where id = 'submissions') as buckets)
select 'PostgreSQL ' || pg as database,
       public_objects || ' tables/views in public' as public_schema,
       coalesce(history, 'none') as migration_history,
       coalesce(steps, 'none') as dira_install_steps,
       accounts || ' sign-in account(s)' as accounts,
       case
         when public_objects = 0 and history is null and steps is null then 'EMPTY: run STEP-1'
         when steps = '1' and history is null then 'STEP-1 is installed: run STEP-2'
         when steps = '1,2' and history = '{V[0]}' then 'STEPS 1-2 are installed: run STEP-3'
         when steps = '1,2,3' and history = '{V[0]},{V[1]}' then 'STEPS 1-3 are installed: run STEP-4'
         when steps = '1,2,3,4' and history = '{V[0]},{V[1]},{V[2]}' then 'INSTALLED: run STEP-5 (verification), then open /setup on the website'
         when steps is null and public_objects > 0 then 'STOP: this project already has DIRA LEARN or other tables (probably the older 39-migration installation). Do not run these steps. Send this result to Claude.'
         else 'STOP: unexpected state. Do not run any step. Send this result to Claude.'
       end as verdict
  from s;
""", encoding='utf-8', newline='\n')

# ---------------- STEP-5: read-only verification (02_verify_readonly.sql with the baseline history) ----------------
v = (proj / 'supabase' / 'production_init' / '02_verify_readonly.sql').read_text(encoding='utf-8')
old_check1 = v[v.index("  select 1, 'migrations 01-39"):v.index("  union all\n  select 2,")]
new_check1 = (f"  select 1, 'DIRA LEARN baseline installed completely (STEPS 1-4; history = the 3 baseline versions)',\n"
              f"         (select v from hist) = '{V[0]},{V[1]},{V[2]}'\n"
              f"         and (select string_agg(step::text, ',' order by step) from supabase_migrations.dira_install_steps) = '1,2,3,4',\n"
              f"         coalesce((select v from hist), 'no history table')\n")
v = v.replace(old_check1, new_check1)
v = v.replace("expected(version) as (select to_char(20260101000000 + g, 'FM00000000000000') from generate_series(1, 39) g),\n", '')
v = v.replace("'Initialization verified. Next: set up the first Super Administrator (see the installation guide; the SQL Editor installation uses STEP-8).'",
              "'Installation verified. Next: open https://<your website>/setup and create the first Super Administrator (docs/deployment/INSTALL_GUIDE.md, part E).'")
v = v.replace("'Do not claim an administrator. Send this table to Claude.'", "'Do not set up the administrator yet. Send this table to Claude.'")
head = v[:v.index('with\n')]
v = ('-- DIRA LEARN - installation in the Supabase SQL Editor, STEP 5 of 5: read-only verification (changes nothing)\n'
     '-- Generated by tools/baseline/build_install.py from supabase/production_init/02_verify_readonly.sql - do not edit by hand.\n'
     '-- Every row must say ok and the last row READY. After the first Super Administrator exists, checks 7 and 8 change by design.\n\n'
     + v[len(head):])
for must in ('dira_install_steps', '/setup', "select 16,"):
    if must not in v: sys.exit('verification adaptation failed: ' + must)
if 'STEP-8' in v or "generate_series(1, 39)" in v: sys.exit('verification still mentions the old installation')
(OUT / 'STEP-5_verify_read-only.sql').write_text(v, encoding='utf-8', newline='\n')

# ---------------- RECOVERY ----------------
(OUT / 'RECOVERY_remove-incomplete-install.sql').write_text("""-- DIRA LEARN - RECOVERY: remove an incomplete or failed DIRA LEARN installation from a NEW project, so STEP-1 can run again.
-- Generated by tools/baseline/build_install.py - do not edit by hand (except the one line below).
-- Usually NOT needed: every step is one transaction, so a failed step leaves nothing behind - fix the cause and run it again.
-- Use this only if STEP-0 says "unexpected state" and Claude has asked you to. The simplest alternative is to delete the
-- Supabase project and create a new one.
-- SAFETY: it refuses if the project has ANY sign-in account (so no person's data can exist), if public has objects that
-- DIRA LEARN did not create, or if you have not edited the line below. It never touches auth users or other schemas' data.
-- To run it, change  'NO'  to  'REMOVE DIRA LEARN'  on the next line:
do $recovery$
declare
  v_confirm text := 'NO';
  r record; n int;
begin
  if v_confirm <> 'REMOVE DIRA LEARN' then
    raise exception 'STOP: edit the line  v_confirm text := ''NO'';  to  ''REMOVE DIRA LEARN''  first. Nothing was changed.';
  end if;
  select count(*) into n from auth.users;
  if n > 0 then raise exception 'STOP: this project has % sign-in account(s). Recovery only runs on a project nobody has used. Nothing was changed.', n; end if;
  if pg_catalog.to_regclass('supabase_migrations.dira_install_steps') is null and pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'STOP: there is no DIRA LEARN installation here. Nothing was changed.';
  end if;
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations where version not in (''20261121000001'', ''20261121000002'', ''20261121000003'')' into n;
    if n > 0 then raise exception 'STOP: the migration history has entries that are not the DIRA LEARN baseline. Nothing was changed.'; end if;
  end if;
  if exists (select 1 from storage.objects where bucket_id in ('application-documents', 'connect-attachments', 'course-materials', 'learning-resources', 'project-evidence', 'submissions')) then
    raise exception 'STOP: the DIRA LEARN storage buckets contain files. Nothing was changed.';
  end if;

  -- the sign-up trigger on auth.users: dropping it directly needs ownership of auth.users, which the SQL Editor's role may not
  -- have; it is removed in any case together with its function public.handle_new_user() further down (drop ... cascade)
  begin
    drop trigger if exists on_auth_user_created on auth.users;
  exception when insufficient_privilege then null;
  end;
  for r in select policyname from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in (__STORAGE_POLICIES__) loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
  delete from storage.buckets where id in ('application-documents', 'connect-attachments', 'course-materials', 'learning-resources', 'project-evidence', 'submissions');
  for r in select tablename from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' loop
    execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
  end loop;
  begin
    execute 'alter role authenticator reset pgrst.db_pre_request';
  exception when insufficient_privilege then raise warning 'Could not reset the API pre-request setting (no permission); it is harmless once STEP-3 is run again.';
  end;
  -- everything DIRA LEARN created in schema public (views, tables, functions, types, sequences), the schema itself stays
  for r in select c.relname, c.relkind from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') loop
    execute format(case r.relkind when 'v' then 'drop view if exists public.%I cascade' else 'drop materialized view if exists public.%I cascade' end, r.relname);
  end loop;
  for r in select c.relname from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('drop table if exists public.%I cascade', r.relname);
  end loop;
  for r in select p.oid::regprocedure as f from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
             and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop function if exists %s cascade', r.f);
  end loop;
  for r in select t.typname from pg_catalog.pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd', 'c')
             and not exists (select 1 from pg_catalog.pg_class c where c.oid = t.typrelid and c.relkind <> 'c')
             and not exists (select 1 from pg_catalog.pg_depend d where d.objid = t.oid and d.deptype = 'e') loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
  for r in select c.relname from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' loop
    execute format('drop sequence if exists public.%I cascade', r.relname);
  end loop;
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'delete from supabase_migrations.schema_migrations where version in (''20261121000001'', ''20261121000002'', ''20261121000003'')';
  end if;
  drop table if exists supabase_migrations.dira_install_steps;
end $recovery$;
select 'DIRA LEARN installation removed. Run STEP-0: it should say EMPTY: run STEP-1.' as result;
""", encoding='utf-8', newline='\n')
rec = OUT / 'RECOVERY_remove-incomplete-install.sql'
pols = sorted(set(re.findall(r'^create policy "([a-z_]+)" on storage\.objects ', body2, re.M)))
if len(pols) != 13: sys.exit(f'expected 13 storage policies in the platform file, found {len(pols)}')
rec.write_text(rec.read_text(encoding='utf-8').replace('__STORAGE_POLICIES__', ', '.join(f"'{x}'" for x in pols)), encoding='utf-8', newline='\n')
# ---------------- REPAIR: Data API privileges of an installation made before this block existed (21 Nov 2026) ----------------
m = re.search(r'-- >>> api-grants.*?-- <<< api-grants\n', body3, re.S)
if not m: sys.exit('api-grants block missing from the data file')
(OUT / 'REPAIR_api-grants.sql').write_text(f"""-- DIRA LEARN - REPAIR of the Data API privileges after STEPS 1-4 (for STEP-5 check 16). Generated by tools/baseline/build_install.py.
-- Why: Supabase gives tables that the SQL Editor creates in schema public some privileges automatically (seen 21 Nov 2026:
-- TRUNCATE, REFERENCES and TRIGGER for anon, authenticated and service_role on all 107 tables and views). Check 16 then fails.
-- What it changes: ONLY privileges of the roles anon, authenticated, service_role (and PUBLIC) on the tables, views and
-- sequences of schema public. It removes all of them and grants again exactly what migration 38 intends (signed-in users:
-- the grants backed by Row Level Security policies; signed-out visitors: none; service role: read/write), then checks the
-- result and refuses (changing nothing) if it is not exact. Not touched: tables, columns, data, functions and their
-- permissions, policies, storage, accounts, curriculum. One transaction; safe to run more than once (same result each time).
do $steps$
declare v text;
begin
  if pg_catalog.to_regclass('supabase_migrations.dira_install_steps') is not null then
    execute 'select string_agg(step::text, '','' order by step) from supabase_migrations.dira_install_steps' into v;
  end if;
  if coalesce(v, 'none') <> '1,2,3,4' then
    raise exception 'STOP: this repair is for a complete installation (STEPS 1-4); this project has: %. Nothing was changed.', coalesce(v, 'none');
  end if;
end $steps$;
{m.group(0)}
select 'Data API privileges repaired' as result, 'Run STEP-5 again: every row must say ok and the verdict READY' as next_step;
""", encoding='utf-8', newline='\n')
print('install package written:', ', '.join(sorted(p.name for p in OUT.glob('*.sql'))))
for p in sorted(OUT.glob('*.sql')): print(f'  {p.name}: {p.stat().st_size:,} bytes')
