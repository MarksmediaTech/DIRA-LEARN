#!/usr/bin/env bash
# Usage: db_test.sh <project-dir> [test-file-pattern]   Mimics `supabase test db`: runs every supabase/tests/*.sql (each rolls itself back).
set -uo pipefail
PROJ="$1"; PAT="${2:-}"; total=0; failed=0; files_bad=()
for f in "$PROJ"/supabase/tests/*${PAT}*.sql; do
  # DIRA_TEST_SKIP: space-separated test files to leave out (the baseline check skips the legacy V13 loader test)
  case " ${DIRA_TEST_SKIP:-} " in *" $(basename "$f") "*) echo "SKIP $(basename "$f") (DIRA_TEST_SKIP)"; continue;; esac
  out=$(psql -h /tmp -p 54322 -U postgres -d postgres -X -tA -v ON_ERROR_STOP=1 -f "$f" 2>&1); rc=$?
  n_ok=$(grep -cE '^ok [0-9]+' <<<"$out"); n_bad=$(grep -cE '^not ok [0-9]+' <<<"$out")
  plan=$(grep -oE '^1\.\.[0-9]+' <<<"$out" | head -1 | cut -c4-)
  total=$((total+n_ok+n_bad)); failed=$((failed+n_bad))
  status="PASS"; { [ $rc -ne 0 ] || [ "$n_bad" -gt 0 ] || [ "${plan:-x}" != "$((n_ok+n_bad))" ]; } && { status="FAIL"; files_bad+=("$(basename "$f")"); }
  printf '%-4s %-38s %3s/%-3s ok' "$status" "$(basename "$f")" "$n_ok" "${plan:-?}"; echo
  if [ "$status" = FAIL ]; then grep -E '^not ok|^#|ERROR|psql:' <<<"$out" | head -12 | sed 's/^/       /'; fi
done
echo "TOTAL assertions run: $total, failed: $failed, files failing: ${#files_bad[@]}"
