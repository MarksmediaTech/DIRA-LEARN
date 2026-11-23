#!/usr/bin/env bash
# Usage: tools/release/migration37_check.sh <project-dir>
# Data-level checks of migration 37 (Digital Marketing topic proposals on their V13.2 sessions; DIRA 8 Nov 2026 approval noted).
# Fresh install (01-37 + seed) and upgrade (01-36 + seed, then 37) must reach the same state; nothing is approved; nothing outside
# the 11 Digital Marketing proposals and Digital Marketing draft records 3-8 changes; re-runs change nothing; a reviewed topic
# makes migration 37 and its rollback refuse without change; the rollback restores the data exactly.
set -uo pipefail
PROJ="$(cd "$1" && pwd)"; T="$PROJ/tools"
P="psql -h /tmp -p 54322 -U postgres -X -q -d postgres"; Q="$P -tA"
M37="$PROJ/supabase/migrations/20260101000037_digital_marketing_topic_sessions.sql"
R37="$PROJ/supabase/rollback/20260101000037_digital_marketing_topic_sessions_down.sql"
pass=0; total=0
ok() { total=$((total+1)); if [ "$1" = "$2" ]; then pass=$((pass+1)); else echo "  FAIL: $3 (got '$1', want '$2')"; fi; }

DM="select string_agg(p.title || '@' || s.session_no || ':' || p.status || ':' || coalesce(p.description, '-'), '|' order by p.title)
      from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id join tracks t on t.id = p.track_id where t.code = 'digital'"
REC="select string_agg(s.session_no || ':' || s.is_approved || ':' || array_to_string(s.topics, ',') || ':' || coalesce(s.assessment_notes, '-'), '|' order by s.session_no)
       from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital'"
K="coalesce(t.code, 'core') || s.session_no"   # natural key of a session (ids differ between databases)
OTHER="select md5(string_agg(x, '|' order by x)) from (
         select $K || p.title || p.status || coalesce(p.description, '-') || coalesce(p.reviewer_comment, '-') as x
           from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id left join tracks t on t.id = s.track_id where t.code is distinct from 'digital'
         union all select $K || (to_jsonb(s.*) - 'id' - 'track_id' - 'programme_id' - 'created_at' - 'updated_at')::text
           from curriculum_sessions s left join tracks t on t.id = s.track_id where t.code is distinct from 'digital' or s.session_no not between 3 and 8
         union all select $K || (to_jsonb(s.*) - 'id' - 'track_id' - 'programme_id' - 'created_at' - 'updated_at' - 'topics' - 'assessment_notes')::text
           from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital'
         union all select $K || lp.status || lp.version || md5(lp.content::text) from curriculum_lesson_plans lp join curriculum_sessions s on s.id = lp.session_id left join tracks t on t.id = s.track_id
         union all select $K || md5(tn.content::text) from curriculum_teaching_notes tn join curriculum_sessions s on s.id = tn.session_id left join tracks t on t.id = s.track_id
         union all select id::text || name || is_approved from programmes union all select code || name || position from tracks) q"
EXPECTED='Canva for marketing graphics@5|Content planning and creation@5|Developing a practical digital marketing strategy@7|Digital advertising fundamentals@7|Digital footprint and online safety@3|Introduction to digital marketing@3|Marketing analytics and measuring campaign performance@7|Marketing copywriting, captions and calls to action@6|SEO fundamentals@6|Social media marketing (Facebook, Instagram, TikTok, LinkedIn)@4|WhatsApp Business@4'
OLD='Canva for marketing graphics@6|Content planning and creation@5|Developing a practical digital marketing strategy@7|Digital advertising fundamentals@7|Digital footprint and online safety@5|Introduction to digital marketing@5|Marketing analytics and measuring campaign performance@7|Marketing copywriting, captions and calls to action@6|SEO fundamentals@7|Social media marketing (Facebook, Instagram, TikTok, LinkedIn)@5|WhatsApp Business@6'
placement() { $Q -c "select string_agg(p.title || '@' || s.session_no, '|' order by p.title) from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id join tracks t on t.id = p.track_id where t.code = 'digital'"; }
review_one() {  # a real review through the Approval Centre function, by a Founder account (test data, local only)
  $Q -c "insert into auth.users(id, email) values ('99999999-9999-9999-9999-999999999999', 'founder@example.test') on conflict do nothing" >/dev/null
  $Q -c "update profiles set role = 'founder' where id = '99999999-9999-9999-9999-999999999999'" >/dev/null
  $Q -c "select set_config('request.jwt.claims', '{\"sub\":\"99999999-9999-9999-9999-999999999999\",\"role\":\"authenticated\"}', false);
         select review_curriculum_topic((select p.id from curriculum_topic_proposals p join tracks t on t.id = p.track_id
                                         where t.code = 'digital' and p.title = 'SEO fundamentals'), 'approve', 'test review')" >/dev/null
}

