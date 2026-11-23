#!/usr/bin/env bash
# Runs every check available WITHOUT npm install (used by Claude between phases). On a normal computer use instead:
#   npm run typecheck && npm run lint && npm test && npm run build && supabase db reset && supabase test db
# Usage: bash tools/check-all.sh   (from the project folder; needs a local PostgreSQL on /tmp:54322, see tools/db-standin/README.md)
set -u -o pipefail
PROJ="$(cd "$(dirname "$0")/.." && pwd)"; T="$PROJ/tools"; fail=0
# A ZIP extraction or a GitHub web upload drops the "executable" mark of shell scripts; restore it so the helper scripts
# start (found 21 Nov 2026 when the release ZIP was tested in a clean folder). Start this file with: bash tools/check-all.sh
find "$T" "$PROJ/scripts" -name '*.sh' -exec chmod +x {} + 2>/dev/null
if ! pg_isready -h /tmp -p 54322 -q 2>/dev/null; then   # start the local PostgreSQL used for testing if it is not running
  [ -d /tmp/pgdata ] || { mkdir -p /tmp/pgdata && chown postgres /tmp/pgdata && su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -U postgres --auth=trust -E UTF8" >/dev/null; }
  rm -f /tmp/pgdata/postmaster.pid; su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-k /tmp -p 54322 -c wal_level=logical' -l /tmp/pg.log -w start" >/dev/null
fi
echo "== 1. database: fresh reset, all migrations, seed";   "$T/db-standin/db_reset.sh" "$PROJ" 2>/dev/null | tail -1 || fail=1
echo "== 2. database tests (pgTAP)";                         out=$("$T/db-standin/db_test.sh" "$PROJ"); echo "$out" | grep -vE '^PASS'; grep -q 'failed: 0, files failing: 0' <<<"$out" || fail=1
echo "== 2b. integration: database results = TypeScript results (Phase 6 fixture)"
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/tsx --tsconfig "$PROJ/tsconfig.json" "$T/db-standin/crosscheck_results.ts" "$PROJ" 2>&1 | grep -v NOTICE || fail=1
echo "== 2c. integration: virus-scanner adapter against a local fake scanner"
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/tsx "$T/db-standin/scanner_adapter_check.ts" "$PROJ" || fail=1
echo "== 2d. integration: every database function, table and bucket the screens use exists and is reachable"
# the screens of this release also use Chat (pending change 2 of 22 Nov 2026) and the enrolment track (pending change 1): they are
# checked on a scratch copy with both pending changes applied, which is the order of deployment (database first, then the website)
psql -h /tmp -p 54322 -U postgres -d template1 -X -q -c "drop database if exists contract with (force)" -c "create database contract template postgres" 2>/dev/null
for f in "$PROJ"/supabase/pending/20261122000001_participant_programme_track.sql "$PROJ"/supabase/pending/20261122000002_chat_notifications_calendar.sql; do
  psql -h /tmp -p 54322 -U postgres -d contract -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "pending change $(basename "$f") did not apply"; fail=1; }; done
