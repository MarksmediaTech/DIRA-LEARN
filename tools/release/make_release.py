#!/usr/bin/env python3
"""Builds the release ZIP (top folder DIRA-LEARN-RELEASE/) from the authoritative development tree (21 Nov 2026 rebuild).

  python3 -I tools/release/make_release.py <project> <lockfile> <output.zip>

Not a copy of the working folder: files are selected, never-ship files are refused, package.json is made to agree with
the verified lockfile, line endings are normalised (CRLF for .bat, LF for everything else), and a MANIFEST.txt with the
SHA-256 of every file is added. Everything sits under one top folder, DIRA-LEARN-RELEASE/.
"""
import hashlib, json, os, pathlib, re, sys, zipfile

proj = pathlib.Path(sys.argv[1]).resolve(); lockfile = pathlib.Path(sys.argv[2]).resolve(); out = pathlib.Path(sys.argv[3]).resolve()
TOP = 'DIRA-LEARN-RELEASE'
SKIP_DIRS = {'node_modules', 'dist', '.git', 'coverage', 'test-results', 'playwright-report', '.vite', '.wrangler', '__pycache__'}
SKIP_FILES = re.compile(r'(^|/)(\.env(\.[a-z]+)?|\.dev\.vars|netlify\.toml|.*\.(pem|key|log|pyc|dump|bak)|\.DS_Store|Thumbs\.db)$', re.I)
KEEP_ENV = re.compile(r'(^|/)\.env\.example$')
SKIP_PATHS = re.compile(r'^supabase/(\.temp|\.branches)/')

files = {}
for dirpath, dirnames, filenames in os.walk(proj):
    dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
    for f in sorted(filenames):
        rel = (pathlib.Path(dirpath) / f).relative_to(proj).as_posix()
        if SKIP_PATHS.match(rel) or (SKIP_FILES.search(rel) and not KEEP_ENV.search(rel)): continue
        files[rel] = (pathlib.Path(dirpath) / f).read_bytes()

# package.json must agree with the verified lockfile (npm ci refuses otherwise): @playwright/test is not in it, because the
# package registry was unreachable when the release was prepared. Everything else is unchanged.
pkg = json.loads(files['package.json'])
lock = json.loads(lockfile.read_bytes()); root = lock['packages']['']
pkg['devDependencies'].pop('@playwright/test', None); pkg['scripts'].pop('test:e2e', None)
pkg['scripts'].setdefault('preview', 'vite preview'); pkg['engines'] = root.get('engines', {'node': '>=20'})
for sec in ('dependencies', 'devDependencies'):
    if pkg.get(sec, {}) != root.get(sec, {}):
        sys.exit(f'package.json {sec} do not match the lockfile: {set(pkg.get(sec, {}).items()) ^ set(root.get(sec, {}).items())}')
files['package.json'] = (json.dumps(pkg, indent=2) + '\n').encode()
files['package-lock.json'] = lockfile.read_bytes()

for rel, data in list(files.items()):
    if b'\0' in data: continue                                        # binary
    text = data.replace(b'\r\n', b'\n')
    files[rel] = text.replace(b'\n', b'\r\n') if rel.lower().endswith(('.bat', '.cmd')) else text

