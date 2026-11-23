-- End-to-end workflow check across phases, using the accounts from supabase/local_test_accounts.sql.
-- Each step runs as the real person, through the same tables and functions the screens use. Everything rolls back.
-- Run by tools/check-all.sh on a scratch copy of the local database.
begin;
select plan(36);
create function _as(email text) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where auth.users.email = _as.email), 'role', 'authenticated')::text, true) $$;
create function _id(email text) returns uuid language sql stable security definer as $$ select id from auth.users where auth.users.email = _id.email $$;
grant execute on function _as(text), _id(text) to authenticated;
set local role authenticated;

-- ---------- assignments, grading and performance (Phases 2 and 6) ----------
select _as('trainer.a@dira-test.local');
select lives_ok($$insert into assignments(id, cohort_id, title, max_score, component, due_at) values ('e2e00000-0000-0000-0000-000000000001', 'd1a22222-0000-0000-0000-00000000000a', 'Week 1 task', 10, 'task', now() + interval '3 days')$$, 'facilitator A sets an assignment for her cohort');
select throws_ok($$insert into assignments(cohort_id, title) values ('d1a22222-0000-0000-0000-00000000000b', 'Not my cohort')$$, null, null, 'but not for cohort B');
select _as('learner1@dira-test.local');
select lives_ok($$insert into submissions(assignment_id, participant_id, body) values ('e2e00000-0000-0000-0000-000000000001', 'd1a11111-0000-0000-0000-000000000010', 'My answer')$$, 'learner 1 submits her work');
select _as('learner3@dira-test.local');
select is((select count(*)::int from assignments), 0, 'learner 3 (access not open yet) cannot see the assignment');
select _as('trainer.a@dira-test.local');
select lives_ok($$update submissions set status = 'graded', score = 9, feedback = 'Well argued' where assignment_id = 'e2e00000-0000-0000-0000-000000000001'$$, 'facilitator A grades it');
select ok((select graded_at is not null from submissions where assignment_id = 'e2e00000-0000-0000-0000-000000000001'), 'the grading time is recorded (Phase 7)');
select lives_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body) values ('d1a11111-0000-0000-0000-000000000010', 'd1a22222-0000-0000-0000-00000000000a', auth.uid(), 'A strong start this week.')$$, 'and leaves shared feedback');
select _as('learner1@dira-test.local');
select is((select (metrics ->> 'tasks_pct')::numeric from my_performance()), 90.0, 'learner 1 sees her 90% task result on her performance page');
select is((select count(*)::int from learner_feedback), 1, 'and the feedback');
select is((select count(*)::int from notifications where kind in ('feedback', 'graded', 'submission')) >= 1, true, 'and she has been notified');
select _as('learner2@dira-test.local');
select is((select count(*)::int from submissions), 0, 'learner 2 cannot see learner 1''s work');
select is((select count(*)::int from learner_metrics('d1a22222-0000-0000-0000-00000000000a')), 1, 'and sees only her own performance row');
select _as('mentor@dira-test.local');
select is((select string_agg(participant_no, ',') from learner_metrics('d1a22222-0000-0000-0000-00000000000a')), 'TEST-11', 'the mentor sees only her mentee (learner 2)');

-- ---------- Daily Briefs (Phase 3) ----------
select _as('founder@dira-test.local');
select lives_ok($$insert into brief_publishers(profile_id) values (_id('coordinator@dira-test.local'))$$, 'the Founder authorises the coordinator to publish briefs');
select _as('coordinator@dira-test.local');
select lives_ok($$insert into daily_briefs(brief_date, cohort_id, title, reflection, status) values (current_date, 'd1a22222-0000-0000-0000-00000000000a', 'Day 8', 'Small steps add up.', 'published')$$, 'the coordinator publishes today''s brief for cohort A');
select _as('learner1@dira-test.local');
select is((select count(*)::int from daily_briefs where brief_date = current_date), 1, 'learner 1 (cohort A) reads it');
select _as('learner4@dira-test.local');
select is((select count(*)::int from daily_briefs where brief_date = current_date), 0, 'learner 4 (cohort B) does not');

