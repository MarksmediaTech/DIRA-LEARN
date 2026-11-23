-- pgTAP tests for in-system applicant approval (migration 20260101000014). NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(42);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email) values
  ('77777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','super@appr.test'),
  ('77777777-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','director@appr.test'),
  ('77777777-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord@appr.test'),
  ('77777777-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','amina@appr.test'),
  ('77777777-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','brian@appr.test'),
  ('77777777-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','carol@appr.test'),
  ('77777777-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dan@appr.test');
update profiles set role='super_admin', status='active' where id = '77777777-0000-0000-0000-000000000001';
update profiles set role='programme_director', status='active' where id = '77777777-0000-0000-0000-000000000002';
update profiles set role='programme_coordinator', status='active' where id = '77777777-0000-0000-0000-000000000003';
-- applicants (…04 Amina, …05 Brian, …06 Carol, …07 Dan) stay role applicant, status active (what sign-up creates)
insert into applications(id, applicant_id, programme_id, status, form_data) values
  ('88888888-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1','submitted','{"firstName":"Amina","lastName":"Otieno","phone":"+254700000001","dateOfBirth":"2004-05-06"}'),
  ('88888888-0000-0000-0000-000000000002','77777777-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a1','under_review','{"firstName":"Brian","lastName":"Mwangi"}'),
  ('88888888-0000-0000-0000-000000000003','77777777-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000a1','submitted','{"firstName":"Carol"}'),
  ('88888888-0000-0000-0000-000000000004','77777777-0000-0000-0000-000000000007','00000000-0000-0000-0000-0000000000a1','submitted','{"firstName":"Dan"}'),
  ('88888888-0000-0000-0000-000000000005','77777777-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','submitted','{"firstName":"Dir"}'),
  ('88888888-0000-0000-0000-000000000006','77777777-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','submitted','{"firstName":"Sue"}');

-- ---------- an ordinary applicant (Amina, pending) ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000003','approve')$$, null,
  'Only a super administrator or programme director can approve or reject applications', 'applicant cannot call the decision function');
select throws_ok($$update applications set status = 'accepted' where id = '88888888-0000-0000-0000-000000000001'$$, null,
  'Application status can only be changed through the review workflow', 'applicant cannot approve their own application');
do $$ begin update profiles set role = 'participant', status = 'active' where id = '77777777-0000-0000-0000-000000000004'; exception when others then null; end $$;
select is((select role::text from profiles where id = '77777777-0000-0000-0000-000000000004'), 'applicant', 'applicant cannot change their own role');
do $$ begin update profiles set role = 'super_admin' where id = '77777777-0000-0000-0000-000000000004'; exception when others then null; end $$;
select is((select role::text from profiles where id = '77777777-0000-0000-0000-000000000004'), 'applicant', 'applicant cannot make themselves super admin');
select is(my_participant_id(), null::uuid, 'a pending applicant has no participant access');
select ok(not is_staff(), 'a pending applicant is not staff');
select is((select count(*)::int from applications), 1, 'applicant sees only their own application');
select throws_ok($$select application_emails()$$, null, 'Only programme staff can view applicant emails', 'applicant cannot list applicant emails');

-- ---------- coordinator: can review, cannot decide ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000001','approve')$$, null,
  'Only a super administrator or programme director can approve or reject applications', 'coordinator cannot approve');
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000001','reject','no')$$, null,
  'Only a super administrator or programme director can approve or reject applications', 'coordinator cannot reject');
select throws_ok($$select transition_application('88888888-0000-0000-0000-000000000002','accepted')$$, null,
  'Applications are approved or rejected with the Approve and Reject actions, by a super administrator or programme director', 'old status route cannot approve');
select throws_ok($$select transition_application('88888888-0000-0000-0000-000000000002','rejected','x')$$, null,
  'Applications are approved or rejected with the Approve and Reject actions, by a super administrator or programme director', 'old status route cannot reject');
select lives_ok($$select transition_application('88888888-0000-0000-0000-000000000001','under_review')$$, 'coordinator can still move an application to under review');
select is((select count(*)::int from application_emails()), 6, 'staff can list applicant emails');

-- ---------- director decides ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000005','approve')$$, null,
  'You cannot decide your own application', 'director cannot approve their own application');
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000001','maybe')$$, null,
  'The decision must be approve or reject', 'unknown decision is refused');
