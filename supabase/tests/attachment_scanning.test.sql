-- pgTAP tests for migration 29 (attachments: no download until scanned clean). LOCAL database only. Everything rolls back.
begin;
select plan(31);

create function _u(n int) returns uuid language sql immutable as $$ select ('77770000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _as(n int) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', _u(n), 'role', 'authenticated')::text, true) $$;
create function _svc() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
create function _rows(q text) returns int language plpgsql as $f$ declare k int; begin execute q; get diagnostics k = row_count; return k; end $f$;
grant execute on function _u(int), _as(int), _svc(), _rows(text) to authenticated, service_role;

-- 1 founder (moderator), 2 co-founder, 3 trainer, 4 Lia, 5 Leo (other cohort)
insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'as' || n || '@as.test' from generate_series(1, 5) n;
update profiles set role = 'founder', status = 'active', first_name = 'Fay', last_name = 'F' where id = _u(1);
update profiles set role = 'co_founder', status = 'active', first_name = 'Cal', last_name = 'C' where id = _u(2);
update profiles set role = 'trainer', status = 'active', first_name = 'Tina', last_name = 'T' where id = _u(3);
update profiles set role = 'participant', status = 'active', first_name = 'Lia', last_name = 'L' where id = _u(4);
update profiles set role = 'participant', status = 'active', first_name = 'Leo', last_name = 'L' where id = _u(5);
insert into participants(id, profile_id, participant_no) values ('77771111-0000-0000-0000-000000000004', _u(4), 'AS-4'), ('77771111-0000-0000-0000-000000000005', _u(5), 'AS-5');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('77772222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'AS one', current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('77772222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'AS two', current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values ('77772222-0000-0000-0000-000000000001', '77771111-0000-0000-0000-000000000004'), ('77772222-0000-0000-0000-000000000002', '77771111-0000-0000-0000-000000000005');
insert into trainer_assignments(cohort_id, trainer_id) values ('77772222-0000-0000-0000-000000000001', _u(3));
insert into connect_conversations(id, kind, learner_id, facilitator_id) values ('7777aaaa-0000-0000-0000-000000000001', 'direct', '77771111-0000-0000-0000-000000000004', _u(3));

set local role authenticated;
select _as(4);
-- Lia shares three files in one message (the browser uploads them, then links them to the message)
insert into storage.objects(bucket_id, name, metadata) select 'connect-attachments', '7777aaaa-0000-0000-0000-000000000001/' || _u(4) || '/' || f, '{"size": 1000, "mimetype": "application/pdf"}'
  from unnest(array['a-good.pdf', 'b-flaky.pdf', 'c-bad.pdf']) f;
insert into connect_messages(id, conversation_id, sender_id, body) values ('7777bbbb-0000-0000-0000-000000000001', '7777aaaa-0000-0000-0000-000000000001', _u(4), 'Three files');
select lives_ok($$insert into connect_attachments(message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, scan_status)
  select '7777bbbb-0000-0000-0000-000000000001', '7777aaaa-0000-0000-0000-000000000001', '7777aaaa-0000-0000-0000-000000000001/' || _u(4) || '/' || f, f, 'application/pdf', 1, _u(4), 'clean'
  from unnest(array['a-good.pdf', 'b-flaky.pdf', 'c-bad.pdf']) f$$, 'Lia attaches three files (and tries to mark them clean herself)');

-- ---------- 1. nothing can be opened before the virus check ----------
select is((select string_agg(distinct scan_status, ',') from connect_attachments), 'pending', 'every new file starts as pending, whatever the browser sent');
select is((select count(*)::int from connect_attachments), 3, 'Lia sees that her files were shared');
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'but not even the uploader can download them yet');
select is((select attachments -> 0 ->> 'scan' from connect_thread_messages('7777aaaa-0000-0000-0000-000000000001') where id = '7777bbbb-0000-0000-0000-000000000001'), 'pending', 'the conversation shows them as waiting for a virus check');
-- since migration 38 the command is not granted at all (no RLS policy allows it), so the database refuses it outright
select throws_ok($$update connect_attachments set scan_status = 'clean'$$, '42501', null, 'users cannot mark files clean');
select throws_ok($$select * from connect_claim_scans(5)$$, '42501', null, 'users cannot run the scan queue');
select throws_ok($$select connect_record_scan((select id from connect_attachments limit 1), 'clean')$$, '42501', null, 'or record scan results');
select _as(3);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'the facilitator cannot download pending files either');
select _as(1);
select is((select pending from connect_scan_queue()), 3, 'executives see how many files are waiting (to notice when no scanner is set up)');
select _as(4);
select is((select pending from connect_scan_queue()), 0, 'learners see no queue figures');

