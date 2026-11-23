#!/usr/bin/env bash
# Usage: bash tools/release/sql_editor_check.sh <project-dir>
# Validates supabase/production_init/sql_editor/ (the Supabase Dashboard SQL Editor installation) against the release:
#  static : every migration and the seed byte for byte as in supabase/migrations and in 01_initialize_production.sql,
#           all 39 + seed exactly once and in order, no psql commands, no transaction control, sizes;
#  dynamic: every file executed exactly as the SQL Editor does (whole text = one query, tools/release/run_as_sql_editor.py)
#           on a strict Supabase stand-in holding ONE existing confirmed sign-in account (the state of the target project).
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; D="$PROJ/supabase/production_init/sql_editor"
P="psql -h /tmp -p 54322 -U postgres -X -q"; DB=se_check; Q="$P -d $DB -tA"
RUN() { python3 -I "$T/release/run_as_sql_editor.py" "$@"; }
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
part() { ls "$D"/STEP-$1_*.sql; }
fresh() { $P -d template1 -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null 2>&1
  $P -d $DB -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1
  $Q -c "insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, encrypted_password, created_at)
         values ('5e5e5e5e-0000-0000-0000-000000000001', 'owner@example.test', now() - interval '2 days', '{\"first_name\":\"Owner\"}', 'hash-owner', now() - interval '3 days')" >/dev/null; }
user_md5() { $Q -c "select md5(string_agg(id || email || encrypted_password || email_confirmed_at || raw_user_meta_data::text || created_at, '|')) from auth.users where id = '5e5e5e5e-0000-0000-0000-000000000001'"; }
fp() { $Q -f /tmp/se_fp.sql; }
python3 - "$PROJ" > /tmp/se_fp.sql <<'EOF'
import sys; s=open(sys.argv[1]+'/supabase/checks/live_full_inspection.sql').read()
print(s[s.index('-- ===================== PART A'):s.index('-- ===================== PART B')])
EOF

# ---------------- static ----------------
python3 -I "$PROJ/supabase/production_init/build_sql_editor.py" >/dev/null || { echo "generator failed"; exit 1; }
ok "$(cd "$PROJ" && git diff --quiet -- "$D" 2>/dev/null; echo regenerated)" regenerated "generator runs"
static=$(python3 - "$PROJ" <<'EOF'
import pathlib, re, sys, hashlib
root = pathlib.Path(sys.argv[1]); d = root / 'supabase/production_init/sql_editor'
mig = sorted((root / 'supabase/migrations').glob('*.sql')); seed = root / 'supabase/seed.sql'
parts = sorted(d.glob('STEP-[1-6]_*.sql'))
bodies = []
for p in parts:
    t = p.read_text(encoding='utf-8')
    for m in re.finditer(r'-- >>>>> (migration (\d{14}) (\S+)|seed\.sql) \(begin of file, unchanged\)\n(.*?)-- <<<<< ', t, re.S):
        bodies.append(((root / 'supabase/migrations' / f'{m.group(2)}_{m.group(3)}.sql') if m.group(2) else seed, m.group(4)))
src = mig + [seed]
probs = []
if [b[0] for b in bodies] != src: probs.append('order or completeness differs')
for f, body in bodies:
    want = f.read_text(encoding='utf-8'); want += '' if want.endswith('\n') else '\n'
    if body != want: probs.append(f'{f.name} differs from the repository file')
orig = (root / 'supabase/production_init/01_initialize_production.sql').read_text(encoding='utf-8')
for f, body in bodies:
    if body not in orig: probs.append(f'{f.name} is not byte-identical to its copy in 01_initialize_production.sql')
for p in sorted(d.glob('STEP-*.sql')):
    t = p.read_text(encoding='utf-8')
    if re.search(r'^\s*\\', t, re.M): probs.append(f'{p.name}: psql command')
    if p.stat().st_size > 450_000: probs.append(f'{p.name}: larger than 450 KB')
    outside = re.sub(r'-- >>>>> .*?-- <<<<< [^\n]*\n', '', t, flags=re.S)
    if re.search(r'^\s*(begin|commit|rollback|start transaction)\s*;', outside, re.I | re.M): probs.append(f'{p.name}: transaction control outside the source files')
for step, src_name in ((0, '00_precheck_readonly.sql'), (7, '02_verify_readonly.sql')):
    p = next(d.glob(f'STEP-{step}_*.sql')); s = (root / 'supabase/production_init' / src_name).read_text(encoding='utf-8')
    if not p.read_text(encoding='utf-8').endswith('\n' + s): probs.append(f'{p.name} is not identical to {src_name}')
print(f'{len(bodies)}|{len(probs)}|' + '; '.join(probs))
EOF
)
ok "$(echo "$static" | cut -d'|' -f1-2)" "40|0" "static: 39 migrations + seed exactly once, in order, byte for byte as in supabase/migrations AND in 01_initialize_production.sql; no psql commands; no transaction control; each file under 450 KB; STEP-0/7 identical to the read-only checks ($(echo "$static" | cut -d'|' -f3))"

# ---------------- reference: the original release bundle via psql ----------------
fresh; $P -d $DB -v ON_ERROR_STOP=1 -f "$PROJ/supabase/production_init/01_initialize_production.sql" >/dev/null 2>&1; ok "$?" 0 "reference: the original psql bundle installs"
fp_bundle=$(fp)

# ---------------- dynamic: SQL Editor mode ----------------
fresh; u0=$(user_md5)
ok "$(RUN "$(part 0)" $DB | grep -o 'VERDICT | status=SAFE_TO_INITIALIZE')" "VERDICT | status=SAFE_TO_INITIALIZE" "STEP-0 on the target state (empty, one confirmed account): SAFE_TO_INITIALIZE"
out=$(RUN "$(part 2)" $DB); ok "$?|$(echo "$out" | grep -c 'STOP: this is part 2 of 6')|$($Q -c "select to_regclass('supabase_migrations.schema_migrations') is null")" "1|1|t" "part 2 before part 1 is refused and changes nothing"
for k in 1 2 3 4 5 6; do out=$(RUN "$(part $k)" $DB); ok "$?|$(echo "$out" | grep -c "Part $k of 6 completed")" "0|1" "STEP-$k runs in SQL Editor mode (one query, one transaction)"; done
s1=$(fp | md5sum)
out=$(RUN "$(part 1)" $DB); ok "$?|$(echo "$out" | grep -c 'STOP: this is part 1 of 6')|$(fp | md5sum)" "1|1|$s1" "re-running part 1 is refused and changes nothing"
out=$(RUN "$(part 6)" $DB); ok "$?|$(echo "$out" | grep -c 'STOP: this is part 6 of 6')|$(fp | md5sum)" "1|1|$s1" "re-running part 6 is refused and changes nothing"
fp_editor=$(fp)
ok "$([ "$fp_editor" = "$fp_bundle" ] && echo same)" same "schema, policies, grants and functions identical to the original psql bundle"
ok "$(diff <(sort "$PROJ/supabase/checks/expected_schema_fingerprint.txt") <(echo "$fp_editor" | sort) >/dev/null && echo same)" same "schema identical to expected_schema_fingerprint.txt"
ok "$($Q -c "select count(*) || '|' || (string_agg(version, ',' order by version) = (select string_agg(to_char(20260101000000 + g, 'FM00000000000000'), ',' order by g) from generate_series(1, 39) g)) from supabase_migrations.schema_migrations")" "39|true" "migration history: exactly 01-39, in order"
ok "$(user_md5)" "$u0" "the existing account is unchanged (id, email, password hash, confirmation, metadata, created)"
ok "$($Q -c "select role || '/' || status from profiles where id = '5e5e5e5e-0000-0000-0000-000000000001'")" "applicant/active" "the existing account received its applicant profile (migration 36)"
ok "$(RUN "$(part 7)" $DB | grep -o 'VERDICT | status=READY')" "VERDICT | status=READY" "STEP-7 verification: READY"
cp "$(part 8)" /tmp/se_step8.sql
ok "$(RUN /tmp/se_step8.sql $DB | grep -c 'STOP: put the account')" 1 "STEP-8 unedited (placeholder) is refused"
sed "s/'PUT-THE-EMAIL-ADDRESS-HERE'/'nobody@example.test'/" "$(part 8)" > /tmp/se_step8_wrong.sql
ok "$(RUN /tmp/se_step8_wrong.sql $DB | grep -c 'STOP: no sign-in account has the email address')" 1 "STEP-8 with an unknown address is refused"
$Q -c "insert into auth.users(id, email) values ('5e5e5e5e-0000-0000-0000-000000000002', 'unconfirmed@example.test')" >/dev/null
sed "s/'PUT-THE-EMAIL-ADDRESS-HERE'/'unconfirmed@example.test'/" "$(part 8)" > /tmp/se_step8_unc.sql
ok "$(RUN /tmp/se_step8_unc.sql $DB | grep -c 'has not confirmed its email address')" 1 "STEP-8 with an unconfirmed account is refused"
$Q -c "delete from auth.users where id = '5e5e5e5e-0000-0000-0000-000000000002'" >/dev/null
sed "s/'PUT-THE-EMAIL-ADDRESS-HERE'/' Owner@Example.test '/" "$(part 8)" > /tmp/se_step8_ok.sql
out=$(RUN /tmp/se_step8_ok.sql $DB)
ok "$(echo "$out" | grep -c 'role=super_admin | status=active | email_confirmed=t')" 1 "STEP-8 with the account's address (any capitalisation, spaces) makes it the first Super Administrator"
ok "$(user_md5)" "$u0" "the account itself (password, sign-in, confirmation) is still unchanged"
ok "$(RUN /tmp/se_step8_ok.sql $DB | grep -c 'an active Super Administrator already exists')" 1 "STEP-8 a second time is refused"
ok "$($Q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"5e5e5e5e-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}', true); select role from profiles where id = auth.uid(); rollback" 2>&1 | grep -cx 'super_admin')" 1 "signed in, the Super Administrator reads their own profile through the API role (no 403)"
ok "$(RUN "$(part 7)" $DB | awk -F' [|] ' '$1!~/ord=(7|8|99)$/ && $3!="status=ok"' | wc -l)" 0 "STEP-7 after STEP-8: every check ok except 7 and 8 (an administrator now exists, by design)"

