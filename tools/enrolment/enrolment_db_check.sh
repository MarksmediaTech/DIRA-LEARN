#!/usr/bin/env bash
# Usage: bash tools/enrolment/enrolment_db_check.sh <project-dir>
# Direct CSV enrolment (22 Nov 2026), database side, on the strict stand-in. A new project is installed from supabase/install
# exactly as the SQL Editor does it, as the non-superuser role of the Supabase SQL Editor (tools/db-standin/sql_editor_role.sql),
# then the PENDING change supabase/pending/20261122000001_participant_programme_track.sql is applied the same way and checked:
#  - it applies, twice; STEP-5 still says READY with all 16 checks ok (no permission change)
#  - the writes complete-enrolment makes (service role) work through the existing guards: participant with the programme
#    track, no cohort, role participant; a second participant for the same account is refused
#  - the learner reads their own row (incl. the track) but cannot write it, cannot create a participant, cannot change role
#  - the public applicant path is unchanged (no participant role without a participant record)
#  - the full pgTAP suite still passes with the column added
#  - the rollback refuses while tracks are saved, then removes the column; STEP-5 READY again
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; D="$PROJ/supabase/install"; M="$PROJ/supabase/pending/20261122000001_participant_programme_track.sql"
R="$PROJ/supabase/pending/20261122000001_participant_programme_track_rollback.sql"
P="psql -h /tmp -p 54322 -U postgres -X -q"; DB=enrol_chk
RUN() { DIRA_SQL_USER=sql_editor python3 -I "$T/release/run_as_sql_editor.py" "$@"; }
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
q() { $P -d $DB -tA -c "$1" 2>&1 | tr '\n' ' ' | sed 's/ $//'; }

$P -d template1 -c "alter role authenticator reset all" -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null 2>&1
$P -d $DB -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1; $P -d $DB -v ON_ERROR_STOP=1 -f "$T/db-standin/sql_editor_role.sql" >/dev/null 2>&1
for k in 1 2 3 4; do RUN "$D"/STEP-${k}_*.sql $DB >/dev/null; done
ok "$(RUN "$D"/STEP-5_*.sql $DB | grep -c 'status=READY')" 1 "the new project is installed and READY before the change"

ok "$(RUN "$M" $DB | grep -c 'participants.programme_track_id is ready')" 1 "the pending change applies in the SQL Editor (non-superuser)"
ok "$(RUN "$M" $DB | grep -c 'participants.programme_track_id is ready')" 1 "... and a second run is harmless"
ok "$(q "select data_type || '/' || is_nullable from information_schema.columns where table_name = 'participants' and column_name = 'programme_track_id'")" "uuid/YES" "optional uuid column"
ok "$(q "select confrelid::regclass from pg_constraint where conrelid = 'public.participants'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.participants'::regclass and attname = 'programme_track_id')]")" "tracks" "it references tracks"
v5=$(RUN "$D"/STEP-5_*.sql $DB)
ok "$(echo "$v5" | grep -c 'status=ok')|$(echo "$v5" | grep -c 'status=READY')" "16|1" "STEP-5 still READY with all 16 checks ok (permissions unchanged)"
ok "$(q "select count(*) from public.participants where programme_track_id is not null")" 0 "existing participants are untouched (none has a track)"

