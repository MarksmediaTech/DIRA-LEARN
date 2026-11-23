-- Rollback for 20260101000031_curriculum_v13_1.sql. Run locally first. ONE transaction: if anything fails, nothing changes.
-- Puts back the V13 lesson plans, teaching notes and draft session records wherever the V13.1 text is still in place
-- (drafts only, plan and notes together, so timings stay consistent), restores the V13 source used by later loads,
-- and removes the V13.1 tables and function. Anything edited or approved after V13.1 is left as it is.
-- Audit log entries are kept (the audit log is append-only).

begin;

create temp table v131_map on commit drop as
select x.track_code, x.session_no, cs.id as session_id, x.session as new_session, x.plan as new_plan, x.notes as new_notes,
       p.session as old_session, p.plan as old_plan, p.notes as old_notes
  from curriculum_v13_1_sessions x
  join curriculum_v13_1_previous p using (track_code, session_no)
  join curriculum_sessions cs on cs.programme_id = '00000000-0000-0000-0000-0000000000a1' and cs.session_no = x.session_no
  left join tracks t on t.id = cs.track_id
 where (x.track_code = 'core' and cs.track_id is null) or (x.track_code <> 'core' and t.code = x.track_code);

create temp table v131_revert on commit drop as
select m.session_id from v131_map m
  join curriculum_lesson_plans lp on lp.session_id = m.session_id and lp.status = 'draft' and lp.content = m.new_plan
  join curriculum_teaching_notes tn on tn.session_id = m.session_id and tn.content = m.new_notes;

update curriculum_lesson_plans lp set content = m.old_plan, version = 'V13'
  from v131_map m where m.session_id = lp.session_id and lp.session_id in (select session_id from v131_revert);
update curriculum_teaching_notes tn set content = m.old_notes
  from v131_map m where m.session_id = tn.session_id and tn.session_id in (select session_id from v131_revert);

update curriculum_sessions cs set
       title = m.old_session ->> 'title', description = m.old_session ->> 'description',
       objectives = array(select jsonb_array_elements_text(m.old_session -> 'objectives')),
       activities = array(select jsonb_array_elements_text(m.old_session -> 'activities')),
       expected_output = m.old_session ->> 'expected_output', assessment_notes = m.old_session ->> 'assessment_notes'
  from v131_map m
 where m.session_id = cs.id and not cs.is_approved
   and (cs.title, cs.description, cs.objectives, cs.activities, cs.expected_output, cs.assessment_notes)
       is not distinct from (m.new_session ->> 'title', m.new_session ->> 'description',
                             array(select jsonb_array_elements_text(m.new_session -> 'objectives')),
                             array(select jsonb_array_elements_text(m.new_session -> 'activities')),
                             m.new_session ->> 'expected_output', m.new_session ->> 'assessment_notes');

update curriculum_v13_sessions v set session = p.session, plan = p.plan, notes = p.notes
  from curriculum_v13_1_previous p where p.track_code = v.track_code and p.session_no = v.session_no;

drop function if exists apply_curriculum_v13_1();
drop table if exists curriculum_v13_1_previous;
drop table if exists curriculum_v13_1_sessions;

commit;
