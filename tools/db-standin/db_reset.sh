#!/usr/bin/env bash
# Usage: db_reset.sh <project-dir>   Mimics `supabase db reset`: fresh database, Supabase stand-in, all migrations in order, seed.
set -uo pipefail
PROJ="$1"; H="$(cd "$(dirname "$0")" && pwd)"
PSQL="psql -h /tmp -p 54322 -U postgres -v ON_ERROR_STOP=1 -q -X"
psql -h /tmp -p 54322 -U postgres -q -X -d template1 -c "drop database if exists postgres with (force)" -c "create database postgres" >/dev/null || exit 1
# DIRA_SHIM lets a historical simulation use another stand-in (only tools/curriculum/upgrade_check.py does, for the pre-V13 era)
$PSQL -d postgres -f "${DIRA_SHIM:-$H/supabase_shim.sql}" >/dev/null || { echo "SHIM FAILED"; exit 1; }
ok=0
# DIRA_BASELINE=1 installs supabase/baseline (the generated, patch-free final state) instead of supabase/migrations + seed.sql
MIGDIR="$PROJ/supabase/migrations"; [ "${DIRA_BASELINE:-0}" = 1 ] && MIGDIR="$PROJ/supabase/baseline"
for f in "$MIGDIR"/*.sql; do
  # Supabase runs each migration file as one transaction
  if out=$($PSQL -d postgres -1 -f "$f" 2>&1); then ok=$((ok+1)); echo "OK   $(basename "$f")"
  else echo "FAIL $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE|psql:" | head -8; exit 2; fi
done
if [ "${DIRA_BASELINE:-0}" = 1 ]; then
  $PSQL -d postgres -f "$H/pgtap_shim.sql" >/dev/null || { echo "PGTAP SHIM FAILED"; exit 1; }
  echo "applied $ok baseline files (data included; no seed.sql)"; exit 0
fi
if out=$($PSQL -d postgres -1 -f "$PROJ/supabase/seed.sql" 2>&1); then echo "OK   seed.sql"; else echo "FAIL seed.sql"; echo "$out" | head -8; exit 3; fi
$PSQL -d postgres -f "$H/pgtap_shim.sql" >/dev/null || { echo "PGTAP SHIM FAILED"; exit 1; }
echo "applied $ok migrations + seed"
