-- pgTAP tests for migration 11 (courses layer). NOT yet executed.
begin;
select plan(15);

insert into auth.users(id, instance_id, aud, role, email) values
  ('cdcdcdcd-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord@m11.local'),
  ('cdcdcdcd-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t1@m11.local'),
  ('cdcdcdcd-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t2@m11.local'),
  ('cdcdcdcd-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@m11.local'),
  ('cdcdcdcd-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@m11.local'),
  ('cdcdcdcd-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p3@m11.local');
update profiles set role='programme_coordinator', status='active' where id = 'cdcdcdcd-0000-0000-0000-000000000001';
update profiles set role='trainer', status='active' where id in ('cdcdcdcd-0000-0000-0000-000000000002','cdcdcdcd-0000-0000-0000-000000000003');
update profiles set role='participant', status='active' where id in ('cdcdcdcd-0000-0000-0000-000000000004','cdcdcdcd-0000-0000-0000-000000000005','cdcdcdcd-0000-0000-0000-000000000006');
insert into participants(id, profile_id, participant_no, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001','cdcdcdcd-0000-0000-0000-000000000004','T-C1','active'),
  ('c1c1c1c1-0000-0000-0000-000000000002','cdcdcdcd-0000-0000-0000-000000000005','T-C2','active'),
  ('c1c1c1c1-0000-0000-0000-000000000003','cdcdcdcd-0000-0000-0000-000000000006','T-C3','active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values ('c2c2c2c2-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','M11 cohort', current_date, current_date + 20, 10);
insert into cohort_enrolments(cohort_id, participant_id) values ('c2c2c2c2-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000001'), ('c2c2c2c2-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000002');
-- a draft course with one module and no lessons yet
insert into courses(id, programme_id, cohort_id, title) values ('c3c3c3c3-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','c2c2c2c2-0000-0000-0000-000000000001','Digital skills');
insert into course_modules(id, course_id, title) values ('c4c4c4c4-0000-0000-0000-000000000001','c3c3c3c3-0000-0000-0000-000000000001','Module one');
insert into course_trainers(course_id, trainer_id) values ('c3c3c3c3-0000-0000-0000-000000000001','cdcdcdcd-0000-0000-0000-000000000002');

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;
-- ---------- trainer ----------
select set_config('request.jwt.claims', '{"sub":"cdcdcdcd-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$insert into courses(id, programme_id, title, status, created_by) values ('c3c3c3c3-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','Trainer course','published','cdcdcdcd-0000-0000-0000-000000000002')$$, 'a trainer can create a course');
select is((select status::text from courses where id = 'c3c3c3c3-0000-0000-0000-000000000002'), 'draft', 'a new course is always a draft, even if published was requested');
select is((select count(*)::int from course_trainers where course_id = 'c3c3c3c3-0000-0000-0000-000000000002'), 1, 'the creating trainer is assigned automatically');
select throws_ok($$update courses set status = 'published' where id = 'c3c3c3c3-0000-0000-0000-000000000001'$$, 'P0001', 'Only programme management can publish or archive a course', 'a trainer cannot publish');
select lives_ok($$insert into course_lessons(module_id, title, kind, body) values ('c4c4c4c4-0000-0000-0000-000000000001','Welcome','reading','Hello')$$, 'an assigned trainer can add a lesson');
select throws_ok($$insert into course_lessons(module_id, title, kind, storage_path) values ('c4c4c4c4-0000-0000-0000-000000000001','File','pdf','other-folder/x.pdf')$$, 'P0001', 'Lesson files must be stored in the course folder', 'lesson files must sit in the course folder');

select set_config('request.jwt.claims', '{"sub":"cdcdcdcd-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from courses where id = 'c3c3c3c3-0000-0000-0000-000000000001'), 0, 'a trainer who is not assigned cannot see the draft course');
select throws_ok($$insert into course_lessons(module_id, title, kind, body) values ('c4c4c4c4-0000-0000-0000-000000000001','Sneaky','reading','x')$$, '42501', null, 'an unassigned trainer cannot add lessons');

-- ---------- management ----------
select set_config('request.jwt.claims', '{"sub":"cdcdcdcd-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$update courses set status = 'published' where id = 'c3c3c3c3-0000-0000-0000-000000000001'$$, 'management can publish a course that has a lesson');
select throws_ok($$insert into course_enrolments(course_id, participant_id) values ('c3c3c3c3-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000003')$$, 'P0001', 'This course is for one cohort and the participant is not enrolled in it', 'a participant outside the course cohort cannot be enrolled');
select lives_ok($$insert into course_enrolments(course_id, participant_id) values ('c3c3c3c3-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000001')$$, 'management can enrol a cohort member');

-- ---------- participants ----------
select set_config('request.jwt.claims', '{"sub":"cdcdcdcd-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from course_lessons), 1, 'an enrolled participant sees the lessons of the published course');
select lives_ok($$insert into lesson_progress(lesson_id, participant_id) select id, 'c1c1c1c1-0000-0000-0000-000000000001' from course_lessons limit 1$$, 'an enrolled participant can mark a lesson done');
select is((select lessons_done from v_course_progress where participant_id = 'c1c1c1c1-0000-0000-0000-000000000001'), 1, 'progress is counted from real completions');

select set_config('request.jwt.claims', '{"sub":"cdcdcdcd-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from courses), 0, 'a participant who is not enrolled sees no courses');

select * from finish();
rollback;