# ---- A. fresh install: 01-37 + seed
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1 || { echo "db_reset failed"; exit 1; }
ok "$(placement)" "$EXPECTED" "fresh: the 11 Digital Marketing topics are on their V13.2 sessions (3,3,4,5,5,6,4,7,6,7,7)"
ok "$($Q -c "select count(*) || '/' || count(*) filter (where status = 'pending') || '/' || count(*) filter (where reviewed_at is null and reviewed_by is null) from curriculum_topic_proposals")" "24/24/24" "fresh: 24 proposals, all pending, none reviewed"
ok "$($Q -c "select count(*) from curriculum_topic_proposals p join tracks t on t.id = p.track_id where t.code = 'digital' and p.description like 'Approved by DIRA on 8 Nov 2026 as a topic of Digital Marketing Session _ %' and p.description like '%Awaiting formal approval in the Curriculum Approval Centre.'")" 11 "fresh: all 11 descriptions record the 8 Nov DIRA approval"
ok "$($Q -c "select string_agg(p.title, '|' order by p.title) from curriculum_topic_proposals p join tracks t on t.id = p.track_id join digital_marketing_topic_map_37() m on m.title = p.title where t.code = 'digital' and p.description not like '%Session ' || m.approved_session || ' (%Taught in Session ' || m.current_session || ' since%'")" "" "fresh: each description names its approved and current session correctly"
ok "$($Q -c "select count(*) from curriculum_topic_events")" 0 "fresh: no approval history written"
ok "$($Q -c "select count(*) filter (where is_approved) || '/' || count(*) filter (where position('DIRA approval of 8 Nov 2026' in assessment_notes) > 0) || '/' || count(*) filter (where (length(assessment_notes) - length(replace(assessment_notes, 'DIRA approval of 8 Nov 2026', ''))) / length('DIRA approval of 8 Nov 2026') = 1) from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital' and s.session_no between 3 and 8")" "0/6/6" "fresh: Digital Marketing records 3-8 draft, each with exactly one approval note"
ok "$($Q -c "select string_agg(s.session_no || '=' || cardinality(s.topics), ',' order by s.session_no) from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital'")" "3=2,4=2,5=2,6=2,7=3,8=0" "fresh: Digital Marketing topics lists match the proposals"
ok "$($Q -c "select count(*) from v_session_topics v join curriculum_sessions s on s.id = v.session_id join tracks t on t.id = s.track_id where t.code = 'digital' and not (v.awaiting_topics <@ (select coalesce(array_agg(p.title), '{}') from curriculum_topic_proposals p where p.session_id = s.id))")" 0 "fresh: every topic awaiting approval on a Digital Marketing session is a proposal of that session"
ok "$($Q -c "select (select string_agg(t.code || '/' || t.name, ',' order by t.position) from tracks t) || ' ' || (select count(*) filter (where track_id is null) || '+' || count(*) filter (where track_id is not null) from curriculum_sessions)")" "digital/Digital Marketing,ai/AI Tools,content/Content Creation,entrepreneurship/Entrepreneurship & Business 2+24" "fresh: four tracks; 2 core + 24 track sessions"
ok "$($Q -c "select (select count(*) from curriculum_lesson_plans where status = 'draft') || '/' || (select count(*) from curriculum_lesson_plans) || ' ' || (select bool_or(is_approved) from programmes) || ' ' || (select string_agg(t.code || s.session_no, ',') from curriculum_sessions s join tracks t on t.id = s.track_id where s.is_approved)")" "26/26 false entrepreneurship4" "fresh: 26 plans draft; programme not approved; only Entrepreneurship 4 record approved"
ok "$($Q -c "select count(*) || '/' || count(*) filter (where p.status = 'pending' and p.description is null) from curriculum_topic_proposals p join tracks t on t.id = p.track_id join curriculum_sessions s on s.id = p.session_id where t.code = 'entrepreneurship' and s.session_no = 4")" "10/10" "fresh: Entrepreneurship 4's 10 proposals pending and untouched"
fresh_dm=$($Q -c "$DM"); fresh_rec=$($Q -c "$REC"); fresh_other=$($Q -c "$OTHER")
ok "$($Q -c "select apply_digital_marketing_approval_37()")" "migration 37: 0 proposal(s) moved, 0 description(s) written, 0 topics list(s) and 0 note(s) updated; nothing approved" "re-running the function changes nothing"
$P -v ON_ERROR_STOP=1 -1 -f "$PROJ/supabase/seed.sql" >/dev/null 2>&1; ok "$?" 0 "seed.sql runs again without error"
ok "$($Q -c "$DM")|$($Q -c "$REC")|$($Q -c "$OTHER")" "$fresh_dm|$fresh_rec|$fresh_other" "seed.sql re-run changes nothing (proposals, records, plans, everything else)"
$P -v ON_ERROR_STOP=1 -1 -f "$M37" >/dev/null 2>&1; ok "$?|$($Q -c "$DM")|$($Q -c "$REC")" "0|$fresh_dm|$fresh_rec" "migration 37 file re-run changes nothing"