# atomicity: a failure inside a part leaves nothing of that part; running it again then works
fresh; for k in 1 2 3; do RUN "$(part $k)" $DB >/dev/null; done
python3 - "$(part 4)" <<'EOF'
import sys; s = open(sys.argv[1], encoding='utf-8').read(); i = s.rindex('-- result shown in the SQL Editor')
open('/tmp/se_part4_fail.sql', 'w', encoding='utf-8').write(s[:i] + "select 1/0;  -- injected failure at the very end of part 4\n" + s[i:])
EOF
before=$(fp | md5sum); out=$(RUN /tmp/se_part4_fail.sql $DB)
ok "$?|$(echo "$out" | grep -c 'division by zero')|$($Q -c "select count(*) from supabase_migrations.schema_migrations")|$(fp | md5sum)" "1|1|30|$before" "a failure at the end of part 4 rolls the whole part back (history still 01-30, schema unchanged)"
for k in 4 5 6; do RUN "$(part $k)" $DB >/dev/null || echo "  part $k failed after the rollback test"; done
ok "$([ "$(fp)" = "$fp_bundle" ] && echo same)" same "after that failure, re-running part 4 and continuing reaches the identical schema"

# an editor that adds its own BEGIN ... COMMIT around the text
fresh; for k in 1 2 3 4 5 6; do RUN "$(part $k)" $DB --wrap >/dev/null || echo "  part $k failed in wrapped mode"; done
ok "$([ "$(fp)" = "$fp_bundle" ] && echo same)" same "also identical when the editor wraps each text in its own transaction"

