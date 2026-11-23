#!/usr/bin/env bash
# verify_rollback.sh <project> <migration-number e.g. 27> : builds 1..(N-1) and 1..N, rolls N back, compares schemas.
set -u; PROJ="$1"; N="$2"; H=$(cd "$(dirname "$0")" && pwd)
prev=$(mktemp -d); cp -a "$PROJ" "$prev/p"; for f in "$prev"/p/supabase/migrations/*.sql; do v=$(basename "$f" | cut -c13-14); [ "$((10#$v))" -ge "$N" ] && rm "$f"; done
"$H/db_reset.sh" "$prev/p" >/dev/null 2>&1 || { echo "build of previous state failed"; exit 1; }
su postgres -c "pg_dump -h /tmp -p 54322 -U postgres -d postgres --schema-only" | grep -vE '^--|^\\(un)?restrict|^$' > "$prev/before.sql"
cp -a "$PROJ" "$prev/q"; for f in "$prev"/q/supabase/migrations/*.sql; do v=$(basename "$f" | cut -c13-14); [ "$((10#$v))" -gt "$N" ] && rm "$f"; done
"$H/db_reset.sh" "$prev/q" >/dev/null 2>&1 || { echo "build with migration failed"; exit 1; }
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$(ls "$PROJ"/supabase/rollback/202601010000${N}_*_down.sql)" >/dev/null || { echo "ROLLBACK $N FAILED"; exit 1; }
su postgres -c "pg_dump -h /tmp -p 54322 -U postgres -d postgres --schema-only" | grep -vE '^--|^\\(un)?restrict|^$' > "$prev/after.sql"
if diff -q "$prev/before.sql" "$prev/after.sql" >/dev/null; then echo "rollback $N: schema identical to the state before migration $N"; rc=0; else echo "rollback $N: SCHEMA DIFFERS"; diff "$prev/before.sql" "$prev/after.sql" | head -30; rc=1; fi
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -1 -f "$(ls "$PROJ"/supabase/migrations/202601010000${N}_*.sql)" >/dev/null && echo "re-apply $N after rollback: OK" || { echo "RE-APPLY $N FAILED"; rc=1; }
rm -rf "$prev"; exit $rc
