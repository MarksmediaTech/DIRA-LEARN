#!/usr/bin/env python3
"""Builds everything that comes from the V13 curriculum source (curriculum/v13/*.yaml):
  * supabase/migrations/20260101000032_curriculum_v13_2.sql (the approved V13.2 content; migrations 30, 31 and 32 are FROZEN - it was delivered
    and may already be applied, so it is only checked against its recorded SHA-256, never rebuilt)
  * the curriculum lines of supabase/seed.sql                (fresh local databases get the V13 tracks and session records)
  * docs/curriculum/*.md                                     (the readable curriculum, lesson plans and facilitator guides)
Usage:  python3 -I tools/curriculum/build_v13.py <project>           write the files
        python3 -I tools/curriculum/build_v13.py <project> --check   only report files that are out of date (exit 1)
Timetable rule: a session's duration is taken from the CURRENT seed (curriculum/v13/previous_seed.json) and must equal the YAML;
the build stops if they differ. Nothing here changes a duration, a date or a time."""
import sys, os, json, re, yaml

proj = sys.argv[1]; check_only = '--check' in sys.argv
SRC = os.path.join(proj, 'curriculum', 'v13')
ORDER = [('core', 'core.yaml'), ('digital', 'digital_marketing.yaml'), ('ai', 'ai_tools.yaml'), ('content', 'content_creation.yaml'), ('entrepreneurship', 'entrepreneurship.yaml')]
data = {code: yaml.safe_load(open(os.path.join(SRC, f), encoding='utf8')) for code, f in ORDER}
for _d in data.values():                                   # 'Final project - a campaign ...' -> 'A campaign ...' (the heading already says it)
    if 'project' in _d:
        _p = re.sub(r'^\s*Final project\s*-\s*', '', ' '.join(_d['project'].split())); _d['project'] = _p[:1].upper() + _p[1:]
prev = json.load(open(os.path.join(SRC, 'previous_seed.json'), encoding='utf8'))
prev_sessions = {((s['track'] or 'core'), s['session_no']): s for s in prev['sessions']}
prev_tracks = {t['code']: t for t in prev['tracks']}
PROGRAMME = '00000000-0000-0000-0000-0000000000a1'
VERSION = 'V13.2'; REVISED = '19 Nov 2026'
FROZEN = {'supabase/migrations/20260101000030_curriculum_v13.sql': 'eb242b786773912170cee0a60074d089e4702e4f54768de82834b18dde4cd722',
          'supabase/rollback/20260101000030_curriculum_v13_down.sql': '8d766387545b2cabb15bb13c296b03067799a3ef19d28e60ac7491b562351a32',
          'supabase/migrations/20260101000031_curriculum_v13_1.sql': 'acbe2848a60f23dcd514c99057d486958bbaa988334df3092af7d5297b254bd5',
          'supabase/rollback/20260101000031_curriculum_v13_1_down.sql': '8645489590a067c61f8594bfd9313230d0ab1417b8434181723a0d2a3d33404d',
          'supabase/migrations/20260101000032_curriculum_v13_2.sql': '0cf8eb16929af783419d42c69cd1a5fa611555d3c51183ddbe9901754f7267a9',
          'supabase/rollback/20260101000032_curriculum_v13_2_down.sql': 'cad53ca57b0d5e112cd66d618f2520c06c7bcb25420784671d0d72bdec4c96ca'}
KIND_LABEL = {'introduction': 'Introduction and recap', 'lesson': 'Main lesson', 'demonstration': 'Demonstration', 'exercise': 'Practical exercise',
              'group': 'Group activity', 'assessment': 'Assessment and feedback', 'conclusion': 'Conclusion and assignment', 'break': 'Stretch break'}

# ---------------------------------------------------------------- validation (stops the build)
errors = []
for code, d in data.items():
    for s in d['sessions']:
        key = (code, s['session_no']); p = prev_sessions.get(key)
        if not p: errors.append(f'{key}: no such session in the current seed'); continue
        if p['duration_minutes'] != s['duration']: errors.append(f'{key}: YAML duration {s["duration"]} differs from the timetable {p["duration_minutes"]}')
        if p['week_no'] != s['week_no']: errors.append(f'{key}: YAML week {s["week_no"]} differs from the timetable week {p["week_no"]}')
        total = sum(g['minutes'] for g in s['segments'])
        if total != s['duration']: errors.append(f'{key}: segments add up to {total}, session is {s["duration"]}')
        if s.get('preserve_approved_record') and not p['is_approved']: errors.append(f'{key}: marked preserve_approved_record but not approved in the seed')
        if p['is_approved'] and not s.get('preserve_approved_record'): errors.append(f'{key}: approved in the seed but the YAML does not preserve it')
        if p['is_approved'] and s['title'] != p['title']: errors.append(f'{key}: approved session title would change')
