-- pgTAP tests for migration 24 (safeguarding officers, confidential records, escalation, oversight rules).
-- LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(87);

-- ---------- helpers (removed again by the rollback) ----------
create function _u(n int) returns uuid language sql immutable as $$ select ('44440000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _p(n int) returns uuid language sql immutable as $$ select ('44441111-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _as(n int) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', _u(n), 'role', 'authenticated')::text, true) $$;
create function _rows(q text) returns int language plpgsql as $f$ declare k int; begin execute q; get diagnostics k = row_count; return k; end $f$;
grant execute on function _u(int), _p(int), _as(int), _rows(text) to authenticated, service_role;

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sg' || n || '@sg.test' from generate_series(1, 10) n;
update profiles set role='founder', status='active', first_name='Fay', last_name='Founder' where id = _u(1);
update profiles set role='co_founder', status='active', first_name='Cal', last_name='Cofounder' where id = _u(2);
update profiles set role='super_admin', status='active', first_name='Sam', last_name='Admin' where id = _u(3);
update profiles set role='programme_director', status='active', first_name='Dee', last_name='Director' where id = _u(4);   -- will be Lead
update profiles set role='programme_coordinator', status='active', first_name='Cora', last_name='Coord' where id = _u(5); -- will be Deputy
update profiles set role='trainer', status='active', first_name='Tina', last_name='Trainer' where id = _u(6);              -- cohort 1
update profiles set role='trainer', status='active', first_name='Tom', last_name='Other' where id = _u(7);                 -- cohort 2
update profiles set role='participant', status='active', first_name='Lia', last_name='Learner' where id = _u(8);          -- cohort 1
update profiles set role='participant', status='active', first_name='Leo', last_name='Learner' where id = _u(9);          -- cohort 2
update profiles set role='mentor', status='active', first_name='Max', last_name='Mentor' where id = _u(10);
insert into participants(id, profile_id, participant_no) values (_p(8), _u(8), 'SG-1'), (_p(9), _u(9), 'SG-2');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('44442222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','SG one', current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('44442222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','SG two', current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values ('44442222-0000-0000-0000-000000000001', _p(8)), ('44442222-0000-0000-0000-000000000002', _p(9));
insert into trainer_assignments(cohort_id, trainer_id) values ('44442222-0000-0000-0000-000000000001', _u(6)), ('44442222-0000-0000-0000-000000000002', _u(7));
insert into connect_conversations(id, kind, learner_id, facilitator_id) values
  ('4444aaaa-0000-0000-0000-000000000001','direct', _p(8), _u(6)),
  ('4444aaaa-0000-0000-0000-000000000002','direct', _p(9), _u(7));
insert into connect_messages(id, conversation_id, sender_id, body) values
  ('4444bbbb-0000-0000-0000-000000000001','4444aaaa-0000-0000-0000-000000000001', _u(6), 'You are useless, quit the course'),
  ('4444bbbb-0000-0000-0000-000000000002','4444aaaa-0000-0000-0000-000000000001', _u(6), 'Send me your home address'),
  ('4444bbbb-0000-0000-0000-000000000003','4444aaaa-0000-0000-0000-000000000002', _u(7), 'Session moved to Friday');
-- a record that existed before anyone was appointed
insert into safeguarding_records(id, summary, severity) values ('4444cccc-0000-0000-0000-000000000000', 'Legacy record created before officers existed', 'medium');

set local role authenticated;

-- ---------- 1. appointing officers ----------
select _as(1);
select is(sg_waiting_without_officer(), 1, 'executives are told a concern is waiting while nobody is appointed (no details)');
select is((select count(*)::int from sg_officers()), 0, 'nobody holds a safeguarding position at the start');
select throws_ok($$select sg_appoint('lead', _u(1), 'I would like to be the lead')$$, null, 'You cannot appoint yourself. Another executive must make this appointment', 'an executive cannot appoint herself');
select throws_ok($$select sg_appoint('lead', _u(8), 'A learner must never hold this')$$, null, 'Safeguarding officers must be active executives or programme staff', 'a learner cannot be appointed');
select throws_ok($$select sg_appoint('lead', _u(4), 'short')$$, null, 'Write a reason of at least 10 characters', 'an appointment needs a written reason');
select lives_ok($$select sg_appoint('lead', _u(4), 'Board resolution 12: interim Safeguarding Lead')$$, 'the Founder appoints the Safeguarding Lead');
select throws_ok($$select sg_appoint('deputy', _u(4), 'Same person as deputy too')$$, null, 'The Lead and the Deputy must be different people', 'one person cannot hold both positions');
select _as(6);
select throws_ok($$select sg_appoint('deputy', _u(5), 'Facilitator trying to appoint')$$, null, 'Only a super administrator, Founder or Co-Founder can appoint safeguarding officers', 'a facilitator cannot appoint officers');
select _as(2);
select lives_ok($$select sg_appoint('deputy', _u(5), 'Board resolution 12: Safeguarding Deputy')$$, 'the Co-Founder appoints the Deputy');
select is(sg_waiting_without_officer(), 0, 'the waiting-without-officer warning clears');
select is((select count(*)::int from sg_officers()), 2, 'executives see who holds the two positions');
select _as(8);
select is((select count(*)::int from safeguarding_officers), 0, 'learners cannot read the officers table');
reset role;
select is((select count(*)::int from notifications where user_id = _u(4) and kind = 'safeguarding'), 2, 'the new Lead is told of the appointment AND of the concern already waiting');
select is((select count(*)::int from safeguarding_officer_history where event = 'appointed'), 2, 'appointments are kept in an append-only history');
set local role authenticated;

-- ---------- 2. records are confidential to the officers ----------
select _as(1);
select is((select count(*)::int from safeguarding_records), 0, 'the Founder cannot read safeguarding records');
select _as(3);
select is((select count(*)::int from safeguarding_records), 0, 'the Super Administrator cannot read safeguarding records');
select is(_rows($$update safeguarding_records set status = 'closed'$$), 0, 'and cannot change them');
select _as(6);
select is((select count(*)::int from safeguarding_records), 0, 'a facilitator cannot read them');
select _as(4);
select is((select count(*)::int from safeguarding_records), 1, 'the Lead reads the records');
select is(sg_my_position(), 'lead', 'and knows her position');
select _as(5);
select is((select count(*)::int from safeguarding_records), 1, 'the Deputy reads the records too');
reset role;
select is((select count(*)::int from audit_logs where table_name = 'safeguarding_records'), 0, 'records are not copied into the general audit log that executives read');
set local role authenticated;

-- ---------- 3. raising concerns ----------
select _as(6);
select lives_ok($$select sg_raise_concern(_p(8), 'Lia said she feels unsafe travelling home after evening sessions', 'urgent')$$, 'a facilitator raises an urgent concern');
select is((select count(*)::int from safeguarding_records), 0, 'the facilitator cannot read it back afterwards');
select _as(8);
select throws_ok($$select sg_raise_concern(_p(8), 'A learner trying to use the staff route here', 'standard')$$, null, null, 'learners use Report or the safeguarding team conversation instead');
select _as(10);
select throws_ok($$select sg_raise_concern(_p(9), 'too short', 'standard')$$, null, 'Describe the concern factually in at least 20 characters', 'a concern needs a factual description');
reset role;
select is((select count(distinct user_id)::int from notifications where kind = 'safeguarding' and title like 'An URGENT%'), 2, 'an urgent concern notifies the Lead AND the Deputy at once');
select is((select count(*)::int from notifications where kind = 'safeguarding' and (title ilike '%Lia%' or body ilike '%Lia%' or body ilike '%unsafe%')), 0, 'notifications carry no names or details');
select ok((select ack_due_at between now() + interval '55 minutes' and now() + interval '65 minutes' from safeguarding_records where urgency = 'urgent'), 'urgent concerns get the 60-minute acknowledgement target');
select ok((select ack_due_at between now() + interval '23 hours' and now() + interval '25 hours' from safeguarding_records where id = '4444cccc-0000-0000-0000-000000000000'), 'other concerns get the 24-hour target');
set local role authenticated;

-- ---------- 4. the officer's workflow ----------
select _as(4);
select lives_ok($$update safeguarding_records set status = 'acknowledged', responsible_officer = _u(4) where urgency = 'urgent'$$, 'the Lead acknowledges and takes responsibility');
select is((select acknowledged_by from safeguarding_records where urgency = 'urgent'), _u(4), 'who acknowledged, and when, is recorded by the database');
select is((select string_agg(a.action, ',' order by a.created_at, a.action) from safeguarding_actions a join safeguarding_records r on r.id = a.record_id where r.urgency = 'urgent'), 'acknowledged,assigned,created', 'creation, acknowledgement and assignment are in the history');
select lives_ok($$insert into safeguarding_actions(record_id, action, note) select id, 'note', 'Called Lia; arranged an escort with the venue' from safeguarding_records where urgency = 'urgent'$$, 'the Lead adds a note of the action taken');
select throws_ok($$insert into safeguarding_actions(record_id, action, note) select id, 'resolved', 'Faking a resolution entry' from safeguarding_records where urgency = 'urgent'$$, null, null, 'officers cannot write system history entries by hand');
select throws_ok($$update safeguarding_records set legal_hold = true where urgency = 'urgent'$$, null, 'A legal hold needs a reason', 'a legal hold needs a reason');
select lives_ok($$update safeguarding_records set legal_hold = true, legal_hold_reason = 'Police enquiry reference 123' where urgency = 'urgent'$$, 'with a reason, the Lead places a legal hold');
select lives_ok($$update safeguarding_records set status = 'resolved', resolution = 'Escort arranged; Lia confirmed she feels safe' where urgency = 'urgent'$$, 'the Lead records the resolution');
select ok((select resolved_at is not null from safeguarding_records where urgency = 'urgent'), 'the resolution date is recorded');
reset role;
select throws_ok($$delete from safeguarding_records$$, null, 'Safeguarding records and their history cannot be deleted', 'records cannot be deleted, not even by the database owner');
select throws_ok($$update safeguarding_actions set note = 'rewritten'$$, null, 'Safeguarding records and their history cannot be deleted', 'and their history cannot be rewritten');
set local role authenticated;

-- ---------- 5. the Deputy acts when the Lead is unavailable ----------
select _as(5);
select throws_ok($$select sg_set_unavailable(now() + interval '1 day', 'Deputy trying')$$, null, 'Only the Safeguarding Lead or an executive can change the Lead''s availability', 'the Deputy cannot change the Lead''s availability');
select _as(4);
select lives_ok($$select sg_set_unavailable(now() + interval '2 days', 'Annual leave')$$, 'the Lead marks herself unavailable');
select _as(5);
select is(sg_is_acting_lead(), true, 'the Deputy is now acting Lead');
select _as(10);
select lives_ok($$select sg_raise_concern(_p(9), 'Leo mentioned he has not eaten for days and seems withdrawn', 'standard')$$, 'a mentor raises a standard concern');
reset role;
select is((select count(*)::int from notifications where user_id = _u(5) and title like 'A safeguarding concern needs acknowledgement%'), 1, 'while the Lead is away, a standard concern goes to the Deputy');
select is((select count(*)::int from notifications where user_id = _u(4) and title like 'A safeguarding concern needs acknowledgement%'), 0, 'and not to the absent Lead');
set local role authenticated;
select _as(4);
select lives_ok($$select sg_set_unavailable(null, 'Back from leave')$$, 'the Lead marks herself available again');
select is(sg_is_acting_lead(), true, 'and is acting Lead again');

-- ---------- 6. overdue acknowledgements ----------
reset role;
select set_config('request.jwt.claims', '', true);  -- a trusted server session, as in the SQL editor
update safeguarding_records set ack_due_at = now() - interval '1 hour' where summary like 'Leo mentioned%';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(sg_overdue_check(), 1, 'the reminder job finds the overdue concern');
select is(sg_overdue_check(), 0, 'and alerts only once');
reset role;
select is((select count(distinct user_id)::int from notifications where title like '%passed its acknowledgement target'), 2, 'both officers are alerted when a target is missed');
set local role authenticated;

-- ---------- 7. exceptional access for a non-officer ----------
select _as(1);
select throws_ok($$select sg_grant_exceptional_access(_u(1), 3, 'I want to review all safeguarding records myself')$$, null, 'You cannot grant access to yourself', 'an executive cannot grant herself exceptional access');
select throws_ok($$select * from sg_exceptional_read('4444cccc-0000-0000-0000-000000000000', 'Board review of incident handling')$$, null, 'You do not have exceptional access to safeguarding records', 'without a grant there is no access');
select _as(2);
select throws_ok($$select sg_grant_exceptional_access(_u(1), 30, 'Board-approved review of incident handling, ref B-7')$$, null, 'Exceptional access lasts between 1 and 7 days', 'exceptional access is time-limited');
select lives_ok($$select sg_grant_exceptional_access(_u(1), 3, 'Board-approved review of incident handling, ref B-7')$$, 'a different executive grants it, with a reason');
select _as(1);
select is((select count(*)::int from sg_exceptional_index()), 3, 'the reader sees which records exist (dates and urgency only)');
select throws_ok($$select * from sg_exceptional_read('4444cccc-0000-0000-0000-000000000000', 'short')$$, null, 'A written reason of at least 10 characters is required', 'each read needs its own reason');
select is((select count(*)::int from sg_exceptional_read('4444cccc-0000-0000-0000-000000000000', 'Board review of incident handling')), 1, 'with a reason, the reader opens one record');
select is((select count(*)::int from safeguarding_records), 0, 'but still has no direct access to the table');
select _as(4);
select is((select count(*)::int from safeguarding_access_log where basis = 'exceptional_grant' and profile_id = _u(1)), 1, 'the Lead sees the exceptional read in the access log');
select is((select count(*)::int from safeguarding_actions where action = 'exceptional_read'), 1, 'and in the record''s history');
select _as(2);
select lives_ok($$select sg_revoke_exceptional_access((select id from safeguarding_access_grants limit 1))$$, 'the grant is revoked');
select _as(1);
select throws_ok($$select * from sg_exceptional_read('4444cccc-0000-0000-0000-000000000000', 'Trying again after revocation')$$, null, 'You do not have exceptional access to safeguarding records', 'after revocation there is no access');

-- ---------- 8. escalation from DIRA Connect ----------
select _as(8);
select lives_ok($$select connect_report_message('4444bbbb-0000-0000-0000-000000000001', 'bullying_or_harassment', 'He keeps saying this')$$, 'Lia reports a message from her facilitator');
select _as(1);
select lives_ok($$select connect_handle_report((select id from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000001'), 'escalate', 'Repeated harassment by a facilitator', 'urgent')$$, 'a moderator escalates it as urgent');
select throws_ok($$select connect_handle_report((select id from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000001'), 'escalate', 'Again', 'urgent')$$, null, 'This report is already with safeguarding', 'it cannot be escalated twice');
select throws_ok($$select connect_handle_report((select id from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000001'), 'dismiss', 'Changed my mind')$$, null, 'An escalated report is handled by safeguarding and cannot be dismissed', 'a moderator cannot dismiss an escalated report');
select is((select count(*)::int from safeguarding_records), 0, 'the escalating moderator cannot read the safeguarding record');
select _as(4);
select is((select count(*)::int from safeguarding_records where source = 'connect_report' and urgency = 'urgent' and reported_message = 'You are useless, quit the course'
           and conversation_id = '4444aaaa-0000-0000-0000-000000000001' and participant_id = _p(8)), 1, 'the record holds a copy of the reported message, the conversation and the learner');
select _as(8);
select lives_ok($$select connect_report_message('4444bbbb-0000-0000-0000-000000000002', 'safety_concern', null)$$, 'Lia reports another message as a safety concern');
select _as(4);
select is((select count(*)::int from safeguarding_records where source = 'connect_safety_report'), 1, 'safety-concern reports go straight to safeguarding');
select _as(1);
select is((select status from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000002'), 'escalated', 'moderators see that it is with safeguarding');

-- ---------- 9. private-conversation oversight ----------
select _as(1);
select throws_ok($$insert into connect_oversight(profile_id, scope, reason) values (_u(1), 'private', 'Founder granting herself access')$$, null, 'You cannot grant oversight to yourself. Another executive must approve it', 'an executive cannot grant herself private oversight');
select _as(2);
select lives_ok($$insert into connect_oversight(profile_id, scope, reason) values (_u(1), 'private', 'Board-appointed reviewer for reported conversations')$$, 'a different executive grants it');
select _as(1);
select ok((select count(*) from connect_oversight_read('4444aaaa-0000-0000-0000-000000000001', 'Reviewing the escalated report')) >= 2, 'the grant holder reads the escalated conversation, with a reason');
select throws_ok($$select * from connect_oversight_read('4444aaaa-0000-0000-0000-000000000002', 'Curious about this conversation')$$, null, null, 'but not a conversation nobody reported');
select is((select basis from connect_oversight_log where profile_id = _u(1) limit 1), 'escalated_conversation', 'the log records why access was allowed');
select _as(4);
select throws_ok($$select * from connect_oversight_read('4444aaaa-0000-0000-0000-000000000002', 'Checking on Leo after the mentor concern')$$, null, null, 'the Lead cannot open an unreported conversation without naming a record');
select lives_ok($$select * from connect_oversight_read('4444aaaa-0000-0000-0000-000000000002', 'Concern raised by the mentor about Leo', (select id from safeguarding_records where summary like 'Leo mentioned%'))$$,
  'the acting Lead opens it for a documented, open safeguarding record');
select is((select count(*)::int from safeguarding_actions a join safeguarding_records r on r.id = a.record_id where r.summary like 'Leo mentioned%' and a.action = 'conversation_read'), 1, 'and the read is added to that record''s history');
select _as(5);
select throws_ok($$select * from connect_oversight_read('4444aaaa-0000-0000-0000-000000000002', 'Deputy checking too', (select id from safeguarding_records where summary like 'Leo mentioned%'))$$, null,
  'Only the acting Safeguarding Lead can open a conversation for a safeguarding record', 'the Deputy cannot do this while the Lead is available');
select _as(1);
select is((select count(*)::int from connect_oversight_log where basis = 'safeguarding_concern'), 1, 'executives can review that the Lead opened it, and why');

-- ---------- 10. hidden messages stay available as evidence ----------
select lives_ok($$select connect_handle_report((select id from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000001'), 'hide', 'Removed while safeguarding reviews')$$, 'a moderator hides the escalated message');
select is((select status from connect_reports where message_id = '4444bbbb-0000-0000-0000-000000000001'), 'escalated', 'the report stays with safeguarding');
select is((select body from connect_oversight_read('4444aaaa-0000-0000-0000-000000000001', 'Reviewing after the message was hidden') where hidden), 'You are useless, quit the course', 'an authorised oversight read shows the original text of a hidden message');
select _as(8);
select is((select body from connect_messages where id = '4444bbbb-0000-0000-0000-000000000001'), 'This message was removed by a moderator.', 'members see only that it was removed');

select * from finish();
rollback;
