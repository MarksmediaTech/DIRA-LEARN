#!/usr/bin/env python3
"""Simulates applying migration 30 to a database that already holds the pre-V13 curriculum and real activity (the situation of the
live project), then rolls it back. Local scratch database only. Usage: python3 -I tools/curriculum/upgrade_check.py <project>
Steps: migrations 1-29 + the pre-V13 seed (tools/curriculum/fixtures) -> test accounts, cohorts and enrolments -> live-like edits
(a scheduled Digital session, an approved topic proposal, an edited session title, an edited track focus) -> snapshot ->
migration 30 -> checks -> V13-era edits (one plan edited, one plan approved) -> migration 31 (V13.1) -> checks ->
rollback 31 -> exactly the V13 state -> rollback 30 -> exactly the pre-V13 state -> migrations 30 and 31 apply again."""
import sys, os, subprocess, tempfile, shutil, json
proj = os.path.abspath(sys.argv[1]); H = os.path.join(proj, 'tools', 'db-standin')
here = os.path.dirname(os.path.abspath(__file__))
results = []
def check(name, ok): results.append((name, bool(ok)))
def psql(sql, single=True):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'] + (['-1'] if single else []) + ['-c', sql], capture_output=True, text=True)
    if r.returncode: raise SystemExit('SQL failed: ' + r.stderr[:800])
    return r.stdout.strip()
def psql_file(path):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-1', '-f', path], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

tmp = tempfile.mkdtemp(); p = os.path.join(tmp, 'p')
shutil.copytree(proj, p, ignore=shutil.ignore_patterns('node_modules', 'dist'))
# the pre-V13 database: exactly migrations 1-29 (until 21 Nov 2026 this removed only 30-32 and silently kept 33 onwards)
for m in os.listdir(os.path.join(p, 'supabase', 'migrations')):
    if int(m[12:14]) >= 30: os.remove(os.path.join(p, 'supabase', 'migrations', m))
shutil.copy(os.path.join(here, 'fixtures', 'seed_before_v13.sql'), os.path.join(p, 'supabase', 'seed.sql'))
# A database of that era still had Supabase's automatic grants (removed for all projects on 30 Oct 2026), so this one
# historical simulation uses the stand-in with the legacy default grants. Every other check uses the strict stand-in.
shim = open(os.path.join(H, 'supabase_shim.sql'), encoding='utf8').read()
a = shim.index("-- Supabase's current default"); b = shim.index('revoke execute on functions from public;') + len('revoke execute on functions from public;')
legacy = os.path.join(tmp, 'supabase_shim_legacy_grants.sql')
open(legacy, 'w', encoding='utf8').write(shim[:a] + '''alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;''' + shim[b:])
r = subprocess.run([os.path.join(H, 'db_reset.sh'), p], capture_output=True, text=True, env={**os.environ, 'DIRA_SHIM': legacy})
if r.returncode: raise SystemExit('pre-V13 build failed: ' + r.stdout[-500:])
rc, out, err = psql_file(os.path.join(proj, 'supabase', 'local_test_accounts.sql'))
if rc: raise SystemExit('test accounts failed: ' + err[:500])

# live-like activity and edits made before V13 arrives
psql("""
insert into session_schedules(cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at, mode, venue)
select 'd1a22222-0000-0000-0000-00000000000a', cs.id, 'd1a00000-0000-0000-0000-000000000006', '2026-12-02 14:00+03', '2026-12-02 16:00+03', 'physical', 'DIRA hall'
  from curriculum_sessions cs join tracks t on t.id = cs.track_id where t.code = 'digital' and cs.session_no = 5;
update curriculum_topic_proposals set status = 'approved', reviewed_by = 'd1a00000-0000-0000-0000-000000000001', reviewed_at = now()
 where title = 'WhatsApp Business' and track_id = (select id from tracks where code = 'digital');
update curriculum_sessions set title = 'AI for everyday tasks (edited by the coordinator)'
 where session_no = 6 and track_id = (select id from tracks where code = 'ai');
update tracks set focus = 'Content focus edited on the live site.' where code = 'content';
""")
SNAP = """select jsonb_build_object(
 'tracks', (select jsonb_agg(to_jsonb(t) order by t.code) from tracks t),
 'sessions', (select jsonb_agg(to_jsonb(c) order by c.track_id nulls first, c.session_no) from curriculum_sessions c),
 'schedules', (select jsonb_agg(to_jsonb(s) order by s.id) from session_schedules s),
 'enrolments', (select jsonb_agg(to_jsonb(e) order by e.participant_id) from cohort_enrolments e),
 'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from curriculum_topic_proposals x),
 'applications', (select jsonb_agg(to_jsonb(a) order by a.id) from applications a))"""
