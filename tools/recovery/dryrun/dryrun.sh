#!/usr/bin/env bash
# DRY RUN of tools/recovery/recovery_check.mjs (the real-Supabase recovery test) against the mock server, here without Docker.
# Scratch database = a copy of the local test database + the local test accounts. A fake "docker" command runs psql on it.
set -u; PROJ="$(cd "$1" && pwd)"; D="$(cd "$(dirname "$0")" && pwd)"; DB=recovery_dryrun; TMP=$(mktemp -d)
psql -h /tmp -p 54322 -U postgres -d template1 -qX -c "drop database if exists $DB with (force)" -c "create database $DB template postgres" >/dev/null
psql -h /tmp -p 54322 -U postgres -d "$DB" -qX -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
psql -h /tmp -p 54322 -U postgres -d "$DB" -qX -v ON_ERROR_STOP=1 -f "$PROJ/supabase/local_test_accounts.sql" >/dev/null || { echo "test accounts failed"; exit 1; }
cat > "$TMP/docker" <<FAKE
#!/usr/bin/env bash
# fake: docker exec <container> psql -U postgres -d postgres <args...>  ->  psql on the scratch database
shift 2; shift 5; exec psql -h /tmp -p 54322 -U postgres -d $DB "\$@"
FAKE
chmod +x "$TMP/docker"
CODES_FILE="$TMP/codes.txt" node "$D/mock_supabase.mjs" 59321 59324 "$DB" 3 & MOCK=$!; sleep 1
PATH="$TMP:$PATH" LOCAL_API_URL=http://127.0.0.1:59321 LOCAL_ANON_KEY=dryrun-anon-key LOCAL_MAIL_URL=http://127.0.0.1:59324 DB_CONTAINER=supabase_db_dira-learn \
  RECOVERY_COOLDOWN_SECONDS=4 node "$PROJ/tools/recovery/recovery_check.mjs" | tee "$TMP/out.txt" | tail -1 | sed "s/^password recovery (real local Supabase)/DRY RUN of the real-Supabase recovery test against a MOCK server/"
rc=${PIPESTATUS[0]}; kill $MOCK 2>/dev/null
if grep -q -F -f "$TMP/codes.txt" "$TMP/out.txt" || grep -q -F "DiraTest!2026x" "$TMP/out.txt"; then echo "FAIL the test printed a recovery code"; rc=1; else echo "dry run output contains none of the $(wc -l < "$TMP/codes.txt") codes sent"; fi
psql -h /tmp -p 54322 -U postgres -d template1 -qX -c "drop database if exists $DB with (force)" >/dev/null
[ $rc -eq 0 ] || grep FAIL "$TMP/out.txt"; rm -rf "$TMP"; exit $rc
