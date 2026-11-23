-- pgTAP tests for migration 25 (DIRA Connect: facilitator-started conversations, closed-access support, safeguarding-team
-- conversations, attachments, retention and legal holds). LOCAL database only. Everything rolls back.
begin;
select plan(75);

create function _u(n int) returns uuid language sql immutable as $$ select ('55550000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _p(n int) returns uuid language sql immutable as $$ select ('55551111-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _c(n int) returns uuid language sql immutable as $$ select ('5555aaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _as(n int) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', _u(n), 'role', 'authenticated')::text, true) $$;
create function _rows(q text) returns int language plpgsql as $f$ declare k int; begin execute q; get diagnostics k = row_count; return k; end $f$;
create function _disc(cohort uuid) returns uuid language sql security definer as $$ select id from connect_conversations where kind = 'cohort' and cohort_id = cohort $$;
grant execute on function _u(int), _p(int), _c(int), _as(int), _rows(text), _disc(uuid) to authenticated, service_role;

-- ---------- fixtures ----------
-- 1 founder, 2 co-founder, 3 director (Lead), 4 coordinator (Deputy), 5 trainer cohort A, 6 trainer cohort B,
-- 7 Lia (A, active), 8 Lou (A, access scheduled), 9 Leo (B, active), 10 Sue (A, suspended), 11 Old (cohort Z ended 14 months ago), 12 trainer Z
insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp' || n || '@cp.test' from generate_series(1, 12) n;
update profiles set role='founder', status='active', first_name='Fay', last_name='Founder' where id = _u(1);
update profiles set role='co_founder', status='active', first_name='Cal', last_name='Cofounder' where id = _u(2);
update profiles set role='programme_director', status='active', first_name='Dee', last_name='Director' where id = _u(3);
update profiles set role='programme_coordinator', status='active', first_name='Cora', last_name='Coord' where id = _u(4);
update profiles set role='trainer', status='active', first_name='Tina', last_name='Trainer' where id in (_u(5));
update profiles set role='trainer', status='active', first_name='Tom', last_name='Other' where id in (_u(6));
update profiles set role='trainer', status='active', first_name='Zed', last_name='Trainer' where id in (_u(12));
update profiles p set role='participant', status='active', first_name='L' || g.n, last_name='Learner' from generate_series(7, 11) g(n) where p.id = _u(g.n);
insert into participants(id, profile_id, participant_no) select _p(n), _u(n), 'CP-' || n from generate_series(7, 11) n;
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at) values
  ('55552222-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','Cohort A', current_date - 3, current_date + 30, 10, now() - interval '3 days', null),
  ('55552222-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000a1','Cohort B', current_date - 3, current_date + 30, 10, now() - interval '3 days', null),
  ('55552222-0000-0000-0000-00000000000f','00000000-0000-0000-0000-0000000000a1','Cohort Z', current_date - 500, (current_date - interval '14 months')::date, 10, now() - interval '500 days', now() - interval '14 months');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('55552222-0000-0000-0000-00000000000a', _p(7)), ('55552222-0000-0000-0000-00000000000a', _p(8)), ('55552222-0000-0000-0000-00000000000b', _p(9)),
  ('55552222-0000-0000-0000-00000000000a', _p(10)), ('55552222-0000-0000-0000-00000000000f', _p(11));
insert into trainer_assignments(cohort_id, trainer_id) values
  ('55552222-0000-0000-0000-00000000000a', _u(5)), ('55552222-0000-0000-0000-00000000000b', _u(6)), ('55552222-0000-0000-0000-00000000000f', _u(12));
insert into learner_access(participant_id, cohort_id, opens_at_override) values (_p(8), '55552222-0000-0000-0000-00000000000a', now() + interval '10 days');
insert into learner_access(participant_id, cohort_id, suspended) values (_p(10), '55552222-0000-0000-0000-00000000000a', true);
insert into connect_conversations(id, kind, learner_id, facilitator_id) values (_c(1), 'direct', _p(7), _u(5));

set local role authenticated;

