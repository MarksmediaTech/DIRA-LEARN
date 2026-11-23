-- pgTAP test for the PENDING change supabase/pending/20261123000001_verify_certificate_full_name.sql (23 Nov 2026).
-- NOT RUN when it was written (no PostgreSQL in the preparation environment). Run it on a scratch/local database only, after
-- loading the baseline/migrations and applying the pending change; everything rolls back. Never run it on the live project.
begin;
select plan(5);

insert into auth.users(id, instance_id, aud, role, email) values
  ('77770000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'whole@cert.test'),
  ('77770000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'split@cert.test');
update profiles set role = 'participant', status = 'active', first_name = 'Brian Njima Otieno', last_name = '' where id = '77770000-0000-0000-0000-000000000001';
update profiles set role = 'participant', status = 'active', first_name = 'Amina', last_name = 'Otieno'                where id = '77770000-0000-0000-0000-000000000002';
insert into participants(id, profile_id, participant_no, status) values
  ('77771111-0000-0000-0000-000000000001', '77770000-0000-0000-0000-000000000001', 'VC-1', 'active'),
  ('77771111-0000-0000-0000-000000000002', '77770000-0000-0000-0000-000000000002', 'VC-2', 'active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at)
values ('77772222-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'Cert cohort', current_date - 20, current_date + 8, 20, now() - interval '20 days', null);
insert into certificates(participant_id, cohort_id, certificate_no, issued_on, revoked) values
  ('77771111-0000-0000-0000-000000000001', '77772222-0000-0000-0000-00000000000a', 'VC-CERT-1', current_date, false),
  ('77771111-0000-0000-0000-000000000002', '77772222-0000-0000-0000-00000000000a', 'VC-CERT-2', current_date, true);

select is((select holder from verify_certificate('VC-CERT-1')), 'Brian Njima Otieno', 'a complete name saved whole is shown exactly as entered (no extra initial or full stop)');
select is((select valid from verify_certificate('VC-CERT-1')), true, 'a valid certificate is reported valid');
select is((select holder from verify_certificate('VC-CERT-2')), 'Amina Otieno', 'an older first name + last name is shown in full');
select is((select valid from verify_certificate('VC-CERT-2')), false, 'a withdrawn certificate is still reported as not valid');
select ok(has_function_privilege('anon', 'public.verify_certificate(text)', 'execute'), 'signed-out visitors can still run the public check');

select * from finish();
rollback;
