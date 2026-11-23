-- ROLLBACK for migration 28 (Phase 7, cohort intelligence). Read-only reports plus one column; no report data is lost.
-- It removes submissions.graded_at (grading times recorded since Phase 7): export it first if needed.
-- Afterwards delete version 20260101000028 from supabase_migrations.schema_migrations.
begin;
drop function if exists ci_safeguarding_summary();
drop function if exists ci_support();
drop function if exists ci_learners();
drop function if exists ci_facilitators();
drop function if exists ci_cohort_comparison();
drop function if exists ci_intake();
drop function if exists ci_can_view();
drop trigger if exists trg_submission_graded_at on submissions;
drop function if exists set_submission_graded_at();
alter table submissions drop column if exists graded_at;
commit;