DIRA_DB=contract python3 -I "$T/db-standin/frontend_contract_check.py" "$PROJ" || fail=1
psql -h /tmp -p 54322 -U postgres -d template1 -X -q -c "drop database if exists contract with (force)" 2>/dev/null
echo "== 2e. end-to-end workflows across phases, with the local test accounts (scratch copy of the database)"
psql -h /tmp -p 54322 -U postgres -d template1 -X -q -c "drop database if exists e2e with (force)" -c "create database e2e template postgres" -c "alter database e2e set search_path = \"\$user\", public, extensions" 2>/dev/null
psql -h /tmp -p 54322 -U postgres -d e2e -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/local_test_accounts.sql" >/dev/null || { echo "test accounts script FAILED"; fail=1; }
out=$(psql -h /tmp -p 54322 -U postgres -d e2e -X -tA -v ON_ERROR_STOP=1 -f "$T/db-standin/workflow_check.sql" 2>&1); echo "$out" | grep -E '^not ok|^# |ERROR'
grep -q '^# all [0-9]* passed' <<<"$out" || fail=1
psql -h /tmp -p 54322 -U postgres -d template1 -X -q -c "drop database if exists e2e with (force)" 2>/dev/null
echo "== 2f. V13 curriculum: generated files in sync, content coverage, timetable, upgrade of an existing database and rollback"
python3 -I "$T/curriculum/build_v13.py" "$PROJ" --check || fail=1
python3 -I "$T/curriculum/coverage.py" "$PROJ" | grep -v "note:" || fail=1
python3 -I "$T/curriculum/upgrade_check.py" "$PROJ" || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 30 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 31 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 32 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 33 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 34 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 35 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 36 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 37 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 38 || fail=1
"$T/db-standin/verify_rollback.sh" "$PROJ" 39 || fail=1
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1; psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/rollback/20260101000034_account_status_enforcement_down.sql" >/dev/null 2>&1
s34=$(psql -h /tmp -p 54322 -U postgres -d postgres -X -tA -c "select coalesce(array_to_string(rolconfig, ','), 'none') from pg_roles where rolname = 'authenticator'")
[ "$s34" = none ] && echo "rollback 34: API pre-request setting removed" || { echo "rollback 34: pre-request setting still present: $s34"; fail=1; }
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "== 3. unit tests (pure logic)"
TMP=$(mktemp -d); cp -a "$PROJ" "$TMP/p"; mkdir -p "$TMP/p/node_modules"; ln -s /opt/npm-tools/node_modules/zod "$TMP/p/node_modules/zod"
out=$("$T/db-standin/run_unit.sh" "$TMP/p" 2>&1); echo "$out" | grep -vE '^PASS'
cases=$(echo "$out" | grep -E '^PASS' | awk '{split($3,a,"/"); s+=a[1]; t+=a[2]} END {print s "/" t}'); echo "unit test cases passed: $cases"
# site.test.ts needs Vite's import.meta.env and cannot run here; any other failure counts
bad=$(echo "$out" | grep -E '^FAIL' | grep -v 'site.test' | wc -l); [ "$bad" -eq 0 ] || fail=1; rm -rf "$TMP"
echo "== 4. type check of all screens and logic (stub definitions, strict settings)"; "$T/typecheck-stubs/run.sh" "$PROJ" || fail=1
echo "== 5. syntax parse of every TypeScript file (incl. Edge Functions)"
NODE_PATH=/opt/npm-tools/node_modules node -e "
const ts=require('typescript');const fs=require('fs');const path=require('path');let n=0,bad=0;
function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory())walk(p);else if(/\.(tsx?)$/.test(f)){n++;const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true,f.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);if(sf.parseDiagnostics.length){bad++;console.log(p)}}}}
for (const d of ['src','supabase/functions','e2e']) walk('$PROJ/'+d); console.log('parsed',n,'files, syntax errors in',bad); process.exit(bad?1:0)" || fail=1
echo "== 6. Windows launchers: static batch-file check and decision-logic check (Windows itself not run)"
python3 -I "$T/check_bat_files.py" "$PROJ" || fail=1
python3 -I "$T/launcher_logic_check.py" "$PROJ" || fail=1
echo "== 7. password recovery: screens in Chrome (simulated Supabase Auth), dry run of the real-Supabase test, no logging of codes"
node "$T/recovery/browser/run.mjs" "$PROJ" || fail=1
"$T/recovery/dryrun/dryrun.sh" "$PROJ" 2>/dev/null | grep -v NOTICE || fail=1
if grep -nE "console\.(log|info|debug|warn|error)" "$PROJ/src/features/auth/ForgotPasswordPage.tsx" "$PROJ/src/features/auth/recoveryRules.ts"; then echo "recovery screens write to the console"; fail=1; else echo "recovery screens: no console logging"; fi
echo "== 8. Edge Functions in Chrome: real function code, simulated Supabase; CORS from allowed and other websites, sign-in and role checks"
node "$T/edge-browser/run.mjs" "$PROJ" 2>&1 | grep -E "^FAIL|checks passed" || fail=1
node "$T/edge-browser/run.mjs" "$PROJ" 2>&1 | grep -q "61/61 checks passed" || fail=1
echo "== 9. Content-Security-Policy in Chrome (simulated Supabase), and the real recovery screens under the production policy"
node "$T/csp/run.mjs" "$PROJ" 2>&1 | grep -E "^FAIL|checks passed" || fail=1
node "$T/csp/run.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
RECOVERY_CSP=1 node "$T/recovery/browser/run.mjs" "$PROJ" 2>&1 | grep -E "checks passed|FAILED" | cut -c1-200
RECOVERY_CSP=1 node "$T/recovery/browser/run.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
echo "== 10. photo preparation tool (synthetic test images)"
python3 -I "$T/photos/check_prepare.py" "$PROJ" | tail -1 || fail=1
python3 -I "$T/photos/check_prepare.py" "$PROJ" >/dev/null || fail=1
echo "== 11. release-check runner (synthetic builds and audit outputs; the real run needs the npm registry)"
node "$T/release/check_release_check.mjs" "$PROJ" | tail -1
node "$T/release/check_release_check.mjs" "$PROJ" >/dev/null || fail=1
echo "== 12. routes: public pages, role guards, menu entries"
python3 -I "$T/release/routes_check.py" "$PROJ" || fail=1
python3 -I "$T/release/references_check.py" "$PROJ" || fail=1
echo "== 13. every file referenced by package.json, Vite, TypeScript, index.html, Supabase config, Edge Functions and deployment docs exists"
python3 -I "$T/release/references_check.py" "$PROJ" || fail=1
echo "== 14. Zod 4 compatibility of the form schemas (Zod 4 engine bundled in zod 3.25; informational until the upgrade)"
node "$T/release/zod4_compat.mjs" "$PROJ" 2>&1 | grep -E "^(SAME|DIFF)"
echo "== 15. registration -> email verification -> account loading in Chrome (real screens, simulated Supabase), also under the production policy"
node "$T/recovery/browser/auth_flow.mjs" "$PROJ" 2>&1 | grep -E "^FAIL|checks passed" ; node "$T/recovery/browser/auth_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
RECOVERY_CSP=1 node "$T/recovery/browser/auth_flow.mjs" "$PROJ" 2>&1 | grep -E "^FAIL|checks passed" ; RECOVERY_CSP=1 node "$T/recovery/browser/auth_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
echo "== 16. migration 36 on a drifted database (trigger missing, accounts without profiles)"
"$T/release/profile_repair_check.sh" "$PROJ" | tail -1 ; "$T/release/profile_repair_check.sh" "$PROJ" >/dev/null || fail=1
echo "== 17. production database initialization rehearsal (empty database; and the partial production state: 01-37 applied, no seed, no grants)"
out=$("$T/release/production_init_check.sh" "$PROJ" 2>&1); echo "$out" | tail -3; echo "$out" | grep -q "28/28 checks passed" || fail=1
echo "== 18. migration 37: Digital Marketing topics on their V13.2 sessions, DIRA 8 Nov 2026 approval noted, nothing approved"
out=$("$T/release/migration37_check.sh" "$PROJ" 2>&1); echo "$out" | tail -3; echo "$out" | grep -q "28/28 checks passed" || fail=1
echo "== 19. Data API grants and RLS (migration 38): the production 403 reproduced without it and gone with it; real signed-in sessions per role"
out=$("$T/release/grants_check.sh" "$PROJ" 2>&1); echo "$out" | tail -3; echo "$out" | grep -q "24/24 checks passed" || fail=1
echo "== 20. migration register: numbering, rollbacks, bundles and documentation agree with the migration files"
python3 -I "$T/release/migration_register.py" "$PROJ" --check || fail=1
echo "== 21. Supabase SQL Editor installation: byte-identical to the release, executed exactly as the SQL Editor does"
out=$(bash "$T/release/sql_editor_check.sh" "$PROJ" 2>&1); echo "$out" | tail -2; echo "$out" | grep -q "44/44 checks passed" || fail=1
echo "== 22. database baseline (supabase/baseline): identical to migrations 01-39 + seed; pgTAP suite on it; guards"
out=$(bash "$T/baseline/baseline_check.sh" "$PROJ" 2>&1); echo "$out" | tail -1; echo "$out" | grep -q "15/15 checks passed" || fail=1
echo "== 23. browser installation of a NEW project (supabase/install): run as the SQL Editor runs it (as a non-superuser, like Supabase), LF and CR LF, guards, failure, recovery"
out=$(bash "$T/baseline/install_check.sh" "$PROJ" 2>/dev/null); echo "$out" | grep -E "FAIL|checks passed"; echo "$out" | grep -q "58/58 checks passed" || fail=1
echo "== 24. first Super Administrator (/setup) and Change password in Chrome (real screens, simulated Supabase), also under the production policy"
node "$T/recovery/browser/setup_flow.mjs" "$PROJ" 2>&1 | grep -E "FAILED|checks passed"; node "$T/recovery/browser/setup_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
RECOVERY_CSP=1 node "$T/recovery/browser/setup_flow.mjs" "$PROJ" 2>&1 | grep -E "FAILED|checks passed"; RECOVERY_CSP=1 node "$T/recovery/browser/setup_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
echo "== 26. direct CSV enrolment and the \"j.json is not a function\" fix in Chrome (real screens, simulated Supabase), also under the production policy"
node "$T/recovery/browser/enrolment_flow.mjs" "$PROJ" 2>&1 | grep -E "FAILED|checks passed"; node "$T/recovery/browser/enrolment_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
RECOVERY_CSP=1 node "$T/recovery/browser/enrolment_flow.mjs" "$PROJ" 2>&1 | grep -E "FAILED|checks passed"; RECOVERY_CSP=1 node "$T/recovery/browser/enrolment_flow.mjs" "$PROJ" >/dev/null 2>&1 || fail=1
echo "== 27. direct CSV enrolment, database side: the PENDING change on a new project as the SQL Editor's non-superuser role"
out=$(bash "$T/enrolment/enrolment_db_check.sh" "$PROJ" 2>/dev/null); echo "$out" | grep -E "FAIL|checks passed"; echo "$out" | grep -q "22/22 checks passed" || fail=1
echo "== 28. Chat, notifications and Google Calendar sync, database side: the PENDING change as the SQL Editor's role, pgTAP, rollback, regression"
out=$(bash "$T/chat/chat_db_check.sh" "$PROJ" 2>/dev/null); echo "$out" | grep -E "FAIL|checks passed"; echo "$out" | grep -q "16/16 checks passed" || fail=1
echo "== 29. Chat dashboard and notification bell in Chrome (the real application, simulated Supabase incl. Realtime and Storage; fake microphone)"
out=$(node "$T/recovery/browser/chat_flow.mjs" "$PROJ" 2>&1); echo "$out" | grep -E "^FAIL|screen tests passed"; echo "$out" | grep -q "24/24 Chat and notification screen tests passed" || fail=1
grep -q "microphone=(self)" "$PROJ/public/_headers" && grep -q "camera=()" "$PROJ/public/_headers" && echo "response headers: microphone allowed for DIRA LEARN only (voice messages), camera off" || { echo "Permissions-Policy does not allow voice recording or enables the camera"; fail=1; }
echo "== 25. GitHub workflow files parse"
python3 -c "import yaml,glob,sys; [yaml.safe_load(open(f)) for f in glob.glob(sys.argv[1]+'/.github/workflows/*.yml')]; print('workflows: YAML ok')" "$PROJ" || fail=1
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "== NOT RUN HERE (no package registry / no Windows / no live services): npm ci, package-lock.json, npm run typecheck with real packages, npm run lint (ESLint), React component tests, site.test.ts, npm run build, npm audit, bundle size, PostgreSQL 17 (GitHub workflow database-pg17 does it), the real Supabase Dashboard and Auth Admin API, Supabase CLI and real Supabase services, the .bat files on Windows, live Edge Functions"
[ $fail -eq 0 ] && echo "ALL AVAILABLE CHECKS PASSED" || echo "SOME CHECKS FAILED"; exit $fail
