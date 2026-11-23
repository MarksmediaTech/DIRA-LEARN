-- Migration 35 - virus scan before download for every uploaded file (post-audit fix M2, 20 Nov 2026).
-- Until now only DIRA Connect attachments were scanned (migration 29). This extends the same rule to every other bucket:
-- application documents, assignment submissions, project evidence, course materials and learning resources.
-- Rule: a stored file can be opened (downloaded, or a signed link created) only when the virus scan of exactly this version
-- of the file said "clean". Pending, scanning, failed and infected files cannot be opened by anyone through the API, except
-- that the person who uploaded a file may still open their own copy while it waits (never when it was found infected).
-- Staff keep seeing the list of files and their scan status, so review workflows are unchanged once files are scanned.
-- Files already stored when this migration runs have no scan yet, so they become "waiting for virus check" (not deleted).
-- Without a configured scanner nothing is scanned and these files stay unavailable - the same safe default as migration 29.
-- Rollback: supabase/rollback/20260101000035_file_scanning_down.sql

create or replace function scanned_bucket(p_bucket text) returns boolean language sql immutable set search_path = public as $$
  select p_bucket in ('application-documents', 'submissions', 'project-evidence', 'course-materials', 'learning-resources') $$;
comment on function scanned_bucket(text) is 'Buckets whose files must pass the virus scan of migration 35 (DIRA Connect has its own, migration 29).';

