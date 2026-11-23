-- ROLLBACK for migration 27 (Phase 6, learner performance). Run in the Supabase SQL editor only if migration 27 must be undone.
-- Back up first. This DELETES facilitator feedback and performance history: export learner_feedback and
-- learner_progress_snapshots first if you want to keep them. Afterwards delete version 20260101000027 from
-- supabase_migrations.schema_migrations, and redeploy the previous send-emails function (it calls take_progress_snapshots).
begin;
drop function if exists performance_cohorts();
drop function if exists learner_performance_history(uuid, uuid);
drop function if exists take_progress_snapshots();
drop table if exists learner_progress_snapshots;
drop table if exists learner_feedback;
drop function if exists block_feedback_change();
drop function if exists guard_learner_feedback();
drop function if exists can_give_learner_feedback(uuid, uuid);
drop function if exists my_performance();
drop function if exists learner_metrics(uuid);
drop function if exists can_view_learner_performance(uuid, uuid);
drop function if exists _learner_metrics(uuid);
drop table if exists performance_settings;
drop function if exists guard_performance_settings();
commit;
