-- pgTAP tests for participant-facing learning resources (migration 7). NOT yet executed.
begin;
select plan(12);

insert into auth.users(id, instance_id, aud, role, email) values
  ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@res.local'),
  ('ffffffff-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@res.local'),
  ('ffffffff-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','applicant@res.local'),
  ('ffffffff-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer@res.local');
update profiles set role='participant', status='active' where id in ('ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002');
update profiles set role='trainer', status='active' where id = 'ffffffff-0000-0000-0000-000000000004';
-- p1 is active; p2 has withdrawn
insert into participants(id, profile_id, participant_no, status) values
  ('12121212-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001','T-R1','active'),
  ('12121212-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000002','T-R2','withdrawn');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('13131313-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','Resources cohort', current_date - 2, current_date + 20, 10);
-- both chose track X (the first seeded track)
insert into cohort_enrolments(cohort_id, participant_id, track_id) values
  ('13131313-0000-0000-0000-000000000001','12121212-0000-0000-0000-000000000001',(select id from tracks order by position limit 1)),
  ('13131313-0000-0000-0000-000000000001','12121212-0000-0000-0000-000000000002',(select id from tracks order by position limit 1));

-- the database refuses non-web links
select throws_ok($$insert into learning_resources(title, kind, external_url) values ('Bad link','link','javascript:alert(1)')$$,
  '23514', null, 'a javascript: link is rejected by the database');

insert into learning_resources(title, kind, external_url, storage_path, track_id, visible_to_participants) values
  ('Core shared link',  'link',     'https://example.org/a', null,             null, true),
  ('Private prep',      'link',     'https://example.org/b', null,             null, false),
  ('Track X deck',      'link',     'https://example.org/c', null,             (select id from tracks order by position limit 1), true),
  ('Track Y deck',      'link',     'https://example.org/d', null,             (select id from tracks order by position offset 1 limit 1), true),
  ('Core shared file',  'document', null,                    'tst/shared.pdf',  null, true),
  ('Private file',      'document', null,                    'tst/private.pdf', null, false);
insert into storage.objects(bucket_id, name) values ('learning-resources','tst/shared.pdf'), ('learning-resources','tst/private.pdf');

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
-- migration 35: files open only after a clean virus scan; the scanner (service role) marks these two clean.
set local role service_role;
select count(*) from claim_file_scans(50);
select record_file_scan(bucket_id, object_name, object_updated_at, 'clean', 'test') from storage_file_scans where object_name like 'tst/%';
reset role;
set local role authenticated;

-- participant 1: shared core items and their own track only
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from learning_resources), 3, 'a participant sees shared core items and their own track (3 of 6)');
select is((select count(*)::int from learning_resources where title in ('Private prep','Private file')), 0, 'trainer-only resources are hidden from participants');
select is((select count(*)::int from learning_resources where title = 'Track Y deck'), 0, 'another track''s resources are hidden');
select is((select count(*)::int from storage.objects where bucket_id = 'learning-resources' and name = 'tst/shared.pdf'), 1, 'a participant can read a shared file');
select is((select count(*)::int from storage.objects where bucket_id = 'learning-resources' and name = 'tst/private.pdf'), 0, 'a participant cannot read a trainer-only file');
select throws_ok($$insert into learning_resources(title, kind, external_url) values ('Mine','link','https://example.org/m')$$,
  '42501', null, 'a participant cannot add resources');

-- participant 2 has withdrawn
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from learning_resources), 0, 'a withdrawn participant sees no resources');

-- applicant
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from learning_resources), 0, 'an applicant sees no resources');

-- trainer
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from learning_resources), 6, 'a trainer sees everything');
select lives_ok($$insert into learning_resources(title, kind, external_url, uploaded_by) values ('Trainer added','link','https://example.org/t','ffffffff-0000-0000-0000-000000000001')$$,
  'a trainer adds a resource (trying to name someone else as uploader)');
select is((select uploaded_by from learning_resources where title = 'Trainer added'), 'ffffffff-0000-0000-0000-000000000004'::uuid,
  'the database records the real uploader');

select * from finish();
rollback;
