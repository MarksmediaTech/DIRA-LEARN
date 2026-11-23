-- pgTAP tests for migration 20260101000022_dira_connect.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(61);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('33330000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cn' || n || '@connect.test' from generate_series(1, 8) n;
update profiles set role='founder', status='active', first_name='Fay', last_name='Founder'              where id = '33330000-0000-0000-0000-000000000001';
update profiles set role='programme_director', status='active', first_name='Dee', last_name='Director'   where id = '33330000-0000-0000-0000-000000000002';
update profiles set role='programme_coordinator', status='active', first_name='Cora', last_name='Coord'  where id = '33330000-0000-0000-0000-000000000003';
update profiles set role='trainer', status='active', first_name='Tina', last_name='Trainer'              where id = '33330000-0000-0000-0000-000000000004';  -- cohort 1
update profiles set role='trainer', status='active', first_name='Tom', last_name='Other'                 where id = '33330000-0000-0000-0000-000000000005';  -- cohort 2
update profiles set role='participant', status='active', first_name='Lia', last_name='Learner'           where id = '33330000-0000-0000-0000-000000000006';  -- cohort 1
update profiles set role='participant', status='active', first_name='Leo', last_name='Learner'           where id = '33330000-0000-0000-0000-000000000007';  -- cohort 2
update profiles set role='participant', status='active', first_name='Lou', last_name='Learner'           where id = '33330000-0000-0000-0000-000000000008';  -- cohort 1, access scheduled
insert into participants(id, profile_id, participant_no) values
  ('33331111-0000-0000-0000-000000000006','33330000-0000-0000-0000-000000000006','CN-1'),
  ('33331111-0000-0000-0000-000000000007','33330000-0000-0000-0000-000000000007','CN-2'),
  ('33331111-0000-0000-0000-000000000008','33330000-0000-0000-0000-000000000008','CN-3');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('33332222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','CN one', current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('33332222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','CN two', current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('33332222-0000-0000-0000-000000000001','33331111-0000-0000-0000-000000000006'),
  ('33332222-0000-0000-0000-000000000002','33331111-0000-0000-0000-000000000007'),
  ('33332222-0000-0000-0000-000000000001','33331111-0000-0000-0000-000000000008');
insert into trainer_assignments(cohort_id, trainer_id) values
  ('33332222-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000004'),
  ('33332222-0000-0000-0000-000000000002','33330000-0000-0000-0000-000000000005');
insert into learner_access(participant_id, cohort_id, opens_at_override) values ('33331111-0000-0000-0000-000000000008','33332222-0000-0000-0000-000000000001', now() + interval '10 days');
-- the discussions were created by the cohort trigger; give them fixed ids
update connect_conversations set id = '3333aaaa-0000-0000-0000-000000000001' where kind = 'cohort' and cohort_id = '33332222-0000-0000-0000-000000000001';
update connect_conversations set id = '3333aaaa-0000-0000-0000-000000000002' where kind = 'cohort' and cohort_id = '33332222-0000-0000-0000-000000000002';
insert into connect_conversations(id, kind, learner_id, facilitator_id) values ('3333aaaa-0000-0000-0000-000000000003','direct','33331111-0000-0000-0000-000000000006','33330000-0000-0000-0000-000000000004');

select is((select count(*)::int from connect_conversations where kind = 'cohort' and cohort_id in ('33332222-0000-0000-0000-000000000001','33332222-0000-0000-0000-000000000002')), 2, 'every cohort gets its own discussion automatically');

-- ---------- learner Lia (cohort 1) ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(connect_start_direct('33330000-0000-0000-0000-000000000004')::text, '3333aaaa-0000-0000-0000-000000000003', 'a learner can start (or reopen) a private conversation with her own facilitator');
select throws_ok($$select connect_start_direct('33330000-0000-0000-0000-000000000005')$$, null, 'You can only message a facilitator assigned to your cohort', 'but not with a facilitator from another cohort');
select is((select count(*)::int from connect_threads()), 2, 'she sees her cohort discussion and her private conversation');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000006','Hello cohort one')$$, 'she can post in her cohort discussion');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000003','33330000-0000-0000-0000-000000000006','Hello facilitator')$$, 'she can message her facilitator privately');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000002','33330000-0000-0000-0000-000000000006','Wrong cohort')$$, null, null, 'she cannot post in another cohort''s discussion');
select is((select count(*)::int from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000002'), 0, 'she cannot read another cohort''s discussion');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000007','Pretending to be Leo')$$, null, null, 'she cannot send a message as someone else');
-- since migration 38 the command is not granted at all (no RLS policy allows it), so the database refuses it outright
select throws_ok($$delete from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001'$$, '42501', null, 'a learner''s attempt to delete messages is refused');
select ok((select count(*) from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001') >= 1, 'and the messages are still there');

-- ---------- learner Leo (cohort 2) ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$select connect_start_direct('33330000-0000-0000-0000-000000000004')$$, null, 'You can only message a facilitator assigned to your cohort', 'a learner cannot message a facilitator from another cohort');
select is((select count(*)::int from connect_conversations), 1, 'Leo sees only his own cohort''s discussion');
select is((select count(*)::int from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001'), 0, 'Leo cannot read cohort one''s discussion');
select is((select count(*)::int from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000003'), 0, 'Leo cannot read Lia''s private conversation');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000003','33330000-0000-0000-0000-000000000007','Intruding')$$, null, null, 'Leo cannot write into Lia''s private conversation');

-- ---------- learner Lou (access not open yet) ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from connect_conversations), 0, 'a learner whose access has not opened sees no conversations');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000008','Too early')$$, null, null, 'and cannot post');

-- ---------- facilitators ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000003'), 1, 'the facilitator reads the learner''s private message');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000003','33330000-0000-0000-0000-000000000004','Hi Lia, how can I help?')$$, 'and replies');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000004','Welcome everyone')$$, 'and takes part in the cohort discussion');
select is((select count(*)::int from connect_conversations where cohort_id = '33332222-0000-0000-0000-000000000002'), 0, 'a facilitator cannot see another cohort''s discussion');
select is((select count(*)::int from notifications where kind = 'message'), 1, 'the facilitator is notified of the new private message');
-- Updated for the 19 Nov 2026 decision: facilitators may START private conversations with learners of their cohorts (migration 25).
select throws_ok($$select connect_start_direct('33330000-0000-0000-0000-000000000004')$$, null, 'Only learners can start a private conversation with a facilitator', 'facilitators do not use the learner''s start function');
select is(connect_start_direct_with_learner('33331111-0000-0000-0000-000000000006')::text, '3333aaaa-0000-0000-0000-000000000003', 'a facilitator can start (or reopen) a conversation with a learner of her cohort');

select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000003'), 0, 'another cohort''s facilitator cannot read the private conversation');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000003','33330000-0000-0000-0000-000000000005','Intruding')$$, null, null, 'or write in it');