for required in ['package.json', 'package-lock.json', '.nvmrc', '.gitignore', '.gitattributes', '.env.example', 'README.md', 'wrangler.jsonc',
                 'vite.config.ts', 'tsconfig.json', 'index.html', 'START-DIRA-LEARN.bat', 'CHECK-DIRA-LEARN.bat', '.github/workflows/release-check.yml',
                 'scripts/release-check.mjs', 'supabase/seed.sql', 'supabase/config.toml', 'supabase/production_init/01_initialize_production.sql',
                 'supabase/production_init/01b_continue_after_37.sql', 'supabase/production_init/02_verify_readonly.sql',
                 'docs/deployment/INSTALL_GUIDE.md', 'docs/deployment/RELEASE_AUDIT_AND_TEST_REPORT_2026-11-21.md', 'docs/deployment/MIGRATION_REGISTER.md',
                 'supabase/functions/bootstrap-first-admin/index.ts', 'src/features/auth/ChangePasswordPage.tsx',
                 'supabase/baseline/20261121000001_dira_learn_baseline_schema.sql', 'supabase/baseline/20261121000002_dira_learn_baseline_platform.sql',
                 'supabase/baseline/20261121000003_dira_learn_baseline_data.sql', 'supabase/install/STEP-0_precheck_read-only.sql',
                 'supabase/install/STEP-1_schema-part-1-of-2.sql', 'supabase/install/STEP-2_schema-part-2-of-2.sql',
                 'supabase/install/STEP-3_platform-and-data-part-1.sql', 'supabase/install/STEP-4_data-part-2.sql',
                 'supabase/install/STEP-5_verify_read-only.sql', 'supabase/install/RECOVERY_remove-incomplete-install.sql', 'supabase/install/REPAIR_api-grants.sql',
                 'supabase/pending/20261122000001_participant_programme_track.sql', 'supabase/pending/20261122000001_participant_programme_track_rollback.sql',
                 'supabase/functions/complete-enrolment/index.ts', 'docs/deployment/CHANGE_REPORT_2026-11-22_DIRECT_CSV_ENROLMENT.md',
                 '.github/workflows/database-pg17.yml', '.github/workflows/deploy-supabase-functions.yml',
                 'tools/baseline/baseline_check.sh', 'tools/baseline/install_check.sh',
                 'tools/check-all.sh', 'src/main.tsx',
                 # Chat, notification bell and Google Calendar sync (22 Nov 2026)
                 'supabase/pending/20261122000002_chat_notifications_calendar.sql', 'supabase/pending/20261122000002_chat_notifications_calendar_rollback.sql',
                 'supabase/tests-pending/chat_notifications_calendar.test.sql', 'supabase/functions/google-calendar-sync/index.ts',
                 'src/features/chat/ChatPage.tsx', 'src/components/ui/NotificationBell.tsx', 'src/features/calendar/GoogleSyncPanel.tsx',
                 'docs/GOOGLE_CALENDAR_SETUP.md', 'docs/CHAT_AND_NOTIFICATIONS.md', 'docs/deployment/CHANGE_REPORT_2026-11-22_CHAT_NOTIFICATIONS_GOOGLE_CALENDAR.md',
                 'tools/chat/chat_db_check.sh', 'tools/recovery/browser/chat_flow.mjs']:
    if required not in files: sys.exit(f'required file missing: {required}')
mig = sorted(r for r in files if re.match(r'supabase/migrations/\d{14}_.*\.sql$', r))
if len(mig) != 39: sys.exit(f'expected 39 migrations, found {len(mig)}')
if any(r.startswith('supabase/functions/claim-first-admin/') for r in files): sys.exit('the retired claim-first-admin function must not ship')
for gone in ('src/features/notifications/NotificationsPage.tsx', 'src/features/notifications/AnnouncementsPage.tsx', 'src/features/connect/ConnectPage.tsx'):
    if gone in files: sys.exit(f'{gone} was replaced by Chat and must not ship')

manifest = '\n'.join(f'{hashlib.sha256(files[r]).hexdigest()}  {r}' for r in sorted(files)) + '\n'
files['MANIFEST.txt'] = (f'# DIRA LEARN updated release - {len(files)} files with SHA-256 (MANIFEST.txt itself excluded)\n' + manifest).encode()
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in sorted(files):
        info = zipfile.ZipInfo(f'{TOP}/{rel}', date_time=(2026, 11, 21, 12, 0, 0))
        info.external_attr = (0o755 if rel.endswith(('.sh', '.mjs', '.py')) else 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, files[rel])
print(f'{out.name}: {len(files)} files, {out.stat().st_size} bytes, sha256 {hashlib.sha256(out.read_bytes()).hexdigest()}')
