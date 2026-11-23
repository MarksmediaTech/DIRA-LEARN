#!/usr/bin/env bash
# Usage: tools/release/production_init_check.sh <project-dir>
# Rehearses supabase/production_init on the local PostgreSQL stand-in, in the state found in production on 20 Nov 2026:
# Supabase's auth/storage layer present, existing sign-in accounts, NO public schema objects, no migration history.
# Checks: pre-check verdict, bundle run, accounts untouched, one applicant profile per account, schema identical to a
# normal migration run, verification verdict, re-run refused without change, guards, and a stop half-way being resumable.
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; I="$PROJ/supabase/production_init"
P="psql -h /tmp -p 54322 -U postgres -X -q"; Q="$P -d postgres -tA"
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
fp() { python3 - "$PROJ" <<'EOF'
import sys; s=open(sys.argv[1]+'/supabase/checks/live_full_inspection.sql').read()
print(s[s.index('-- ===================== PART A'):s.index('-- ===================== PART B')])
EOF
}
fp > /tmp/pi_fp.sql
fresh() {
  $P -d template1 -c "drop database if exists postgres with (force)" -c "create database postgres" >/dev/null
  $P -d postgres -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1
  $Q -c "insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, encrypted_password) values
    ('11111111-1111-1111-1111-111111111111','one@example.test', now(), '{\"first_name\":\"A\"}', 'h1'),
    ('22222222-2222-2222-2222-222222222222','two@example.test', now(), '{}', 'h2'),
    ('33333333-3333-3333-3333-333333333333','three@example.test', null, '{}', 'h3')" >/dev/null
}
users_md5() { $Q -c "select md5(string_agg(id || email || coalesce(encrypted_password,'') || coalesce(email_confirmed_at::text,'') || coalesce(raw_user_meta_data::text,''), '|' order by id)) from auth.users"; }

python3 "$I/build_bundle.py" >/dev/null || { echo "bundle build failed"; exit 1; }
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1; $Q -f /tmp/pi_fp.sql > /tmp/pi_fp_reset.txt

