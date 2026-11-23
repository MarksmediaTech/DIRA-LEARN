-- pgTAP tests for migration 20260101000035 (virus scan before download for every bucket, post-audit fix M2, 20 Nov 2026),
-- including the cohort limit on trainers' file access found while testing it. Two cohorts; files before and after scanning.
begin;
select plan(31);

insert into auth.users(id, instance_id, aud, role, email)
select ('35350000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f' || n || '@m35.test'
from generate_series(1, 7) n;
-- 1 coordinator, 2 trainer TA (cohort A), 3 trainer TB (cohort B), 4 M&E officer, 5 learner L1 (A), 6 learner L4 (B), 7 applicant
update profiles p set role = r.role::role_code, status = 'active' from (values
  (1, 'programme_coordinator'), (2, 'trainer'), (3, 'trainer'), (4, 'me_officer'), (5, 'participant'), (6, 'participant'), (7, 'applicant')) r(n, role)
where p.id = ('35350000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid;
set local session_replication_role = replica;
insert into participants(id, profile_id, participant_no, status) values
  ('35351111-0000-0000-0000-000000000005', '35350000-0000-0000-0000-000000000005', 'M35-5', 'active'),
  ('35351111-0000-0000-0000-000000000006', '35350000-0000-0000-0000-000000000006', 'M35-6', 'active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at)
select x.id::uuid, (select id from programmes limit 1), x.n, current_date - 7, current_date + 21, 30, now() - interval '7 days', now() + interval '60 days'
from (values ('35352222-0000-0000-0000-00000000000a', 'M35 A'), ('35352222-0000-0000-0000-00000000000b', 'M35 B')) x(id, n);
insert into cohort_enrolments(cohort_id, participant_id, track_id) values
  ('35352222-0000-0000-0000-00000000000a', '35351111-0000-0000-0000-000000000005', (select id from tracks limit 1)),
  ('35352222-0000-0000-0000-00000000000b', '35351111-0000-0000-0000-000000000006', (select id from tracks limit 1));
insert into trainer_assignments(cohort_id, trainer_id) values
  ('35352222-0000-0000-0000-00000000000a', '35350000-0000-0000-0000-000000000002'), ('35352222-0000-0000-0000-00000000000b', '35350000-0000-0000-0000-000000000003');
insert into storage.objects(bucket_id, name, owner, updated_at, metadata) values
  ('submissions', '35350000-0000-0000-0000-000000000005/a.pdf', '35350000-0000-0000-0000-000000000005', '2026-11-20 10:00', '{"mimetype":"application/pdf","size":100}'),
  ('submissions', '35350000-0000-0000-0000-000000000005/c.pdf', '35350000-0000-0000-0000-000000000005', '2026-11-20 10:00', '{"mimetype":"application/pdf","size":100}'),
  ('submissions', '35350000-0000-0000-0000-000000000006/b.pdf', '35350000-0000-0000-0000-000000000006', '2026-11-20 10:00', '{"mimetype":"application/pdf","size":100}'),
  ('application-documents', '35350000-0000-0000-0000-000000000007/id.pdf', '35350000-0000-0000-0000-000000000007', '2026-11-20 10:00', '{"mimetype":"application/pdf","size":100}'),
  ('learning-resources', 'm35/res.pdf', '35350000-0000-0000-0000-000000000001', '2026-11-20 10:00', '{"mimetype":"application/pdf","size":100}');
set local session_replication_role = origin;

create or replace function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"35350000-0000-0000-0000-' || lpad(n::text, 12, '0') || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.files() returns text language sql as $$
  select coalesce(string_agg(regexp_replace(name, '^.*/', ''), ',' order by regexp_replace(name, '^.*/', '')), '-') from storage.objects where name like '3535%' or name like 'm35/%' $$;
create or replace function pg_temp.changed(q text) returns int language plpgsql as $$
  declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.files() to authenticated;

-- ---------- before any scan ----------
set local role authenticated;
select pg_temp.as_user(5); select is(pg_temp.files(), 'a.pdf,c.pdf', 'before scanning, the learner can still open their own uploads');
select pg_temp.as_user(2); select is(pg_temp.files(), '-', 'before scanning, the trainer cannot open any learner file');
select pg_temp.as_user(1); select is(pg_temp.files(), 'res.pdf', 'before scanning, the coordinator sees only the resource they uploaded themselves');
select throws_ok($$select * from claim_file_scans(10)$$, '42501', null, 'signed-in users cannot claim scans');
select throws_ok($$select record_file_scan('submissions', 'x', now(), 'clean')$$, '42501', null, 'signed-in users cannot record scan results');
select pg_temp.as_user(5);
select throws_ok($$update storage_file_scans set status = 'clean'$$, '42501', null, 'nobody can mark their own file clean');

-- ---------- the scanner (service role) ----------
reset role; select set_config('request.jwt.claims', '', true);
set local role service_role;
select is((select count(*)::int from claim_file_scans(50) where object_name like '3535%' or object_name like 'm35/%'), 5, 'the scanner receives all five unscanned files');
select is(record_file_scan('submissions', '35350000-0000-0000-0000-000000000005/a.pdf', '2026-11-20 10:00', 'clean', 'test'), 'clean', 'a.pdf clean');
select is(record_file_scan('submissions', '35350000-0000-0000-0000-000000000005/c.pdf', '2026-11-20 10:00', 'infected', 'test', 'EICAR'), 'infected', 'c.pdf infected');
select is(record_file_scan('submissions', '35350000-0000-0000-0000-000000000006/b.pdf', '2026-11-20 10:00', 'clean', 'test'), 'clean', 'b.pdf clean');
select is(record_file_scan('application-documents', '35350000-0000-0000-0000-000000000007/id.pdf', '2026-11-20 10:00', 'clean', 'test'), 'clean', 'id.pdf clean');
reset role;

-- ---------- after scanning: who can open what ----------
set local role authenticated;
select pg_temp.as_user(2); select is(pg_temp.files(), 'a.pdf', 'trainer A: only the clean file of a learner in cohort A (not cohort B, not the infected one, not application documents)');
select pg_temp.as_user(3); select is(pg_temp.files(), 'b.pdf', 'trainer B: only the clean file of the cohort B learner');
select pg_temp.as_user(1); select is(pg_temp.files(), 'a.pdf,b.pdf,id.pdf,res.pdf', 'coordinator: all clean files plus their own pending upload, never the infected one');
select pg_temp.as_user(4); select is(pg_temp.files(), 'a.pdf,b.pdf', 'M&E officer: clean submissions, but no application documents');
select pg_temp.as_user(5); select is(pg_temp.files(), 'a.pdf', 'the learner cannot open their own infected file');
select pg_temp.as_user(7); select is(pg_temp.files(), 'id.pdf', 'the applicant opens their own scanned document');
select pg_temp.as_user(5);
select is((select count(*)::int from notifications where title = 'A file you uploaded was blocked'), 1, 'the learner is told their infected file was blocked');
select is((select string_agg(status, ',' order by object_name) from storage_file_scans), 'clean,infected', 'the learner sees the scan status of their own files only');
select pg_temp.as_user(2);
select is((select count(*)::int from storage_file_scans), 0, 'trainers do not see the scan table');
select pg_temp.as_user(1);
select is((select waiting from file_scan_queue() where bucket_id = 'learning-resources'), 1, 'staff see how many files are waiting');
select pg_temp.as_user(5);
select is((select count(*)::int from file_scan_queue()), 0, 'learners see no queue figures');

-- ---------- a replaced file needs a new scan ----------
reset role; select set_config('request.jwt.claims', '', true);
update storage.objects set updated_at = '2026-11-20 11:00' where name = '35350000-0000-0000-0000-000000000005/a.pdf';
set local role authenticated;
select pg_temp.as_user(2); select is(pg_temp.files(), '-', 'after the learner replaces a.pdf, the trainer cannot open it until the new version is scanned');
select pg_temp.as_user(5); select is(pg_temp.files(), 'a.pdf', '... the learner still opens their own new version');
reset role; select set_config('request.jwt.claims', '', true);
set local role service_role;
select is((select count(*)::int from claim_file_scans(50) where object_name like '%/a.pdf'), 1, 'the new version is queued again');
select is(record_file_scan('submissions', '35350000-0000-0000-0000-000000000005/a.pdf', '2026-11-20 10:00', 'clean', 'late'), 'superseded', 'a late result for the old version does not count');
-- three scanner errors on the resource -> scan_failed
select record_file_scan('learning-resources', 'm35/res.pdf', '2026-11-20 10:00', 'error', 'test');
select claim_file_scans(50); select record_file_scan('learning-resources', 'm35/res.pdf', '2026-11-20 10:00', 'error', 'test');
select claim_file_scans(50);
select is(record_file_scan('learning-resources', 'm35/res.pdf', '2026-11-20 10:00', 'error', 'test'), 'scan_failed', 'after three scanner errors the file is marked scan_failed (still not downloadable)');
reset role;
set local role authenticated;
select pg_temp.as_user(2); select is(pg_temp.files(), '-', 'trainer A still cannot open the failed resource or the unscanned new version');

-- ---------- configuration ----------
reset role; select set_config('request.jwt.claims', '', true);
select ok((select 'application/pdf' = any(allowed_mime_types) and not ('text/html' = any(allowed_mime_types)) from storage.buckets where id = 'learning-resources'),
          'learning resources now accept only document, image and video types');
select ok(not file_is_downloadable('submissions', 'never-scanned.pdf', now(), null), 'a file that was never scanned is not downloadable');
select ok(file_is_downloadable('connect-attachments', 'x', now(), null), 'DIRA Connect keeps its own scan rules (migration 29); this rule leaves it alone');

select * from finish();
rollback;
