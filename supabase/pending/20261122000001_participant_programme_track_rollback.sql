-- DIRA LEARN - UNDO of 20261122000001_participant_programme_track.sql. Removes participants.programme_track_id and its index.
-- Refuses if any participant already has a programme track saved (that would be lost), unless you edit the line below.
-- Deploy the previous versions of import-learners / complete-enrolment and the website first.
do $rollback$
declare
  v_confirm text := 'NO';   -- change to 'DELETE SAVED TRACKS' only if you accept losing saved programme tracks
  n int;
begin
  if pg_catalog.to_regclass('public.participants') is null then raise exception 'STOP: DIRA LEARN is not installed here.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participants' and column_name = 'programme_track_id') then
    raise notice 'participants.programme_track_id does not exist: nothing to undo.'; return;
  end if;
  execute 'select count(*) from public.participants where programme_track_id is not null' into n;
  if n > 0 and v_confirm <> 'DELETE SAVED TRACKS' then
    raise exception 'STOP: % participant(s) have a saved programme track. Nothing was changed.', n;
  end if;
  drop index if exists public.participants_programme_track_id_idx;
  alter table public.participants drop column programme_track_id;
end $rollback$;
