-- DIRA LEARN - PENDING database change for direct CSV enrolment (prepared 22 Nov 2026). NOT APPLIED. Apply only after the owner
-- approves it: paste the whole file into the Supabase SQL Editor and Run (it is one transaction), BEFORE deploying the Edge
-- Functions import-learners / complete-enrolment and the website of this change.
--
-- WHY: a learner imported from CSV must keep their programme track while they have no cohort. Today a participant's track is
-- stored only in cohort_enrolments.track_id, and cohort_enrolments.cohort_id is required (NOT NULL), so there is no place for
-- the track of a learner without a cohort. participants has no track column.
-- WHAT: one new OPTIONAL column participants.programme_track_id (uuid, references tracks.id) and an index on it.
--   - Existing participants keep NULL (public applicants are unchanged; their track keeps coming from cohort enrolment).
--   - No other table, column, enum, trigger, function, policy or permission changes. The column is covered by the existing
--     table permissions and Row Level Security policies of participants (staff manage, learners read their own row).
--   - A track that is referenced cannot be deleted (tracks are configuration and are not deleted in DIRA LEARN).
-- SAFE TO RUN TWICE: the second run changes nothing. Undo: 20261122000001_participant_programme_track_rollback.sql.
-- It does not add a migration-history row, so STEP-5 verification keeps working unchanged.
do $guard$
begin
  if pg_catalog.to_regclass('public.participants') is null or pg_catalog.to_regclass('public.tracks') is null then
    raise exception 'STOP: DIRA LEARN is not installed in this project (participants/tracks missing). Nothing was changed.';
  end if;
end $guard$;

alter table public.participants add column if not exists programme_track_id uuid references public.tracks(id);
create index if not exists participants_programme_track_id_idx on public.participants (programme_track_id);
comment on column public.participants.programme_track_id is
  'Programme track chosen by programme management when the learner was imported from CSV (direct enrolment, 22 Nov 2026). NULL for participants from applications. Not a cohort assignment.';

do $check$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participants'
                  and column_name = 'programme_track_id' and is_nullable = 'YES' and data_type = 'uuid') then
    raise exception 'participants.programme_track_id was not created as expected. Nothing was changed.';
  end if;
end $check$;
select 'participants.programme_track_id is ready' as result;