missing = set(prev_sessions) - {(c, s['session_no']) for c, d in data.items() for s in d['sessions']}
if missing: errors.append(f'sessions without a V13 lesson plan: {sorted(missing)}')
if errors:
    print('BUILD STOPPED:'); [print('  ' + e) for e in errors]; sys.exit(2)

# ---------------------------------------------------------------- content split: what learners see / what only staff see
def plan_content(code, s):
    d = data[code]
    c = {'version': VERSION, 'purpose': s['purpose'], 'objectives': s['objectives'], 'topics': s['topics'],
         'segments': [{'minutes': g['minutes'], 'title': g['title'], 'kind': g['kind'], 'summary': g['summary']} for g in s['segments']],
         'guided_exercises': s['guided_exercises'], 'individual_activities': s['individual_activities'], 'group_activities': s['group_activities'],
         'examples': s['examples'], 'tools': s['tools'], 'assessment': [{'question': a['question']} for a in s['assessment']],
         'expected_outputs': s['expected_outputs'], 'homework': s['homework'], 'cross_track_notes': s.get('cross_track_notes') or []}
    if code != 'core': c['track_project'] = d['project']
    return c
def notes_content(s):
    return {'version': VERSION, 'segments': [{'title': g['title'], 'steps': g['steps']} for g in s['segments']],
            'demonstrations': s['demonstrations'], 'assessment_guides': s['assessment'], 'facilitator': s['facilitator']}
def session_record(code, s):
    return {'title': s['title'], 'description': s['description'], 'objectives': s['objectives'],
            'activities': [g['title'] for g in s['segments']], 'expected_output': '; '.join(s['expected_outputs']),
            'assessment_notes': f'DRAFT ({VERSION} curriculum revision, {REVISED}): full lesson plan with timed segments, activities, assessment and facilitator notes. '
                                f'Assessment: {len(s["assessment"])} questions or tasks, checked against the expected outputs. Needs approval by programme management.'}

def q(v):  # SQL text literal
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"
def arr(xs): return 'array[' + ','.join(q(x) for x in xs) + ']::text[]' if xs else "'{}'::text[]"
def jlit(obj):
    j = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    assert '$cv13$' not in j
    return '$cv13$' + j + '$cv13$::jsonb'

# ---------------------------------------------------------------- migration 31 (migration 30 is frozen)
HEADER = open(os.path.join(proj, 'tools', 'curriculum', 'migration_32_template.sql'), encoding='utf8').read()
rows_s = []
for code, d in data.items():
    for s in d['sessions']:
        rows_s.append(f"  ({q(code)}, {s['session_no']},\n   {jlit(session_record(code, s))},\n   {jlit(plan_content(code, s))},\n   {jlit(notes_content(s))})")
migration = (HEADER.rstrip('\n') + '\n\n-- ============ 3. the V13.2 content (generated from curriculum/v13/*.yaml by tools/curriculum/build_v13.py - do not edit by hand) ============\n'
             'insert into curriculum_v13_2_sessions(track_code, session_no, session, plan, notes) values\n' + ',\n'.join(rows_s) + '\non conflict (track_code, session_no) do nothing;\n\n'
             '-- Existing databases (local or, after approval, live): apply now. A fresh `supabase db reset` applies it again at the end of seed.sql.\n'
             'select item, outcome from apply_curriculum_v13_2();\n')
# ---------------------------------------------------------------- seed.sql curriculum lines
seed_path = os.path.join(proj, 'supabase', 'seed.sql'); seed = open(seed_path, encoding='utf8').read()
seed_lines = seed.split('\n')
approved_lines = [l for l in seed_lines if l.startswith('insert into curriculum_sessions') and ',is_approved)' in l]
assert len(approved_lines) == 1, 'expected exactly one approved curriculum line in seed.sql'
new_track_lines, new_session_lines = [], []
for i, (code, f) in enumerate(ORDER[1:], start=1):
    d = data[code]; p = prev_tracks[code]; assert p['position'] == i
    new_track_lines.append(f"insert into tracks(programme_id,code,name,focus,position) values ('{PROGRAMME}',{q(code)},{q(d['track_name'])},{q(' '.join(d['track_focus'].split()))},{i}) on conflict do nothing;")