-- ---------- DIRA Connect, closed access and safeguarding (Phase 4) ----------
select _as('learner3@dira-test.local');
select lives_ok($$select connect_start_direct(_id('trainer.a@dira-test.local'))$$, 'learner 3, whose access is not open, can still contact her facilitator');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, auth.uid(), 'When can I collect my laptop?' from connect_conversations where kind = 'direct'$$, 'and send a message');
select is((select count(*)::int from connect_conversations where kind = 'cohort'), 0, 'but cannot see the cohort discussion');
select _as('trainer.a@dira-test.local');
select is((select count(*)::int from connect_messages m join connect_conversations c on c.id = m.conversation_id where c.kind = 'direct'), 1, 'facilitator A receives it');
select lives_ok($$select connect_start_direct_with_learner('d1a11111-0000-0000-0000-000000000011')$$, 'and starts a conversation with learner 2');
select lives_ok($$insert into connect_messages(conversation_id, sender_id, body) select id, auth.uid(), 'Please meet me alone after class' from connect_conversations where kind = 'direct' and learner_id = 'd1a11111-0000-0000-0000-000000000011'$$, 'and writes to her');
select _as('learner2@dira-test.local');
select lives_ok($$select connect_report_message((select m.id from connect_messages m join connect_conversations c on c.id = m.conversation_id where c.learner_id = 'd1a11111-0000-0000-0000-000000000011' limit 1), 'safety_concern', 'This made me uncomfortable')$$, 'learner 2 reports it as a safety concern');
select _as('director@dira-test.local');
select is((select count(*)::int from safeguarding_records where source = 'connect_safety_report'), 1, 'the Safeguarding Lead receives a confidential record straight away');
select _as('founder@dira-test.local');
select is((select count(*)::int from safeguarding_records), 0, 'the Founder cannot read it');
select is((select status from connect_list_reports('all') limit 1), 'escalated', 'moderators only see that it went to safeguarding');
select _as('trainer.b@dira-test.local');
select is((select count(*)::int from connect_messages), 0, 'facilitator B sees none of cohort A''s messages');

-- ---------- Cohort Intelligence (Phase 7) ----------
select _as('coordinator@dira-test.local');
select is((select reports_escalated from ci_support() where cohort_id = 'd1a22222-0000-0000-0000-00000000000a'), 1, 'Cohort Intelligence shows one report with safeguarding for cohort A');
select _as('me@dira-test.local');
select is((select learners from ci_cohort_comparison() where cohort_id = 'd1a22222-0000-0000-0000-00000000000a' and level = 'cohort'), 3, 'M&E sees cohort A''s totals (3 learners) but no individuals');

-- ---------- V13 curriculum: what learners and facilitators see ----------
select _as('learner1@dira-test.local');
select is((select t.name from cohort_enrolments e join tracks t on t.id = e.track_id where e.participant_id = my_participant_id()), 'Digital Marketing',
          'learner1''s track (internal code digital, as before) is shown as Digital Marketing');
select is((select count(*)::int from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id
            join cohort_enrolments e on e.track_id = cs.track_id and e.participant_id = my_participant_id()), 6, 'learner1 can open the six lesson plans of their track');
select is((select count(*)::int from curriculum_teaching_notes), 0, 'learner1 cannot open any teaching notes');
select _as('trainer.a@dira-test.local');
select ok((select count(*) = 26 and bool_and(jsonb_array_length(content -> 'segments') > 0) from curriculum_teaching_notes), 'facilitator A can open the teaching notes of every session');
select _as('director@dira-test.local');
select lives_ok($$select set_lesson_plan_approval((select cs.id from curriculum_sessions cs join tracks t on t.id = cs.track_id where t.code = 'digital' and cs.session_no = 3), true)$$,
                'the Programme Director approves the first Digital Marketing lesson plan');
select _as('learner1@dira-test.local');
select is((select lp.status::text from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id join tracks t on t.id = cs.track_id where t.code = 'digital' and cs.session_no = 3),
          'approved', 'learner1 sees that lesson plan as approved');

select * from finish();
rollback;
