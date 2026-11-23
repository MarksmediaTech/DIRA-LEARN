-- pgTAP tests for migration 26 (minimum age 18). LOCAL database only. Everything rolls back.
begin;
select plan(10);

insert into auth.users(id, instance_id, aud, role, email) values
  ('66660000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'age1@age.test'),
  ('66660000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'age2@age.test'),
  ('66660000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'age3@age.test');
update profiles set role = 'programme_director', status = 'active' where id = '66660000-0000-0000-0000-000000000003';
insert into applications(id, applicant_id, programme_id, status, form_data) values
  ('66661111-0000-0000-0000-000000000001', '66660000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'draft', '{"firstName":"Ada"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$update applications set status = 'submitted' where id = '66661111-0000-0000-0000-000000000001'$$, null, 'Enter your date of birth before submitting your application', 'an application cannot be submitted without a date of birth');
select throws_ok(format($$update applications set status = 'submitted', form_data = jsonb_build_object('dateOfBirth', '%s') where id = '66661111-0000-0000-0000-000000000001'$$, (current_date - interval '17 years')::date), null,
  'DIRA LEARN is for people aged 18 to 25. Applications from people under 18 cannot be accepted', 'a 17-year-old cannot submit');
select throws_ok(format($$update applications set status = 'submitted', form_data = jsonb_build_object('dateOfBirth', '%s') where id = '66661111-0000-0000-0000-000000000001'$$, (current_date - interval '18 years' + interval '1 day')::date), null, null, 'one day before the 18th birthday is still too young');
select lives_ok(format($$update applications set status = 'submitted', form_data = jsonb_build_object('dateOfBirth', '%s') where id = '66661111-0000-0000-0000-000000000001'$$, (current_date - interval '18 years')::date), 'on the 18th birthday the application can be submitted');
select throws_ok(format($$insert into applications(applicant_id, programme_id, status, form_data) values ('66660000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'submitted', jsonb_build_object('dateOfBirth', '%s'))$$, (current_date - interval '16 years')::date), null, null, 'a new submitted application from a 16-year-old is refused');

-- an application whose recorded date of birth shows the person is under 18 can never be approved
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(format($$insert into applications(applicant_id, programme_id, status, form_data) values ('66660000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'submitted', jsonb_build_object('dateOfBirth', '%s'))$$, (current_date - interval '17 years')::date), null, null, 'not even from the SQL editor');
insert into applications(id, applicant_id, programme_id, status, form_data) values ('66661111-0000-0000-0000-000000000002', '66660000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'submitted', '{}');
update applications set status = 'under_review' where id = '66661111-0000-0000-0000-000000000002';
update applications set form_data = jsonb_build_object('dateOfBirth', (current_date - interval '17 years')::date) where id = '66661111-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66660000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select decide_application('66661111-0000-0000-0000-000000000002', 'approve', null)$$, null, null, 'a programme director cannot approve someone under 18');
reset role;
select is((select role::text from profiles where id = '66660000-0000-0000-0000-000000000002'), 'applicant', 'and the person gets no participant access');
select throws_ok($$insert into participants(profile_id, participant_no, date_of_birth) values ('66660000-0000-0000-0000-000000000002', 'AGE-1', current_date - interval '15 years')$$, null, 'DIRA LEARN participants must be at least 18 years old', 'no participant record can be created for someone under 18');
select lives_ok($$insert into participants(profile_id, participant_no, date_of_birth) values ('66660000-0000-0000-0000-000000000002', 'AGE-2', current_date - interval '20 years')$$, 'a 20-year-old participant record is fine');

select * from finish();
rollback;