-- ---------- 1. facilitators may start conversations ----------
select _as(5);
select is((select count(*)::int from connect_my_learners()), 3, 'a facilitator lists the learners of her cohort (including those with closed access)');
select is(connect_start_direct_with_learner(_p(7))::text, _c(1)::text, 'starting again with Lia reopens the same conversation');
select throws_ok($$select connect_start_direct_with_learner(_p(9))$$, null, 'You can only message learners in a cohort you are assigned to', 'a facilitator cannot message another cohort''s learner');
select lives_ok($$select connect_start_direct_with_learner(_p(8))$$, 'a facilitator starts a conversation with Lou');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, _u(5), 'Hi Lou, checking in before your start date' from connect_conversations where kind = 'direct' and learner_id = _p(8)$$, 'and writes first');
select _as(7);
select throws_ok($$select connect_start_direct_with_learner(_p(7))$$, null, 'Only facilitators can start a conversation with a learner', 'learners cannot use the facilitator''s start function');
select is((select count(*)::int from connect_my_learners()), 0, 'and see no learner list');
select _as(1);
select throws_ok($$select connect_start_direct_with_learner(_p(7))$$, null, null, 'executives cannot start private conversations with learners');

-- ---------- 2. closed access keeps support messaging only ----------
select _as(8);
select is((select status::text from my_learning_access()), 'scheduled', 'Lou''s learning access is not open yet');
select is((select count(*)::int from connect_threads() where kind = 'direct'), 1, 'but she sees her facilitator''s message');
select is((select learning_access_open from connect_my_support()), false, 'the screen is told her learning access is closed');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, _u(8), 'Thank you, I have a question about my laptop' from connect_conversations where kind = 'direct' and learner_id = _p(8)$$, 'and she can reply');
select is((select count(*)::int from connect_my_facilitators()), 1, 'she can see her assigned facilitator');
select is((select count(*)::int from connect_threads() where kind = 'cohort'), 0, 'but the cohort discussion stays closed');
select throws_ok($$insert into connect_messages(conversation_id, sender_id, body) values (_disc('55552222-0000-0000-0000-00000000000a'), _u(8), 'Early post')$$, null, null, 'and she cannot post in it');
select is((select count(*)::int from assignments), 0, 'learning materials stay closed');
select _as(10);
select lives_ok($$select connect_start_direct(_u(5))$$, 'a suspended learner can still contact her facilitator for support');
select _as(11);
select is((select status::text from my_learning_access()), 'expired', 'a learner from a finished cohort has expired access');
select lives_ok($$select connect_start_direct(_u(12))$$, 'and can still contact her facilitator');
select _as(7);
select is((select count(*)::int from connect_threads() where kind = 'cohort'), 1, 'an active learner still sees her cohort discussion');

-- ---------- 3. the safeguarding team conversation ----------
select is((select safeguarding_available from connect_my_support()), false, 'before officers are appointed the safeguarding team is not offered');
select throws_ok($$select connect_start_safeguarding()$$, null, 'The safeguarding team has not been set up yet. Please speak to your facilitator or contact DIRA Foundation directly', 'and cannot be messaged');
select _as(1);
select lives_ok($$select sg_appoint('lead', _u(3), 'Board resolution 12: interim Safeguarding Lead')$$, 'the Founder appoints the Lead');
select _as(2);
select lives_ok($$select sg_appoint('deputy', _u(4), 'Board resolution 12: Safeguarding Deputy')$$, 'the Co-Founder appoints the Deputy');
select _as(8);
select is((select safeguarding_available from connect_my_support()), true, 'now Lou (access closed) is offered the safeguarding team');
select lives_ok($$select connect_start_safeguarding()$$, 'she opens a conversation with the safeguarding team');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, _u(8), 'Someone in my cohort is making me uncomfortable' from connect_conversations where kind = 'safeguarding' and learner_id = _p(8)$$, 'and writes to them');
select is((select title from connect_threads() where kind = 'safeguarding'), 'Safeguarding team', 'she sees it as "Safeguarding team"');
select throws_ok($$select connect_report_message((select id from connect_messages where body like 'Someone in my%'), 'other', null)$$, null, null, 'safeguarding conversations are never sent to moderators');
reset role;
select is((select count(*)::int from notifications where user_id = _u(3) and kind = 'safeguarding' and title = 'A learner has sent a message to the safeguarding team'), 1, 'the acting officer (the Lead) is alerted, without details');
set local role authenticated;
select _as(3);
select is((select count(*)::int from connect_threads() where kind = 'safeguarding'), 1, 'the Lead sees the conversation');
select is((select title from connect_threads() where kind = 'safeguarding'), 'L8 Learner', 'with the learner''s name');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, _u(3), 'Thank you for telling us. Can we talk tomorrow at 10?' from connect_conversations where kind = 'safeguarding' and learner_id = _p(8)$$, 'the Lead replies');
select _as(4);
select is((select count(*)::int from connect_messages m join connect_conversations c on c.id = m.conversation_id where c.kind = 'safeguarding'), 2, 'the Deputy can read it too');
select _as(8);
select is((select sender_role from connect_thread_messages((select id from connect_conversations where kind = 'safeguarding' and learner_id = _p(8))) where not mine), 'Safeguarding team', 'Lou sees the reply as from the safeguarding team');
select _as(1);
select is((select count(*)::int from connect_messages m join connect_conversations c on c.id = m.conversation_id where c.kind = 'safeguarding'), 0, 'executives cannot read safeguarding conversations');
select _as(2);
select lives_ok($$insert into connect_oversight(profile_id, scope, reason) values (_u(1), 'private', 'Reviewer for reported private conversations')$$, 'a co-founder grants the Founder private oversight');
select _as(1);
select throws_ok($$select * from connect_oversight_read((select id from connect_conversations where kind = 'safeguarding' limit 1), 'Trying to read the safeguarding team')$$, null, 'Not a private conversation', 'even private oversight cannot open a safeguarding conversation');
select _as(5);
select is((select count(*)::int from connect_conversations where kind = 'safeguarding'), 0, 'the facilitator cannot see it');
select _as(7);
select is((select count(*)::int from connect_conversations where kind = 'safeguarding'), 0, 'another learner cannot see it');