before = json.loads(psql(SNAP))

rc, out, err = psql_file(os.path.join(proj, 'supabase', 'migrations', '20260101000030_curriculum_v13.sql'))
check('migration 30 applies to a database with the pre-V13 curriculum and activity', rc == 0)
if rc: print(err[:1500]); sys.exit(1)
outcome = dict(line.split('|', 1) for line in out.strip().splitlines() if '|' in line)
after = json.loads(psql(SNAP))
bs = {(s['track_id'], s['session_no']): s for s in before['sessions']}; as_ = {(s['track_id'], s['session_no']): s for s in after['sessions']}
tid = {t['code']: t['id'] for t in after['tracks']}

check('track digital renamed to Digital Marketing, same id', next(t for t in after['tracks'] if t['code'] == 'digital')['name'] == 'Digital Marketing' and set(tid.values()) == {t['id'] for t in before['tracks']})
check('no track is called Digital Skills any more', all(t['name'] != 'Digital Skills' for t in after['tracks']))
check('the four tracks are Digital Marketing, AI Tools, Content Creation, Entrepreneurship & Business',
      [t['name'] for t in sorted(after['tracks'], key=lambda t: t['position'])] == ['Digital Marketing', 'AI Tools', 'Content Creation', 'Entrepreneurship & Business'])
check('an edited track focus is kept and reported', next(t for t in after['tracks'] if t['code'] == 'content')['focus'] == 'Content focus edited on the live site.' and 'focus kept' in outcome.get('track content', ''))
check('every session keeps its duration, week, number and track', all((as_[k]['duration_minutes'], as_[k]['week_no'], as_[k]['track_id']) == (v['duration_minutes'], v['week_no'], v['track_id']) for k, v in bs.items()) and len(as_) == len(bs) == 26)
check('durations are still 110, 115 and 24 x 120', sorted(s['duration_minutes'] for s in after['sessions']) == [110, 115] + [120] * 24)
check('the approved Entrepreneurship session 4 record is byte-for-byte unchanged', bs[(tid['entrepreneurship'], 4)] == as_[(tid['entrepreneurship'], 4)])
check('a session record edited since the seed is kept and reported', as_[(tid['ai'], 6)]['title'] == 'AI for everyday tasks (edited by the coordinator)' and 'edited since the seed' in outcome.get('ai session 6', ''))
check('draft Digital session records now carry the V13 titles', as_[(tid['digital'], 3)]['title'] == 'Digital marketing foundations, online presence and reputation' and as_[(tid['digital'], 8)]['title'] == 'Digital marketing campaign showcase')
check('no session topics list changed (Curriculum Approval Centre input)', all(as_[k]['topics'] == v['topics'] for k, v in bs.items()))
check('scheduled sessions (dates, times, trainer, venue) unchanged', before['schedules'] == after['schedules'] and before['schedules'])
check('enrolments unchanged (still on the same track ids)', before['enrolments'] == after['enrolments'] and before['enrolments'])
check('topic proposals and their decisions unchanged', before['proposals'] == after['proposals'])
check('applications unchanged', before['applications'] == after['applications'])
check('26 lesson plans and 26 teaching notes added (V13), all draft', psql("select count(*) filter (where status = 'draft') || '/' || count(*) from curriculum_lesson_plans") == '26/26' and psql('select count(*) from curriculum_teaching_notes') == '26')
check('every plan adds up to its session duration', psql('select count(*) from curriculum_sessions cs where lesson_plan_timing_problem(cs.id) is not null') == '0')
check('nothing was approved by the migration', psql("select count(*) from curriculum_lesson_plans where status = 'approved'") == '0' and
      [s['is_approved'] for s in after['sessions']] == [s['is_approved'] for s in before['sessions']])
