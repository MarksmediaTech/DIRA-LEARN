-- pgTAP tests for the PENDING change supabase/pending/20261122000002_chat_notifications_calendar.sql (22 Nov 2026).
-- Run by tools/chat/chat_db_check.sh after both pending changes are applied. Everything rolls back.
begin;
select plan(118);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('55550000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@chat.test'
from generate_series(1, 11) n;
update profiles set role = 'founder',               status = 'active', first_name = 'Fay',  last_name = 'Founder' where id = '55550000-0000-0000-0000-000000000001';
update profiles set role = 'programme_coordinator', status = 'active', first_name = 'Cora', last_name = 'Coord'   where id = '55550000-0000-0000-0000-000000000002';
update profiles set role = 'trainer',               status = 'active', first_name = 'Tina', last_name = 'One'     where id = '55550000-0000-0000-0000-000000000003';
update profiles set role = 'trainer',               status = 'active', first_name = 'Tom',  last_name = 'Two'     where id = '55550000-0000-0000-0000-000000000004';
update profiles set role = 'mentor',                status = 'active', first_name = 'Mo',   last_name = 'Mentor'  where id = '55550000-0000-0000-0000-000000000005';
update profiles set role = 'me_officer',            status = 'active', first_name = 'Eve',  last_name = 'Evaluator' where id = '55550000-0000-0000-0000-000000000006';
update profiles set role = 'participant',           status = 'active', first_name = 'Lia',  last_name = 'Learner' where id = '55550000-0000-0000-0000-000000000007';
update profiles set role = 'participant',           status = 'active', first_name = 'Lou',  last_name = 'Learner' where id = '55550000-0000-0000-0000-000000000008';
update profiles set role = 'participant',           status = 'active', first_name = 'Leo',  last_name = 'Elsewhere' where id = '55550000-0000-0000-0000-000000000009';
update profiles set role = 'applicant',             status = 'active', first_name = 'Amy',  last_name = 'Applicant' where id = '55550000-0000-0000-0000-000000000010';
update profiles set role = 'participant',           status = 'active', first_name = 'Ida',  last_name = 'Imported' where id = '55550000-0000-0000-0000-000000000011';
insert into participants(id, profile_id, participant_no, programme_track_id) values
  ('55551111-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000007', 'CH-1', null),
  ('55551111-0000-0000-0000-000000000008', '55550000-0000-0000-0000-000000000008', 'CH-2', null),
  ('55551111-0000-0000-0000-000000000009', '55550000-0000-0000-0000-000000000009', 'CH-3', null),
  ('55551111-0000-0000-0000-000000000011', '55550000-0000-0000-0000-000000000011', 'CH-4', (select id from tracks where name = 'AI Tools'));
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('55552222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Chat one', current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('55552222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Chat two', current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('55552222-0000-0000-0000-000000000001', '55551111-0000-0000-0000-000000000007'),
  ('55552222-0000-0000-0000-000000000001', '55551111-0000-0000-0000-000000000008'),
  ('55552222-0000-0000-0000-000000000002', '55551111-0000-0000-0000-000000000009');
insert into trainer_assignments(cohort_id, trainer_id, track_id) values
  ('55552222-0000-0000-0000-000000000001', '55550000-0000-0000-0000-000000000003', (select id from tracks where name = 'AI Tools')),
  ('55552222-0000-0000-0000-000000000002', '55550000-0000-0000-0000-000000000004', null);
insert into mentorship_assignments(mentor_id, participant_id) values ('55550000-0000-0000-0000-000000000005', '55551111-0000-0000-0000-000000000007');

create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
create or replace function pg_temp.act(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;

-- ================= who may talk to whom =================
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000008'), true, 'two learners of the same cohort may talk');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000009'), false, 'learners of different cohorts may not');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000003'), true, 'a learner and the trainer of her cohort may');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000004'), false, 'a learner and another cohort''s trainer may not');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000002'), true, 'a learner and programme staff may');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000005'), true, 'a learner and her mentor may');
select is(chat_can_dm('55550000-0000-0000-0000-000000000009', '55550000-0000-0000-0000-000000000005'), false, 'a learner and someone else''s mentor may not');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000006'), false, 'a learner and an M&E officer may not');
select is(chat_can_dm('55550000-0000-0000-0000-000000000003', '55550000-0000-0000-0000-000000000004'), true, 'two staff members may');
select is(chat_can_dm('55550000-0000-0000-0000-000000000010', '55550000-0000-0000-0000-000000000002'), false, 'applicants are not in chat');
select is(chat_can_dm('55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000007'), false, 'nobody talks to themselves');