-- ---------- 4. attachments ----------
select _as(7);
select lives_ok(format($$insert into storage.objects(bucket_id, name, metadata) values ('connect-attachments', '%s/%s/plan.pdf', '{"size": 2048, "mimetype": "application/pdf"}')$$, _c(1), _u(7)), 'Lia uploads a PDF into her own folder of her conversation');
select throws_ok(format($$insert into storage.objects(bucket_id, name, metadata) values ('connect-attachments', '%s/%s/x.pdf', '{"size": 10, "mimetype": "application/pdf"}')$$, _c(1), _u(5)), null, null, 'she cannot upload into someone else''s folder');
select throws_ok(format($$insert into storage.objects(bucket_id, name, metadata) values ('connect-attachments', '%s/%s/x.pdf', '{"size": 10, "mimetype": "application/pdf"}')$$, (select id from connect_conversations where kind = 'direct' and learner_id = _p(8)), _u(7)), null, null, 'or into a conversation she is not in');
select lives_ok($$insert into connect_messages(id, conversation_id, sender_id, body) values ('5555bbbb-0000-0000-0000-000000000001', _c(1), _u(7), 'Here is my plan')$$, 'she sends a message');
select lives_ok(format($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('5555bbbb-0000-0000-0000-000000000001', '%s', '%s/%s/plan.pdf', 'plan.pdf', 'application/pdf', 1, '%s')$$, _c(1), _c(1), _u(7), _u(7)), 'and attaches the file');
select is((select size_bytes::int from connect_attachments where file_name = 'plan.pdf'), 2048, 'the size is taken from what Storage recorded, not from the attachment row');
select is((select jsonb_array_length(attachments) from connect_thread_messages(_c(1)) where id = '5555bbbb-0000-0000-0000-000000000001'), 1, 'the message lists its attachment');
select lives_ok(format($$insert into storage.objects(bucket_id, name, metadata) values ('connect-attachments', '%s/%s/tool.exe', '{"size": 100, "mimetype": "application/x-msdownload"}')$$, _c(1), _u(7)), '(the storage bucket itself refuses .exe in Supabase; here the row is created to test the database check)');
select throws_ok(format($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('5555bbbb-0000-0000-0000-000000000001', '%s', '%s/%s/tool.exe', 'tool.pdf', 'application/pdf', 1, '%s')$$, _c(1), _c(1), _u(7), _u(7)), null,
  'Only PDF, Word, Excel, PowerPoint, JPG and PNG files can be attached', 'a file whose recorded type is not allowed is refused, whatever name or type the attachment row claims');
select lives_ok(format($$insert into storage.objects(bucket_id, name, metadata) values ('connect-attachments', '%s/%s/huge.pdf', '{"size": 20000000, "mimetype": "application/pdf"}')$$, _c(1), _u(7)), '(an oversized object, to test the database check)');
select throws_ok(format($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('5555bbbb-0000-0000-0000-000000000001', '%s', '%s/%s/huge.pdf', 'huge.pdf', 'application/pdf', 1, '%s')$$, _c(1), _c(1), _u(7), _u(7)), null,
  'Files can be at most 10 MB', 'files over 10 MB are refused');
