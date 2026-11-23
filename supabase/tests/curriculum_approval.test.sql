-- pgTAP tests for the Curriculum Approval Centre (migrations 20260101000015 and 20260101000016). NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(46);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('99999999-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@ca.test' from generate_series(1, 8) n;
update profiles set role='founder', status='active', first_name='Fiona', last_name='Founder' where id = '99999999-0000-0000-0000-000000000001';
update profiles set role='co_founder', status='active', first_name='Colin', last_name='CoFounder' where id = '99999999-0000-0000-0000-000000000002';
update profiles set role='super_admin', status='active' where id = '99999999-0000-0000-0000-000000000003';
update profiles set role='programme_director', status='active' where id = '99999999-0000-0000-0000-000000000004';
update profiles set role='programme_coordinator', status='active' where id = '99999999-0000-0000-0000-000000000005';
update profiles set role='trainer', status='active' where id = '99999999-0000-0000-0000-000000000006';
update profiles set role='participant', status='active' where id = '99999999-0000-0000-0000-000000000007';
-- 08 stays an applicant

insert into tracks(id, programme_id, code, name, position) values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'tt_appr', 'Approval test track', 90);
insert into curriculum_sessions(id, programme_id, track_id, week_no, session_no, title, topics) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 3, 'Test session one', array['Topic Alpha','Topic Beta','Topic Gamma','Topic Delta']),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 3, 4, 'Test session two', array['Topic Alpha']);
insert into curriculum_topic_proposals(id, session_id, title) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Topic Alpha'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Topic Beta'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Topic Gamma'),
  ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'Topic Delta'),
  ('cccccccc-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000002', 'Topic Alpha');

select is((select track_id::text from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000001'), 'aaaaaaaa-0000-0000-0000-000000000001', 'a proposal takes its track from its session');
select throws_ok($$insert into curriculum_topic_proposals(session_id, title) values ('bbbbbbbb-0000-0000-0000-000000000001', 'topic ALPHA')$$, '23505', null, 'the same topic cannot be proposed twice in one session');
select is((select count(*)::int from curriculum_topic_proposals where title = 'Topic Alpha'), 2, 'the same title in another session stays a separate proposal');
select is(seed_initial_topic_proposals(), 0, 'seeding the initial queue again adds nothing');

-- ---------- Founder ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(is_staff() and is_executive() and not is_admin(), 'a founder has staff and executive powers (migration 17) but is not a super admin, so cannot assign roles');
do $$ begin update profiles set role = 'super_admin' where id = '99999999-0000-0000-0000-000000000001'; exception when others then null; end $$;
select is((select role::text from profiles where id = '99999999-0000-0000-0000-000000000001'), 'founder', 'a founder cannot change their own role');
select is((select count(*)::int from curriculum_topic_proposals where session_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')), 5, 'a founder sees every proposal');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000002','reject')$$, null, 'Give a reason when rejecting a topic', 'rejecting needs a reason');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000002','reject','   ')$$, null, 'Give a reason when rejecting a topic', 'a blank reason does not count');
select lives_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000001','approve','Good for week 2')$$, 'founder approves a topic');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000001','approve')$$, null, 'Only a pending topic can be approved or rejected (this one is approved)', 'a decision cannot be repeated');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000001','reopen')$$, null, 'Only a rejected topic can be reconsidered (this one is approved)', 'only rejected topics can be reconsidered');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','maybe')$$, null, 'The decision must be approve, reject or reopen', 'unknown decision refused');
select is((select actor_name from curriculum_topic_history('cccccccc-0000-0000-0000-000000000001')), 'Fiona Founder', 'history shows who decided');
select is((select track_name from curriculum_proposals_list() where title = 'Topic Alpha' and session_no = 3), 'Approval test track', 'the list shows track and session');

-- ---------- Co-Founder ----------
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000002','reject','Out of scope for week 2')$$, 'co-founder rejects a topic with a reason');

