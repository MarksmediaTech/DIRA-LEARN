#!/usr/bin/env bash
# Builds the clean production package from the development project (no Windows launchers, tests, test tools or
# development history). Usage: tools/make-production-package.sh <development project> <output folder>
# Writes <output folder>/dira-learn. The development project itself is not changed.
set -euo pipefail
DEV="$(cd "$1" && pwd)"; PARENT="$2"; OUT="$PARENT/dira-learn"
rm -rf "$OUT"; mkdir -p "$PARENT"; cp -a "$DEV" "$OUT"; cd "$OUT"
OVERLAY=$(mktemp -d); cp -a tools/production/. "$OVERLAY/"
rm -rf node_modules dist supabase/.temp supabase/.branches .env.local
REMOVE=( CHECK-DIRA-LEARN.bat CREATE-DIRA-TEST-ACCOUNTS.bat START-DIRA-LEARN.bat TEST-PASSWORD-RECOVERY.bat README-LOCAL-TESTING.txt
  e2e playwright.config.ts netlify.toml src/test supabase/tests supabase/local_test_accounts.sql supabase/reset_curriculum.sql
  docs/DEVELOPMENT_PROGRESS.md docs/FINAL_IMPLEMENTATION_REPORT.md docs/HANDOVER_AUDIT_V8.md docs/INTERFACE_POLISH.md
  docs/NETLIFY_DEPLOYMENT.md docs/PHASE4_COMPLETION_REPORT.md docs/TEST_REPORT.md )
for f in "${REMOVE[@]}"; do [ -e "$f" ] || { echo "expected development file missing: $f"; exit 1; }; rm -rf "$f"; done
# tools: keep only what operators need (curriculum generator, photo preparation)
find tools -mindepth 1 -maxdepth 1 ! -name curriculum ! -name photos -exec rm -rf {} +
find tools/curriculum -mindepth 1 ! -name build_v13.py ! -name coverage.py ! -name 'migration_3?_template.sql' -exec rm -rf {} +
find tools/photos -mindepth 1 ! -name prepare.py ! -name photos.yaml -exec rm -rf {} +
find src -name '*.test.ts' -delete; find src -name '*.test.tsx' -delete
cp "$OVERLAY/README.md" README.md; cp "$OVERLAY/env.example" .env.example; rm -rf "$OVERLAY"
python3 - <<'PY'
import json
d = json.load(open('package.json'))
for k in ['test', 'test:watch', 'test:e2e', 'db:reset', 'db:test', 'db:types']: d['scripts'].pop(k, None)
d['scripts']['preview'] = 'vite preview'; d['devDependencies'].pop('@playwright/test', None); d['engines'] = {'node': '>=20'}
open('package.json', 'w').write(json.dumps(d, indent=2) + '\n')
s = open('docs/PASSWORD_RECOVERY.md').read(); i = s.index('## 5. Tests')
open('docs/PASSWORD_RECOVERY.md', 'w').write(s[:i] + "## 5. Tests and local testing\nThe automated tests, the local Windows test scripts and the Supabase CLI v3 launcher notes are kept in the development\narchive (`dira-learn-v13.2-dev-archive.zip`), not in this production package. Live checks: `docs/deployment/SECURITY_AND_TESTING_REPORT.md` §4.\n")
PY
echo "production package written to $OUT"
