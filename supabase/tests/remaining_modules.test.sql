-- pgTAP tests for migration 9 (mentorship, certificates, notifications, projects, settings, safeguarding, user management).
-- NOT yet executed. Direct database sessions (no JWT) are trusted by the profile guards, so setup can set roles freely;
-- the checks below then switch to `authenticated` with JWT claims to behave like the real API.
begin;
select plan(24);

insert into auth.users(id, instance_id, aud, role, email) values
  ('fefefefe-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@m9.local'),
  ('fefefefe-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','director@m9.local'),
  ('fefefefe-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mentor@m9.local'),
  ('fefefefe-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@m9.local'),
  ('fefefefe-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@m9.local'),
  ('fefefefe-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mentor2@m9.local');
update profiles set role='super_admin', status='active' where id = 'fefefefe-0000-0000-0000-000000000001';
update profiles set role='programme_director', status='active' where id = 'fefefefe-0000-0000-0000-000000000002';
update profiles set role='mentor', status='active' where id in ('fefefefe-0000-0000-0000-000000000003','fefefefe-0000-0000-0000-000000000008');
update profiles set role='participant', status='active' where id in ('fefefefe-0000-0000-0000-000000000004','fefefefe-0000-0000-0000-000000000005');
insert into participants(id, profile_id, participant_no, status) values
  ('15151515-0000-0000-0000-000000000001','fefefefe-0000-0000-0000-000000000004','T-M1','active'),
  ('15151515-0000-0000-0000-000000000002','fefefefe-0000-0000-0000-000000000005','T-M2','active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values
  ('16161616-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','M9 cohort', current_date - 5, current_date + 20, 10);
insert into cohort_enrolments(cohort_id, participant_id) values ('16161616-0000-0000-0000-000000000001','15151515-0000-0000-0000-000000000001');

-- ---------- mentorship ----------
select throws_ok($$insert into mentorship_assignments(mentor_id, participant_id) values ('fefefefe-0000-0000-0000-000000000005','15151515-0000-0000-0000-000000000001')$$,
  'P0001', 'The mentor must be an active account with the mentor role', 'only a mentor account can be assigned as mentor');
select lives_ok($$insert into mentorship_assignments(id, mentor_id, participant_id) values ('17171717-0000-0000-0000-000000000001','fefefefe-0000-0000-0000-000000000003','15151515-0000-0000-0000-000000000001')$$,
  'a mentor can be assigned');
select throws_ok($$insert into mentorship_assignments(mentor_id, participant_id) values ('fefefefe-0000-0000-0000-000000000008','15151515-0000-0000-0000-000000000001')$$,
  '23505', null, 'a participant has one mentor');
select throws_ok($$insert into mentorship_sessions(assignment_id, held_on) values ('17171717-0000-0000-0000-000000000001', current_date + 3)$$,
  'P0001', 'A mentoring session cannot be dated in the future', 'future mentoring sessions are refused');
insert into mentorship_sessions(assignment_id, held_on, summary, shared_with_mentee) values
  ('17171717-0000-0000-0000-000000000001', current_date - 2, 'Private note', false),
  ('17171717-0000-0000-0000-000000000001', current_date - 1, 'Shared note', true);

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from mentorship_sessions), 1, 'a mentee sees only the sessions the mentor shared');
select is((select count(*)::int from profiles where id = 'fefefefe-0000-0000-0000-000000000003'), 1, 'a mentee can read their mentor''s name');
select throws_ok($$update profiles set role = 'super_admin' where id = 'fefefefe-0000-0000-0000-000000000004'$$,
  'P0001', 'Only a super administrator can change role, status or organisation', 'a participant cannot promote themselves');

select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from mentorship_sessions), 0, 'another participant sees no mentoring sessions');

-- ---------- user management guards ----------
select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$update profiles set status = 'deactivated' where id = 'fefefefe-0000-0000-0000-000000000001'$$,
  'P0001', 'You cannot change your own role or status', 'an administrator cannot change their own status');
select throws_ok($$update profiles set role = 'participant' where id = 'fefefefe-0000-0000-0000-000000000003'$$,
  'P0001', 'A participant account is created by converting an accepted application', 'participant is not assignable by hand');
select throws_ok($$update profiles set role = 'trainer' where id = 'fefefefe-0000-0000-0000-000000000004'$$,
  'P0001', 'A participant cannot be given another role. Mark the participant as withdrawn instead', 'a participant keeps the participant role');
select lives_ok($$select admin_set_account_status('fefefefe-0000-0000-0000-000000000008', 'deactivated', 'Left the programme team (test)')$$, 'an administrator can deactivate another account (since migration 34: with a reason, through admin_set_account_status)');
select is((select count(*)::int from admin_list_users() where email = 'mentor@m9.local'), 1, 'a super administrator can list accounts with emails');

select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from admin_list_users()), 0, 'anyone else gets an empty account list');

-- ---------- certificates ----------
select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$insert into certificates(participant_id, cohort_id) values ('15151515-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001')$$,
  '42501', null, 'a director cannot insert a certificate directly (since migration 38 refused before the trigger: the certificate number sequence is not granted)');
select throws_ok($$select issue_certificate('15151515-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001')$$,
  'P0001', 'Graduation rules have not been approved by management', 'no certificate without approved graduation rules');

reset role;
insert into graduation_rules(programme_id, min_sessions_attended, require_core_sessions, require_final_project, require_reflection, is_approved)
  values ('00000000-0000-0000-0000-0000000000a1', 1, false, false, false, true);
select isnt((select approved_at from graduation_rules where programme_id = '00000000-0000-0000-0000-0000000000a1'), null, 'approval time is recorded by the database');
update graduation_rules set min_sessions_attended = 2 where programme_id = '00000000-0000-0000-0000-0000000000a1';
select is((select is_approved from graduation_rules where programme_id = '00000000-0000-0000-0000-0000000000a1'), false, 'editing an approved rule sends it back to draft');
update graduation_rules set min_sessions_attended = 1, is_approved = true where programme_id = '00000000-0000-0000-0000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select issue_certificate('15151515-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001')$$,
  'P0001', 'Attendance requirement not met (0 of 1 sessions)', 'no certificate without the required attendance');

reset role;
insert into session_schedules(id, cohort_id, curriculum_session_id, starts_at, ends_at, status) values
  ('18181818-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001',
   (select id from curriculum_sessions where track_id is null order by session_no limit 1), now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'completed');
insert into attendance(schedule_id, participant_id, status) values ('18181818-0000-0000-0000-000000000001','15151515-0000-0000-0000-000000000001','present');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fefefefe-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select issue_certificate('15151515-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001')$$, 'a director can issue a certificate once the approved rules are met');
select throws_ok($$select issue_certificate('15151515-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001')$$,
  'P0001', 'This participant already has an active certificate for this cohort', 'a second active certificate is refused');
select is((select count(*)::int from notifications where user_id = 'fefefefe-0000-0000-0000-000000000004' and kind = 'certificate'), 0, 'the director cannot read someone else''s notification');

reset role;
select is((select status::text from participants where id = '15151515-0000-0000-0000-000000000001'), 'graduated', 'issuing a certificate marks the participant as graduated');
select is((select count(*)::int from notifications where user_id = 'fefefefe-0000-0000-0000-000000000004' and kind = 'certificate'), 1, 'the participant is notified');

select * from finish();
rollback;
