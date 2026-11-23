-- ROLLBACK for migration 026. Run in the Supabase SQL editor ONLY if migration 026 must be undone, newest migration first
-- (26, then 25, then 24). Back up the database first. Afterwards delete version 20260101000026 from
-- supabase_migrations.schema_migrations so `supabase db push` can apply it again later.
begin;
drop trigger if exists trg_application_min_age on applications;
drop trigger if exists trg_participant_min_age on participants;
drop function if exists guard_application_min_age();
drop function if exists guard_participant_min_age();
drop function if exists dob_from_form(jsonb);
commit;