# ---- B. upgrade: 01-36 + seed, then 37
OLDP=$(mktemp -d); cp -a "$PROJ/supabase" "$OLDP/"; rm "$OLDP/supabase/migrations/20260101000037_digital_marketing_topic_sessions.sql"
"$T/db-standin/db_reset.sh" "$OLDP" >/dev/null 2>&1
ok "$(placement)" "$OLD" "before 37: topics on their 8 Nov sessions (5, 6, 7)"
pre_dm=$($Q -c "$DM"); pre_rec=$($Q -c "$REC"); pre_other=$($Q -c "$OTHER")
review_one; reviewed_dm=$($Q -c "$DM"); reviewed_rec=$($Q -c "$REC")
out=$($P -v ON_ERROR_STOP=1 -1 -f "$M37" 2>&1); rc=$?
ok "$rc|$(echo "$out" | grep -c 'already been reviewed and are not moved: SEO fundamentals (approved)')" "3|1" "a reviewed topic makes migration 37 refuse"
ok "$($Q -c "$DM")|$($Q -c "$REC")|$($Q -c "select to_regprocedure('apply_digital_marketing_approval_37()') is null")" "$reviewed_dm|$reviewed_rec|t" "after the refusal nothing changed (not even the functions)"
"$T/db-standin/db_reset.sh" "$OLDP" >/dev/null 2>&1
$P -v ON_ERROR_STOP=1 -1 -f "$M37" >/dev/null 2>&1; ok "$?" 0 "upgrade: migration 37 applies on a seeded 01-36 database"
ok "$($Q -c "$DM")|$($Q -c "$REC")" "$fresh_dm|$fresh_rec" "upgrade reaches exactly the fresh-install state"
ok "$($Q -c "$OTHER")" "$pre_other" "upgrade changes nothing outside the 11 proposals and the Digital Marketing notes/topics (plans, Entrepreneurship 4, other tracks, titles, outputs, durations)"
$P -v ON_ERROR_STOP=1 -1 -f "$R37" >/dev/null 2>&1; ok "$?" 0 "rollback 37 runs"
ok "$($Q -c "$DM")|$($Q -c "$REC")|$($Q -c "$OTHER")" "$pre_dm|$pre_rec|$pre_other" "rollback restores the data exactly"
$P -v ON_ERROR_STOP=1 -1 -f "$M37" >/dev/null 2>&1; review_one; s=$($Q -c "$DM")
out=$($P -v ON_ERROR_STOP=1 -1 -f "$R37" 2>&1); rc=$?
ok "$rc|$(echo "$out" | grep -c 'rollback 37 refused')|$($Q -c "$DM")" "3|1|$s" "rollback refuses, changing nothing, when a topic was reviewed after 37"
rm -rf "$OLDP"