fresh; before=$(users_md5)
ok "$($Q -F '|' -f "$I/00_precheck_readonly.sql" | awk -F'|' '$1==99{print $3}')" SAFE_TO_INITIALIZE "pre-check verdict on the production-like state"
$P -d postgres -v ON_ERROR_STOP=1 -f "$I/01_initialize_production.sql" >/tmp/pi_run.log 2>&1; ok "$?" 0 "bundle runs to the end"
ok "$(users_md5)" "$before" "auth.users rows unchanged (emails, password hashes, confirmation, metadata)"
ok "$($Q -c "select count(*) || '/' || count(distinct id) || '/' || count(*) filter (where role = 'applicant' and status = 'active') from profiles")" "3/3/3" "one applicant profile per existing account"
$Q -f /tmp/pi_fp.sql > /tmp/pi_fp_bundle.txt
ok "$(diff /tmp/pi_fp_reset.txt /tmp/pi_fp_bundle.txt >/dev/null && echo same)" same "schema identical to a normal migration run"
ok "$(diff <(sort "$PROJ/supabase/checks/expected_schema_fingerprint.txt") <(sort /tmp/pi_fp_bundle.txt) >/dev/null && echo same)" same "schema equals expected_schema_fingerprint.txt"
ok "$($Q -F '|' -f "$I/02_verify_readonly.sql" | awk -F'|' '$1==99{print $3}')" READY "verification verdict"
cur() { $Q -c "select md5(string_agg(x, '|' order by x)) from (select s.id::text || s.title || s.is_approved || coalesce(lp.status::text, '-') || lp.content::text as x from curriculum_sessions s left join curriculum_lesson_plans lp on lp.session_id = s.id union all select p.id::text || p.status || p.title from curriculum_topic_proposals p union all select id::text || name || is_approved from programmes union all select code || name from tracks union all select key || value::text from system_settings union all select code::text from roles) q"; }
c1=$(cur); $P -d postgres -v ON_ERROR_STOP=1 -1 -f "$PROJ/supabase/seed.sql" >/dev/null 2>&1; ok "$?|$(cur)" "0|$c1" "seed.sql run a second time succeeds and changes nothing"
neg() { $Q -F '|' -c "begin" -c "$1" -f "$I/02_verify_readonly.sql" -c "rollback" 2>&1 | awk -F'|' -v c="$2" '$1==c{a=$3} $1==99{v=$3} END{print a "/" v}'; }
ok "$(neg "update curriculum_topic_proposals set session_id = (select s.id from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital' and s.session_no = 7) where title = 'SEO fundamentals' and track_id = (select id from tracks where code = 'digital')" 15)" "FAIL/NOT READY" "verification catches a Digital Marketing topic on an obsolete session"
ok "$(neg "update curriculum_lesson_plans set status = 'approved', approved_at = now() where session_id = (select s.id from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital' and s.session_no = 5)" 14)" "FAIL/NOT READY" "verification catches an approved lesson plan"
ok "$(neg "update curriculum_sessions set is_approved = true where session_no = 6 and track_id = (select id from tracks where code = 'digital')" 14)" "FAIL/NOT READY" "verification catches an approved V13.2 Digital Marketing record"
s1=$($Q -f /tmp/pi_fp.sql | md5sum); out=$($P -d postgres -v ON_ERROR_STOP=1 -f "$I/01_initialize_production.sql" 2>&1)
ok "$(echo "$out" | grep -c 'STOP: public.profiles already exists')" 1 "second run refused"
ok "$($Q -f /tmp/pi_fp.sql | md5sum)" "$s1" "second run changed nothing"
$Q -c "insert into auth.users(id, email) values ('44444444-4444-4444-4444-444444444444', 'new@example.test')" >/dev/null
ok "$($Q -c "select count(*) from profiles where id = '44444444-4444-4444-4444-444444444444' and role = 'applicant'")" 1 "new sign-up gets its profile"
ok "$($Q -c "begin; set local role service_role; select claim_first_admin('11111111-1111-1111-1111-111111111111')::text || ',' || claim_first_admin('22222222-2222-2222-2222-222222222222')::text; rollback" | grep -E '^(true|false),')" "true,false" "first-admin claim works once (rolled back)"
ok "$($Q -c "select count(*) from profiles where role <> 'applicant'")" 0 "no administrator granted by the initialization"

fresh; $Q -c "insert into storage.buckets(id, name) values ('submissions', 'submissions')" >/dev/null
out=$($P -d postgres -v ON_ERROR_STOP=1 -f "$I/01_initialize_production.sql" 2>&1)
ok "$(echo "$out" | grep -c 'STOP: a DIRA LEARN storage bucket')$($Q -c "select count(*) from pg_tables where schemaname = 'public'")" 10 "existing bucket: refused before any change"

fresh; python3 - "$I/01_initialize_production.sql" <<'EOF'
import sys; s=open(sys.argv[1]).read(); i=s.index("\\echo '== migration 20260101000010"); j=s.index('begin;', i)+6
open('/tmp/pi_fail.sql','w').write(s[:j]+"\nselect 1/0;\n"+s[j:])
EOF
$P -d postgres -v ON_ERROR_STOP=1 -f /tmp/pi_fail.sql >/dev/null 2>&1
ok "$($Q -c "select count(*) || ',' || (to_regclass('public.email_outbox') is null) from supabase_migrations.schema_migrations")" "9,true" "stop in migration 10: 01-09 applied and recorded, nothing of 10"
for f in "$PROJ"/supabase/migrations/*.sql; do b=$(basename "$f" .sql); v=${b:0:14}; n=${b:15}
  [ "$($Q -c "select count(*) from supabase_migrations.schema_migrations where version = '$v'")" = 1 ] && continue
  $P -d postgres -v ON_ERROR_STOP=1 -1 -c "\\i $f" -c "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n')" >/dev/null 2>&1 || break
done; $P -d postgres -v ON_ERROR_STOP=1 -1 -f "$PROJ/supabase/seed.sql" >/dev/null 2>&1
ok "$($Q -f /tmp/pi_fp.sql | diff -q - /tmp/pi_fp_reset.txt >/dev/null && echo same)" same "resuming the unrecorded migrations reaches the same schema"

# ---- partial production state (21 Nov 2026): 01-37 applied and recorded, seed not completed, no Data API grants,
#      existing accounts incl. one Super Administrator promoted by hand in the SQL editor
fresh
$Q -c "update profiles set role = 'super_admin', status = 'active' where id = '11111111-1111-1111-1111-111111111111'" >/dev/null 2>&1
$P -d postgres -c "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)" >/dev/null
for f in "$PROJ"/supabase/migrations/*.sql; do b=$(basename "$f" .sql); v=${b:0:14}; [ "$v" \> 20260101000037 ] && continue   # production had exactly 01-37
  $P -d postgres -v ON_ERROR_STOP=1 -1 -c "\\i $f" -c "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '${b:15}')" >/dev/null 2>&1 || { echo "  setup failed at $b"; break; }; done
$Q -c "update profiles set role = 'super_admin', status = 'active' where id = '11111111-1111-1111-1111-111111111111'" >/dev/null
before=$(users_md5); roles_before=$($Q -c "select string_agg(id || ':' || role || ':' || status, ',' order by id) from profiles")
ok "$($Q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}', true); select role from profiles where id = '11111111-1111-1111-1111-111111111111'; rollback" 2>&1 | grep -c 'permission denied for table profiles')" 1 "partial state reproduces the production 403 (super_admin/active, permission denied for table profiles)"
ok "$($Q -F '|' -f "$I/00b_precheck_partial_readonly.sql" | awk -F'|' '$1==99{print $3}')" CONTINUE "partial-state pre-check verdict"
ok "$($Q -F '|' -f "$I/00_precheck_readonly.sql" | awk -F'|' '$1==99{print $3}')" STOP "the empty-database pre-check refuses the partial state"
$P -d postgres -v ON_ERROR_STOP=1 -f "$I/01b_continue_after_37.sql" >/tmp/pi_cont.log 2>&1; ok "$?" 0 "continuation (migration 38 + seed) runs to the end"
ok "$($Q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}', true); select id || ',' || role || ',' || status from profiles where id = '11111111-1111-1111-1111-111111111111'; rollback" 2>&1 | grep -c '11111111-1111-1111-1111-111111111111,super_admin,active')" 1 "after it the Super Administrator reads their own profile through the API role"
ok "$(users_md5)|$($Q -c "select string_agg(id || ':' || role || ':' || status, ',' order by id) from profiles")" "$before|$roles_before" "accounts, roles and statuses unchanged"
ok "$($Q -F '|' -f "$I/02_verify_readonly.sql" | awk -F'|' '$1!=99 && $1!=7 && $1!=8 && $3!="ok"{print $1}' | tr '\n' ' ')" "" "verification: every check ok except 7/8 (an administrator already exists, by design)"
s1=$($Q -f /tmp/pi_fp.sql | md5sum)
ok "$($P -d postgres -v ON_ERROR_STOP=1 -f "$I/01b_continue_after_37.sql" 2>&1 | grep -c 'STOP: migration history is not exactly 01-37')|$($Q -f /tmp/pi_fp.sql | md5sum)" "1|$s1" "a second continuation run is refused and changes nothing"
ok "$($Q -F '|' -f "$I/00b_precheck_partial_readonly.sql" | awk -F'|' '$1==99{print $3}')" ALREADY_38 "partial-state pre-check after continuation"

"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "production initialization rehearsal: $pass/$total checks passed"
[ "$pass" = "$total" ]