check('running the loader again changes nothing', psql("select count(*) from load_curriculum_v13() where outcome like '%updated%' or outcome like '%added%' or outcome like 'renamed%'") == '0' and json.loads(psql(SNAP)) == after)

# ---------------- V13 -> V13.1 ----------------
PLANS = """select jsonb_build_object(
 'plans', (select jsonb_agg(jsonb_build_object('s', session_id, 'v', version, 'st', status, 'c', content, 'by', approved_by) order by session_id) from curriculum_lesson_plans),
 'notes', (select jsonb_agg(jsonb_build_object('s', session_id, 'c', content) order by session_id) from curriculum_teaching_notes))"""
def sid(code, n): return psql(f"select cs.id from curriculum_sessions cs left join tracks t on t.id = cs.track_id where cs.session_no = {n} and " + ("cs.track_id is null" if code == 'core' else f"t.code = '{code}'"))
psql(f"""update curriculum_lesson_plans set content = jsonb_set(content, '{{homework}}', '["Edited by the coordinator during V13"]') where session_id = '{sid('ai', 4)}';
update curriculum_lesson_plans set status = 'approved', approved_at = now(), approved_by = 'd1a00000-0000-0000-0000-000000000004' where session_id = '{sid('content', 4)}';""")
v13 = json.loads(psql(SNAP)); v13p = json.loads(psql(PLANS))
rc, out, err = psql_file(os.path.join(proj, 'supabase', 'migrations', '20260101000031_curriculum_v13_1.sql'))
check('migration 31 (V13.1) applies on top of V13', rc == 0)
if rc: print(err[:1500]); sys.exit(1)
o31 = dict(line.split('|', 1) for line in out.strip().splitlines() if '|' in line)
v131 = json.loads(psql(SNAP))
check('V13.1: unedited draft plans updated (24 of 26)', psql("select count(*) from curriculum_lesson_plans where version = 'V13.1'") == '24')
check('V13.1: a plan edited during V13 is kept and reported', 'edited since V13' in o31.get('ai session 4', '') and
      psql(f"select content -> 'homework' ->> 0 from curriculum_lesson_plans where session_id = '{sid('ai', 4)}'") == 'Edited by the coordinator during V13')
check('V13.1: a plan approved during V13 is kept, still approved, and reported', 'approved since V13' in o31.get('content session 4', '') and
      psql(f"select status || version from curriculum_lesson_plans where session_id = '{sid('content', 4)}'") == 'approvedV13')
check('V13.1: nothing newly approved', psql("select count(*) from curriculum_lesson_plans where status = 'approved'") == '1' and
      [x['is_approved'] for x in v131['sessions']] == [x['is_approved'] for x in v13['sessions']])
check('V13.1: no duration, week or track changed; 24 track sessions have a break', all((a['duration_minutes'], a['week_no'], a['track_id']) == (b['duration_minutes'], b['week_no'], b['track_id'])
      for a, b in zip(v13['sessions'], v131['sessions'])) and psql("select count(distinct lp.session_id) from curriculum_lesson_plans lp, jsonb_array_elements(lp.content -> 'segments') e where e ->> 'kind' = 'break'") == '22')
check('V13.1: every plan still adds up to its session duration', psql('select count(*) from curriculum_sessions cs where lesson_plan_timing_problem(cs.id) is not null') == '0')
check('V13.1: approved session record, edited session record, schedules, enrolments, proposals and applications unchanged',
      all(v13[k] == v131[k] for k in ('schedules', 'enrolments', 'proposals', 'applications', 'tracks')) and
      next(x for x in v131['sessions'] if x['track_id'] == tid['entrepreneurship'] and x['session_no'] == 4) == next(x for x in v13['sessions'] if x['track_id'] == tid['entrepreneurship'] and x['session_no'] == 4) and
      next(x for x in v131['sessions'] if x['track_id'] == tid['ai'] and x['session_no'] == 6)['title'] == 'AI for everyday tasks (edited by the coordinator)')
