#!/usr/bin/env bash
# Usage: bash tools/baseline/baseline_check.sh <project-dir>
# Proves that the committed supabase/baseline (the generated, patch-free final state for NEW projects) is equivalent to
# migrations 01-39 + seed. It never regenerates the baseline.
#  * schema: identical fingerprint (tables, columns, constraints, indexes, policies, functions, triggers, grants, buckets ...);
#  * data: every table holds the same rows, ids and timestamps aside (the legacy seed creates them anew on each build), except
#    the audit log and 11 legacy staging/backup tables, which start empty; relationships identical by natural keys; no orphans;
#  * the complete database test suite passes on the baseline database (except the legacy V13 loader test, which needs the
#    V13 staging data that a new project does not get);
#  * guards: files out of order or twice are refused without change; no text patching and no psql commands.
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; B="$PROJ/supabase/baseline"
P="psql -h /tmp -p 54322 -U postgres -X -q -d postgres"; Q="$P -tA"
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
python3 - "$PROJ" > /tmp/bl_fp.sql <<'PY'
import sys; s=open(sys.argv[1]+'/supabase/checks/live_full_inspection.sql').read()
print(s[s.index('-- ===================== PART A'):s.index('-- ===================== PART B')])
PY
cat > /tmp/bl_content.sql <<'SQL'
-- content of every table, with uuid/date/timestamp columns left out
select string_agg(t || '=' || n || ':' || h, E'\n' order by t) from (
  select c.relname as t,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text as n,
    (xpath('/row/h/text()', query_to_xml(format(
       'select md5(coalesce(string_agg(r, $s$|$s$ order by r), $s$$s$)) as h from (select (to_jsonb(x) - %L::text[])::text as r from public.%I x) y',
       coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                  and a.atttypid in ('uuid'::regtype, 'timestamptz'::regtype, 'timestamp'::regtype, 'date'::regtype)), '{}'),
       c.relname), false, true, '')))[1]::text as h
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') z;
SQL
cat > /tmp/bl_rels.sql <<'SQL'
-- relationships by natural keys instead of ids
select md5(string_agg(x, '|' order by x)) from (
  select 'session ' || coalesce(t.code, 'core') || ' ' || s.session_no || ' ' || s.title || ' prog=' || p.name || ' org=' || o.name as x
    from curriculum_sessions s join programmes p on p.id = s.programme_id join organizations o on o.id = p.organization_id left join tracks t on t.id = s.track_id
  union all select 'track ' || t.code || ' prog=' || p.name from tracks t join programmes p on p.id = t.programme_id
  union all select 'plan ' || coalesce(t.code, 'core') || ' ' || s.session_no || ' ' || md5(lp.content::text) || ' ' || lp.status
    from curriculum_lesson_plans lp join curriculum_sessions s on s.id = lp.session_id left join tracks t on t.id = s.track_id
  union all select 'notes ' || coalesce(t.code, 'core') || ' ' || s.session_no || ' ' || md5(n.content::text)
    from curriculum_teaching_notes n join curriculum_sessions s on s.id = n.session_id left join tracks t on t.id = s.track_id
  union all select 'topic ' || coalesce(t.code, 'core') || ' ' || s.session_no || ' ' || p.title || ' ' || p.status || ' ' || coalesce(p.description, '-')
    from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id left join tracks t on t.id = s.track_id) q;
SQL
cat > /tmp/bl_orphans.sql <<'SQL'
-- every foreign key: rows pointing to a missing row
select coalesce(string_agg(conname, ', '), 'none') from (
  select c.conname, (xpath('/row/n/text()', query_to_xml(format(
    'select count(*) as n from %s ch where (%s) is not null and not exists (select 1 from %s pa where (%s) = (%s))',
    c.conrelid::regclass,
    (select string_agg('ch.' || quote_ident(a.attname), ', ') from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k),
    c.confrelid::regclass,
    (select string_agg('pa.' || quote_ident(a.attname), ', ') from unnest(c.confkey) k join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k),
    (select string_agg('ch.' || quote_ident(a.attname), ', ') from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)),
    false, true, '')))[1]::text::int as n
  from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace) z where n > 0;
SQL
SKIP="audit_logs curriculum_v13_sessions curriculum_v13_tracks curriculum_v13_1_sessions curriculum_v13_1_previous curriculum_v13_2_sessions curriculum_v13_2_previous security_fix_33_backup security_fix_34_backup file_scanning_35_backup profile_repair_36_backup grants_38_backup"

# ---- reference: migrations 01-39 + seed
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1 || { echo "legacy build failed"; exit 1; }
$Q -f /tmp/bl_fp.sql > /tmp/bl_fp_legacy.txt; $Q -f /tmp/bl_content.sql > /tmp/bl_data_legacy.txt; $Q -f /tmp/bl_rels.sql > /tmp/bl_rels_legacy.txt
ok "$(grep -c '=' /tmp/bl_data_legacy.txt)" 100 "reference built: 100 tables"