-- ================= direct messages =================
set local role authenticated;
select pg_temp.act('55550000-0000-0000-0000-000000000007');
insert into ids values ('dm', chat_start_dm('55550000-0000-0000-0000-000000000008'));
select is(chat_start_dm('55550000-0000-0000-0000-000000000008'), (select v from ids where k = 'dm'), 'starting again returns the same conversation (no duplicates)');
select throws_ok($$select chat_start_dm('55550000-0000-0000-0000-000000000009')$$, '42501', null, 'a learner cannot start a conversation with a learner of another cohort');
insert into ids values ('direct', chat_start_dm('55550000-0000-0000-0000-000000000003'));
select is((select kind from connect_conversations where id = (select v from ids where k = 'direct')), 'direct', 'learner -> her trainer reuses DIRA Connect''s private conversation');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000007', 'Hi Lou, did you finish the brief?' from ids where k = 'dm'$$, 'she sends a message');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000007', 'Second message' from ids where k = 'dm'$$, 'and a second one');
select is((select count(*)::int from chat_contacts() where profile_id in ('55550000-0000-0000-0000-000000000008', '55550000-0000-0000-0000-000000000003', '55550000-0000-0000-0000-000000000002')), 3, 'her contacts include her cohort mate, her trainer and programme staff');
select is((select count(*)::int from chat_contacts() where profile_id in ('55550000-0000-0000-0000-000000000009', '55550000-0000-0000-0000-000000000004', '55550000-0000-0000-0000-000000000006', '55550000-0000-0000-0000-000000000010')), 0, 'but not other cohorts, their trainers, M&E or applicants');

select pg_temp.act('55550000-0000-0000-0000-000000000008');
select is((select title from chat_inbox() where conversation_id = (select v from ids where k = 'dm')), 'Lia Learner', 'Lou''s inbox shows the conversation under Lia''s name');
select is((select unread::int from chat_inbox() where conversation_id = (select v from ids where k = 'dm')), 2, '... with 2 unread messages');
select is((select can_post from chat_inbox() where conversation_id = (select v from ids where k = 'dm')), true, '... and she may reply');
select is((select count(*)::int from notifications where user_id = '55550000-0000-0000-0000-000000000008' and dedupe_key = 'conv:' || (select v from ids where k = 'dm')), 1, 'two messages give Lou ONE unread notification for the conversation');
select is((select link from notifications where user_id = '55550000-0000-0000-0000-000000000008' and kind = 'message'), '/chat?c=' || (select v from ids where k = 'dm'), 'the notification opens the conversation');
select is((select title from notifications where user_id = '55550000-0000-0000-0000-000000000008' and kind = 'message'), 'New message from Lia Learner', 'it says who wrote');
insert into ids select 'm1', id from chat_messages((select v from ids where k = 'dm')) where body like 'Hi Lou%';
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body, reply_to) select (select v from ids where k = 'dm'), '55550000-0000-0000-0000-000000000008', 'Yes, done!', (select v from ids where k = 'm1')$$, 'Lou replies to Lia''s message');
select is((select reply_body from chat_messages((select v from ids where k = 'dm')) where body = 'Yes, done!'), 'Hi Lou, did you finish the brief?', 'the reply carries a preview of the message it answers');
select is(chat_react((select v from ids where k = 'm1'), '👍'), true, 'Lou reacts with 👍');
select is((select (reactions->0->>'count')::int from chat_messages((select v from ids where k = 'dm')) where id = (select v from ids where k = 'm1')), 1, 'the reaction is counted');
select is(chat_react((select v from ids where k = 'm1'), '👍'), false, 'reacting again removes it');
select throws_ok($$select chat_react((select v from ids where k = 'm1'), '🍕')$$, null, null, 'only the offered emoji are accepted');
select is(chat_react((select v from ids where k = 'm1'), '🎉'), true, 'Lou reacts with 🎉');
select is((select count(*)::int from chat_read_state((select v from ids where k = 'dm'))), 0, 'Lia has not read yet: no read state');

