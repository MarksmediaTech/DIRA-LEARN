-- ROLLBACK for 20260101000016_curriculum_approval_centre.sql (run manually in the SQL Editor; migrations only go forward).
-- WARNING: this DELETES the approval queue and the approval history (decisions, reviewers, comments). Export them first if you need them:
--   select * from curriculum_topic_proposals;  select * from curriculum_topic_events;
-- It does not touch curriculum_sessions, tracks, profiles or any other data. The founder/co_founder enum values stay (PostgreSQL cannot remove them);
-- to retire the roles, move any founder/co_founder accounts to another role in the Users page first.
begin;
drop view if exists v_session_topics;
drop function if exists seed_initial_topic_proposals();
drop function if exists curriculum_topic_history(uuid);
drop function if exists curriculum_proposals_list();
drop function if exists review_curriculum_topic(uuid, text, text);
drop table if exists curriculum_topic_events;
drop table if exists curriculum_topic_proposals;
drop function if exists can_approve_curriculum();
drop function if exists forbid_topic_event_change();
drop function if exists forbid_topic_delete();
drop function if exists guard_topic_update();
drop function if exists set_topic_track();
drop type if exists topic_status;
delete from roles where code in ('founder', 'co_founder') and not exists (select 1 from profiles where role in ('founder', 'co_founder'));
commit;
