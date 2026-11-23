-- pgTAP tests for migration 28 (Phase 7: cohort intelligence). LOCAL database only. Everything rolls back.
begin;
select plan(44);

-- fixture copied from learner_performance.test.sql (Phase 6); figures for each learner are verified there
create function _u(n int) returns uuid language sql immutable as $$ select ('66660000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _p(n int) returns uuid language sql immutable as $$ select ('66661111-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _as(n int) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', _u(n), 'role', 'authenticated')::text, true) $$;
create function _rows(q text) returns int language plpgsql as $f$ declare k int; begin execute q; get diagnostics k = row_count; return k; end $f$;
create function _cs(p_code text, wk int, sn int) returns uuid language sql stable as $$
  select cs.id from curriculum_sessions cs left join tracks t on t.id = cs.track_id where coalesce(t.code, 'core') = p_code and cs.week_no = wk and cs.session_no = sn $$;
grant execute on function _u(int), _p(int), _as(int), _rows(text), _cs(text, int, int) to authenticated, service_role;

-- 1 coordinator, 2 trainer A, 3 trainer B, 4 mentor (of Leo), 5 M&E officer, 6 founder, 7 Lia, 8 Leo, 9 Sue (withdrawn), 10 Kim (scheduled), 11 Max (cohort B, expired), 12 applicant
insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lp' || n || '@lp.test' from generate_series(1, 12) n;
update profiles set role = 'programme_coordinator', status = 'active', first_name = 'Cora', last_name = 'Coord' where id = _u(1);
update profiles set role = 'trainer', status = 'active', first_name = 'Tina', last_name = 'A' where id = _u(2);
update profiles set role = 'trainer', status = 'active', first_name = 'Tom', last_name = 'B' where id = _u(3);
update profiles set role = 'mentor', status = 'active', first_name = 'Mo', last_name = 'Mentor' where id = _u(4);
update profiles set role = 'me_officer', status = 'active', first_name = 'Em', last_name = 'Officer' where id = _u(5);
update profiles set role = 'founder', status = 'active', first_name = 'Fay', last_name = 'Founder' where id = _u(6);
update profiles p set role = 'participant', status = 'active', first_name = x.f, last_name = 'Learner'
  from (values (7, 'Lia'), (8, 'Leo'), (9, 'Sue'), (10, 'Kim'), (11, 'Max')) x(n, f) where p.id = _u(x.n);
insert into participants(id, profile_id, participant_no, status) values
  (_p(7), _u(7), 'LP-7', 'active'), (_p(8), _u(8), 'LP-8', 'active'), (_p(9), _u(9), 'LP-9', 'withdrawn'), (_p(10), _u(10), 'LP-10', 'active'), (_p(11), _u(11), 'LP-11', 'active');
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at, access_closes_at) values
  ('66662222-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'Perf A', current_date - 20, current_date + 8, 20, now() - interval '20 days', null),
  ('66662222-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'Perf B', current_date - 120, current_date - 90, 20, now() - interval '120 days', now() - interval '80 days');
insert into cohort_enrolments(cohort_id, participant_id, track_id)
select '66662222-0000-0000-0000-00000000000a'::uuid, p, (select id from tracks where code = 'digital') from unnest(array[_p(7), _p(8), _p(9), _p(10)]) p
union all select '66662222-0000-0000-0000-00000000000b', _p(11), (select id from tracks where code = 'digital');
insert into learner_access(participant_id, cohort_id, opens_at_override) values (_p(10), '66662222-0000-0000-0000-00000000000a', now() + interval '5 days');
insert into trainer_assignments(cohort_id, trainer_id) values ('66662222-0000-0000-0000-00000000000a', _u(2)), ('66662222-0000-0000-0000-00000000000b', _u(3));
insert into mentorship_assignments(mentor_id, participant_id) values (_u(4), _p(8));
-- eight sessions: the 2 core sessions and the 6 digital-track sessions, one a day in the past; one extra cancelled session
insert into session_schedules(id, cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at, mode, status)
select ('66663333-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, '66662222-0000-0000-0000-00000000000a', cs, _u(2),
       date_trunc('day', now()) - make_interval(days => 20 - i) + interval '9 hours', date_trunc('day', now()) - make_interval(days => 20 - i) + interval '11 hours', 'physical', 'completed'
from (values (1, _cs('core', 1, 1)), (2, _cs('core', 1, 2)), (3, _cs('digital', 2, 3)), (4, _cs('digital', 2, 4)), (5, _cs('digital', 3, 5)),
             (6, _cs('digital', 3, 6)), (7, _cs('digital', 4, 7)), (8, _cs('digital', 4, 8))) v(i, cs);
insert into session_schedules(id, cohort_id, curriculum_session_id, trainer_id, starts_at, ends_at, mode, status) values
  ('66663333-0000-0000-0000-000000000009', '66662222-0000-0000-0000-00000000000a', _cs('digital', 4, 8), _u(2), date_trunc('day', now()) - interval '1 day' + interval '14 hours', date_trunc('day', now()) - interval '1 day' + interval '15 hours', 'physical', 'cancelled');
-- attendance: Lia present everywhere; Leo 4 present, 1 late, 3 absent (62.5%); Sue 2 present; the cancelled session is ignored
insert into attendance(schedule_id, participant_id, status)
select ('66663333-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, _p(7), 'present' from generate_series(1, 9) i
union all select ('66663333-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, _p(8),
  (case when i <= 4 then 'present' when i = 5 then 'late' else 'absent' end)::attendance_status from generate_series(1, 8) i
union all select ('66663333-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, _p(9), 'present' from generate_series(1, 2) i;
-- assignments: a task (10 marks), the final project (100), the reflection (10), a second task due in the past, a task for Lia only,
-- and a feedback-only task with no marks
insert into assignments(id, cohort_id, title, max_score, component, due_at, allow_resubmission) values
  ('66664444-0000-0000-0000-000000000001', '66662222-0000-0000-0000-00000000000a', 'Task one', 10, 'task', now() - interval '10 days', true),
  ('66664444-0000-0000-0000-000000000002', '66662222-0000-0000-0000-00000000000a', 'Final project', 100, 'final_project', now() - interval '2 days', false),
  ('66664444-0000-0000-0000-000000000003', '66662222-0000-0000-0000-00000000000a', 'Reflection', 10, 'reflection', now() + interval '5 days', false),
  ('66664444-0000-0000-0000-000000000004', '66662222-0000-0000-0000-00000000000a', 'Task two', 10, 'task', now() - interval '4 days', false),
  ('66664444-0000-0000-0000-000000000005', '66662222-0000-0000-0000-00000000000a', 'Extension for Lia', 10, 'task', now() + interval '3 days', false),
  ('66664444-0000-0000-0000-000000000006', '66662222-0000-0000-0000-00000000000a', 'Feedback only', null, 'task', null, false);
insert into assignment_recipients(assignment_id, participant_id) values ('66664444-0000-0000-0000-000000000005', _p(7));
-- Lia: task one 8/10 after a returned first attempt, final 70/100, reflection 9/10, task two 7/10; extension not yet graded.
-- Real workflow: the database sets attempt and on-time/late status on submission; grading or returning happens afterwards.
insert into submissions(assignment_id, participant_id, body) values ('66664444-0000-0000-0000-000000000001', _p(7), 'first try');
update submissions set status = 'returned', feedback = 'Please add an example' where assignment_id = '66664444-0000-0000-0000-000000000001' and participant_id = _p(7);
insert into submissions(assignment_id, participant_id, body) values ('66664444-0000-0000-0000-000000000001', _p(7), 'second try');
update submissions set status = 'graded', score = 8 where assignment_id = '66664444-0000-0000-0000-000000000001' and participant_id = _p(7) and attempt = 2;
insert into submissions(assignment_id, participant_id, body) values
  ('66664444-0000-0000-0000-000000000002', _p(7), 'project'), ('66664444-0000-0000-0000-000000000003', _p(7), 'reflection'),
  ('66664444-0000-0000-0000-000000000004', _p(7), 'task two'), ('66664444-0000-0000-0000-000000000005', _p(7), 'extension'),
  -- Leo: task one submitted late, not graded; nothing else (final project and task two are overdue)
  ('66664444-0000-0000-0000-000000000001', _p(8), 'late work');
update submissions s set status = 'graded', score = x.score from (values ('66664444-0000-0000-0000-000000000002'::uuid, 70), ('66664444-0000-0000-0000-000000000003'::uuid, 9), ('66664444-0000-0000-0000-000000000004'::uuid, 7)) x(a, score)
 where s.assignment_id = x.a and s.participant_id = _p(7);

-- Phase 7 additions: applicants (13-15), a recruitment window, a Connect report, a mute, closed-access support messaging
insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lp' || n || '@lp.test' from generate_series(13, 16) n;
update cohorts set recruitment_opens_on = current_date - 60, recruitment_closes_on = current_date - 25 where id = '66662222-0000-0000-0000-00000000000a';
insert into applications(applicant_id, programme_id, status, submitted_at) values
  (_u(13), '00000000-0000-0000-0000-0000000000a1', 'submitted', now() - interval '40 days'),
  (_u(14), '00000000-0000-0000-0000-0000000000a1', 'accepted', now() - interval '35 days'),
  (_u(15), '00000000-0000-0000-0000-0000000000a1', 'rejected', now() - interval '30 days'),
  (_u(16), '00000000-0000-0000-0000-0000000000a1', 'submitted', now() - interval '3 days');   -- outside the window
insert into connect_conversations(id, kind, learner_id, facilitator_id) values ('6666aaaa-0000-0000-0000-000000000001', 'direct', _p(7), _u(2));
insert into connect_messages(id, conversation_id, sender_id, body) values ('6666bbbb-0000-0000-0000-000000000001', '6666aaaa-0000-0000-0000-000000000001', _u(2), 'Please resend that file');

set local role authenticated;
select _as(7);
select connect_report_message('6666bbbb-0000-0000-0000-000000000001', 'other', 'Not sure about this');
select _as(6);
select connect_mute(_u(8), now() + interval '1 day', 'Cooling off');
select _as(10);
select connect_start_direct(_u(2));
insert into connect_messages(conversation_id, sender_id, body) select id, _u(10), 'Can I get the reading list before access opens?' from connect_conversations where kind = 'direct' and learner_id = _p(10);
-- the facilitator grades Leo's late work (the database records when)
select _as(2);
update submissions set status = 'graded', score = 5 where assignment_id = '66664444-0000-0000-0000-000000000001' and participant_id = _p(8);

-- ---------- 1. who can open which report ----------
select _as(1);
select ok((select count(*) from ci_intake()) >= 2, 'a programme coordinator sees the intake report');
select is((select count(*)::int from ci_learners() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 4, 'and the learner list across cohorts');
select is((select count(*)::int from ci_facilitators() where cohort_id in ('66662222-0000-0000-0000-00000000000a', '66662222-0000-0000-0000-00000000000b')), 2, 'and every facilitator');
select _as(5);
select ok((select count(*) from ci_cohort_comparison()) >= 2, 'an M&E officer sees the cohort comparison');
select is((select applications_in_window from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000a'), null::int, 'but not application counts (as on the existing Analytics page)');
select is((select count(*)::int from ci_learners()), 0, 'and no individual learners');
select is((select count(*)::int from ci_facilitators()), 0, 'and no facilitator report');
select ok((select count(*) from ci_support()) >= 2, 'but does see the support totals');
select _as(2);
select is((select count(*)::int from ci_intake()), 0, 'a facilitator cannot open the cohort reports');
select is((select count(*)::int from ci_cohort_comparison()), 0, 'or the comparison');
select is((select string_agg(cohort_name, ',') from ci_facilitators()), 'Perf A', 'but sees her own facilitator row');
select is((select count(*)::int from ci_learners()), 0, 'and no learner list');
select _as(7);
select is((select count(*)::int from ci_cohort_comparison()) + (select count(*)::int from ci_support()) + (select count(*)::int from ci_learners()) + (select count(*)::int from ci_facilitators()), 0, 'a learner sees none of it');
select _as(4);
select is((select count(*)::int from ci_cohort_comparison()) + (select count(*)::int from ci_learners()), 0, 'nor does a mentor');
reset role;
set local role anon;
select throws_ok($$select * from ci_cohort_comparison()$$, '42501', null, 'anonymous visitors cannot call the reports');
reset role;
set local role authenticated;

-- ---------- 2. intake ----------
select _as(1);
select is((select enrolled || '/' || capacity || '/' || fill_pct from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000a'), '4/20/20.0', 'cohort A: 4 enrolled of 20 places (20%)');
select is((select withdrawn from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'one learner withdrew');
select is((select applications_in_window || '/' || accepted_in_window || '/' || rejected_in_window from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000a'), '3/1/1', 'three applications inside the recruitment window (one outside is not counted)');
select is((select (tracks -> 0 ->> 'learners')::int from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 4, 'track mix is reported');
select is((select applications_in_window from ci_intake() where cohort_id = '66662222-0000-0000-0000-00000000000b'), null::int, 'cohorts without a recruitment window show no application count rather than zero');

-- ---------- 3. cohort comparison (figures follow from the Phase 6 learner figures) ----------
select is((select learners || '/' || active_learners || '/' || withdrawn from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), '4/3/1', 'cohort A: 4 learners, 3 active, 1 withdrawn');
select is((select avg_attendance from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), 81.3, 'average attendance of active learners with records (100 and 62.5)');
select is((select submission_rate from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), 37.5, 'submission rate 6 of 16 expected pieces of work');
select is((select avg_overall || '/' || results_count from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), '79.5/1', 'average overall uses only learners who have one (never counts missing as 0)');
select is((select requirements_met || '/' || certified || '/' || completion_rate from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), '1/0/33.3', 'one of three active learners meets the draft completion requirements');
select is((select needs_support from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'cohort'), 2, 'two learners may need support (Leo and Kim)');
select is((select count(*)::int from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'track'), 1, 'there is a row per track');
select is((select learners from ci_cohort_comparison() where cohort_id = '66662222-0000-0000-0000-00000000000a' and level = 'track'), 4, 'and the track row adds up to the cohort');

-- ---------- 4. facilitators ----------
select is((select sessions_scheduled || '/' || sessions_completed || '/' || sessions_cancelled from ci_facilitators() where cohort_id = '66662222-0000-0000-0000-00000000000a'), '9/8/1', 'facilitator A: 9 sessions, 8 completed, 1 cancelled');
select is((select awaiting_grading from ci_facilitators() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'one piece of work still waits for a grade (Lia''s extension)');
select is((select graded_with_time from ci_facilitators() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'her grading is timed from now on');
select ok((select avg_turnaround_hours is not null from ci_facilitators() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 'so a grading turnaround is reported');
reset role;
select set_config('request.jwt.claims', '', true);
update submissions set graded_at = '2020-01-01' where participant_id = _p(8);
select ok((select bool_and(graded_at is null or graded_at > now() - interval '1 hour') from submissions where participant_id = _p(8)), 'nobody can backdate the grading time');
set local role authenticated;

-- ---------- 5. support and interventions ----------
select _as(1);
select is((select needs_support || '/' || low_attendance || '/' || with_overdue_work from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000a'), '2/1/2', 'support flags by reason');
select is((select access_scheduled || '/' || access_expired || '/' || access_suspended from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000a'), '1/0/1', 'access: one scheduled, one suspended (the withdrawn learner)');
select is((select reports_open from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'the open Connect report is counted');
select is((select active_mutes from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'and the active mute');
select is((select closed_access_support_messages_30d from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000a'), 1, 'and support messages from a learner whose access is closed');
select is((select access_expired from ci_support() where cohort_id = '66662222-0000-0000-0000-00000000000b'), 1, 'cohort B: the expired learner is counted');

-- ---------- 6. safeguarding totals: officers only ----------
select _as(6);
select lives_ok($$select sg_appoint('lead', _u(1), 'Interim Safeguarding Lead for testing')$$, 'the Founder appoints the coordinator as Lead');
select _as(2);
select lives_ok($$select sg_raise_concern(_p(8), 'Leo seemed distressed after the last session and left early', 'urgent')$$, 'the facilitator raises an urgent concern about Leo');
select _as(6);
select is((select count(*)::int from ci_safeguarding_summary()), 0, 'the Founder sees no safeguarding totals');
select _as(5);
select is((select count(*)::int from ci_safeguarding_summary()), 0, 'nor does M&E');
select _as(1);
select is((select cohort_name || ':' || open_count || ':' || urgent from ci_safeguarding_summary()), 'Perf A:1:1', 'the Safeguarding Lead sees totals by cohort, with no names or details');

select * from finish();
rollback;
