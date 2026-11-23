#!/usr/bin/env bash
# Row-visibility matrix in the disposable audit DB (each query in its own transaction, as that user, under RLS).
declare -A U=([anon]= [L1]=10 [L2]=11 [L3]=12 [L4]=13 [TA]=06 [TB]=07 [mentor]=08 [me]=09 [coord]=05 [director]=04 [founder]=01 [cofounder]=02 [admin]=03 [applicant]=14)
mapfile -t QS <<'Q'
attendance|select string_agg(replace(participant_id::text,'d1a11111-0000-0000-0000-0000000000','P'),',' order by 1) from attendance
submissions|select string_agg(body,',' order by 1) from submissions
messages|select string_agg(body,' / ' order by 1) from connect_messages
safeguarding|select string_agg(summary,',') from safeguarding_records
lfeedback|select string_agg(body,',' order by 1) from learner_feedback
certificates|select string_agg(certificate_no,',') from certificates
notifications|select string_agg(title,',' order by 1) from notifications
profiles|select count(*) from profiles
participants|select count(*) from participants
applications|select count(*) from applications
teaching_notes|select count(*) from curriculum_teaching_notes
lesson_plans|select count(*) from curriculum_lesson_plans
cur_sessions|select count(*) from curriculum_sessions
audit_logs|select count(*) from audit_logs
sg_officers|select count(*) from safeguarding_officers
security_backup|select count(*) from security_fix_33_backup
storage_objects|select count(*) from storage.objects
Q
WHO=${WHO:-anon L1 L2 L3 L4 TA TB mentor me coord director founder cofounder admin applicant}
printf "%-14s" table; for w in $WHO; do printf "| %s " $w; done; echo
for q in "${QS[@]}"; do name=${q%%|*}; sql=${q#*|}; line=$(printf "%-14s" $name)
  for who in $WHO; do n=${U[$who]}
    if [ -z "$n" ]; then claims='{"role":"anon"}'; role=anon; else claims="{\"sub\":\"d1a00000-0000-0000-0000-0000000000$n\",\"role\":\"authenticated\"}"; role=authenticated; fi
    r=$(psql -h /tmp -p 54322 -U postgres -d audit -X -tA -q 2>&1 <<SQL
begin; set local role $role; select set_config('request.jwt.claims','$claims',true) is null as x \g /dev/null
$sql;
rollback;
SQL
)
    r=$(echo "$r" | grep -v '^$' | sed 's/ERROR: *permission denied.*/DENIED/;s/ERROR:.*/ERR/' | head -1); line+="| ${r:--} "
  done; echo "$line"; done