check('V13.1: pending Digital Marketing topics stay pending (10 here: the simulation approved one before V13)', psql("select count(*) from curriculum_topic_proposals p join tracks t on t.id = p.track_id where t.code = 'digital' and p.status = 'pending'") == '10')
check('V13.1: running the update again changes nothing', psql("select count(*) from apply_curriculum_v13_1() where outcome like '%updated%'") == '0')

v131p = json.loads(psql(PLANS)); v131s = json.loads(psql(SNAP))
rc, out, err = psql_file(os.path.join(proj, 'supabase', 'migrations', '20260101000032_curriculum_v13_2.sql'))
check('migration 32 (V13.2) applies on top of V13.1', rc == 0)
o32 = dict(line.split('|', 1) for line in out.strip().splitlines() if '|' in line)
check('V13.2: the 24 V13.1 drafts are updated; the edited and the approved plan are kept', psql("select count(*) from curriculum_lesson_plans where version = 'V13.2'") == '24'
      and psql(f"select status || version from curriculum_lesson_plans where session_id = '{sid('content', 4)}'") == 'approvedV13' and 'kept' in o32.get('ai session 4', ''))
check('V13.2: nothing newly approved, no timing problem, curriculum records otherwise unchanged', psql("select count(*) from curriculum_lesson_plans where status = 'approved'") == '1'
      and psql('select count(*) from curriculum_sessions cs where lesson_plan_timing_problem(cs.id) is not null') == '0'
      and all(json.loads(psql(SNAP))[k] == v131s[k] for k in ('tracks', 'schedules', 'enrolments', 'proposals', 'applications')))
rc, out, err = psql_file(os.path.join(proj, 'supabase', 'rollback', '20260101000032_curriculum_v13_2_down.sql'))
check('after rollback 32, lesson plans, notes and session records are exactly the V13.1 state', rc == 0 and json.loads(psql(PLANS)) == v131p and json.loads(psql(SNAP)) == v131s)

rc, out, err = psql_file(os.path.join(proj, 'supabase', 'rollback', '20260101000031_curriculum_v13_1_down.sql'))
check('rollback 31 runs', rc == 0)
check('after rollback 31, lesson plans, teaching notes and session records are exactly the V13 state', json.loads(psql(PLANS)) == v13p and json.loads(psql(SNAP)) == v13)

rc, out, err = psql_file(os.path.join(proj, 'supabase', 'rollback', '20260101000030_curriculum_v13_down.sql'))
check('rollback 30 runs', rc == 0)
back = json.loads(psql(SNAP))
check('after rollback 30, tracks are exactly as before (Digital Skills, edited focus kept)', back['tracks'] == before['tracks'])
check('after rollback 30, all 26 session records are exactly as before', back['sessions'] == before['sessions'])
check('after rollback 30, schedules, enrolments, proposals and applications are untouched', all(back[k] == before[k] for k in ('schedules', 'enrolments', 'proposals', 'applications')))
check('after rollback 30, the lesson plan tables are gone', psql("select to_regclass('public.curriculum_lesson_plans') is null and to_regclass('public.curriculum_teaching_notes') is null") == 't')
ok = all(psql_file(os.path.join(proj, 'supabase', 'migrations', m))[0] == 0 for m in ('20260101000030_curriculum_v13.sql', '20260101000031_curriculum_v13_1.sql', '20260101000032_curriculum_v13_2.sql'))
check('migrations 30, 31 and 32 apply again after the rollbacks, giving 26 V13.2 plans', ok and psql("select count(*) from curriculum_lesson_plans where version = 'V13.2'") == '26')
shutil.rmtree(tmp)
subprocess.run([os.path.join(H, 'db_reset.sh'), proj], capture_output=True)   # leave the normal local database behind

failed = [n for n, ok in results if not ok]
print(f'curriculum upgrade and rollback: {len(results) - len(failed)}/{len(results)} checks passed')
for n in failed: print('  FAILED ' + n)
sys.exit(1 if failed else 0)
