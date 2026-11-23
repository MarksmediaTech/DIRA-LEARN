-- Rollback for 20260101000030_curriculum_v13.sql. Run locally first. ONE transaction: if anything fails, nothing changes.
-- Puts back the track names and focus texts, and the draft session records, that load_curriculum_v13() replaced
-- (only where the V13 values are still in place and the session has not been approved since), then removes the lesson plans,
-- teaching notes and their rules. Schedules, enrolments, attendance, assignments, results and the Curriculum Approval Centre
-- are not touched. Audit log entries are kept (the audit log is append-only).
-- WARNING: lesson plans and teaching notes, including any edits made after V13 was applied, are deleted. Export them first
-- (docs/curriculum is generated from the same source) if they have been edited.

begin;

do $$
declare n_kept int;
begin
  select count(*) into n_kept
    from curriculum_v13_previous p join curriculum_sessions cs on cs.id = p.ref
   where p.kind = 'session' and (cs.is_approved or cs.source <> 'curriculum_v13');
  if n_kept > 0 then
    raise notice '% session record(s) were approved or edited after V13 was applied and are left as they are', n_kept;
  end if;
end $$;

update tracks t set name = p.data ->> 'name'
  from curriculum_v13_previous p, curriculum_v13_tracks v
 where p.kind = 'track' and p.ref = t.id and v.code = t.code and t.name = v.name;
update tracks t set focus = p.data ->> 'focus'
  from curriculum_v13_previous p, curriculum_v13_tracks v
 where p.kind = 'track' and p.ref = t.id and v.code = t.code and t.focus = v.focus;

update curriculum_sessions cs set
       title = p.data ->> 'title', description = p.data ->> 'description',
       objectives = array(select jsonb_array_elements_text(p.data -> 'objectives')),
       activities = array(select jsonb_array_elements_text(p.data -> 'activities')),
       expected_output = p.data ->> 'expected_output', assessment_notes = p.data ->> 'assessment_notes', source = p.data ->> 'source'
  from curriculum_v13_previous p
 where p.kind = 'session' and p.ref = cs.id and not cs.is_approved and cs.source = 'curriculum_v13';

drop trigger if exists trg_session_duration_vs_plan on curriculum_sessions;
drop function if exists load_curriculum_v13();
drop function if exists set_lesson_plan_approval(uuid, boolean);
drop table if exists curriculum_teaching_notes;
drop table if exists curriculum_lesson_plans;
drop function if exists check_lesson_plan_timing();
drop function if exists lesson_plan_timing_problem(uuid);
drop function if exists guard_teaching_notes();
drop function if exists guard_lesson_plan();
drop function if exists can_read_teaching_notes();
drop function if exists can_approve_lesson_plans();
drop function if exists can_edit_curriculum();
drop table if exists curriculum_v13_previous;
drop table if exists curriculum_v13_sessions;
drop table if exists curriculum_v13_tracks;
drop type if exists lesson_plan_status;

commit;