select pg_temp.act('55550000-0000-0000-0000-000000000007');
select is((select count(*)::int from notifications where kind = 'reply'), 1, 'Lia is told about the reply');
select is((select count(*)::int from notifications where kind = 'reaction'), 1, 'and about the reaction');
select lives_ok($$select connect_mark_read((select v from ids where k = 'dm'))$$, 'Lia reads the conversation');
select pg_temp.act('55550000-0000-0000-0000-000000000008');
select is((select count(*)::int from chat_read_state((select v from ids where k = 'dm'))), 1, 'Lou sees when Lia read it (for the Seen tick)');
select is((select count(*)::int from chat_search('brief')), 1, 'Lou finds the message by searching');

select pg_temp.act('55550000-0000-0000-0000-000000000009');
select is((select count(*)::int from connect_messages where conversation_id = (select v from ids where k = 'dm')), 0, 'Leo (other cohort) cannot read their messages');
select is((select count(*)::int from chat_messages((select v from ids where k = 'dm'))), 0, '... not through chat_messages either');
select is((select count(*)::int from chat_search('brief')), 0, '... nor find them by searching');
select is((select count(*)::int from chat_read_state((select v from ids where k = 'dm'))), 0, '... nor see their read state');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000009', 'Intruding' from ids where k = 'dm'$$, null, null, 'Leo cannot write into their conversation');
select throws_ok($$select chat_react((select v from ids where k = 'm1'), '👍')$$, null, null, 'Leo cannot react in it');
select is((select count(*)::int from notifications where user_id = '55550000-0000-0000-0000-000000000008'), 0, 'Leo cannot read Lou''s notifications');
select is((select count(*)::int from connect_reactions), 0, 'nor the reactions of their conversation');

-- notifications: only the read time may change
select pg_temp.act('55550000-0000-0000-0000-000000000008');
select throws_ok($$update notifications set link = '/elsewhere' where user_id = '55550000-0000-0000-0000-000000000008'$$, null, 'Only the read time of a notification can be changed', 'the link of a notification cannot be changed');
select lives_ok($$update notifications set read_at = now() where user_id = '55550000-0000-0000-0000-000000000008' and kind = 'message'$$, 'Lou marks the notification as read');
select pg_temp.act('55550000-0000-0000-0000-000000000007');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000007', 'Third' from ids where k = 'dm'$$, 'Lia writes again');
select pg_temp.act('55550000-0000-0000-0000-000000000008');
select is((select count(*)::int from notifications where kind = 'message' and read_at is null), 1, 'after reading, a new message gives a new notification');

-- ================= groups =================
select pg_temp.act('55550000-0000-0000-0000-000000000007');
select throws_ok($$select chat_create_group('Study buddies', array['55550000-0000-0000-0000-000000000008']::uuid[])$$, '42501', null, 'learners cannot create groups');
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select throws_ok($$select chat_create_group('Mixed', array['55550000-0000-0000-0000-000000000009']::uuid[])$$, '42501', null, 'a trainer cannot add a learner from another cohort');
insert into ids values ('grp', chat_create_group('AI Tools study group', array['55550000-0000-0000-0000-000000000007', '55550000-0000-0000-0000-000000000004']::uuid[]));
select is((select member_count from chat_inbox() where conversation_id = (select v from ids where k = 'grp')), 3, 'Tina creates a group with Lia and Tom (3 members)');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000003', 'Welcome to the group' from ids where k = 'grp'$$, 'Tina posts in the group');
select is(chat_add_members((select v from ids where k = 'grp'), array['55550000-0000-0000-0000-000000000008']::uuid[]), 1, 'the owner adds Lou');
select pg_temp.act('55550000-0000-0000-0000-000000000008');
select is((select count(*)::int from notifications where kind = 'group' and link = '/chat?c=' || (select v from ids where k = 'grp')), 1, 'Lou is told she was added, with a link to the group');
select pg_temp.act('55550000-0000-0000-0000-000000000007');
select is((select count(*)::int from notifications where kind = 'group_message'), 1, 'Lia got a notification for the group message');
select throws_ok($$select chat_add_members((select v from ids where k = 'grp'), array['55550000-0000-0000-0000-000000000002']::uuid[])$$, '42501', null, 'a member who is not the owner cannot add people');
select throws_ok($$select chat_rename_group((select v from ids where k = 'grp'), 'Hijacked')$$, '42501', null, '... nor rename the group');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select v, '55550000-0000-0000-0000-000000000007', 'Thanks!' from ids where k = 'grp'$$, 'a learner member writes in the group');
select lives_ok($$select chat_remove_member((select v from ids where k = 'grp'), '55550000-0000-0000-0000-000000000007')$$, 'Lia leaves the group');
select is((select count(*)::int from connect_messages where conversation_id = (select v from ids where k = 'grp')), 0, 'after leaving she no longer sees it');
select pg_temp.act('55550000-0000-0000-0000-000000000009');
select is((select count(*)::int from chat_inbox() where conversation_id = (select v from ids where k = 'grp')), 0, 'Leo never sees the group');
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select throws_ok($$select chat_remove_member((select v from ids where k = 'grp'), '55550000-0000-0000-0000-000000000003')$$, null, 'Hand the group to another owner before leaving', 'the only owner cannot leave while members remain');

