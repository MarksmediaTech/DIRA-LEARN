-- DIRA LEARN: reporting views, participant numbering, storage buckets and policies
-- STATUS: written, NOT yet executed. Views use security_invoker so RLS of the caller applies (PostgreSQL 15+).

create sequence participant_seq;
create or replace function next_participant_no() returns text language sql as $$
  select 'DL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('participant_seq')::text, 4, '0') $$;

create view v_application_funnel with (security_invoker = true) as
  select status::text as status, count(*)::int as total from applications where status <> 'draft' group by status;

-- Attendance per participant. rate_percent is NULL when there is nothing to measure.
-- Uses the DRAFT rule (late = attended, excused excluded); keep in sync with src/features/attendance/stats.ts.
create view v_attendance_by_participant with (security_invoker = true) as
  select a.participant_id, count(*) filter (where a.status <> 'excused')::int as counted,
         count(*) filter (where a.status in ('present','late'))::int as attended,
         case when count(*) filter (where a.status <> 'excused') = 0 then null
              else round(100.0 * count(*) filter (where a.status in ('present','late')) / count(*) filter (where a.status <> 'excused'), 1) end as rate_percent
  from attendance a group by a.participant_id;

create view v_track_enrolment with (security_invoker = true) as
  select e.cohort_id, t.id as track_id, t.name as track_name, count(*)::int as participants
  from cohort_enrolments e join tracks t on t.id = e.track_id group by e.cohort_id, t.id, t.name;

create view v_cohort_capacity with (security_invoker = true) as
  select c.id as cohort_id, c.name, c.capacity, count(e.id)::int as enrolled
  from cohorts c left join cohort_enrolments e on e.cohort_id = c.id group by c.id;

-- Capacity guard
create or replace function enforce_cohort_capacity() returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; cur int;
begin
  select capacity into cap from cohorts where id = new.cohort_id;
  select count(*) into cur from cohort_enrolments where cohort_id = new.cohort_id;
  if cur >= cap then raise exception 'Cohort is at capacity (%)', cap; end if;
  return new;
end $$;
create trigger trg_capacity before insert on cohort_enrolments for each row execute function enforce_cohort_capacity();

-- Storage: private buckets, 5 MB / 10 MB limits, type allow-lists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('application-documents', 'application-documents', false, 5242880, array['application/pdf','image/jpeg','image/png']),
  ('submissions', 'submissions', false, 10485760, array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('learning-resources', 'learning-resources', false, 52428800, null),
  ('project-evidence', 'project-evidence', false, 10485760, array['application/pdf','image/jpeg','image/png','video/mp4'])
on conflict (id) do nothing;

-- Object paths must start with the owner's user id: '<auth.uid()>/<filename>'
create policy storage_own_docs on storage.objects for all to authenticated
  using (bucket_id in ('application-documents','submissions','project-evidence') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('application-documents','submissions','project-evidence') and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_staff_read on storage.objects for select to authenticated
  using (bucket_id in ('application-documents','submissions','project-evidence') and (is_staff() or app_role() in ('trainer','me_officer')));
create policy storage_resources_read on storage.objects for select to authenticated using (bucket_id = 'learning-resources');
create policy storage_resources_write on storage.objects for all to authenticated
  using (bucket_id = 'learning-resources' and (is_staff() or app_role() = 'trainer'))
  with check (bucket_id = 'learning-resources' and (is_staff() or app_role() = 'trainer'));

create unique index uq_cert_active on certificates(participant_id, cohort_id) where not revoked;
