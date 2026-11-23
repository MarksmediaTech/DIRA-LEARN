#!/usr/bin/env python3
"""Every file the build needs exists in the given project folder: all relative and '@/' imports in src (incl. images and CSS),
index.html references, package.json scripts, Vite/TypeScript/Tailwind/PostCSS/ESLint configs, the GitHub workflow, the
Edge Functions' shared imports, and the files the deployment docs and scripts name. Also lists src files nothing imports."""
import os, re, sys, json
root = os.path.abspath(sys.argv[1]); problems = []; checked = 0
def exists(rel): return os.path.exists(os.path.join(root, rel))
def need(rel, why):
    global checked; checked += 1
    if not exists(rel): problems.append(f'missing {rel}  (needed by {why})')
EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx']
def resolve(base_dir, spec):
    p = os.path.normpath(os.path.join(base_dir, spec))
    for e in EXT:
        if os.path.isfile(p + e): return p + e
    return None
imported = set()
src_files = [os.path.join(d, f) for d, _, fs in os.walk(os.path.join(root, 'src')) for f in fs]
for f in src_files:
    if not f.endswith(('.ts', '.tsx', '.css')): continue
    text = open(f, encoding='utf8').read()
    specs = re.findall(r"""(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]""", text)
    for groups in specs:
        spec = next(s for s in groups if s)
        if spec.startswith('@/'): target = resolve(os.path.join(root, 'src'), spec[2:])
        elif spec.startswith('.'): target = resolve(os.path.dirname(f), spec)
        else: continue   # npm package
        checked += 1
        if not target: problems.append(f'missing import {spec!r} in {os.path.relpath(f, root)}')
        else: imported.add(os.path.normpath(target))
pkg = json.load(open(os.path.join(root, 'package.json')))
for name, cmd in pkg['scripts'].items():
    for m in re.findall(r'node\s+(\S+\.m?js)', cmd): need(m, f'npm script {name}')
for rel in ['index.html', 'vite.config.ts', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.js', 'eslint.config.js', '.nvmrc',
            'public/_headers', 'src/main.tsx', 'src/vite-env.d.ts', 'src/index.css', '.github/workflows/release-check.yml',
            'scripts/write-headers.mjs', 'scripts/release-check.mjs', 'wrangler.jsonc', 'scripts/secret-scan-allowlist.json', 'supabase/config.toml', 'supabase/seed.sql', 'supabase/templates/recovery.html',
            '.env.example', '.gitignore', '.gitattributes', 'docs/deployment/CLOUDFLARE_PAGES.md', 'docs/deployment/SUPABASE_PRODUCTION.md',
            'docs/deployment/DEPLOYMENT_CHECKLIST.md', 'docs/deployment/INSTALL_GUIDE.md', '.github/workflows/database-pg17.yml',
            '.github/workflows/deploy-supabase-functions.yml', 'supabase/install/STEP-0_precheck_read-only.sql', 'supabase/install/STEP-1_schema-part-1-of-2.sql',
            'supabase/install/STEP-2_schema-part-2-of-2.sql', 'supabase/install/STEP-3_platform-and-data-part-1.sql', 'supabase/install/STEP-4_data-part-2.sql',
            'supabase/install/STEP-5_verify_read-only.sql', 'supabase/install/RECOVERY_remove-incomplete-install.sql', 'supabase/install/REPAIR_api-grants.sql', 'tools/db-standin/sql_editor_role.sql',
            'supabase/pending/20261122000001_participant_programme_track.sql', 'supabase/pending/20261122000001_participant_programme_track_rollback.sql',
            'supabase/functions/complete-enrolment/index.ts', 'src/lib/functionError.ts', 'src/features/auth/enrolment.ts',
            'docs/deployment/CHANGE_REPORT_2026-11-22_DIRECT_CSV_ENROLMENT.md', 'tools/enrolment/enrolment_db_check.sh', 'tools/recovery/browser/enrolment_flow.mjs',
            'supabase/functions/bootstrap-first-admin/index.ts', 'src/features/auth/ChangePasswordPage.tsx']:
    need(rel, 'build / deployment')
html = open(os.path.join(root, 'index.html')).read()
for ref in re.findall(r'(?:src|href)="(/[^"]+)"', html):
    need(ref.lstrip('/') if ref.startswith('/src/') else 'public' + ref, 'index.html')
toml = open(os.path.join(root, 'supabase/config.toml')).read()
for ref in re.findall(r'content_path\s*=\s*"\./([^"]+)"', toml): need(ref, 'supabase/config.toml (paths are relative to the project folder)')
fn_dir = os.path.join(root, 'supabase/functions')
for d in sorted(os.listdir(fn_dir)):
    if d.startswith('_'): continue
    need(f'supabase/functions/{d}/index.ts', 'Edge Function')
    for spec in re.findall(r"from '(\.\./_shared/[^']+)'", open(os.path.join(fn_dir, d, 'index.ts')).read()):
        need(os.path.normpath(f'supabase/functions/{d}/{spec}'), f'Edge Function {d}')
migs = sorted(f for f in os.listdir(os.path.join(root, 'supabase/migrations')) if f.endswith('.sql'))
nums = [int(f[8:14]) for f in migs]
if nums != list(range(1, len(nums) + 1)): problems.append(f'migrations not numbered 1..{len(nums)}: {nums}')
for n in [14, 16] + list(range(23, 40)):
    need(next((f'supabase/rollback/{f}' for f in os.listdir(os.path.join(root, 'supabase/rollback')) if f.startswith(f'2026010100{n:04d}')), f'supabase/rollback/<migration {n}>_down.sql'), 'rollback')
for doc in ['docs/deployment/' + f for f in os.listdir(os.path.join(root, 'docs/deployment')) if f != 'REMOVED_FILES.md']:   # that file lists what is left out on purpose
    for ref in re.findall(r'`((?:supabase|scripts|src|public|tools|docs)/[A-Za-z0-9_./-]+\.(?:sql|mjs|ts|tsx|md|yaml|py|html|txt))`', open(os.path.join(root, doc)).read()):
        if 'tests/' in ref or ref.startswith('tools/') and not ref.startswith(('tools/photos/prepare.py', 'tools/photos/photos.yaml', 'tools/curriculum/')): continue
        if '<' in ref or '*' in ref: continue
        need(ref, doc)
entry = {os.path.normpath(os.path.join(root, 'src/main.tsx')), os.path.normpath(os.path.join(root, 'src/vite-env.d.ts'))}
unused = sorted(os.path.relpath(f, root) for f in src_files if f.endswith(('.ts', '.tsx', '.css', '.png', '.svg')) and not f.endswith(('.test.ts', '.test.tsx'))
                and '/test/' not in f and os.path.normpath(f) not in imported | entry)
print(f'references checked: {checked}; missing: {len(problems)}; migrations: {len(migs)} (01-{nums[-1]:02d})')
for p in problems: print('  PROBLEM ' + p)
if unused: print('  note - source files nothing imports: ' + ', '.join(unused))
sys.exit(1 if problems else 0)
