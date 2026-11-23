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
run L1 BLOCKED "learner makes self super_admin"            "$(cnt "update profiles set role='super_admin' where id=auth.uid()")"
run L1 BLOCKED "learner reactivates/changes own status"     "$(cnt "update profiles set status='active', role='trainer' where id=auth.uid()")"
run applicant BLOCKED "applicant accepts own application"   "$(cnt "update applications set status='accepted' where id='$APP'")"
run applicant BLOCKED "applicant transition_application"    "select transition_application('$APP','accepted','x')"
run L1 BLOCKED "learner raises own score"                   "$(cnt "update submissions set score=100 where participant_id='$P1'")"
run L1 BLOCKED "learner writes own feedback"                "$(cnt "update submissions set feedback='great' where participant_id='$P1'")"
run L1 BLOCKED "learner marks self present"                 "$(cnt "insert into attendance(schedule_id,participant_id,status) values ('aa000000-0000-0000-0000-00000000000a','$P1','present') on conflict do nothing")"
run L1 BLOCKED "learner edits own attendance"               "$(cnt "update attendance set status='present' where participant_id='$P1'")"
run TB BLOCKED "trainer B records attendance in cohort A"   "$(cnt "update attendance set status='absent' where participant_id='$P1'")"
run TB BLOCKED "trainer B grades cohort A submission"       "$(cnt "update submissions set score=1 where participant_id='$P1'")"
run TA ALLOWED "trainer A grades own-cohort submission"     "$(cnt "update submissions set score=55, status='graded' where participant_id='$P1'")"
run TA BLOCKED "trainer A grades cohort B submission"       "$(cnt "update submissions set score=1 where participant_id='$P4'")"
run L1 BLOCKED "learner issues certificate"                 "select issue_certificate('$P1','$CA')"
run TA BLOCKED "trainer issues certificate"                 "select issue_certificate('$P1','$CA')"
run L1 BLOCKED "learner inserts certificate row"            "$(cnt "insert into certificates(participant_id,cohort_id,certificate_no) values ('$P1','$CA','FAKE-1')")"
run L1 BLOCKED "learner revokes certificate"                "select revoke_certificate('$CERT','x')"
run anon BLOCKED "anon approves curriculum session"         "select set_curriculum_approval('$S',true)"
run anon BLOCKED "anon issues certificate"                  "select issue_certificate('$P1','$CA')"
run anon BLOCKED "anon revokes certificate"                 "select revoke_certificate('$CERT','x')"
run anon ALLOWED "anon verifies a certificate (public)"     "select count(*)+1 from verify_certificate('DIRA-TEST-0001')"
run TA BLOCKED "trainer approves curriculum session"        "select set_curriculum_approval('$S',true)"
run coord BLOCKED "coordinator approves curriculum session"  "select set_curriculum_approval('$S',true)"
run L1 BLOCKED "learner updates curriculum directly"        "$(cnt "update curriculum_sessions set is_approved=true where id='$S'")"
run TA BLOCKED "trainer approves lesson plan"               "select set_lesson_plan_approval('$S',true)"
run founder ALLOWED "founder approves session (authorised)"  "select set_curriculum_approval('$S',true)"
run L1 BLOCKED "learner reads teaching notes"               "select count(*) from curriculum_teaching_notes"
run L1 BLOCKED "learner posts as another user"              "$(cnt "insert into connect_messages(conversation_id,sender_id,body) values ('ac000000-0000-0000-0000-000000000001','d1a00000-0000-0000-0000-000000000006','spoof')")"
run L1 BLOCKED "learner posts into another learner's DM"    "$(cnt "insert into connect_messages(conversation_id,sender_id,body) values ('ac000000-0000-0000-0000-000000000002',auth.uid(),'x')")"
run L1 BLOCKED "learner posts in cohort B chat"             "$(cnt "insert into connect_messages(conversation_id,sender_id,body) select id,auth.uid(),'x' from connect_conversations where kind='cohort' and cohort_id='$CB'")"
run L1 BLOCKED "learner edits a message (no edits)"         "$(cnt "update connect_messages set body='edited' where sender_id=auth.uid()")"
run L1 BLOCKED "learner deletes a message"                  "$(cnt "delete from connect_messages where sender_id=auth.uid()")"
run founder BLOCKED "founder opens private DM w/o safeguarding" "select count(*) from connect_oversight_read('ac000000-0000-0000-0000-000000000001','curious',null)"
run L1 BLOCKED "learner suspends another learner"           "select set_learner_suspension('$P4','$CB',true,'x')"
run TA BLOCKED "trainer appoints safeguarding officer"      "select sg_appoint('lead','d1a00000-0000-0000-0000-000000000006','x')"
run L1 BLOCKED "learner reads other's notifications"        "select count(*) from notifications where user_id<>auth.uid()"
run L1 BLOCKED "learner marks other's notification read"    "$(cnt "update notifications set read_at=now() where user_id<>auth.uid()")"
run admin BLOCKED "super admin deletes audit log"           "$(cnt "delete from audit_logs")"
run admin BLOCKED "super admin edits audit log"             "$(cnt "update audit_logs set action='x'")"
run admin BLOCKED "super admin reads migration-33 backup"   "select count(*) from security_fix_33_backup"
run coord BLOCKED "coordinator changes a user's role"       "$(cnt "update profiles set role='super_admin' where id='d1a00000-0000-0000-0000-000000000005'")"
run founder BLOCKED "founder changes a role (admin-only)"   "$(cnt "update profiles set role='trainer' where id='d1a00000-0000-0000-0000-000000000010'")"
run L1 BLOCKED "learner reads safeguarding"                 "select count(*) from safeguarding_records"
run L1 BLOCKED "learner creates teaching note"              "$(cnt "insert into curriculum_teaching_notes(session_id, notes) select id,'x' from curriculum_sessions limit 1")"
run L1 BLOCKED "learner uploads to another's storage path"  "$(cnt "insert into storage.objects(bucket_id,name,owner) values ('submissions','$P4/x.pdf',auth.uid())")"
run L1 BLOCKED "learner sets feedback shared"               "$(cnt "update learner_feedback set shared_with_learner=true")"