select lives_ok($$select decide_application('88888888-0000-0000-0000-000000000001','approve')$$, 'director approves a pending application');

reset role;
select is((select status::text from applications where id = '88888888-0000-0000-0000-000000000001'), 'accepted', 'approved: application is accepted');
select is((select role::text || '/' || status::text || '/' || first_name from profiles where id = '77777777-0000-0000-0000-000000000004'), 'participant/active/Amina', 'approved: profile is now an active participant');
select is((select date_of_birth::text from participants where application_id = '88888888-0000-0000-0000-000000000001'), '2004-05-06', 'approved: participant record created once, with date of birth');
select is((select count(*)::int from portfolios p join participants x on x.id = p.participant_id where x.application_id = '88888888-0000-0000-0000-000000000001'), 1, 'approved: portfolio created');
select is((select count(*)::int from application_events where application_id = '88888888-0000-0000-0000-000000000001' and to_status = 'accepted' and actor_id = '77777777-0000-0000-0000-000000000002'), 1, 'approved: history records the administrator');
select is((select count(*)::int from audit_logs where action = 'application_approved' and actor_id = '77777777-0000-0000-0000-000000000002' and row_id = '88888888-0000-0000-0000-000000000001' and new_data ->> 'decision' = 'approve' and created_at is not null), 1, 'approved: audit log has admin, decision and time');
select is((select count(*)::int from email_outbox where to_user_id = '77777777-0000-0000-0000-000000000004' and template_key = 'application_approved' and status = 'queued'), 1, 'approved: email queued');
select is((select count(*)::int from notifications where user_id = '77777777-0000-0000-0000-000000000004' and kind = 'application_decision'), 1, 'approved: in-app notification created');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000001','reject','changed my mind')$$, null,
  'Only pending applications can be approved or rejected (this one is accepted)', 'a decision cannot be repeated or reversed');
select lives_ok($$select decide_application('88888888-0000-0000-0000-000000000002','reject','Incomplete application')$$, 'director rejects with a reason');
select lives_ok($$select decide_application('88888888-0000-0000-0000-000000000004','reject')$$, 'director rejects without a reason');
do $$ begin update profiles set role = 'super_admin' where id = '77777777-0000-0000-0000-000000000006'; exception when others then null; end $$;

reset role;
select is((select status::text from applications where id = '88888888-0000-0000-0000-000000000002'), 'rejected', 'rejected: application is rejected');
select is((select role::text from profiles where id = '77777777-0000-0000-0000-000000000005'), 'applicant', 'rejected: profile stays an applicant');
select is((select count(*)::int from participants where profile_id = '77777777-0000-0000-0000-000000000005'), 0, 'rejected: no participant record');
select is((select note from application_events where application_id = '88888888-0000-0000-0000-000000000002' and to_status = 'rejected'), 'Incomplete application', 'rejected: reason recorded in history');
select is((select new_data ->> 'reason' from audit_logs where action = 'application_rejected' and row_id = '88888888-0000-0000-0000-000000000002'), 'Incomplete application', 'rejected: audit log holds the reason');
select is((select count(*)::int from audit_logs where action = 'application_rejected' and row_id = '88888888-0000-0000-0000-000000000004' and new_data ->> 'reason' is null), 1, 'rejected without reason: audit log still written');
select is((select count(*)::int from email_outbox where to_user_id = '77777777-0000-0000-0000-000000000005' and template_key = 'application_rejected' and body not like '%Incomplete application%'), 1, 'rejected: email queued and the internal reason is not in it');
select is((select count(*)::int from notifications where user_id = '77777777-0000-0000-0000-000000000005' and kind = 'application'), 0, 'rejected: no duplicate neutral notification');
select is((select role::text from profiles where id = '77777777-0000-0000-0000-000000000006'), 'applicant', 'director cannot change another account''s role');

-- ---------- after the decisions ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(my_participant_id(), null::uuid, 'a rejected applicant has no participant access');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt(my_participant_id(), null::uuid, 'an approved applicant now has participant access');
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000003','approve')$$, null,
  'Only a super administrator or programme director can approve or reject applications', 'an approved participant cannot approve others');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select decide_application('88888888-0000-0000-0000-000000000006','approve')$$, null,
  'You cannot decide your own application', 'super admin cannot approve their own application');
select lives_ok($$select decide_application('88888888-0000-0000-0000-000000000003','approve')$$, 'super admin approves a pending application');

select * from finish();
rollback;