-- ---------- 2. the scan job (service role) ----------
reset role;
set local role service_role;
select _svc();
select is((select count(*)::int from connect_claim_scans(10)), 3, 'the job claims the three waiting files');
select is((select count(*)::int from connect_claim_scans(10)), 0, 'a claimed file is not handed out twice');
select is(connect_record_scan((select id from connect_attachments where file_name = 'a-good.pdf'), 'clean', 'test-engine', null), 'clean', 'file a is clean');
select is(connect_record_scan((select id from connect_attachments where file_name = 'c-bad.pdf'), 'infected', 'test-engine', 'Eicar-Test-Signature'), 'infected', 'file c is infected');
select is(connect_record_scan((select id from connect_attachments where file_name = 'b-flaky.pdf'), 'error', 'test-engine', 'timeout'), 'pending', 'a scanner error puts file b back in the queue');
select is((select count(*)::int from connect_claim_scans(10)), 1, 'file b is claimed again');
select is(connect_record_scan((select id from connect_attachments where file_name = 'b-flaky.pdf'), 'error', 'test-engine', 'timeout'), 'pending', 'second error: still queued');
select is((select count(*)::int from connect_claim_scans(10)), 1, 'claimed a third time');
select is(connect_record_scan((select id from connect_attachments where file_name = 'b-flaky.pdf'), 'error', 'test-engine', 'timeout'), 'scan_failed', 'after three errors the file is marked scan_failed');
select is((select count(*)::int from connect_claim_scans(10)), 0, 'and is no longer retried');
select throws_ok($$select connect_record_scan((select id from connect_attachments where file_name = 'a-good.pdf'), 'probably fine')$$, null, 'Result must be clean, infected or error', 'only the three results are accepted');

-- ---------- 3. after the check ----------
reset role;
set local role authenticated;
select _as(3);
select is((select string_agg(storage.filename(name), ',') from storage.objects where bucket_id = 'connect-attachments'), 'a-good.pdf', 'the facilitator can now download the clean file, and only that one');
select _as(4);
select is((select string_agg(file_name, ',' order by file_name) from connect_attachments), 'a-good.pdf,b-flaky.pdf', 'the infected file disappears from the conversation');
select is((select count(*)::int from notifications where user_id = _u(4) and title = 'A file you shared was blocked'), 1, 'and the sender is told it was blocked');
select is((select count(*)::int from connect_attachment_scans), 0, 'learners cannot read the scan log');
select _as(5);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'someone outside the conversation still cannot download the clean file');
select _as(1);
select is((select count(*)::int from connect_attachment_scans), 5, 'moderators and executives can read every scan result');
select is((select clean || '/' || infected || '/' || scan_failed from connect_scan_queue()), '1/1/1', 'the queue summary adds up');

-- ---------- 4. an abandoned claim is picked up again ----------
reset role;
select set_config('request.jwt.claims', '', true);
update connect_attachments set scan_status = 'scanning', scan_claimed_at = now() - interval '20 minutes', scan_attempts = 1 where file_name = 'a-good.pdf';
set local role service_role;
select _svc();
select is((select storage_path like '%a-good.pdf' from connect_claim_scans(10)), true, 'a claim older than 15 minutes (a crashed job) is handed out again');
reset role;
set local role authenticated;
select _as(3);
select is((select count(*)::int from storage.objects where bucket_id = 'connect-attachments'), 0, 'while it is being re-scanned it cannot be downloaded');

select * from finish();
rollback;