-- ================= attachments: formats and sizes =================
select lives_ok($$insert into connect_messages(id, conversation_id, sender_id, body) select '55553333-0000-0000-0000-000000000001', v, '55550000-0000-0000-0000-000000000003', 'Video lesson' from ids where k = 'grp'$$, 'a message for attachments');
reset role;
insert into storage.objects(bucket_id, name, owner, metadata)
select 'connect-attachments', v || '/55550000-0000-0000-0000-000000000003/' || f, '55550000-0000-0000-0000-000000000003', jsonb_build_object('size', sz, 'mimetype', mt)
from ids, (values ('lesson.mp4', 40000000, 'video/mp4'), ('x.svg', 1000, 'image/svg+xml'), ('big.webm', 30000000, 'audio/webm')) f(f, sz, mt) where k = 'grp';
set local role authenticated;
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select lives_ok($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select '55553333-0000-0000-0000-000000000001', v, v || '/55550000-0000-0000-0000-000000000003/lesson.mp4', 'lesson.mp4', 'video/mp4', 40000000, '55550000-0000-0000-0000-000000000003' from ids where k = 'grp'$$, 'a 40 MB MP4 video is accepted');
select throws_ok($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select '55553333-0000-0000-0000-000000000001', v, v || '/55550000-0000-0000-0000-000000000003/x.svg', 'x.svg', 'image/svg+xml', 1000, '55550000-0000-0000-0000-000000000003' from ids where k = 'grp'$$, '22023', 'This file type is not accepted', 'an SVG image is refused');
select throws_ok($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select '55553333-0000-0000-0000-000000000001', v, v || '/55550000-0000-0000-0000-000000000003/big.webm', 'big.webm', 'audio/webm', 30000000, '55550000-0000-0000-0000-000000000003' from ids where k = 'grp'$$, '22023', 'The file is larger than allowed for its type', 'a 30 MB audio file is refused (limit 20 MB)');
select is((select attachments->0->>'mime' from chat_messages((select v from ids where k = 'grp')) where id = '55553333-0000-0000-0000-000000000001'), 'video/mp4', 'the attachment is listed with its message');
update chat_file_rules set max_bytes = 1 where mime_type = 'video/mp4';
select is((select max_bytes from chat_file_rules where mime_type = 'video/mp4'), 52428800::bigint, 'a trainer cannot change the file limits');
select pg_temp.act('55550000-0000-0000-0000-000000000001');
select lives_ok($$update chat_file_rules set max_bytes = 31457280 where mime_type = 'audio/webm'$$, 'an executive can change a limit');