cols = 'programme_id,track_id,week_no,session_no,title,description,duration_minutes,objectives,activities,topics,expected_output,assessment_notes,source'
for code, d in data.items():
    for s in d['sessions']:
        p = prev_sessions[(code, s['session_no'])]
        if p['is_approved']: new_session_lines.append(approved_lines[0]); continue      # the approved record is kept exactly as it is
        r = session_record(code, s)
        vals = f"{s['week_no']},{s['session_no']},{q(r['title'])},{q(r['description'])},{p['duration_minutes']},{arr(r['objectives'])},{arr(r['activities'])},{arr(p['topics'])},{q(r['expected_output'])},{q(r['assessment_notes'])},'curriculum_v13'"
        if code == 'core': new_session_lines.append(f"insert into curriculum_sessions({cols}) values ('{PROGRAMME}',null,{vals}) on conflict do nothing;")
        else: new_session_lines.append(f"insert into curriculum_sessions({cols}) select '{PROGRAMME}',t.id,{vals} from tracks t where t.programme_id='{PROGRAMME}' and t.code={q(code)} on conflict do nothing;")
first = next(i for i, l in enumerate(seed_lines) if l.startswith('insert into tracks('))
last = max(i for i, l in enumerate(seed_lines) if l.startswith('insert into curriculum_sessions') or l.startswith('insert into tracks('))
block = new_track_lines + ['-- Curriculum session records (V13, generated by tools/curriculum/build_v13.py). Durations are the approved timetable: 110, 115, then 120 minutes.'] + new_session_lines
old_block = seed_lines[first:last + 1]
old_block_clean = [l for l in old_block if not l.startswith('-- Curriculum session records (V13')]
if any(not (l.startswith('insert into tracks(') or l.startswith('insert into curriculum_sessions')) for l in old_block_clean):
    print('BUILD STOPPED: unexpected line inside the seed curriculum block'); sys.exit(2)
seed_new = '\n'.join(seed_lines[:first] + block + seed_lines[last + 1:])
LOADER = ("-- V13 curriculum: lesson plans and teaching notes for every session (draft until approved). Idempotent; changes no duration.\n"
          "do $$ begin if to_regprocedure('public.load_curriculum_v13()') is not null then perform load_curriculum_v13(); end if; end $$;\n"
          "do $$ begin if to_regprocedure('public.apply_curriculum_v13_1()') is not null then perform apply_curriculum_v13_1(); end if; end $$;\n"
          "do $$ begin if to_regprocedure('public.apply_curriculum_v13_2()') is not null then perform apply_curriculum_v13_2(); end if; end $$;")
# Migration 37 (21 Nov 2026) runs AFTER the V13 loaders: they restore their own record notes, it re-adds DIRA's 8 Nov 2026 approval notes.
DM37 = ("-- DIRA's 8 Nov 2026 approval of Digital Marketing Sessions 5-7 (migration 37): Digital Marketing topic proposals on their V13.2\n"
        "-- sessions, approval noted on proposals and draft records. Approves nothing; idempotent.\n"
        "do $$ begin if to_regprocedure('public.apply_digital_marketing_approval_37()') is not null then perform apply_digital_marketing_approval_37(); end if; end $$;")
seed_new = seed_new.replace('\n\n' + DM37, '').replace(DM37, '')
seed_new = re.sub(r"\n*-- V13 curriculum: lesson plans.*\n((select item, outcome from load_curriculum_v13\(\);|do \$\$ begin if to_regprocedure.*)\n?)+", '', seed_new)
seed_new = seed_new.rstrip('\n') + '\n\n' + LOADER + '\n\n' + DM37 + '\n'

# ---------------------------------------------------------------- documents
def clock(m): return f'{m // 60}:{m % 60:02d}'
def segment_table(s):
    out = ['| Time | Minutes | Segment | Type |', '|---|---|---|---|']; t = 0
    for g in s['segments']:
        out.append(f"| {clock(t)}–{clock(t + g['minutes'])} | {g['minutes']} | {g['title']} | {KIND_LABEL[g['kind']]} |"); t += g['minutes']
    out.append(f"| **Total** | **{t}** | Equals the timetable ({s['duration']} min) | |"); return out