# Windows line endings (CR LF), as stored after copying from Notepad into the browser (the cause of the 21 Nov 2026 failure
# "Migration 20: expected text not found in function guard_submission()"). Files are sent byte for byte.
rows() { $Q -c "select string_agg(c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text, ',' order by c.relname)
                  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'"; }
fresh; for k in 1 2 3 4 5 6; do RUN "$(part $k)" $DB >/dev/null || echo "  LF part $k failed"; done; rows_lf=$(rows)
fresh; for k in 0 1 2 3 4 5 6 7; do sed 's/$/\r/' "$(part $k)" > /tmp/se_crlf_$k.sql; done
ok "$(grep -c $'\r' /tmp/se_crlf_2.sql | awk '{print ($1 > 1000) ? "crlf" : "lf"}')" crlf "the test files really contain CR LF"
ok "$(RUN /tmp/se_crlf_0.sql $DB | grep -o 'VERDICT | status=SAFE_TO_INITIALIZE')" "VERDICT | status=SAFE_TO_INITIALIZE" "CR LF: STEP-0"
for k in 1 2 3 4 5 6; do out=$(RUN /tmp/se_crlf_$k.sql $DB); ok "$?|$(echo "$out" | grep -c "Part $k of 6 completed")" "0|1" "CR LF: STEP-$k completes (part 2 failed here before the fix)"; done
ok "$([ "$(fp)" = "$fp_bundle" ] && echo same)" same "CR LF: schema and every function source identical to the original release"
ok "$(rows)" "$rows_lf" "CR LF: row counts of all tables identical to the LF installation"
crs=$($Q -c "with x as materialized (select format('%I.%I', c.table_name, c.column_name) as t, c.table_name, c.column_name from information_schema.columns c
          join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relkind = 'r'
          where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY'))
          select coalesce(string_agg(t, ', '), 'none') from x where (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I where %I::text like %L', x.table_name, x.column_name, '%' || chr(13) || '%'), false, true, '')))[1]::text::int > 0")
ok "$crs" none "CR LF: no carriage return stored in any text or JSON value"
ok "$($Q -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and position(chr(13) in prosrc) > 0")" 0 "CR LF: no carriage return left in any function"
ok "$(RUN /tmp/se_crlf_7.sql $DB | grep -o 'VERDICT | status=READY')" "VERDICT | status=READY" "CR LF: STEP-7 READY"
sed "s/'PUT-THE-EMAIL-ADDRESS-HERE'/'owner@example.test'/" "$(part 8)" | sed 's/$/\r/' > /tmp/se_crlf_8.sql
ok "$(RUN /tmp/se_crlf_8.sql $DB | grep -c 'role=super_admin | status=active')" 1 "CR LF: STEP-8 sets the first Super Administrator"

$P -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1
echo "SQL Editor installation (supabase/production_init/sql_editor): $pass/$total checks passed"
[ "$pass" = "$total" ]