# ---- the baseline
ok "$(grep -lE 'pg_get_functiondef|expected text not found' "$B"/*.sql | wc -l)|$(grep -lE '^\s*\\' "$B"/*.sql | wc -l)" "0|0" "no text patching and no psql commands in the baseline"
DIRA_BASELINE=1 "$T/db-standin/db_reset.sh" "$PROJ" >/tmp/bl_reset.log 2>&1
ok "$?|$(tail -1 /tmp/bl_reset.log)" "0|applied 3 baseline files (data included; no seed.sql)" "the baseline installs on an empty database (3 files, one transaction each)"
ok "$($Q -f /tmp/bl_fp.sql | diff -q - /tmp/bl_fp_legacy.txt >/dev/null && echo same)" same "schema identical to migrations 01-39 + seed"
ok "$($Q -f /tmp/bl_fp.sql | sort | diff -q - <(sort "$PROJ/supabase/checks/expected_schema_fingerprint.txt") >/dev/null && echo same)" same "schema identical to expected_schema_fingerprint.txt"
$Q -f /tmp/bl_content.sql > /tmp/bl_data_base.txt
diffs=$(for t in $(cut -d= -f1 /tmp/bl_data_legacy.txt); do case " $SKIP " in *" $t "*) continue;; esac
  [ "$(grep "^$t=" /tmp/bl_data_legacy.txt)" = "$(grep "^$t=" /tmp/bl_data_base.txt)" ] || echo "$t"; done | tr '\n' ' ')
ok "$diffs" "" "data: every table holds the same rows (ids and timestamps aside)"
ok "$(for t in $SKIP; do grep "^$t=" /tmp/bl_data_base.txt | cut -d= -f2 | cut -d: -f1; done | sort -u | tr '\n' ' ')" "0 " "the audit log and the 11 legacy staging/backup tables start empty"
ok "$($Q -f /tmp/bl_rels.sql)" "$(cat /tmp/bl_rels_legacy.txt)" "relationships identical by natural keys (sessions, tracks, programme, organisation, lesson plans, notes, topic proposals)"
ok "$($Q -f /tmp/bl_orphans.sql)" none "every foreign key holds (no row points to a missing row)"
ok "$($Q -c "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")" "20261121000001,20261121000002,20261121000003" "migration history records the 3 baseline files"
ok "$($Q -c "select (select count(*) from curriculum_sessions where is_approved) || '/' || (select count(*) from curriculum_lesson_plans where status = 'draft') || '/' || (select count(*) from curriculum_topic_proposals where status = 'pending') || '/' || (select bool_or(is_approved) from programmes)")" "1/26/24/false" "approval state as recorded: 1 approved session record, 26 Draft lesson plans, 24 pending proposals, programme not approved"
tests=$(DIRA_TEST_SKIP="curriculum_v13.test.sql" "$T/db-standin/db_test.sh" "$PROJ" 2>&1 | tail -1)
ok "$(echo "$tests" | grep -oE 'failed: 0, files failing: 0')" "failed: 0, files failing: 0" "the database test suite passes on the baseline database ($tests)"
out=$($P -v ON_ERROR_STOP=1 -1 -f "$B/20261121000001_dira_learn_baseline_schema.sql" 2>&1); ok "$(echo "$out" | grep -c 'STOP: public.profiles already exists')" 1 "file 1 a second time is refused"
out=$($P -v ON_ERROR_STOP=1 -1 -f "$B/20261121000003_dira_learn_baseline_data.sql" 2>&1); ok "$(echo "$out" | grep -c 'STOP: expected the baseline files before this one')" 1 "file 3 a second time is refused"
$P -d template1 -c "drop database if exists bl_order with (force)" -c "create database bl_order" >/dev/null 2>&1
psql -h /tmp -p 54322 -U postgres -X -q -d bl_order -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1
out=$(psql -h /tmp -p 54322 -U postgres -X -q -d bl_order -v ON_ERROR_STOP=1 -1 -f "$B/20261121000002_dira_learn_baseline_platform.sql" 2>&1)
ok "$(echo "$out" | grep -c 'STOP: expected the baseline files before this one')|$(psql -h /tmp -p 54322 -U postgres -X -d bl_order -tA -c "select count(*) from storage.buckets")" "1|0" "file 2 on an empty database is refused and changes nothing"
$P -d template1 -c "drop database if exists bl_order with (force)" >/dev/null 2>&1
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "database baseline (supabase/baseline): $pass/$total checks passed"
[ "$pass" = "$total" ]
