-- Rollback for 20260101000035_file_scanning.sql. ONE transaction.
-- WARNING: files in application-documents, submissions, project-evidence, course-materials and learning-resources become
-- downloadable again WITHOUT a virus scan (audit finding M2), and every trainer can again open every learner's files. Scan results are removed (the scan log is lost; files are not touched).
begin;
drop policy dira_scanned_files on storage.objects;
drop policy storage_staff_read on storage.objects;
create policy storage_staff_read on storage.objects for select to authenticated
  using (bucket_id in ('application-documents','submissions','project-evidence') and (is_staff() or app_role() in ('trainer','me_officer')));
update storage.buckets set allowed_mime_types = case when b.data = '(none)' then null else string_to_array(b.data, ',') end
from file_scanning_35_backup b where storage.buckets.id = 'learning-resources' and b.name = 'learning-resources.allowed_mime_types';
drop function file_scan_queue();
drop function record_file_scan(text, text, timestamptz, text, text, text);
drop function claim_file_scans(int);
drop function file_is_downloadable(text, text, timestamptz, uuid);
drop table storage_file_scan_log;
drop table storage_file_scans;
drop function scanned_bucket(text);
drop table file_scanning_35_backup;
commit;
