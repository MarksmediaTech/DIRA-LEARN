#!/usr/bin/env bash
# Usage: bash tools/baseline/install_check.sh <project-dir>
# Validates supabase/install/ (installation of a NEW Supabase project from the browser SQL Editor) end to end, executing every
# file exactly as the SQL Editor does (whole text = one query; tools/release/run_as_sql_editor.py) on the strict stand-in:
#  - regenerating gives identical files; sizes; no psql commands or transaction control
#  - STEP-0 names the right next step at every stage; STEPS 1-4 install; STEP-5 says READY with every check ok
#  - the result is IDENTICAL to installing supabase/baseline with psql (schema + data of public, storage, auth trigger,
#    publication, API setting, history) - with LF and with Windows CR LF line endings
#  - guards: wrong order, repeats, a non-empty project and the older 39-migration installation are refused, nothing changed
#  - a step that fails part-way leaves nothing behind and can simply be run again
#  - an account created before the installation gets its profile; the first-administrator path works afterwards
#  - RECOVERY refuses unless edited, refuses with any sign-in account, and otherwise removes the install completely
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"; D="$PROJ/supabase/install"
P="psql -h /tmp -p 54322 -U postgres -X -q"
# Every file runs as the role "sql_editor", a NON-superuser with the rights of the Supabase SQL Editor's role (tools/db-standin/sql_editor_role.sql)
RUN() { DIRA_SQL_USER=sql_editor python3 -I "$T/release/run_as_sql_editor.py" "$@"; }
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }
step() { ls "$D"/STEP-$1_*.sql; }
emulate() { $P -d "$1" -v ON_ERROR_STOP=1 -f "$T/db-standin/sql_editor_role.sql" >/dev/null 2>&1 || echo "  emulation of the SQL Editor role failed in $1"; }
fresh() { $P -d template1 -c "alter role authenticator reset all" -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1; $P -d "$1" -f "$T/db-standin/supabase_shim.sql" >/dev/null 2>&1; emulate "$1"; }
verdict() { RUN "$(step 0)" "$1" | sed 's/.*verdict=//'; }
# everything the installation creates, in a comparable text form
state() { { pg_dump -h /tmp -p 54322 -U postgres -d "$1" --schema=public --no-owner 2>/dev/null | grep -v -E '^(--|\\restrict|\\unrestrict|$)' | LC_ALL=C sort   # rows may sit in another order on disk (e.g. after a failed attempt); the content may not differ
  $P -d "$1" -tA -c "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id" \
     -c "select policyname, permissive, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' order by policyname" \
     -c "select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1" \
     -c "select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1, 2" \
     -c "select rolconfig from pg_roles where rolname = 'authenticator'" \
     -c "select version, name from supabase_migrations.schema_migrations order by 1"; } | md5sum | cut -c1-32; }