-- ---------- staff without oversight, and executives ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from connect_conversations), 0, 'a coordinator with no oversight sees no conversations at all');
select throws_ok($$insert into connect_oversight(profile_id, scope, reason) values ('33330000-0000-0000-0000-000000000003','private','Coordinator trying to grant themselves')$$, null, null, 'staff cannot grant themselves oversight');

select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from connect_conversations where kind = 'cohort'), 2, 'an executive can read every cohort discussion');
select is((select count(*)::int from connect_conversations where kind = 'direct'), 0, 'but no private conversation');
select ok((select count(*) from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001') >= 2, 'and the messages in a discussion');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000001','Executive posting')$$, null, null, 'executives oversee discussions; they do not post in them');
select throws_ok($$select * from connect_oversight_read('3333aaaa-0000-0000-0000-000000000003','Wanting to read for no grant')$$, null, 'You have not been granted private conversation oversight', 'an executive cannot read a private conversation without an explicit grant');

-- ---------- unread counts ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select unread::int from connect_threads() where kind = 'direct'), 1, 'the learner has one unread private reply');
select lives_ok($$select connect_mark_read('3333aaaa-0000-0000-0000-000000000003')$$, 'she opens the conversation');
select is((select unread::int from connect_threads() where kind = 'direct'), 0, 'and her unread count returns to zero');

