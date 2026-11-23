#!/usr/bin/env bash
# Migration 36 in a database that has DRIFTED (trigger dropped, accounts without profiles) - disposable local database only.
# Usage: tools/release/profile_repair_check.sh <project>
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$(cd "$(dirname "$0")/.." && pwd)"
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1 || { echo "reset failed"; exit 1; }
Q() { psql -h /tmp -p 54322 -U postgres -d postgres -X -tA -v ON_ERROR_STOP=1 -c "$1"; }
pass=0; total=0; ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS  $3"; else echo "FAIL  $3 (got '$1', expected '$2')"; fi; }
# a staff profile that must not change
Q "insert into auth.users(id, instance_id, aud, role, email) values ('36360000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@m36.test')" >/dev/null
Q "update profiles set role='programme_coordinator' where id='36360000-0000-0000-0000-000000000001'" >/dev/null
# drift: the trigger is gone; two people register and verify, and get no profile
Q "drop trigger on_auth_user_created on auth.users" >/dev/null
Q "insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at) values ('36360000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@m36.test', now()), ('36360000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@m36.test', now())" >/dev/null
ok "$(Q "select count(*) from auth.users u where u.email like '%@m36.test' and not exists (select 1 from profiles p where p.id=u.id)")" 2 "drift reproduced: 2 verified accounts have no profile (the app would wait for ever)"
before=$(Q "select count(*)||'/'||string_agg(role::text||':'||status::text, ',' order by id) from profiles where id::text not like '36360000%'")
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/migrations/20260101000036_profile_bootstrap_repair.sql" 2>&1 | grep -o "migration 36: .*" | sed 's/^/      /'
ok "$(Q "select string_agg(role::text||'/'||status::text, ',' order by id) from profiles where id in ('36360000-0000-0000-0000-000000000002','36360000-0000-0000-0000-000000000003')")" "applicant/active,applicant/active" "both get exactly the profile the trigger would have created (applicant, active)"
ok "$(Q "select role from profiles where id='36360000-0000-0000-0000-000000000001'")" "programme_coordinator" "an existing staff profile is not changed"
ok "$(Q "select count(*)||'/'||string_agg(role::text||':'||status::text, ',' order by id) from profiles where id::text not like '36360000%'")" "$before" "no other profile changed (roles and statuses identical)"
ok "$(Q "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created' and tgenabled <> 'D'")" 1 "the trigger exists again"
Q "insert into auth.users(id, instance_id, aud, role, email) values ('36360000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@m36.test')" >/dev/null
ok "$(Q "select count(*)||':'||max(role::text) from profiles where id='36360000-0000-0000-0000-000000000004'")" "1:applicant" "a new registration gets exactly one applicant profile"
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/migrations/20260101000036_profile_bootstrap_repair.sql" >/dev/null 2>&1; rc=$?
ok "$rc" 0 "running migration 36 a second time is safe"
ok "$(Q "select count(*) from (select id from profiles group by id having count(*) > 1) d")" 0 "no duplicate profiles"
ok "$(Q "select count(*) from auth.users u where not exists (select 1 from profiles p where p.id=u.id)")" 0 "every sign-in account has a profile"
Q "insert into profiles(id, role, status) values ('36360000-0000-0000-0000-000000000005','applicant','active')" >/dev/null 2>&1 || true
Q "insert into auth.users(id, instance_id, aud, role, email) values ('36360000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@m36.test')" >/dev/null 2>&1; rc=$?
ok "$rc" 0 "an account whose profile already exists can still be created (no error, no duplicate)"
# rollback after drift: trigger state back to "missing", back-filled profiles kept
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
Q "drop trigger on_auth_user_created on auth.users; drop table profile_repair_36_backup" >/dev/null
Q "insert into auth.users(id, instance_id, aud, role, email) values ('36360000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e@m36.test')" >/dev/null
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/migrations/20260101000036_profile_bootstrap_repair.sql" >/dev/null 2>&1
psql -h /tmp -p 54322 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f "$PROJ/supabase/rollback/20260101000036_profile_bootstrap_repair_down.sql" >/dev/null 2>&1
ok "$(Q "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created'")" 0 "rollback restores the earlier trigger state (missing)"
ok "$(Q "select count(*) from profiles where id='36360000-0000-0000-0000-000000000006'")" 1 "rollback keeps the back-filled profile"
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "profile repair (migration 36) on a drifted database: $pass/$total checks passed"
[ "$pass" = "$total" ]
