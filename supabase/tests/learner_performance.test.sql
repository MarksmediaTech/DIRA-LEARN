-- pgTAP tests for migration 27 (Phase 6: individual learner performance). LOCAL database only. Everything rolls back.
begin;
select plan(60);

-- FIXTURE START (also used by tools/db-standin/crosscheck_results.mjs to compare the SQL and TypeScript calculations)
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
-- FIXTURE END

set local role authenticated;

-- ---------- 1. the facilitator of cohort A ----------
select _as(2);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 4, 'the facilitator sees every learner of her cohort');
select is((select attendance_rate from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), 100.0, 'Lia: attendance 100% (the cancelled session is ignored)');
select is((select sessions_attended || '/' || core_attended || '/' || core_total from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), '8/2/2', 'Lia: 8 sessions, both core sessions');
select is((select tasks_pct from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), 75.0, 'Lia: tasks are the mean of graded scored tasks (80% and 70%), by latest attempt');
select is((select tasks_graded || '/' || tasks_total from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), '2/3', 'Lia: 2 of her 3 scored tasks graded (the extension is hers only; feedback-only work has no mark)');
select is((select final_pct || '/' || reflection_pct from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), '70.0/90.0', 'Lia: final project 70%, reflection 90%');
select is((select overall from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), 79.5, 'Lia: draft weighted result 79.5% (20/30/40/10)');
select is((select provisional from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), true, 'and it is provisional while the extension is ungraded');
select is((select completion_status from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), 'requirements_met', 'Lia meets the draft completion requirements');
select is((select needs_support from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), false, 'Lia is not flagged');
select is((select attendance_rate from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(8)), 62.5, 'Leo: attendance 62.5% (late counts as attended)');
select is((select overall from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(8)), null::numeric, 'Leo: no overall while components are ungraded (never shown as 0)');
select is((select assignments_expected || '/' || overdue || '/' || late from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(8)), '5/2/1', 'Leo: 5 assignments apply (not Lia''s extension), 2 overdue, 1 late');
select is((select support_reasons from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(8)), array['attendance', 'overdue_work'], 'Leo is flagged for attendance and overdue work (draft thresholds)');
select is((select completion_status || ':' || needs_support from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(9)), 'withdrawn:false', 'Sue is withdrawn and not flagged');
select is((select access_status from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(10)), 'scheduled', 'Kim''s access is shown as scheduled');
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000b')), 0, 'the facilitator sees nothing of another cohort');
select is((select string_agg(name, ',') from performance_cohorts()), 'Perf A', 'her Performance page lists only her own cohort');

-- ---------- 2. other roles ----------
select _as(3);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 0, 'cohort B''s facilitator sees nothing of cohort A');
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000b')), 1, 'but sees his own cohort');
select _as(4);
select is((select string_agg(participant_no, ',') from learner_metrics('66662222-0000-0000-0000-00000000000a')), 'LP-8', 'a mentor sees only his mentee');
select is((select count(*)::int from performance_cohorts()), 1, 'the mentor''s Performance page lists only his mentee''s cohort');
select _as(5);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 0, 'an M&E officer sees no individual records');
select is((select count(*)::int from performance_cohorts()), 0, 'and no cohorts on the Performance page');
select _as(12);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 0, 'an applicant sees nothing');
select _as(1);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 4, 'a programme coordinator sees everyone');
select _as(6);
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000b')), 1, 'the Founder sees every cohort');
select ok((select count(*) from performance_cohorts()) >= 2, 'and lists every cohort');
reset role;
set local role anon;
select throws_ok($$select * from learner_metrics('66662222-0000-0000-0000-00000000000a')$$, '42501', null, 'anonymous visitors cannot call it at all');
select throws_ok($$select * from _learner_metrics('66662222-0000-0000-0000-00000000000a')$$, '42501', null, 'and nobody can call the unfiltered internal calculation');
reset role;
set local role authenticated;

-- ---------- 3. learners see only themselves ----------
select _as(7);
select is((select string_agg(participant_no, ',') from learner_metrics('66662222-0000-0000-0000-00000000000a')), 'LP-7', 'Lia sees only her own row of her cohort');
select is((select (metrics ->> 'overall')::numeric from my_performance()), 79.5, 'and her own performance summary');
select throws_ok($$select * from _learner_metrics('66662222-0000-0000-0000-00000000000a')$$, '42501', null, 'she cannot call the internal calculation');
select _as(10);
select is((select count(*)::int from my_performance()), 0, 'a learner whose access is only scheduled sees no performance yet');
select _as(11);
select is((select count(*)::int from my_performance()), 1, 'a learner whose access has expired still reads her own results');
select is((select count(*)::int from learner_metrics('66662222-0000-0000-0000-00000000000a')), 0, 'but nothing about another cohort');