def bullets(xs): return [f'- {x}' for x in xs]
def lesson_md(code, s):
    d = data[code]; L = [f"## Session {s['session_no']} (Week {s['week_no']}, {s['duration']} minutes): {s['title']}", '']
    if s.get('preserve_approved_record'): L += ['> The approved session record (title, description and approved topics) is kept unchanged. This detailed lesson plan is new and is a draft until approved.', '']
    L += [f"*{s['description']}*", '', '### 1. Learning purpose', ' '.join(s['purpose'].split()), '', '### 2. Learning objectives', 'By the end of the session learners can:'] + bullets(s['objectives'])
    L += ['', '### 3. Topics and subtopics']
    for tp in s['topics']: L += [f"- **{tp['title']}**"] + [f'    - {x}' for x in tp['subtopics']]
    L += ['', '### 4. Time allocation'] + segment_table(s) + ['', '### 5. Step-by-step teaching content']; t = 0
    for g in s['segments']:
        L += [f"#### {clock(t)}–{clock(t + g['minutes'])} · {g['title']} ({g['minutes']} min, {KIND_LABEL[g['kind']].lower()})", f"*{g['summary']}*", ''] + [f'{i}. {x}' for i, x in enumerate(g['steps'], 1)] + ['']; t += g['minutes']
    L += ['### 6. Practical demonstrations']
    for x in s['demonstrations']: L += [f"- **{x['title']}**"] + [f'    {i}. {st}' for i, st in enumerate(x['steps'], 1)]
    for head, key in [('7. Guided exercises', 'guided_exercises'), ('8. Individual activities', 'individual_activities'), ('9. Group activities', 'group_activities')]:
        L += ['', f'### {head}'] + [f"- **{x['title']}:** {' '.join(x['instructions'].split())}" for x in s[key]]
    L += ['', '### 10. Real-world examples (Kenya)'] + bullets(s['examples']) + ['', '### 11. Tools and resources'] + bullets(s['tools'])
    L += ['', '### 12. Assessment questions and activities', '| Question or task | What a good answer shows |', '|---|---|'] + [f"| {a['question']} | {a['guide']} |" for a in s['assessment']]
    L += ['', '### 13. Expected learner outputs'] + bullets(s['expected_outputs'])
    f = s['facilitator']; L += ['', '### 14. Facilitator instructions']
    for head, key in [('Before the session', 'preparation'), ('During the session', 'delivery'), ('Inclusion and safeguarding', 'inclusion_and_safeguarding'), ('After the session', 'after_session')]:
        if f.get(key): L += [f'**{head}**'] + bullets(f[key]) + ['']
    L += ['### 15. Homework and follow-up'] + bullets(s['homework'])
    if s.get('cross_track_notes'): L += ['', '### 16. How this differs from other tracks'] + bullets(s['cross_track_notes'])
    return L + ['', '---', '']
docs = {}
names = {'core': ('00_CORE_SESSIONS.md', 'Shared core (Week 1, sessions 1 and 2)'), 'digital': ('01_DIGITAL_MARKETING.md', 'Digital Marketing'), 'ai': ('02_AI_TOOLS.md', 'AI Tools'),
         'content': ('03_CONTENT_CREATION.md', 'Content Creation'), 'entrepreneurship': ('04_ENTREPRENEURSHIP_AND_BUSINESS.md', 'Entrepreneurship & Business')}
GEN = f'<!-- Generated from curriculum/v13/*.yaml by tools/curriculum/build_v13.py. Edit the YAML, then run the build. -->'
for code, d in data.items():
    fn, title = names[code]
    L = [GEN, f'# DIRA LEARN {VERSION} curriculum – {title}', '', f'Revised {REVISED}. Status: **reviewed draft lesson plans (V13.2), authorised for approval by programme management.** Durations are the approved timetable and were not changed.', '']
    if code != 'core': L += ['**Track focus.** ' + ' '.join(d['track_focus'].split()), '', '**Final project.** ' + ' '.join(d['project'].split()), '']
    L += ['| Session | Week | Minutes | Title |', '|---|---|---|---|'] + [f"| {s['session_no']} | {s['week_no']} | {s['duration']} | {s['title']} |" for s in d['sessions']] + ['']
    for s in d['sessions']: L += lesson_md(code, s)
    docs[fn] = '\n'.join(L)
# overview
L = [GEN, f'# DIRA LEARN {VERSION} curriculum – overview', '', f'Revised {REVISED}. Four weeks, eight live sessions, two a week, at most two hours each. Week 1 is the shared core; weeks 2 to 4 are specialist-track sessions (sessions 3 to 8).', '',
     '## The four-week timetable (unchanged)', '', '| Week | Session | Minutes | Shared core / ' + ' / '.join(data[c]['track_name'] for c, _ in ORDER[1:]) + ' |', '|---|---|---|---|']