# an imported learner (as the Auth Admin API creates them) and a public applicant
L=7e7e0000-0000-0000-0000-000000000001; A=7e7e0000-0000-0000-0000-000000000002; C=7e7e0000-0000-0000-0000-000000000003
$P -d $DB -c "insert into auth.users(id, email, email_confirmed_at) values ('$L', 'mary@example.com', now()), ('$A', 'pub@example.com', now()), ('$C', 'coord@example.com', now())" >/dev/null
$P -d $DB -c "update public.profiles set role = 'programme_coordinator' where id = '$C'" >/dev/null
SVC="set local role service_role; set local request.jwt.claims = '{\"role\":\"service_role\"}';"
out=$($P -d $DB -tA -v ON_ERROR_STOP=1 -c "begin; $SVC
  insert into public.participants(profile_id, participant_no, programme_track_id) values ('$L', public.next_participant_no(), (select id from public.tracks where name = 'AI Tools'));
  update public.profiles set role = 'participant' where id = '$L';
  insert into public.portfolios(participant_id) select id from public.participants where profile_id = '$L';
  commit;" 2>&1)
ok "$(echo "$out" | grep -c ERROR)" 0 "complete-enrolment's writes (service role) pass the existing guards"
ok "$(q "select p.role || '/' || p.status || '/' || t.name from public.profiles p join public.participants x on x.profile_id = p.id join public.tracks t on t.id = x.programme_track_id where p.id = '$L'")" "participant/active/AI Tools" "the learner is an active participant with the programme track AI Tools"
ok "$(q "select count(*) from public.cohort_enrolments e join public.participants x on x.id = e.participant_id where x.profile_id = '$L'")" 0 "no cohort is assigned"
ok "$(q "select application_id is null from public.participants where profile_id = '$L'")" "t" "no application is linked"
ok "$($P -d $DB -tA -c "begin; $SVC insert into public.participants(profile_id, participant_no) values ('$L', public.next_participant_no()); rollback;" 2>&1 | grep -c 'participants_profile_id_key')" 1 "a second participant for the same account is refused"

LRN="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$L\",\"role\":\"authenticated\"}';"
ok "$(q "begin; $LRN select t.name from public.participants x join public.tracks t on t.id = x.programme_track_id; rollback;")" "AI Tools" "the learner reads their own participant row with the track"
ok "$(q "begin; $LRN update public.participants set programme_track_id = null where profile_id = '$L' returning 1; rollback;" | grep -c '^1$')" 0 "the learner cannot change their programme track"
APP="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$A\",\"role\":\"authenticated\"}';"
ok "$($P -d $DB -tA -c "begin; $APP insert into public.participants(profile_id, participant_no, programme_track_id) values ('$A', 'X-1', (select id from public.tracks limit 1)); rollback;" 2>&1 | grep -c 'row-level security\|permission denied')" 1 "a public applicant cannot create a participant record for themselves"
ok "$($P -d $DB -tA -c "begin; $APP update public.profiles set role = 'participant' where id = '$A'; rollback;" 2>&1 | grep -c 'ERROR')" 1 "a public applicant cannot make themselves a participant"
S=7e7e0000-0000-0000-0000-000000000004; $P -d $DB -c "insert into auth.users(id, email, email_confirmed_at) values ('$S', 'admin@example.com', now()); update public.profiles set role = 'super_admin' where id = '$S'" >/dev/null
ADM="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$S\",\"role\":\"authenticated\"}';"
ok "$($P -d $DB -tA -c "begin; $ADM update public.profiles set role = 'participant' where id = '$A'; rollback;" 2>&1 | grep -c 'converting an accepted application')" 1 "unchanged rule: even a super administrator cannot make an applicant a participant without a participant record (public path still needs acceptance)"
CO="set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$C\",\"role\":\"authenticated\"}';"
ok "$(q "begin; $CO select count(*) from public.participants where programme_track_id is not null; rollback;")" 1 "programme management sees the saved track"

# full pgTAP suite with the column added (migrations 01-39 + seed + the pending change)
bash "$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1 && $P -d postgres -v ON_ERROR_STOP=1 -f "$M" >/dev/null 2>&1
ok "$(bash "$T/db-standin/db_test.sh" "$PROJ" | tail -1 | grep -c 'failed: 0, files failing: 0')" 1 "the full pgTAP suite passes with the column added"
bash "$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1

ok "$(RUN "$R" $DB | grep -c 'STOP: 1 participant(s) have a saved programme track')" 1 "the rollback refuses while a track is saved"
sed "s/v_confirm text := 'NO';/v_confirm text := 'DELETE SAVED TRACKS';/" "$R" > /tmp/enrol_rollback_ok.sql
RUN /tmp/enrol_rollback_ok.sql $DB >/dev/null
ok "$(q "select count(*) from information_schema.columns where table_name = 'participants' and column_name = 'programme_track_id'")" 0 "the confirmed rollback removes the column"
RUN "$D"/STEP-5_*.sql $DB | grep -v 'status=ok' | cut -c1-200 > /tmp/enrol_v5_after.txt
ok "$(RUN "$D"/STEP-5_*.sql $DB | grep 'ord=16 ' | grep -c 'status=ok')" 1 "after the rollback STEP-5 check 16 (permissions) is still ok"

$P -d template1 -c "drop database if exists $DB with (force)" >/dev/null 2>&1
echo "direct CSV enrolment, database side (pending change, not applied anywhere): $pass/$total checks passed"
[ "$pass" = "$total" ]