-- ---------- 4. facilitator feedback ----------
select _as(2);
select lives_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body) values (_p(7), '66662222-0000-0000-0000-00000000000a', _u(6), 'Strong final project. Next, tighten your reflection.')$$, 'the facilitator gives Lia shared feedback');
select is((select author_id from learner_feedback limit 1), _u(2), 'the author is always the signed-in person, whatever was sent');
select lives_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body, shared_with_learner) values (_p(7), '66662222-0000-0000-0000-00000000000a', _u(2), 'Staff note: check in about the extension.', false)$$, 'and a staff-only note');
select throws_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body) values (_p(11), '66662222-0000-0000-0000-00000000000b', _u(2), 'Feedback for another cohort')$$, null, null, 'she cannot give feedback to another cohort''s learner');
select throws_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body) values (_p(7), '66662222-0000-0000-0000-00000000000b', _u(2), 'Wrong cohort for Lia')$$, null, null, 'nor for a cohort the learner is not in');
-- since migration 38 the command is not granted at all (no RLS policy allows it), so the database refuses it outright
select throws_ok($$update learner_feedback set body = 'Rewritten'$$, '42501', null, 'feedback cannot be edited');
select throws_ok($$delete from learner_feedback$$, '42501', null, 'or deleted');
select is((select count(*)::int from learner_feedback where participant_id = _p(7)), 2, 'the facilitator reads both notes');
select _as(7);
select is((select count(*)::int from learner_feedback), 1, 'Lia reads only the shared feedback');
select throws_ok($$insert into learner_feedback(participant_id, cohort_id, author_id, body) values (_p(7), '66662222-0000-0000-0000-00000000000a', _u(7), 'Praising myself here')$$, null, null, 'learners cannot write feedback');
select _as(8);
select is((select count(*)::int from learner_feedback), 0, 'Leo cannot read Lia''s feedback');
select _as(3);
select is((select count(*)::int from learner_feedback), 0, 'another cohort''s facilitator cannot read it');
select _as(4);
select is((select count(*)::int from learner_feedback), 0, 'Leo''s mentor cannot read feedback about Lia');
reset role;
select is((select count(*)::int from notifications where user_id = _u(7) and kind = 'feedback'), 1, 'Lia is notified once, only of the shared feedback');
set local role authenticated;

-- ---------- 5. performance history ----------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(take_progress_snapshots(), 4, 'the schedule takes a snapshot of each learner in running cohorts (cohort B ended long ago)');
select is(take_progress_snapshots(), 0, 'and only once a day');
reset role;
set local role authenticated;
select _as(7);
select is((select overall from learner_performance_history(_p(7), '66662222-0000-0000-0000-00000000000a')), 79.5, 'Lia reads her own history');
select is((select count(*)::int from learner_performance_history(_p(8), '66662222-0000-0000-0000-00000000000a')), 0, 'but not Leo''s');
select is((select count(*)::int from learner_progress_snapshots), 1, 'and the table shows her only her own snapshot');

-- ---------- 6. draft thresholds ----------
select _as(2);
select is(_rows($$update performance_settings set support_attendance_below = 50$$), 0, 'a facilitator cannot change the support thresholds');
select _as(6);
select lives_ok($$update performance_settings set support_attendance_below = 60$$, 'an executive can');
select is((select support_reasons from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(8)), array['overdue_work'], 'with a 60% threshold Leo is flagged only for overdue work');

-- ---------- 7. certified learners ----------
reset role;
select set_config('app.certificate_fn', '1', true);   -- what issue_certificate() does internally; not possible from the app
insert into certificates(participant_id, cohort_id, certificate_no, issued_on) values (_p(7), '66662222-0000-0000-0000-00000000000a', 'LP-CERT-1', current_date);
select set_config('app.certificate_fn', '', true);
set local role authenticated;
select _as(2);
select is((select completion_status from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), 'certified', 'once a certificate is issued, Lia shows as certified');
select is((select needs_support from learner_metrics('66662222-0000-0000-0000-00000000000a') where participant_id = _p(7)), false, 'and certified learners are never flagged');

select * from finish();
rollback;