for n in range(1, 9):
    if n <= 2:
        s = data['core']['sessions'][n - 1]; L.append(f"| {s['week_no']} | {n} | {s['duration']} | **Core:** {s['title']} |")
    else:
        ss = [next(x for x in data[c]['sessions'] if x['session_no'] == n) for c, _ in ORDER[1:]]
        L.append(f"| {ss[0]['week_no']} | {n} | {ss[0]['duration']} | " + ' / '.join(x['title'] for x in ss) + ' |')
L += ['', 'Total live teaching time per learner: ' + str(sum(s['duration'] for s in data['core']['sessions']) + sum(s['duration'] for s in data['digital']['sessions'])) + ' minutes (core 225 + track 720).', '',
      '## Specialist tracks', '']
for code, _ in ORDER[1:]:
    d = data[code]; L += [f"### {d['track_name']}", ' '.join(d['track_focus'].split()), '', '**Final project:** ' + ' '.join(d['project'].split()), '']
L += ['## Files', '', '| File | Contents |', '|---|---|'] + [f'| [{names[c][0]}]({names[c][0]}) | {names[c][1]}: full lesson plans with time allocations, teaching steps, activities, assessment and facilitator instructions |' for c, _ in ORDER] + \
     ['| [TIME_ALLOCATIONS.md](TIME_ALLOCATIONS.md) | Every session broken into timed segments, with totals checked against the timetable |', '| [ASSESSMENT_AND_OUTPUTS.md](ASSESSMENT_AND_OUTPUTS.md) | Assessment methods, expected outputs and final projects for every track |', '']
docs['README.md'] = '\n'.join(L)
L = [GEN, f'# DIRA LEARN {VERSION} – session time allocations', '', 'Every session is divided into teaching segments. The segments of each session add up exactly to its timetabled duration. Each 120-minute track session includes one five-minute stretch break inside the session (no time is added); the core sessions keep their approved 110 and 115 minutes.', '']
for code, d in data.items():
    L += [f"## {names[code][1]}", '']
    for s in d['sessions']: L += [f"### Session {s['session_no']}: {s['title']} ({s['duration']} min)"] + segment_table(s) + ['']
docs['TIME_ALLOCATIONS.md'] = '\n'.join(L)
L = [GEN, f'# DIRA LEARN {VERSION} – assessment methods and expected outputs', '', 'Each session ends with an assessment activity; questions and marking guidance are in the lesson plans. Final grades follow the programme\'s existing assessment weights and rules in DIRA LEARN (unchanged by this revision).', '']
for code, d in data.items():
    L += [f"## {names[code][1]}", '']
    if code != 'core': L += ['**Final project:** ' + ' '.join(d['project'].split()), '']
    L += ['| Session | Assessment | Expected outputs | Homework |', '|---|---|---|---|']
    for s in d['sessions']:
        L.append(f"| {s['session_no']}. {s['title']} | {len(s['assessment'])} questions or tasks, e.g. *{s['assessment'][0]['question']}* | {'; '.join(s['expected_outputs'])} | {'; '.join(s['homework'])} |")
    L.append('')
docs['ASSESSMENT_AND_OUTPUTS.md'] = '\n'.join(L)

# ---------------------------------------------------------------- write or check
outputs = {os.path.join(proj, 'supabase', 'migrations', '20260101000032_curriculum_v13_2.sql'): migration, seed_path: seed_new}
outputs.update({os.path.join(proj, 'docs', 'curriculum', k): v + ('' if v.endswith('\n') else '\n') for k, v in docs.items()})
import hashlib
stale, writes = [], []
for rel, sha in FROZEN.items():
    if hashlib.sha256(open(os.path.join(proj, rel), 'rb').read()).hexdigest() != sha: stale.append(rel + ' (FROZEN file was changed)')
for path, content in outputs.items():
    cur = open(path, encoding='utf8').read() if os.path.exists(path) else None
    if cur == content: continue
    rel = os.path.relpath(path, proj)
    if rel in FROZEN:
        stale.append(rel + ' (FROZEN: the curriculum source changed after this migration was delivered - add a new migration version for further changes)')
    else:
        stale.append(rel); writes.append((path, content))
frozen_bad = [x for x in stale if 'FROZEN' in x]
if frozen_bad and not check_only:
    print('BUILD STOPPED (nothing written): ' + ', '.join(frozen_bad)); sys.exit(2)
if not check_only:
    for path, content in writes:
        os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w', encoding='utf8').write(content)
if check_only:
    print(f'curriculum build: {len(outputs)} generated files, {len(stale)} out of date' + (': ' + ', '.join(stale) if stale else ''))
    sys.exit(1 if stale else 0)
print(f'curriculum build: wrote {len(stale)} of {len(outputs)} files; 26 sessions, durations equal the timetable')