# ---------------- static ----------------
before=$(cat "$D"/*.sql | md5sum); python3 -I "$T/baseline/build_install.py" "$PROJ" >/dev/null || { echo "generator failed"; exit 1; }
ok "$(cat "$D"/*.sql | md5sum)" "$before" "regenerating supabase/install gives identical files"
ok "$(ls "$D"/*.sql | wc -l)" 8 "8 files (STEP-0..5, REPAIR, RECOVERY)"
ok "$(for f in "$D"/STEP-[1-4]_*.sql; do [ "$(stat -c %s "$f")" -le 420000 ] && echo y; done | wc -l)" 4 "every install step is at most 420 KB (pasteable)"
ok "$(grep -lE '^\s*\\' "$D"/*.sql | wc -l)" 0 "no psql commands"
ok "$(grep -liE '^\s*(begin|commit|rollback)\s*;' "$D"/*.sql | wc -l)" 0 "no BEGIN/COMMIT (each step is one transaction)"
ok "$(grep -l 'STOP: this is STEP-' "$D"/STEP-[1-4]_*.sql | wc -l)" 4 "every install step starts with its guard"

# ---------------- reference: supabase/baseline installed with psql ----------------
fresh ins_ref; for f in "$PROJ"/supabase/baseline/2026112100000[123]_*.sql; do $P -d ins_ref -v ON_ERROR_STOP=1 -1 -f "$f" >/dev/null 2>&1 || echo "  reference install failed: $f"; done
REF=$(state ins_ref)

# ---------------- LF installation, step by step ----------------
fresh ins_lf
ok "$(verdict ins_lf)" "EMPTY: run STEP-1" "STEP-0 on a new project: EMPTY, run STEP-1"
ok "$(RUN "$(step 2)" ins_lf | grep -c 'STOP: this is STEP-2')" 1 "STEP-2 before STEP-1 is refused"
ok "$(verdict ins_lf)" "EMPTY: run STEP-1" "... and changed nothing"
want=("" "STEP-1 is installed: run STEP-2" "STEPS 1-2 are installed: run STEP-3" "STEPS 1-3 are installed: run STEP-4" "INSTALLED: run STEP-5 (verification), then open /setup on the website")
for k in 1 2 3 4; do
  ok "$(RUN "$(step $k)" ins_lf | grep -c "result=STEP-$k installed")" 1 "STEP-$k installs (as the SQL Editor runs it)"
  ok "$(verdict ins_lf)" "${want[$k]}" "STEP-0 after STEP-$k"
done
ok "$(RUN "$(step 1)" ins_lf | grep -c 'STOP: this is STEP-1')" 1 "STEP-1 a second time is refused"
ok "$(RUN "$(step 4)" ins_lf | grep -c 'STOP: this is STEP-4')" 1 "STEP-4 a second time is refused"
v5=$(RUN "$(step 5)" ins_lf)
ok "$(echo "$v5" | grep -c 'status=ok')" 16 "STEP-5: all 16 checks ok"
ok "$(echo "$v5" | grep -c 'status=READY')" 1 "STEP-5: verdict READY"
ok "$($P -d ins_lf -tA -c "select rolsuper from pg_roles where rolname = 'sql_editor'")" "f" "the steps ran as a non-superuser (as in the Supabase SQL Editor)"
ok "$(RUN /dev/stdin ins_lf <<<"select pg_catalog.set_config('session_replication_role', 'replica', true);" | grep -c 'permission denied to set parameter "session_replication_role"')" 1 "the emulated role gets the same refusal Supabase gave on 21 Nov 2026 (session_replication_role)"
ok "$(grep -l 'session_replication_role' "$D"/STEP-*.sql | wc -l)" 0 "no step uses session_replication_role"
ok "$($P -d ins_lf -tA -c "select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgenabled = 'D'")" 0 "every trigger paused for the data load is enabled again"
ok "$($P -d ins_lf -tA -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relowner <> 'sql_editor'::regrole")" 0 "every table belongs to the SQL Editor's role (as on Supabase)"
ok "$(state ins_lf)" "$REF" "LF install is identical to supabase/baseline installed with psql (schema, data, storage, trigger, publication, API setting, history)"

# ---------------- Windows line endings (Notepad -> browser) ----------------
mkdir -p /tmp/ins_crlf; for f in "$D"/*.sql; do sed 's/$/\r/' "$f" > /tmp/ins_crlf/$(basename "$f"); done
fresh ins_crlf; for k in 1 2 3 4; do RUN /tmp/ins_crlf/STEP-${k}_*.sql ins_crlf >/dev/null || echo "  CRLF STEP-$k failed"; done
ok "$(RUN /tmp/ins_crlf/STEP-5_*.sql ins_crlf | grep -c 'status=READY')" 1 "CR LF: all steps install and verify READY"
ok "$($P -d ins_crlf -tA -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and position(chr(13) in prosrc) > 0")" 0 "CR LF: no stored function keeps a CR"
ok "$(state ins_crlf)" "$REF" "CR LF install is identical to the reference"

# ---------------- failure part-way ----------------
fresh ins_fail; RUN "$(step 1)" ins_fail >/dev/null; RUN "$(step 2)" ins_fail >/dev/null
sed 's/^select .STEP-3 installed.*/select 1\/0;/' "$(step 3)" > /tmp/ins_step3_broken.sql
ok "$(RUN /tmp/ins_step3_broken.sql ins_fail | grep -c 'ERROR:.*division by zero')" 1 "a STEP-3 that fails at its very end reports the error"
ok "$(verdict ins_fail)" "STEPS 1-2 are installed: run STEP-3" "... and left nothing of STEP-3 behind (still: run STEP-3)"
ok "$($P -d ins_fail -tA -c "select count(*) from storage.buckets")|$($P -d ins_fail -tA -c "select count(*) from public.tracks")" "0|0" "... no buckets, no data"
RUN "$(step 3)" ins_fail >/dev/null; RUN "$(step 4)" ins_fail >/dev/null
ok "$(state ins_fail)" "$REF" "running STEP-3 again after the failure completes an identical installation"

# ---------------- other refusals ----------------
fresh ins_busy; $P -d ins_busy -c "create table public.something_else(id int)" >/dev/null
ok "$(RUN "$(step 1)" ins_busy | grep -c 'STOP: the public schema already has 1')" 1 "STEP-1 refuses a project whose public schema is not empty"
bash "$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1; emulate postgres   # database postgres = the older 39-migration installation
ok "$(verdict postgres | cut -c1-60)" "STOP: this project already has DIRA LEARN or other tables (p" "STEP-0 recognises the older 39-migration installation"
ok "$(RUN "$(step 1)" postgres | grep -c 'STOP: public.profiles already exists')" 1 "STEP-1 refuses it"

# ---------------- account created before the installation; then the first administrator ----------------
fresh ins_acc; $P -d ins_acc -c "insert into auth.users(id, email, email_confirmed_at) values ('7a7a7a7a-0000-0000-0000-000000000001', 'MarksMedia.Studios@gmail.com', now())" >/dev/null
for k in 1 2 3 4; do RUN "$(step $k)" ins_acc >/dev/null; done
ok "$($P -d ins_acc -tA -c "select role || '/' || status from public.profiles where id = '7a7a7a7a-0000-0000-0000-000000000001'")" "applicant/active" "an account created before the installation gets an active applicant profile"
ok "$(RUN "$(step 5)" ins_acc | grep -c 'status=READY')" 1 "... and STEP-5 says READY"
ok "$($P -d ins_acc -tA -c "begin; set local role service_role; select claim_first_admin('7a7a7a7a-0000-0000-0000-000000000001'); select first_admin_needed(); commit;" | tr '\n' ',')" "t,f," "the first-administrator claim (as bootstrap-first-admin makes it) works on the installed project"
ok "$(RUN "$(step 5)" ins_acc | grep -E 'ord=(7|8) ' | grep -c 'status=FAIL')" 2 "after setup, STEP-5 checks 7 and 8 change by design"

# ---------------- RECOVERY ----------------
R="$D/RECOVERY_remove-incomplete-install.sql"; sed "s/v_confirm text := 'NO';/v_confirm text := 'REMOVE DIRA LEARN';/" "$R" > /tmp/ins_recovery_ok.sql
ok "$(RUN "$R" ins_lf | grep -c "STOP: edit the line")" 1 "RECOVERY unedited is refused"
ok "$(RUN /tmp/ins_recovery_ok.sql ins_acc | grep -c 'STOP: this project has 1 sign-in account')" 1 "RECOVERY refuses a project with a sign-in account"
ok "$($P -d ins_acc -tA -c "select count(*) from public.profiles")" 1 "... and changed nothing"
fresh ins_rec; RUN "$(step 1)" ins_rec >/dev/null; RUN "$(step 2)" ins_rec >/dev/null
ok "$(RUN /tmp/ins_recovery_ok.sql ins_rec | grep -c 'installation removed')" 1 "RECOVERY removes a partial install (STEPS 1-2)"
ok "$(verdict ins_rec)" "EMPTY: run STEP-1" "... STEP-0 then says EMPTY"
for k in 1 2 3 4; do RUN "$(step $k)" ins_rec >/dev/null; done
ok "$(state ins_rec)" "$REF" "... and a full installation afterwards is identical to the reference"
ok "$(RUN /tmp/ins_recovery_ok.sql ins_rec | grep -c 'installation removed')|$(verdict ins_rec)" "1|EMPTY: run STEP-1" "RECOVERY also removes a complete install that nobody has used"
ok "$($P -d ins_rec -tA -c "select count(*) from storage.buckets")|$($P -d ins_rec -tA -c "select count(*) from pg_policies where schemaname = 'storage'")|$($P -d ins_rec -tA -c "select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal")" "0|0|0" "... including buckets, storage policies and the sign-up trigger"

# ---------------- REPAIR of the Data API privileges (the state of the real project on 21 Nov 2026) ----------------
REP="$D/REPAIR_api-grants.sql"
fresh ins_rep
ok "$(RUN "$REP" ins_rep | grep -c 'STOP: this repair is for a complete installation')" 1 "REPAIR refuses an incomplete installation"
for k in 1 2 3 4; do RUN "$(step $k)" ins_rep >/dev/null; done
ok "$(RUN "$(step 5)" ins_rep | grep -c 'status=READY')" 1 "with Supabase's default table privileges, a fresh installation verifies READY directly (privileges normalised in STEP-3)"
$P -d ins_rep -c "grant truncate, references, trigger on all tables in schema public to anon, authenticated, service_role" >/dev/null
ok "$(RUN "$(step 5)" ins_rep | grep 'ord=16 ' | sed 's/.*detail=//')" "107 tables/views granted to signed-in users (577 privileges); profiles readable: true; signed-out table privileges: 321" "the project's reported check-16 failure reproduced exactly (577 / 321)"
before=$($P -d ins_rep -tA -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from public.curriculum_sessions) t")
ok "$(RUN "$REP" ins_rep | grep -c 'Data API privileges repaired')" 1 "REPAIR runs"
ok "$(RUN "$(step 5)" ins_rep | grep -c 'status=ok')|$(RUN "$(step 5)" ins_rep | grep -c 'status=READY')" "16|1" "after REPAIR: all 16 checks ok, READY"
ok "$(state ins_rep)" "$REF" "after REPAIR the database is identical to the reference (schema incl. privileges, data, storage, trigger, history)"
ok "$($P -d ins_rep -tA -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from public.curriculum_sessions) t")" "$before" "REPAIR left the curriculum records untouched"
ok "$(RUN "$REP" ins_rep | grep -c 'Data API privileges repaired')|$(state ins_rep)" "1|$REF" "REPAIR a second time: same result"
$P -d ins_rep -c "grant select, insert on public.profiles to anon; grant delete on public.tracks to authenticated" >/dev/null
RUN "$REP" ins_rep >/dev/null
ok "$(state ins_rep)" "$REF" "REPAIR also removes any other stray privilege (signed-out read of profiles, signed-in delete of tracks)"
for db in ins_rep ins_ref ins_lf ins_crlf ins_fail ins_busy ins_acc ins_rec; do $P -d template1 -c "drop database if exists $db with (force)" >/dev/null 2>&1; done
echo "browser installation package (supabase/install): $pass/$total checks passed"
[ "$pass" = "$total" ]
