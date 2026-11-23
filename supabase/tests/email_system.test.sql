-- pgTAP tests for migration 10 (email system). NOT yet executed.
begin;
select plan(13);

insert into auth.users(id, instance_id, aud, role, email) values
  ('abababab-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord@m10.local'),
  ('abababab-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@m10.local'),
  ('abababab-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@m10.local');
update profiles set role='programme_coordinator', status='active' where id = 'abababab-0000-0000-0000-000000000001';
update profiles set role='participant', status='active', first_name='Amina' where id = 'abababab-0000-0000-0000-000000000002';
update profiles set role='participant', status='active', first_name='Joseph', email_opt_out = true where id = 'abababab-0000-0000-0000-000000000003';
insert into participants(id, profile_id, participant_no, status) values
  ('a1a1a1a1-0000-0000-0000-000000000001','abababab-0000-0000-0000-000000000002','T-E1','active'),
  ('a1a1a1a1-0000-0000-0000-000000000002','abababab-0000-0000-0000-000000000003','T-E2','active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity) values ('a2a2a2a2-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','M10 cohort', current_date, current_date + 20, 10);
insert into cohort_enrolments(cohort_id, participant_id) values ('a2a2a2a2-0000-0000-0000-000000000001','a1a1a1a1-0000-0000-0000-000000000001'), ('a2a2a2a2-0000-0000-0000-000000000001','a1a1a1a1-0000-0000-0000-000000000002');
insert into email_templates(key, name, subject, body) values ('hello_cohort', 'Hello', 'Welcome {{first_name}}', 'You are in {{cohort_name}}.');

select is(render_text('Hi {{first_name}}', '{"first_name":"Amina"}'), 'Hi Amina', 'placeholders are filled in');
select throws_ok($$select render_text('Hi {{nope}}', '{"first_name":"A"}')$$, 'P0001', 'Unresolved placeholder in template: {{nope}}', 'an unresolved placeholder is refused, never sent');
select is(email_automation_enabled(), false, 'automation is off until approved');
select is(queue_reminders(), 0, 'no reminders are queued while automation is off');

-- migration 18: cohorts start with no learning access until an opening time is set; these fixtures want open access.
update cohorts set access_opens_at = now() - interval '1 day' where access_opens_at is null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"abababab-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select enqueue_bulk_email('hello_cohort','cohort','a2a2a2a2-0000-0000-0000-000000000001', null)$$, 'P0001', 'Only programme management can send email', 'a participant cannot send bulk email');
select throws_ok($$insert into email_outbox(to_email, subject, body) values ('x@y.org','s','b')$$, '42501', null, 'nobody can write the outbox directly');
select is((select count(*)::int from email_outbox), 0, 'a participant cannot read the outbox');

select set_config('request.jwt.claims', '{"sub":"abababab-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(enqueue_bulk_email('hello_cohort','cohort','a2a2a2a2-0000-0000-0000-000000000001', null), 1, 'bulk send skips people who opted out');
select is((select body from email_outbox where to_email = 'p1@m10.local'), 'You are in M10 cohort.', 'the email is personalised per person');
select lives_ok($$delete from email_templates where key = 'notification'$$, 'deleting a system template is silently ignored by row-level security');
select is((select count(*)::int from email_templates where key = 'notification'), 1, 'the system template is still there');
select lives_ok($$select cancel_email((select id from email_outbox limit 1))$$, 'a queued email can be cancelled');
select throws_ok($$select enqueue_bulk_email('hello_cohort','cohort','a2a2a2a2-0000-0000-0000-000000000001', now() - interval '1 day')$$, 'P0001', 'The scheduled time is in the past', 'a past schedule is refused');

select * from finish();
rollback;