-- ---------- reporting ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$select connect_report_message((select id from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001' and sender_id = '33330000-0000-0000-0000-000000000006'), 'inappropriate_content', 'Please review')$$, 'a member can report a message');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$select connect_report_message((select id from connect_messages limit 1), 'spam', null)$$, null, null, 'someone outside the conversation cannot report its messages');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from connect_list_reports('open')), 0, 'a learner cannot list reports');

select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from connect_list_reports('open')), 1, 'a moderator sees the open report');
select lives_ok($$select connect_handle_report((select id from connect_reports limit 1), 'hide', 'Removed for review')$$, 'a moderator can hide the reported message');
select is((select count(*)::int from connect_hidden_originals), 1, 'the original is kept for moderators');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select body from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000001' and sender_id = '33330000-0000-0000-0000-000000000006' limit 1), 'This message was removed by a moderator.', 'members see only that the message was removed');
select is((select count(*)::int from connect_hidden_originals), 0, 'and cannot read the original');

-- ---------- moderation: lock and mute ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select connect_set_lock('3333aaaa-0000-0000-0000-000000000001', true)$$, 'a moderator can lock a cohort discussion');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000006','Locked out')$$, null, null, 'nobody can post in a locked discussion');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select connect_set_lock('3333aaaa-0000-0000-0000-000000000001', false)$$, 'and unlock it');
select lives_ok($$select connect_mute('33330000-0000-0000-0000-000000000006', now() + interval '1 day', 'Cooling off after a report')$$, 'a moderator can mute a learner from discussions');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000001','33330000-0000-0000-0000-000000000006','Muted post')$$, null, null, 'a muted learner cannot post in the discussion');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) values ('3333aaaa-0000-0000-0000-000000000003','33330000-0000-0000-0000-000000000006','I can still ask my facilitator for help')$$, 'but can still reach her facilitator privately');

-- ---------- explicit, logged oversight of private conversations ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$insert into connect_oversight(profile_id, scope, reason) values ('33330000-0000-0000-0000-000000000002','private','Designated safeguarding lead for the programme')$$, 'an executive can grant private oversight to a named person with a reason');
select throws_ok($$insert into connect_oversight(profile_id, scope, reason) values ('33330000-0000-0000-0000-000000000006','private','A learner should never get this')$$, null, 'Oversight can only be granted to executives and programme staff', 'but never to a learner');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from connect_oversight_read('3333aaaa-0000-0000-0000-000000000003','short')$$, null, 'A written reason of at least 10 characters is required', 'a grant holder must still give a written reason');
-- Updated for the 19 Nov 2026 decision: a 'private' grant reads only reported or escalated conversations (migration 24).
select throws_ok($$select * from connect_oversight_read('3333aaaa-0000-0000-0000-000000000003','Just checking how things are going')$$, null, null, 'a grant holder cannot read a private conversation nobody reported');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$select connect_report_message((select id from connect_messages where conversation_id = '3333aaaa-0000-0000-0000-000000000003' and sender_id = '33330000-0000-0000-0000-000000000004' limit 1), 'other', 'Please check this reply')$$, 'Lia reports a message in her private conversation');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok((select count(*) from connect_oversight_read('3333aaaa-0000-0000-0000-000000000003','Reviewing a reported safety concern')) >= 3, 'once reported, and with a reason, the grant holder can read the private conversation');
select is((select count(*)::int from connect_oversight_log), 0, 'the log itself is not visible to the grant holder');
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from connect_oversight_log), 1, 'but executives can see that the access was logged');

-- ---------- slow down ----------
select set_config('request.jwt.claims', '{"sub":"33330000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($q$insert into connect_messages(conversation_id, sender_id, body) select '3333aaaa-0000-0000-0000-000000000002', '33330000-0000-0000-0000-000000000007', 'spam ' || g from generate_series(1, 16) g$q$, null, 'You are sending messages too quickly. Please wait a moment', 'a flood of messages is refused');

reset role;
select throws_ok($$delete from connect_messages$$, null, 'Messages cannot be deleted', 'not even the database owner can delete a message');

select * from finish();
rollback;
