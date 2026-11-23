#!/usr/bin/env bash
# Unauthorised write attempts in the disposable audit DB. Each runs as the named user in its own rolled-back transaction.
# Result BLOCKED = error raised or 0 rows changed; ALLOWED = the change happened (rolled back afterwards).
declare -A U=([anon]= [L1]=10 [L2]=11 [L4]=13 [TA]=06 [TB]=07 [mentor]=08 [me]=09 [coord]=05 [director]=04 [founder]=01 [admin]=03 [applicant]=14)
P1=d1a11111-0000-0000-0000-000000000010; P4=d1a11111-0000-0000-0000-000000000013
CA=d1a22222-0000-0000-0000-00000000000a; CB=d1a22222-0000-0000-0000-00000000000b
S=$(psql -h /tmp -p 54322 -U postgres -d audit -X -tA -c "select id from curriculum_sessions where not is_approved order by week_no, session_no limit 1")
CERT=$(psql -h /tmp -p 54322 -U postgres -d audit -X -tA -c "select id from certificates limit 1")
APP=$(psql -h /tmp -p 54322 -U postgres -d audit -X -tA -c "select id from applications limit 1")
run(){ who=$1; expect=$2; label=$3; sql=$4; n=${U[$who]}
  if [ -z "$n" ]; then claims='{"role":"anon"}'; role=anon; else claims="{\"sub\":\"d1a00000-0000-0000-0000-0000000000$n\",\"role\":\"authenticated\"}"; role=authenticated; fi
  out=$(psql -h /tmp -p 54322 -U postgres -d audit -X -tA -q 2>&1 <<SQL
begin; set local role $role; select set_config('request.jwt.claims','$claims',true) is null \g /dev/null
$sql;
rollback;
SQL
)
  if grep -q ERROR <<<"$out"; then res=BLOCKED; why=$(grep -m1 ERROR <<<"$out" | sed 's/.*ERROR: *//' | cut -c1-70)
  elif [ "$(echo "$out" | grep -v '^$' | tail -1)" = "0" ]; then res=BLOCKED; why="0 rows"
  else res=ALLOWED; why="result: $(echo "$out" | grep -v '^$' | tail -1 | cut -c1-40)"; fi
  [ "$res" = "$expect" ] && mark=ok || mark="**UNEXPECTED**"
  printf "%-6s %-10s %-8s %-62s %s\n" "$mark" "$who" "$res" "$label" "$why"; }
cnt(){ echo "with x as ($1 returning 1) select count(*) from x"; }
run TA ALLOWED "trainer A grades own-cohort submission"     "$(cnt "update submissions set score=55, status='graded' where participant_id='$P1'")"
run L1 BLOCKED "learner reads teaching notes"               "select count(*) from curriculum_teaching_notes"
run L1 BLOCKED "learner edits teaching note"              "$(cnt "update curriculum_teaching_notes set content='{}'::jsonb")"
run TA ALLOWED "trainer A grades own-cohort submission"     "$(cnt "update submissions set score=55, status='graded' where participant_id='$P1'")"
run TA BLOCKED "trainer edits teaching notes"               "$(cnt "update curriculum_teaching_notes set content='{}'::jsonb")"
run L1 BLOCKED "learner reads teaching notes via view/func" "select count(*) from curriculum_teaching_notes"
run director BLOCKED "director edits teaching notes (finding I1)"        "$(cnt "update curriculum_teaching_notes set content=content")"
