-- DIRA LEARN: TEST ACCOUNTS FOR YOUR OWN COMPUTER ONLY (local Supabase started with `npx supabase start`).
-- NEVER run this on the live Supabase project. It refuses to run if the database already has real users.
--
-- How to use (local only):
--   On Windows: start the system with START-DIRA-LEARN.bat, then double-click CREATE-DIRA-TEST-ACCOUNTS.bat
--   (it runs this file inside the local database container only, and asks first).
--   Or paste this file into the LOCAL Studio at http://localhost:54323 > SQL Editor.
--   Then sign in at http://localhost:5173 with any address below and the password  DiraTest!2026
--
-- Accounts (all @dira-test.local):
--   founder@, cofounder@, admin@ (super admin), director@ (Safeguarding Lead), coordinator@ (Safeguarding Deputy),
--   trainer.a@ (cohort A), trainer.b@ (cohort B), mentor@ (mentor of learner2), me@ (M&E officer),
--   learner1@ and learner2@ (cohort A, access open), learner3@ (cohort A, access not open yet), learner4@ (cohort B, access open),
--   applicant@ (an applicant)
-- STATUS: written and checked against a local PostgreSQL stand-in; signing in has NOT been tried against real Supabase Auth.
begin;

do $$ begin
  if exists (select 1 from auth.users where email not like '%@dira-test.local') then
    raise exception 'STOPPED: this database already has real users. This script is only for a fresh LOCAL test database.';
  end if;
  if exists (select 1 from auth.users where email like '%@dira-test.local') then
    raise exception 'STOPPED: the test accounts already exist. Run `npx supabase db reset` first if you want to recreate them.';
  end if;
end $$;

create temporary table t_accounts(n int, email text, first text, last text, role role_code) on commit drop;
insert into t_accounts values
  (1, 'founder@dira-test.local', 'Faith', 'Founder', 'founder'), (2, 'cofounder@dira-test.local', 'Collins', 'Cofounder', 'co_founder'),
  (3, 'admin@dira-test.local', 'Sam', 'Admin', 'super_admin'), (4, 'director@dira-test.local', 'Dorcas', 'Director', 'programme_director'),
  (5, 'coordinator@dira-test.local', 'Kevin', 'Coordinator', 'programme_coordinator'), (6, 'trainer.a@dira-test.local', 'Tabitha', 'TrainerA', 'trainer'),
  (7, 'trainer.b@dira-test.local', 'Tom', 'TrainerB', 'trainer'), (8, 'mentor@dira-test.local', 'Mercy', 'Mentor', 'mentor'),
  (9, 'me@dira-test.local', 'Eric', 'Evaluation', 'me_officer'), (10, 'learner1@dira-test.local', 'Lilian', 'LearnerOne', 'participant'),
  (11, 'learner2@dira-test.local', 'Leon', 'LearnerTwo', 'participant'), (12, 'learner3@dira-test.local', 'Lucy', 'LearnerThree', 'participant'),
  (13, 'learner4@dira-test.local', 'Liam', 'LearnerFour', 'participant'), (14, 'applicant@dira-test.local', 'Amani', 'Applicant', 'applicant');

-- Supabase Auth users with a password (local only), plus the email identity Supabase Auth expects.
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                       created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
select '00000000-0000-0000-0000-000000000000', ('d1a00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'authenticated', 'authenticated', email,
       extensions.crypt('DiraTest!2026', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from t_accounts;
insert into auth.identities(id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), ('d1a00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, ('d1a00000-0000-0000-0000-' || lpad(n::text, 12, '0')), 'email',
       jsonb_build_object('sub', ('d1a00000-0000-0000-0000-' || lpad(n::text, 12, '0')), 'email', email, 'email_verified', true), now(), now(), now()
from t_accounts;

-- Roles and names (the sign-up trigger already created applicant profiles; a direct database session may set roles).
update profiles p set role = t.role, status = 'active', first_name = t.first, last_name = t.last
from t_accounts t where p.id = ('d1a00000-0000-0000-0000-' || lpad(t.n::text, 12, '0'))::uuid;

insert into participants(id, profile_id, participant_no, date_of_birth, status)
select ('d1a11111-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, ('d1a00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'TEST-' || n, current_date - interval '21 years', 'active'
from t_accounts where role = 'participant';

insert into cohorts(id, programme_id, name, intake_label, season, start_date, end_date, capacity, recruitment_opens_on, recruitment_closes_on, access_opens_at, access_closes_at)
select 'd1a22222-0000-0000-0000-00000000000a', id, 'Test cohort A', 'Test intake', 'Test season', current_date - 7, current_date + 21, 30, current_date - 40, current_date - 10, now() - interval '7 days', now() + interval '60 days'
from programmes order by version desc limit 1;
insert into cohorts(id, programme_id, name, intake_label, season, start_date, end_date, capacity, access_opens_at, access_closes_at)
select 'd1a22222-0000-0000-0000-00000000000b', id, 'Test cohort B', 'Test intake', 'Test season', current_date - 7, current_date + 21, 30, now() - interval '7 days', now() + interval '60 days'
from programmes order by version desc limit 1;

insert into cohort_enrolments(cohort_id, participant_id, track_id)
select case when t.n = 13 then 'd1a22222-0000-0000-0000-00000000000b'::uuid else 'd1a22222-0000-0000-0000-00000000000a'::uuid end,
       ('d1a11111-0000-0000-0000-' || lpad(t.n::text, 12, '0'))::uuid, (select id from tracks where code = 'digital')
from t_accounts t where t.role = 'participant';
-- learner3's access opens in 10 days (to try closed-access support messaging)
insert into learner_access(participant_id, cohort_id, opens_at_override) values ('d1a11111-0000-0000-0000-000000000012', 'd1a22222-0000-0000-0000-00000000000a', now() + interval '10 days');
insert into trainer_assignments(cohort_id, trainer_id) values
  ('d1a22222-0000-0000-0000-00000000000a', 'd1a00000-0000-0000-0000-000000000006'), ('d1a22222-0000-0000-0000-00000000000b', 'd1a00000-0000-0000-0000-000000000007');
insert into mentorship_assignments(mentor_id, participant_id) values ('d1a00000-0000-0000-0000-000000000008', 'd1a11111-0000-0000-0000-000000000011');

-- Test safeguarding officers, appointed by the Founder (never by themselves). Real officers are appointed in the app.
insert into safeguarding_officers(position, profile_id, appointed_by, reason) values
  ('lead', 'd1a00000-0000-0000-0000-000000000004', 'd1a00000-0000-0000-0000-000000000001', 'LOCAL TEST ONLY: test Safeguarding Lead'),
  ('deputy', 'd1a00000-0000-0000-0000-000000000005', 'd1a00000-0000-0000-0000-000000000001', 'LOCAL TEST ONLY: test Safeguarding Deputy');

-- An application from the applicant, so the Applications page has something to review.
insert into applications(applicant_id, programme_id, status, submitted_at, form_data)
select 'd1a00000-0000-0000-0000-000000000014', id, 'submitted', now() - interval '20 days',
       jsonb_build_object('firstName', 'Amani', 'lastName', 'Applicant', 'dateOfBirth', (current_date - interval '20 years')::date, 'location', 'Nairobi')
from programmes order by version desc limit 1;

commit;
select 'Created ' || count(*) || ' local test accounts. Password for all: DiraTest!2026' as result from auth.users where email like '%@dira-test.local';