-- ================= announcements =================
select pg_temp.act('55550000-0000-0000-0000-000000000007');
select throws_ok($$insert into announcements(title, body) values ('Learner news', 'Hello')$$, '42501', null, 'learners cannot publish announcements');
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select lives_ok($$insert into announcements(id, title, body, audience, cohort_id) values ('55554444-0000-0000-0000-000000000001', 'Week 1 notes', 'See the slides attached.', 'cohort', '55552222-0000-0000-0000-000000000001')$$, 'a trainer publishes to her cohort');
select throws_ok($$insert into announcements(title, body) values ('To everyone', 'x')$$, '42501', null, 'a trainer cannot publish to everyone');
select throws_ok($$insert into announcements(title, body, audience, cohort_id) values ('Other cohort', 'x', 'cohort', '55552222-0000-0000-0000-000000000002')$$, '42501', null, '... nor to another trainer''s cohort');
select lives_ok($$insert into announcements(id, title, body, audience, track_id) values ('55554444-0000-0000-0000-000000000002', 'AI Tools track update', 'New exercise.', 'track', (select id from tracks where name = 'AI Tools'))$$, 'a trainer publishes to the track she teaches');
select lives_ok($$insert into announcement_attachments(announcement_id, storage_path, file_name, mime_type, size_bytes) values ('55554444-0000-0000-0000-000000000001', '55554444-0000-0000-0000-000000000001/slides.pptx', 'slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2000000)$$, 'she attaches slides');
select throws_ok($$insert into announcement_attachments(announcement_id, storage_path, file_name, mime_type, size_bytes) values ('55554444-0000-0000-0000-000000000001', 'elsewhere/slides.pdf', 'slides.pdf', 'application/pdf', 2000)$$, null, null, 'a file must be stored under its announcement');
select is(ann_file_upload_ok('55554444-0000-0000-0000-000000000001/notes.pdf'), true, 'the author may upload into the announcement''s folder');
select pg_temp.act('55550000-0000-0000-0000-000000000005');
select lives_ok($$insert into announcements(title, body, audience, cohort_id) values ('Mentoring hours', 'Thursday 4pm', 'cohort', '55552222-0000-0000-0000-000000000001')$$, 'a mentor publishes to a cohort where she mentors');
select throws_ok($$insert into announcements(title, body, audience, cohort_id) values ('x', 'x', 'cohort', '55552222-0000-0000-0000-000000000002')$$, '42501', null, '... but not to another cohort');
select throws_ok($$insert into announcement_attachments(announcement_id, storage_path, file_name, mime_type, size_bytes) values ('55554444-0000-0000-0000-000000000001', '55554444-0000-0000-0000-000000000001/mine.pdf', 'mine.pdf', 'application/pdf', 2000)$$, null, null, 'only the author attaches files to an announcement');
select is(ann_file_upload_ok('55554444-0000-0000-0000-000000000001/x.pdf'), false, '... and only the author may upload into its folder');
select pg_temp.act('55550000-0000-0000-0000-000000000006');
select lives_ok($$insert into announcements(id, title, body, pinned) values ('55554444-0000-0000-0000-000000000003', 'Programme survey', 'Please answer by Friday.', true)$$, 'an M&E officer publishes to everyone, pinned');

select pg_temp.act('55550000-0000-0000-0000-000000000007');
select is((select count(*)::int from notifications where kind = 'announcement' and link = '/chat?a=55554444-0000-0000-0000-000000000001'), 1, 'Lia (cohort 1) is notified, with a link that opens the announcement');
select is((select id from ann_feed() limit 1), '55554444-0000-0000-0000-000000000003'::uuid, 'the pinned announcement is first in the feed');
select is((select author_name from ann_feed() where id = '55554444-0000-0000-0000-000000000001'), 'Tina One', 'the feed shows who posted');
select is((select jsonb_array_length(attachments) from ann_feed() where id = '55554444-0000-0000-0000-000000000001'), 1, 'and the attached slides');
select is(ann_file_read_ok('55554444-0000-0000-0000-000000000001/slides.pptx'), true, 'Lia may download the slides');
select is(ann_react('55554444-0000-0000-0000-000000000001', '👏'), true, 'Lia reacts with 👏');
update announcements set title = 'Changed by a learner' where id = '55554444-0000-0000-0000-000000000001';
select is((select title from announcements where id = '55554444-0000-0000-0000-000000000001'), 'Week 1 notes', 'learners cannot edit announcements');
select is((select count(*)::int from announcements where id = '55554444-0000-0000-0000-000000000002'), 0, 'Lia is not in the AI Tools track: she does not see its announcement');
select pg_temp.act('55550000-0000-0000-0000-000000000011');
select is((select count(*)::int from announcements where id = '55554444-0000-0000-0000-000000000002'), 1, 'Ida, imported into the AI Tools track (no cohort yet), sees it');
select is((select count(*)::int from notifications where link = '/chat?a=55554444-0000-0000-0000-000000000002'), 1, '... and was notified');
select pg_temp.act('55550000-0000-0000-0000-000000000009');
select is((select count(*)::int from announcements where id = '55554444-0000-0000-0000-000000000001'), 0, 'Leo (cohort 2) does not see cohort 1''s announcement');
select is(ann_file_read_ok('55554444-0000-0000-0000-000000000001/slides.pptx'), false, '... nor download its files');
select throws_ok($$select ann_react('55554444-0000-0000-0000-000000000001', '👍')$$, null, null, '... nor react to it');
select is((select count(*)::int from announcement_attachments), 0, '... nor list its attachments');
select pg_temp.act('55550000-0000-0000-0000-000000000004');
update announcements set title = 'Not mine' where id = '55554444-0000-0000-0000-000000000001';
select is((select count(*)::int from announcements where title = 'Not mine'), 0, 'another trainer cannot edit it');
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select lives_ok($$update announcements set body = 'See the corrected slides attached.' where id = '55554444-0000-0000-0000-000000000001'$$, 'the author edits her announcement');
select isnt((select edited_at from announcements where id = '55554444-0000-0000-0000-000000000001'), null::timestamptz, 'it is marked as edited');
select pg_temp.act('55550000-0000-0000-0000-000000000008');
select is((select count(*)::int from notifications where dedupe_key = 'ann-update:55554444-0000-0000-0000-000000000001'), 1, 'Lou is told about the update');
select pg_temp.act('55550000-0000-0000-0000-000000000001');
delete from announcements where id = '55554444-0000-0000-0000-000000000002';
select is((select count(*)::int from announcements where id = '55554444-0000-0000-0000-000000000002'), 0, 'an executive can delete an announcement');

-- ================= Google Calendar queue =================
reset role;
insert into session_schedules(id, cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at, venue)
values ('55556666-0000-0000-0000-000000000001', '55552222-0000-0000-0000-000000000001', (select id from curriculum_sessions limit 1), null,
        now() + interval '2 days', now() + interval '2 days 2 hours', 'Nairobi hub');
select is((select operation || '/' || state || '/' || google_event_id from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'),
          'upsert/pending/dira55556666000000000000000000000001', 'a new session is queued for Google Calendar with a fixed event id');
update session_schedules set venue = 'Room 2' where id = '55556666-0000-0000-0000-000000000001';
select is((select count(*)::int from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'), 1, 'an edit keeps one queue row (no duplicates)');
set local role service_role;
select is((select title from gcal_claim(10) where schedule_id = '55556666-0000-0000-0000-000000000001'), 'DIRA LEARN: ' || (select title from curriculum_sessions limit 1) || ' (Chat one)', 'the sync function claims it with the event details');
select lives_ok($$select gcal_record('55556666-0000-0000-0000-000000000001', false, 'Google said 503')$$, 'a failure is recorded');
select is((select state || '/' || attempts || '/' || (next_attempt_at > now()) from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'), 'pending/1/true', '... and retried later with a back-off');
update gcal_events set next_attempt_at = now() - interval '1 minute' where schedule_id = '55556666-0000-0000-0000-000000000001';
select is((select count(*)::int from gcal_claim(10)), 1, 'it is claimed again when due');
select lives_ok($$select gcal_record('55556666-0000-0000-0000-000000000001', true)$$, 'success is recorded');
select is((select state from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'), 'synced', 'the session is synced');
reset role;
update session_schedules set status = 'cancelled' where id = '55556666-0000-0000-0000-000000000001';
select is((select operation || '/' || state from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'), 'delete/pending', 'cancelling the session queues removal from Google Calendar');
update gcal_events set state = 'failed', attempts = 8 where schedule_id = '55556666-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.act('55550000-0000-0000-0000-000000000007');
select is((select count(*)::int from gcal_events), 0, 'learners do not see the sync queue');
select throws_ok($$select gcal_retry_failed()$$, '42501', null, 'learners cannot retry syncs');
select throws_ok($$select gcal_claim(1)$$, '42501', null, 'signed-in users cannot claim the queue');
select pg_temp.act('55550000-0000-0000-0000-000000000003');
select is(gcal_retry_failed(), 1, 'a trainer retries the failed sync');
reset role;
delete from session_schedules where id = '55556666-0000-0000-0000-000000000001';
select is((select operation from gcal_events where schedule_id = '55556666-0000-0000-0000-000000000001'), 'delete', 'deleting the session queues removal too');

-- ================= platform =================
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'), 'notifications are sent live (Realtime)');
select is((select count(*)::int from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'), 0, 'signed-out visitors still have no table access');

select * from finish();
rollback;