create table storage_file_scans (
  bucket_id text not null,
  object_name text not null,
  object_updated_at timestamptz not null,        -- the version of the file this result is for; a re-upload needs a new scan
  status text not null default 'pending' check (status in ('pending', 'scanning', 'clean', 'infected', 'scan_failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  scanned_at timestamptz,
  engine text,
  detail text,
  uploaded_by uuid,
  primary key (bucket_id, object_name)
);
create index storage_file_scans_queue_idx on storage_file_scans (status, claimed_at) where status in ('pending', 'scanning');
create table storage_file_scan_log (
  id bigint generated always as identity primary key,
  bucket_id text not null, object_name text not null, object_updated_at timestamptz not null,
  result text not null check (result in ('clean', 'infected', 'error')), engine text, detail text,
  created_at timestamptz not null default now()
);
alter table storage_file_scans enable row level security;
alter table storage_file_scan_log enable row level security;
create policy dira_active_account on storage_file_scans as restrictive for all to authenticated
  using ((select account_is_active())) with check ((select account_is_active()));
create policy dira_active_account on storage_file_scan_log as restrictive for all to authenticated
  using ((select account_is_active())) with check ((select account_is_active()));
-- Status of a file: programme staff and executives, and the uploader for their own files. Written only by the scanner.
create policy sfs_read on storage_file_scans for select to authenticated using (is_staff() or is_executive() or uploaded_by = auth.uid());
create policy sfsl_read on storage_file_scan_log for select to authenticated using (is_staff() or is_executive());
revoke insert, update, delete, truncate on storage_file_scans, storage_file_scan_log from anon, authenticated;

-- Opening a file: only a clean scan of this exact version (updated_at) counts.
create or replace function file_is_downloadable(p_bucket text, p_name text, p_updated_at timestamptz, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not scanned_bucket(p_bucket)
      or exists (select 1 from storage_file_scans s where s.bucket_id = p_bucket and s.object_name = p_name
                 and s.status = 'clean' and s.object_updated_at = p_updated_at)
      or (p_owner is not null and p_owner = auth.uid()
          and not exists (select 1 from storage_file_scans s where s.bucket_id = p_bucket and s.object_name = p_name
                          and s.status = 'infected' and s.object_updated_at = p_updated_at)) $$;

create policy dira_scanned_files on storage.objects as restrictive for select to authenticated
  using (file_is_downloadable(bucket_id, name, updated_at, owner));

-- Scanner queue (service role only): files with no result for their current version are claimed; abandoned claims after 15 minutes.
create or replace function claim_file_scans(p_limit int default 10)
returns table(bucket_id text, object_name text, object_updated_at timestamptz, mime_type text, size_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  -- new or re-uploaded files enter the queue
  insert into storage_file_scans as s (bucket_id, object_name, object_updated_at, status, uploaded_by)
  select o.bucket_id, o.name, o.updated_at, 'pending', o.owner from storage.objects o
  where scanned_bucket(o.bucket_id) and o.updated_at is not null
    and not exists (select 1 from storage_file_scans x where x.bucket_id = o.bucket_id and x.object_name = o.name and x.object_updated_at = o.updated_at)
  on conflict on constraint storage_file_scans_pkey do update
    set object_updated_at = excluded.object_updated_at, status = 'pending', attempts = 0, claimed_at = null, scanned_at = null,
        engine = null, detail = null, uploaded_by = excluded.uploaded_by;
  return query
  with c as (
    select s.bucket_id, s.object_name from storage_file_scans s
    where s.status = 'pending' or (s.status = 'scanning' and s.claimed_at < now() - interval '15 minutes')
    order by s.object_updated_at limit greatest(1, least(p_limit, 50)) for update skip locked)
  update storage_file_scans s set status = 'scanning', claimed_at = now(), attempts = s.attempts + 1
  from c, storage.objects o
  where s.bucket_id = c.bucket_id and s.object_name = c.object_name and o.bucket_id = s.bucket_id and o.name = s.object_name
  returning s.bucket_id, s.object_name, s.object_updated_at, (o.metadata ->> 'mimetype'), nullif(o.metadata ->> 'size', '')::bigint;
end $$;

-- Record a result for the version that was scanned. 'error' re-queues, or marks scan_failed after 3 attempts.
create or replace function record_file_scan(p_bucket text, p_name text, p_updated_at timestamptz, p_result text, p_engine text default null, p_detail text default null)
returns text language plpgsql security definer set search_path = public as $$
declare s storage_file_scans; final text;
begin
  if p_result not in ('clean', 'infected', 'error') then raise exception 'Result must be clean, infected or error'; end if;
  select * into s from storage_file_scans where bucket_id = p_bucket and object_name = p_name for update;
  if not found then raise exception 'File not in the scan queue'; end if;
  insert into storage_file_scan_log(bucket_id, object_name, object_updated_at, result, engine, detail)
  values (p_bucket, p_name, p_updated_at, p_result, left(p_engine, 100), left(p_detail, 500));
  if s.object_updated_at <> p_updated_at then return 'superseded'; end if;   -- the file was replaced meanwhile; the new version is queued
  final := case p_result when 'error' then (case when s.attempts >= 3 then 'scan_failed' else 'pending' end) else p_result end;
  update storage_file_scans set status = final, scanned_at = case when p_result = 'error' then scanned_at else now() end,
         engine = coalesce(left(p_engine, 100), engine), detail = left(p_detail, 500), claimed_at = null
  where bucket_id = p_bucket and object_name = p_name;
  if final = 'infected' and s.uploaded_by is not null then
    insert into notifications(user_id, kind, title, body) values (s.uploaded_by, 'message', 'A file you uploaded was blocked',
      'Our virus check found a problem with ' || left(regexp_replace(p_name, '^.*/', ''), 100) || '. It cannot be opened. Please upload a clean copy.');
  end if;
  return final;
end $$;

-- How many files wait (to notice when no scanner is configured): staff and executives.
create or replace function file_scan_queue() returns table(bucket_id text, waiting int, clean int, infected int, scan_failed int, oldest_waiting timestamptz)
language sql stable security definer set search_path = public as $$
  select o.bucket_id,
         count(*) filter (where s.status is null or s.object_updated_at <> o.updated_at or s.status in ('pending', 'scanning'))::int,
         count(*) filter (where s.status = 'clean' and s.object_updated_at = o.updated_at)::int,
         count(*) filter (where s.status = 'infected' and s.object_updated_at = o.updated_at)::int,
         count(*) filter (where s.status = 'scan_failed' and s.object_updated_at = o.updated_at)::int,
         min(o.updated_at) filter (where s.status is null or s.object_updated_at <> o.updated_at or s.status in ('pending', 'scanning'))
  from storage.objects o left join storage_file_scans s on s.bucket_id = o.bucket_id and s.object_name = o.name
  where scanned_bucket(o.bucket_id) and (is_staff() or is_executive())
  group by o.bucket_id $$;

-- Found while testing this fix: any trainer (and the M&E officer) could open EVERY learner's submission and project files and
-- every applicant's application documents, in every cohort. Now: application documents - programme staff only;
-- submissions and project evidence - programme staff, the M&E officer, and trainers only for learners in their own cohorts.
drop policy storage_staff_read on storage.objects;
create policy storage_staff_read on storage.objects for select to authenticated using (
  (bucket_id = 'application-documents' and is_staff())
  or (bucket_id in ('submissions', 'project-evidence') and (
        is_staff() or app_role() = 'me_officer'
        or (app_role() = 'trainer' and exists (
              select 1 from participants p join cohort_enrolments e on e.participant_id = p.id
              where p.profile_id::text = (storage.foldername(name))[1] and e.cohort_id in (select my_trainer_cohorts()))))));

-- Learning resources accepted any file type (audit M2). Limit them to the document, image and video types the site shows.
-- Files already stored are not touched; the previous setting is kept for the rollback.
create table file_scanning_35_backup (name text primary key, data text);
alter table file_scanning_35_backup enable row level security;
revoke all on file_scanning_35_backup from anon, authenticated;
create policy dira_active_account on file_scanning_35_backup as restrictive for all to authenticated
  using ((select account_is_active())) with check ((select account_is_active()));
insert into file_scanning_35_backup(name, data)
select 'learning-resources.allowed_mime_types', coalesce(array_to_string(allowed_mime_types, ','), '(none)') from storage.buckets where id = 'learning-resources';
update storage.buckets set allowed_mime_types = array['application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'image/jpeg', 'image/png', 'video/mp4']
where id = 'learning-resources' and allowed_mime_types is null;

revoke execute on function scanned_bucket(text), file_is_downloadable(text, text, timestamptz, uuid), claim_file_scans(int),
  record_file_scan(text, text, timestamptz, text, text, text), file_scan_queue() from public, anon;
revoke execute on function claim_file_scans(int), record_file_scan(text, text, timestamptz, text, text, text) from authenticated;
grant execute on function claim_file_scans(int), record_file_scan(text, text, timestamptz, text, text, text) to service_role;
grant execute on function scanned_bucket(text), file_is_downloadable(text, text, timestamptz, uuid), file_scan_queue() to authenticated, service_role;