select _as(5);
-- Updated for migration 29: nothing can be downloaded until a virus scanner marks it clean.
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments' and name like '%plan.pdf'), 0, 'while the virus check is pending, even the facilitator in the conversation cannot open the file');
select is((select count(*)::int from connect_attachments where file_name = 'plan.pdf'), 1, 'but she can see that it was shared');
reset role;
update connect_attachments set scan_status = 'clean' where file_name = 'plan.pdf';
set local role authenticated;
select _as(5);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments' and name like '%plan.pdf'), 1, 'once scanned clean, the facilitator in the conversation can open the file');
select throws_ok(format($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ('5555bbbb-0000-0000-0000-000000000001', '%s', '%s/%s/plan.pdf', 'again.pdf', 'application/pdf', 1, '%s')$$, _c(1), _c(1), _u(7), _u(5)), null, null, 'nobody can attach files to someone else''s message');
select _as(9);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'a learner outside the conversation cannot open any file');
select is((select count(*)::int from connect_attachments), 0, 'or see the attachment list');
select _as(6);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'nor can another cohort''s facilitator');
reset role;
update connect_attachments set scan_status = 'infected' where file_name = 'plan.pdf';
set local role authenticated;
select _as(5);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments' and name like '%plan.pdf'), 0, 'a file marked infected by a scanner is blocked for everyone');
reset role;
update connect_attachments set scan_status = 'clean' where file_name = 'plan.pdf';
set local role authenticated;

-- ---------- 5. retention and legal holds ----------
-- Old (11) has a conversation with Zed in a cohort that ended 14 months ago; add messages to it and a second, reported one.
reset role;
select set_config('request.jwt.claims', '', true);
insert into connect_messages(conversation_id, sender_id, body) select id, _u(11), 'Old question from last year' from connect_conversations where kind = 'direct' and learner_id = _p(11);
insert into connect_conversations(id, kind, cohort_id) select _c(90), 'cohort', '55552222-0000-0000-0000-00000000000f' where not exists (select 1 from connect_conversations where kind = 'cohort' and cohort_id = '55552222-0000-0000-0000-00000000000f');
insert into connect_messages(conversation_id, sender_id, body) select id, _u(12), 'Final session notes' from connect_conversations where kind = 'cohort' and cohort_id = '55552222-0000-0000-0000-00000000000f';
set local role authenticated;
select _as(1);
select is((select count(*)::int from connect_retention_status() where due and not held), 2, 'executives see two conversations past the 12-month period and not protected');
select is((select count(*)::int from connect_retention_status() where kind = 'safeguarding' and held), 1, 'the safeguarding conversation is always protected');
select _as(7);
select is((select count(*)::int from connect_retention_status()), 0, 'learners cannot see the retention list');
select is(_rows($$update connect_retention_settings set enabled = true$$), 0, 'learners cannot switch retention on');

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from connect_retention_purge()), 0, 'while retention is OFF (the default) the job deletes nothing');
reset role;
select is((select count(*)::int from connect_messages where body in ('Old question from last year', 'Final session notes')), 2, 'and the old messages are still there');
set local role authenticated;

select _as(3);
select lives_ok($$select connect_place_hold(null, null, '55552222-0000-0000-0000-00000000000f', 'Complaint received about cohort Z, keep everything')$$, 'the Safeguarding Lead places a legal hold on cohort Z');
select _as(1);
select is((select count(*)::int from connect_retention_status() where due and not held), 0, 'the hold protects both old conversations');
select lives_ok($$select connect_release_hold((select id from connect_legal_holds limit 1), 'Complaint closed with no further action')$$, 'the hold is released with a reason');
select lives_ok($$update connect_retention_settings set enabled = true$$, 'an executive switches retention on');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$select * from connect_retention_purge()$$, 'the scheduled job runs');
reset role;
select is((select count(*)::int from connect_messages where body in ('Old question from last year', 'Final session notes')), 0, 'messages 12 months after the cohort ended are deleted');
select ok((select count(*) from connect_messages where conversation_id = _c(1)) >= 1, 'current conversations are untouched');
select ok((select count(*) from connect_messages m join connect_conversations c on c.id = m.conversation_id where c.kind = 'safeguarding') = 2, 'safeguarding conversations are untouched');
select is((select conversations from connect_retention_log), 2, 'the run is logged (counts only)');
select throws_ok($$delete from connect_messages$$, null, 'Messages cannot be deleted', 'outside the retention job, messages still cannot be deleted');

select * from finish();
rollback;
