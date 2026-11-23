#!/usr/bin/env bash
# Usage: run_unit.sh <project-dir>   Runs every src/**/*.test.ts through tsx with the Vitest stand-in (one process per file).
PROJ="$1"; H="$(cd "$(dirname "$0")" && pwd)"; pass=0; fail=0; skip=0
cd "$PROJ"
for f in $(find src -name '*.test.ts' | sort); do
  runner=$(mktemp --suffix=.mjs -p /tmp)
  printf "import { run } from '%s';\nawait import('%s');\nawait run('%s');\n" "$H/vitest_shim.mjs" "$PROJ/$f" "$f" > "$runner"
  out=$(NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/tsx --tsconfig "$PROJ/tsconfig.json" "$runner" 2>&1); rc=$?
  if grep -q "Cannot find package\|ERR_MODULE_NOT_FOUND\|Cannot find module" <<<"$out"; then
    skip=$((skip+1)); echo "SKIP $f (needs: $(grep -oE "(package|module) '[^']+'" <<<"$out" | head -1))"
  else echo "$out" | grep -E '^(PASS|FAIL)|^     - ' ; [ $rc -eq 0 ] && pass=$((pass+1)) || fail=$((fail+1)); fi
  rm -f "$runner"
done
echo "files passed: $pass, failed: $fail, skipped (missing package): $skip"