# ---- C. inconsistent review metadata: reviewed_by set, reviewed_at NULL, status pending, no history event.
# Migration 16's constraint topic_review_fields forbids this state, so it is simulated by dropping that constraint in this scratch
# database (a drifted database). Migration 37 and its rollback must both refuse it and change nothing.
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
$Q -c "insert into auth.users(id, email) values ('99999999-9999-9999-9999-999999999998', 'drift@example.test')" >/dev/null
$Q -c "alter table curriculum_topic_proposals drop constraint topic_review_fields" >/dev/null
$Q -c "update curriculum_topic_proposals set reviewed_by = '99999999-9999-9999-9999-999999999998'
        where title = 'Canva for marketing graphics' and track_id = (select id from tracks where code = 'digital')" >/dev/null
ok "$($Q -c "select p.status || '|' || (p.reviewed_by is not null) || '|' || (p.reviewed_at is null) || '|' || (select count(*) from curriculum_topic_events e where e.proposal_id = p.id) || '|' || s.session_no
              from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id join tracks t on t.id = p.track_id where t.code = 'digital' and p.title = 'Canva for marketing graphics'")" "pending|true|true|0|5" "drift state set up: pending, reviewed_by set, reviewed_at NULL, no history event, on Session 5"
FN="select coalesce(md5(string_agg(p.proname || md5(p.prosrc), ',' order by p.proname)), '-') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('seed_initial_topic_proposals', 'apply_digital_marketing_approval_37', 'digital_marketing_topic_map_37')"
RB="select string_agg(p.title || ':' || coalesce(p.reviewed_by::text, '-') || ':' || coalesce(p.reviewed_at::text, '-'), '|' order by p.title) from curriculum_topic_proposals p"
d_dm=$($Q -c "$DM"); d_rec=$($Q -c "$REC"); d_other=$($Q -c "$OTHER"); d_fn=$($Q -c "$FN"); d_rb=$($Q -c "$RB")
out=$($P -v ON_ERROR_STOP=1 -1 -f "$R37" 2>&1); rc=$?
ok "$rc|$(echo "$out" | grep -c 'rollback 37 refused: these Digital Marketing topics have been reviewed since migration 37: Canva for marketing graphics (pending)')" "3|1" "rollback refuses a topic with reviewed_by set (reviewed_at NULL, no history event)"
ok "$($Q -c "$DM")|$($Q -c "$REC")|$($Q -c "$OTHER")|$($Q -c "$FN")|$($Q -c "$RB")|$($Q -c "select count(*) from curriculum_topic_events")" "$d_dm|$d_rec|$d_other|$d_fn|$d_rb|0" "after that refusal nothing changed: proposals, records, plans, functions, review fields, history"
out=$($Q -c "select apply_digital_marketing_approval_37()" 2>&1)
ok "$(echo "$out" | grep -c 'already been reviewed and are not moved: Canva for marketing graphics (pending)')|$($Q -c "$DM")|$($Q -c "$FN")" "1|$d_dm|$d_fn" "migration 37 refuses the same drift state, changing nothing"
"$T/db-standin/db_reset.sh" "$PROJ" >/dev/null 2>&1
echo "migration 37 (Digital Marketing topics, DIRA 8 Nov 2026 approval): $pass/$total checks passed"
[ "$pass" = "$total" ]