-- ---------- Super Administrator ----------
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000003','approve')$$, 'super administrator approves a topic');
select throws_ok($$update curriculum_topic_proposals set status = 'approved' where id = 'cccccccc-0000-0000-0000-000000000004'$$, '42501', null, 'even a super administrator cannot update proposal status directly');
select throws_ok($$delete from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000004'$$, '42501', null, 'even a super administrator cannot delete a proposal through the API');

-- ---------- everyone else ----------
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','approve')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'programme director cannot approve');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','reject','no')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'programme director cannot reject');
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000002','reopen')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'programme director cannot reconsider');
select throws_ok($$select curriculum_proposals_list()$$, null, 'Only the Founder, Co-Founder or a Super Administrator can open the Curriculum Approval Centre', 'programme director cannot open the approval list');
select throws_ok($$select curriculum_topic_history('cccccccc-0000-0000-0000-000000000001')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can view the approval history', 'programme director cannot read the history');
select throws_ok($$update curriculum_topic_proposals set status = 'approved' where id = 'cccccccc-0000-0000-0000-000000000004'$$, '42501', null, 'a programme director cannot update proposal status directly');
select is((select count(*)::int from curriculum_topic_proposals where session_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')), 2, 'a programme director sees only the approved topics');
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','approve')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'coordinator cannot approve');
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','approve')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'trainer cannot approve');
select is((select count(*)::int from curriculum_topic_proposals where session_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')), 2, 'a trainer sees only the approved topics');
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','approve')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'participant cannot approve');
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000004','approve')$$, null, 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics', 'applicant cannot approve');

-- ---------- what the database now holds (superuser) ----------
reset role;
select is((select status::text from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000004'), 'pending', 'refused direct updates changed nothing');
select is((select count(*)::int from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000004'), 1, 'refused direct deletes changed nothing');
select throws_ok($$delete from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000004'$$, null, 'Topic proposals are never deleted. Reject a topic instead', 'even a database session cannot silently delete a proposal');
select throws_ok($$update curriculum_topic_events set comment = 'edited'$$, null, 'The approval history cannot be changed', 'approval history cannot be edited');
select is((select reviewed_by::text || '|' || reviewer_comment from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000001'), '99999999-0000-0000-0000-000000000001|Good for week 2', 'approval records reviewer and comment');
select ok((select reviewed_at is not null from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000001'), 'approval records the time');
select is((select status::text || '|' || reviewed_by::text from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000002'), 'rejected|99999999-0000-0000-0000-000000000002', 'rejection is kept, with the reviewer');
select is((select count(*)::int from audit_logs where action = 'curriculum_topic_approved' and actor_id = '99999999-0000-0000-0000-000000000001' and row_id = 'cccccccc-0000-0000-0000-000000000001'), 1, 'the audit log records the approval');
select is((select approved_topics from v_session_topics where session_id = 'bbbbbbbb-0000-0000-0000-000000000001'), array['Topic Alpha','Topic Gamma'], 'approved topics become official content of their session');
select is((select awaiting_topics from v_session_topics where session_id = 'bbbbbbbb-0000-0000-0000-000000000001'), array['Topic Delta'], 'rejected topics are hidden and pending topics stay "awaiting"');
select is((select approved_topics from v_session_topics where session_id = 'bbbbbbbb-0000-0000-0000-000000000002'), '{}'::text[], 'approving a topic in one session does not approve the same title in another');

-- ---------- reconsider a rejected topic ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$select review_curriculum_topic('cccccccc-0000-0000-0000-000000000002','reopen','New evidence')$$, 'a rejected topic can be returned to pending');
reset role;
select is((select status::text || '|' || coalesce(reviewed_by::text, 'none') from curriculum_topic_proposals where id = 'cccccccc-0000-0000-0000-000000000002'), 'pending|none', 'a reconsidered topic is pending again');
select is((select count(*)::int from curriculum_topic_events where proposal_id = 'cccccccc-0000-0000-0000-000000000002' and ((from_status = 'pending' and to_status = 'rejected') or (from_status = 'rejected' and to_status = 'pending'))), 2, 'the history keeps both the rejection and the reconsideration');
select is((select awaiting_topics from v_session_topics where session_id = 'bbbbbbbb-0000-0000-0000-000000000001'), array['Topic Beta','Topic Delta'], 'a reconsidered topic is awaiting again');

select * from finish();
rollback;
