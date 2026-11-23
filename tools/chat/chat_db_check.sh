#!/usr/bin/env bash
# Usage: bash tools/chat/chat_db_check.sh <project-dir>
# Chat, notification bell and Google Calendar sync (22 Nov 2026), database side. Nothing here touches a real project.
#  A. A new project is installed from supabase/install exactly as the SQL Editor does it, as the NON-superuser role of the
#     Supabase SQL Editor WITH Supabase's default table privileges (tools/db-standin/sql_editor_role.sql); then both pending
#     changes are applied the same way: it applies, refuses a second run, STEP-5 says READY (check 2 = 106 tables, check 16 ok)
#  B. the pgTAP tests supabase/tests-pending/chat_notifications_calendar.test.sql pass on that project
#  C. the rollback refuses while Chat data exists, then (confirmed) returns the schema, storage policies, buckets and Realtime
#     publication exactly to the state before the change
#  D. the existing pgTAP suite (migrations 01-39 + seed + both pending changes) passes, except the two assertions that check the
#     old attachment error texts (documented intended change: type and size now follow chat_file_rules)
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; D="$PROJ/supabase/install"; PD="$PROJ/supabase/pending"
M1="$PD/20261122000001_participant_programme_track.sql"; M2="$PD/20261122000002_chat_notifications_calendar.sql"; R2="$PD/20261122000002_chat_notifications_calendar_rollback.sql"
P="psql -h /tmp -p 54322 -U postgres -X -q"; DB=chat_chk
RUN() { DIRA_SQL_USER=sql_editor python3 -I "$T/release/run_as_sql_editor.py" "$@"; }
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
state() { { pg_dump -h /tmp -p 54322 -U postgres -d $DB --schema=public --schema-only --no-owner 2>/dev/null | grep -v -E '^(--|\\restrict|\\unrestrict|$)' | LC_ALL=C sort
  $P -d $DB -tA -c "select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' order by 1" \
     -c "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id" \
     -c "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1"; } | md5sum | cut -c1-32; }

# ---------- A ----------
$P -d template1 -c "alter role authenticator reset all" -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null 2>&1
$P -d $DB -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1; $P -d $DB -v ON_ERROR_STOP=1 -f "$T/db-standin/sql_editor_role.sql" >/dev/null 2>&1
for k in 1 2 3 4; do RUN "$D"/STEP-${k}_*.sql $DB >/dev/null; done
RUN "$M1" $DB >/dev/null
BEFORE=$(state)
ok "$(RUN "$M2" $DB | grep -c 'Chat, notification bell and Google Calendar sync are ready')" 1 "the Chat change applies in the SQL Editor (non-superuser, with Supabase's default table privileges)"
ok "$(RUN "$M2" $DB | grep -c 'STOP: this change is already applied')" 1 "a second run is refused and changes nothing"
v5=$(RUN "$D"/STEP-5_*.sql $DB)
ok "$(echo "$v5" | grep -c 'status=ok')|$(echo "$v5" | grep -c 'status=READY')" "16|1" "STEP-5 READY with all 16 checks ok after the change"
ok "$(echo "$v5" | grep 'ord=2 ' | grep -c 'detail=106 tables; without RLS: none')" 1 "106 tables, all with Row Level Security"
ok "$($P -d $DB -tA -c "select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee in ('anon','authenticated','service_role') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')")" 0 "Supabase's default TRUNCATE/REFERENCES/TRIGGER privileges were removed from the new tables"
ok "$($P -d $DB -tA -c "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('notifications','connect_reactions','announcements','announcement_reactions','connect_members')")" 5 "live updates (Realtime) for notifications, reactions, announcements and group membership"
ok "$($P -d $DB -tA -c "select file_size_limit || '|' || array_length(allowed_mime_types, 1) from storage.buckets where id = 'announcement-files' and not public")" "52428800|24" "a private announcement-files bucket with the documented 24 file types"

# ---------- B ----------
$P -d $DB -f "$T/db-standin/pgtap_shim.sql" >/dev/null 2>&1
out=$(PGOPTIONS="-c search_path=public,extensions" $P -d $DB -tA -f "$PROJ/supabase/tests-pending/chat_notifications_calendar.test.sql" 2>&1)
ok "$(echo "$out" | grep -cE '^ok [0-9]+')|$(echo "$out" | grep -cE '^not ok')" "118|0" "pgTAP: all 118 Chat / notification / calendar tests pass on the SQL-Editor-installed project"
echo "$out" | grep -E '^not ok|ERROR' | head -5 | sed 's/^/    /'

# ---------- C ----------
$P -d $DB -c "insert into public.connect_conversations(kind, title) values ('group', 'Left behind')" >/dev/null
ok "$(RUN "$R2" $DB | grep -c 'STOP: 1 row(s) were created with the Chat change')" 1 "the rollback refuses while Chat data exists"
sed "s/v_confirm text := 'NO';/v_confirm text := 'DELETE CHAT DATA';/" "$R2" > /tmp/chat_rollback_ok.sql
ok "$(RUN /tmp/chat_rollback_ok.sql $DB | grep -c 'has been undone')" 1 "the confirmed rollback runs in the SQL Editor"
ok "$(state)" "$BEFORE" "after the rollback, schema, storage policies, buckets and Realtime are exactly as before the change"
ok "$(RUN "$D"/STEP-5_*.sql $DB | grep -c 'status=READY')" 1 "STEP-5 READY after the rollback"
ok "$(RUN "$M2" $DB | grep -c 'are ready')" 1 "the change can be applied again after the rollback"

# ---------- D ----------
bash "$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
$P -d postgres -v ON_ERROR_STOP=1 -f "$M1" >/dev/null 2>&1; $P -d postgres -v ON_ERROR_STOP=1 -f "$M2" >/dev/null 2>&1
reg=$(bash "$T/db-standin/db_test.sh" "$PROJ" 2>&1)
ok "$(echo "$reg" | grep -E '^FAIL' | awk '{print $2}' | tr '\n' ' ')" "connect_phase4.test.sql " "existing suite: only connect_phase4 differs"
ok "$(echo "$reg" | grep -oE 'FAILED 2 of 75: 49 51')" "FAILED 2 of 75: 49 51" "... in exactly the two assertions on the old attachment error texts (intended)"
ok "$(echo "$reg" | tail -1 | grep -oE 'failed: [0-9]+')" "failed: 2" "all other existing assertions pass with the change applied"
bash "$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1

$P -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1
echo "Chat, notifications and Google Calendar, database side (pending change, not applied anywhere): $pass/$total checks passed"
[ "$pass" = "$total" ]
