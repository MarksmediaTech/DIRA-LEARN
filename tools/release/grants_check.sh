#!/usr/bin/env bash
# Usage: tools/release/grants_check.sh <project-dir>
# Data API grants and RLS (migration 38). Runs on the local stand-in, which - like Supabase since 30 Oct 2026 - grants
# NOTHING automatically. Proves: the 403 on profiles reproduces without migration 38 and is gone with it; every table
# operation and function the screens use is granted; signed-out visitors have no table access; no grant exists without
# an RLS policy; real signed-in sessions of each role read only what they may; migration 38's self-check rejects
# tampered grants; the frontend contract check detects missing grants.
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"
P="psql -h /tmp -p 54322 -U postgres -X -q -d postgres"; Q="$P -tA"
M38="$PROJ/supabase/migrations/20260101000038_explicit_api_grants.sql"
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
as_user() { $Q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', true); $2; rollback" 2>&1; }
users() { $Q -c "insert into auth.users(id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000000001', 'super@example.test', now()), ('a0000000-0000-0000-0000-000000000002', 'staff@example.test', now()),
  ('a0000000-0000-0000-0000-000000000003', 'trainer@example.test', now()), ('a0000000-0000-0000-0000-000000000004', 'learner@example.test', now()),
  ('a0000000-0000-0000-0000-000000000005', 'inactive@example.test', now())" >/dev/null
  for stmt in "update profiles set role = 'super_admin' where id = 'a0000000-0000-0000-0000-000000000001'" \
              "update profiles set role = 'programme_coordinator' where id = 'a0000000-0000-0000-0000-000000000002'" \
              "update profiles set role = 'trainer' where id = 'a0000000-0000-0000-0000-000000000003'" \
              "update profiles set role = 'participant' where id = 'a0000000-0000-0000-0000-000000000004'" \
              "update profiles set status = 'deactivated' where id = 'a0000000-0000-0000-0000-000000000005'"; do
    [ "$($Q -c "$stmt" 2>&1)" = "" ] || { echo "  setup statement failed: $stmt"; exit 1; }
  done; }

# ---- A. without migration 38: the production failure
OLDP=$(mktemp -d); cp -a "$PROJ/supabase" "$PROJ/src" "$PROJ/tools" "$OLDP/"; rm "$OLDP"/supabase/migrations/2026010100003[89]_*.sql   # 38 and every later migration (39 checks the grants of 38)
"$T/db-standin/db_reset.sh" "$OLDP" >/dev/null 2>&1; users
ok "$(as_user a0000000-0000-0000-0000-000000000001 "select role from profiles where id = auth.uid()" | grep -c 'permission denied for table profiles')" 1 "without 38: a super_admin/active account gets 'permission denied for table profiles' (the production 403)"
n=$(python3 -I "$T/db-standin/frontend_contract_check.py" "$OLDP" 2>/dev/null | head -1 | grep -o '[0-9]* problems' | cut -d' ' -f1)
ok "$([ "${n:-0}" -gt 100 ] && echo detected)" detected "without 38: the frontend contract check reports the missing grants ($n problems)"
rm -rf "$OLDP"

# ---- B. with migration 38
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1; users
# the screens of this release also use the two pending changes of 22 Nov 2026 (deployment order: database first, then website)
for f in "$PROJ"/supabase/pending/20261122000001_participant_programme_track.sql "$PROJ"/supabase/pending/20261122000002_chat_notifications_calendar.sql; do
  psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || echo "  pending change $(basename "$f") did not apply"; done
ok "$(python3 -I "$T/db-standin/frontend_contract_check.py" "$PROJ" | head -1 | grep -o '[0-9]* problems')" "0 problems" "every table operation and function used by the screens is granted (with the pending changes the screens need)"
for u in 1 2 3 4; do
  ok "$(as_user a0000000-0000-0000-0000-00000000000$u "select count(*) from profiles where id = auth.uid()" | grep -E '^[0-9]+$')" 1 "role $u reads its own profile through the API role"
done
ok "$(as_user a0000000-0000-0000-0000-000000000004 "select count(*) from profiles" | grep -E '^[0-9]+$')" 1 "a learner sees only their own profile (RLS still filters rows)"
ok "$(as_user a0000000-0000-0000-0000-000000000001 "select count(*) from profiles" | grep -E '^[0-9]+$')" 5 "the Super Administrator sees every profile"
ok "$(as_user a0000000-0000-0000-0000-000000000004 "update profiles set role = 'super_admin' where id = auth.uid()" | grep -ciE 'error')" 1 "a learner cannot make themselves Super Administrator"
ok "$(as_user a0000000-0000-0000-0000-000000000005 "select check_request()" | grep -c 'DIRA_ACCOUNT_INACTIVE')" 1 "an inactive account is refused by the API pre-request check"
ok "$(as_user a0000000-0000-0000-0000-000000000005 "select count(*) from curriculum_sessions" | grep -E '^[0-9]+$')" 0 "an inactive account reads no programme data (active-account rule)"
ok "$(as_user a0000000-0000-0000-0000-000000000004 "select claim_first_admin('a0000000-0000-0000-0000-000000000004')" | grep -c 'permission denied for function')" 1 "signed-in users cannot call the server-only first-admin claim"
ok "$(as_user a0000000-0000-0000-0000-000000000001 "truncate audit_logs" | grep -c 'permission denied')" 1 "not even a Super Administrator can TRUNCATE through the API role"
ok "$($Q -c "begin; set local role anon; select count(*) from curriculum_sessions; rollback" 2>&1 | grep -c 'permission denied')" 1 "signed-out visitors cannot read tables"
ok "$($Q -c "begin; set local role anon; select verify_certificate('none'); rollback" 2>&1 | grep -c 'permission denied')" 0 "signed-out visitors can still verify a certificate"
ok "$($Q -c "select count(*) from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'")" 0 "no table privilege for signed-out visitors"
ok "$($Q -F '|' -f "$PROJ/supabase/production_init/02_verify_readonly.sql" | awk -F'|' '$1==16{print $3}')" ok "verification check 16 (grants) passes"

# ---- C. migration 38's self-check rejects tampered grants (each tamper rolled back)
CHECK=$(python3 - "$M38" <<'EOF'
import sys; s=open(sys.argv[1]).read(); a=s.index('do $check$'); b=s.index('end $check$;')+len('end $check$;'); print(s[a:b])
EOF
)
for tamper in "grant truncate on audit_logs to authenticated" "grant select on curriculum_sessions to anon" "grant delete on curriculum_topic_proposals to authenticated" \
              "revoke select on profiles from authenticated" "grant execute on function claim_first_admin(uuid) to authenticated"; do
  ok "$($Q -c "begin; $tamper; $CHECK rollback;" 2>&1 | grep -c 'migration 38 self-check')" 1 "self-check rejects: $tamper"
done
ok "$($P -v ON_ERROR_STOP=1 -1 -f "$M38" 2>&1 | grep -c 'self-check passed')" 1 "migration 38 re-runs cleanly (idempotent)"

"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "Data API grants and RLS (migration 38): $pass/$total checks passed"
[ "$pass" = "$total" ]
