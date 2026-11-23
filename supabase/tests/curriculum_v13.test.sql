-- pgTAP tests for the V13 curriculum revision (migration 20260101000030) the V13.1 review refinements (migration 20260101000031) and the V13.2 final refinements (migration 20260101000032). Executed locally (PostgreSQL 16 + Supabase stand-in).
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(70);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('77777777-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v13u' || n || '@cv13.test'
  from generate_series(1, 9) n;
update profiles set role = 'founder', status = 'active' where id = '77777777-0000-0000-0000-000000000001';
update profiles set role = 'super_admin', status = 'active' where id = '77777777-0000-0000-0000-000000000002';
update profiles set role = 'programme_director', status = 'active' where id = '77777777-0000-0000-0000-000000000003';
update profiles set role = 'programme_coordinator', status = 'active' where id = '77777777-0000-0000-0000-000000000004';
update profiles set role = 'trainer', status = 'active' where id = '77777777-0000-0000-0000-000000000005';
update profiles set role = 'participant', status = 'active' where id = '77777777-0000-0000-0000-000000000006';
update profiles set role = 'mentor', status = 'active' where id = '77777777-0000-0000-0000-000000000007';
update profiles set role = 'me_officer', status = 'active' where id = '77777777-0000-0000-0000-000000000008';
-- 09 stays an applicant
create temp table ids as
  select t.code, cs.session_no, cs.id from curriculum_sessions cs left join tracks t on t.id = cs.track_id;
grant select on ids to authenticated;
create temp table ref as select (select id from ids where code = 'digital' and session_no = 3) as dm3,
                                (select id from ids where code = 'entrepreneurship' and session_no = 4) as eb4,
                                (select id from ids where code = 'ai' and session_no = 5) as ai5;
grant select on ref to authenticated;

-- ---------- curriculum content and timetable (superuser) ----------
select is((select array_agg(name order by position) from tracks where programme_id = '00000000-0000-0000-0000-0000000000a1'),
          array['Digital Marketing', 'AI Tools', 'Content Creation', 'Entrepreneurship & Business'], 'the four specialist tracks, in order');
select is((select code from tracks where name = 'Digital Marketing'), 'digital', 'Digital Marketing keeps the internal code of the old track, so existing records still point at it');
select is((select count(*)::int from tracks t where t.name ilike '%digital skills%' or t.focus ilike '%digital skills%')
        + (select count(*)::int from curriculum_sessions cs where concat_ws(' ', cs.title, cs.description, cs.assessment_notes, array_to_string(cs.objectives, ' '), array_to_string(cs.activities, ' ')) ilike '%digital skills%'),
          0, 'the old track name no longer appears in tracks or session records');
select is((select count(*)::int from curriculum_sessions), 26, '2 core + 4 x 6 track sessions');
select is((select count(*)::int from curriculum_sessions where track_id is null and session_no = 1 and duration_minutes = 110), 1, 'core session 1 keeps 110 minutes');
select is((select count(*)::int from curriculum_sessions where track_id is null and session_no = 2 and duration_minutes = 115), 1, 'core session 2 keeps 115 minutes');
select is((select count(*)::int from curriculum_sessions where track_id is not null and duration_minutes = 120), 24, 'all 24 track sessions keep 120 minutes');
select is((select count(*)::int from curriculum_sessions cs where (cs.track_id is null and cs.week_no <> 1) or (cs.session_no in (3, 4) and cs.week_no <> 2)
            or (cs.session_no in (5, 6) and cs.week_no <> 3) or (cs.session_no in (7, 8) and cs.week_no <> 4)), 0, 'two sessions a week: weeks unchanged');
select is((select count(*)::int from curriculum_lesson_plans), 26, 'every session has a lesson plan');
select is((select count(*)::int from curriculum_teaching_notes), 26, 'every session has teaching notes');
select is((select count(*)::int from curriculum_sessions cs
            where (select sum((e ->> 'minutes')::int) from curriculum_lesson_plans lp, jsonb_array_elements(lp.content -> 'segments') e where lp.session_id = cs.id) <> cs.duration_minutes),
          0, 'the segments of every lesson plan add up exactly to the session duration');
select is((select count(*)::int from curriculum_sessions cs where lesson_plan_timing_problem(cs.id) is not null), 0, 'the timing check finds no problem in any session');
select is((select count(*)::int from curriculum_lesson_plans lp where exists (
            select 1 from unnest(array['purpose','objectives','topics','segments','guided_exercises','individual_activities','group_activities','examples','tools','assessment','expected_outputs','homework']) k
             where lp.content -> k is null or lp.content -> k in ('[]'::jsonb, '""'::jsonb))), 0, 'every lesson plan has all the learner-facing parts');
select is((select count(*)::int from curriculum_teaching_notes tn where exists (select 1 from jsonb_array_elements(tn.content -> 'segments') e where jsonb_array_length(e -> 'steps') = 0)
            or jsonb_array_length(tn.content -> 'demonstrations') = 0 or tn.content -> 'facilitator' is null), 0, 'every segment has step-by-step teaching content, and every session has demonstrations and facilitator instructions');
select is((select count(*)::int from curriculum_lesson_plans lp where lp.content::text like '%"steps"%' or lp.content::text like '%"guide"%'), 0,
          'learner-facing plans hold no teaching steps or marking guidance (those are in the staff-only teaching notes)');
select is((select count(*)::int from curriculum_lesson_plans where status <> 'draft'), 0, 'no lesson plan was approved automatically');
select ok((select is_approved and title = 'Value proposition and business model' and source = 'curriculum_docx + master_instruction_proposal' from curriculum_sessions where id = (select eb4 from ref)),
          'the approved Entrepreneurship session 4 record is unchanged');
select ok((select content::text ilike '%value proposition%' and content::text ilike '%business model canvas%' from curriculum_lesson_plans where session_id = (select eb4 from ref)),
          'the Value Proposition and Business Model content is kept and expanded in the lesson plan');
select is((select count(*)::int from curriculum_topic_proposals where status = 'pending'), 24, 'the Curriculum Approval Centre queue is untouched');
-- Migration 37 adds DIRA's 8 Nov 2026 approval note to Digital Marketing records 3-8, so the V13 loader sees those six notes as
-- different and restores its own text; seed.sql therefore always runs apply_digital_marketing_approval_37() right after it.
create temp table before_v13_rerun as select id, row(s.*)::text as r from curriculum_sessions s;
select is((select string_agg(item, ',' order by item) from load_curriculum_v13() where outcome like '%updated%' or outcome like '%added%' or outcome like 'renamed%'),
          'digital session 3,digital session 4,digital session 5,digital session 6,digital session 7,digital session 8',
          'applying the V13 content again changes nothing except the migration 37 notes on Digital Marketing records 3-8');
select apply_digital_marketing_approval_37();
select is((select count(*)::int from curriculum_sessions s join before_v13_rerun b using (id) where row(s.*)::text <> b.r), 0,
          'after apply_digital_marketing_approval_37() (as in seed.sql) every session record is exactly as before');

-- ---------- V13.1 review refinements (superuser) ----------
select is((select count(*)::int from curriculum_lesson_plans where version = 'V13.2' and content ->> 'version' = 'V13.2'), 26, 'all 26 lesson plans carry the approved V13.2 content');
select ok((select lp.content::text ilike '%Duck.ai%' and lp.content::text ilike '%without an account%' from curriculum_lesson_plans lp where lp.session_id = (select id from ids where code = 'ai' and session_no = 4)),
          'AI Tools session 4 names free tools and a no-account alternative');
select is((select count(*)::int from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id join tracks t on t.id = cs.track_id
            where t.code = 'content' and cs.session_no = 3 and lp.content ->> 'track_project' ilike '%restricted-access link%' and lp.content ->> 'track_project' ilike '%never a public%'), 1,
          'Content Creation portfolio submissions use restricted-access links or DIRA LEARN uploads');
select is((select count(*)::int from apply_curriculum_v13_2() where outcome like '%updated%'), 0, 'applying V13.2 again changes nothing');
select is((select count(*)::int from curriculum_sessions cs where cs.track_id is not null and (select count(*) from curriculum_lesson_plans lp, jsonb_array_elements(lp.content -> 'segments') e
            where lp.session_id = cs.id and e ->> 'kind' = 'break' and (e ->> 'minutes')::int = 5) = 1), 24, 'every 120-minute track session has one five-minute stretch break inside it');
select is((select count(*)::int from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id, jsonb_array_elements(lp.content -> 'segments') e
            where cs.track_id is null and e ->> 'kind' = 'break'), 0, 'the core sessions keep their approved flow without a break');
select is((select count(*)::int from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id
            where cs.session_no = 8 and cs.track_id is not null
              and (select sum((e ->> 'minutes')::int) from jsonb_array_elements(lp.content -> 'segments') e where e ->> 'kind' = 'assessment') = 60), 4, 'every showcase keeps 60 minutes of presentations');
select ok((select tn.content::text like '%Session 8 room plan%' from curriculum_teaching_notes tn where tn.session_id = (select id from ids where code = 'digital' and session_no = 8)), 'the showcase room plan is in the facilitator notes');
select ok((select lp.content::text not ilike '%who the Safeguarding Lead is%' and tn.content::text not ilike '%has appointed%' and tn.content::text ilike '%formally confirmed%'
             from curriculum_lesson_plans lp join curriculum_teaching_notes tn using (session_id) where lp.session_id = (select id from ids where code is null and session_no = 1)),
          'core session 1 shares only formally confirmed safeguarding contacts');
select ok((select tn.content::text ilike '%fully allocated unit cost = variable cost per unit%' and tn.content::text ilike '%contribution per unit = price - variable cost per unit%'
                  and tn.content::text not ilike '%Gross profit per bottle = price minus variable cost%'
             from curriculum_teaching_notes tn where tn.session_id = (select id from ids where code = 'entrepreneurship' and session_no = 5)), 'Entrepreneurship session 5 uses consistent finance terms');
select is((select count(*)::int from curriculum_lesson_plans lp join curriculum_sessions cs on cs.id = lp.session_id join tracks t on t.id = cs.track_id
            where cs.session_no = 3 and lp.content ->> 'track_project' ilike '%Privacy option%'), 4, 'every track offers a private or simulated option for its final project');
select is((select count(*)::int from curriculum_topic_proposals p join tracks t on t.id = p.track_id where t.code = 'digital' and p.status = 'pending'), 11, 'the 11 Digital Marketing topics are still pending');
select is((select count(*)::int from apply_curriculum_v13_1() where outcome like '%updated%'), 0, 'applying V13.1 again changes nothing');

-- ---------- participant ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_lesson_plans), 26, 'a learner can read every lesson plan (topics, outcomes, activities, assignments)');
select is((select count(*)::int from curriculum_teaching_notes), 0, 'a learner cannot read teaching notes');
update curriculum_lesson_plans set content = jsonb_set(content, '{purpose}', '"changed by a learner"') where session_id = (select dm3 from ref);
select isnt((select content ->> 'purpose' from curriculum_lesson_plans where session_id = (select dm3 from ref)), 'changed by a learner', 'a learner cannot edit a lesson plan');
select throws_ok($$insert into curriculum_teaching_notes(session_id, content) values ((select ai5 from ref), '{"segments":[]}')$$, '42501', null, 'a learner cannot add teaching notes');
select throws_ok($$select set_lesson_plan_approval((select dm3 from ref), true)$$, null, 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan', 'a learner cannot approve');
select throws_ok($$select count(*) from curriculum_v13_sessions$$, '42501', null, 'the raw V13 source tables are not readable through the API');
select throws_ok($$select * from load_curriculum_v13()$$, '42501', null, 'nobody can run the V13 loader through the API');
select throws_ok($$select * from apply_curriculum_v13_1()$$, '42501', null, 'nobody can run the V13.1 update through the API');
select throws_ok($$select * from apply_curriculum_v13_2()$$, '42501', null, 'nobody can run the V13.2 update through the API');

-- ---------- applicant, mentor, M&E officer ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_teaching_notes), 0, 'an applicant cannot read teaching notes');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_teaching_notes), 0, 'a mentor cannot read teaching notes');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_teaching_notes), 0, 'an M&E officer cannot read teaching notes');

-- ---------- trainer (facilitator) ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_teaching_notes), 26, 'a facilitator can read the teaching notes of every session');
update curriculum_teaching_notes set content = '{"segments":[]}' where session_id = (select dm3 from ref);
select isnt((select content::text from curriculum_teaching_notes where session_id = (select dm3 from ref)), '{"segments": []}', 'a facilitator cannot edit teaching notes');
select throws_ok($$select set_lesson_plan_approval((select dm3 from ref), true)$$, null, 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan', 'a facilitator cannot approve');

-- ---------- programme coordinator (edits, cannot approve) ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from curriculum_teaching_notes), 26, 'the coordinator can read teaching notes');
select lives_ok($$update curriculum_lesson_plans set content = jsonb_set(content, '{homework}', '["Revised homework"]') where session_id = (select dm3 from ref)$$, 'the coordinator can edit a lesson plan');
select is((select status::text from curriculum_lesson_plans where session_id = (select dm3 from ref)), 'draft', 'an edited plan stays draft');
select throws_ok($$update curriculum_lesson_plans set status = 'approved' where session_id = (select dm3 from ref)$$, null,
                 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan', 'the coordinator cannot approve a plan directly');
set constraints all immediate;                                       -- check the timing rule straight away instead of at commit
select throws_ok($$update curriculum_lesson_plans set content = jsonb_set(content, '{segments,0,minutes}', '25') where session_id = (select dm3 from ref)$$, '23514', null,
                 'a lesson plan whose segments do not add up to the session duration is refused');
select throws_ok($$update curriculum_lesson_plans set content = jsonb_set(content, '{segments,0,minutes}', '0') where session_id = (select dm3 from ref)$$, '23514', null,
                 'a segment of 0 minutes is refused');
select throws_ok($$update curriculum_sessions set duration_minutes = 100 where id = (select dm3 from ref)$$, '23514', null,
                 'a session duration cannot be changed away from its lesson plan timing');
select throws_ok($$update curriculum_teaching_notes set content = jsonb_set(content, '{segments}', '[]') where session_id = (select dm3 from ref)$$, '23514', null,
                 'teaching notes must keep one entry per lesson segment');
select throws_ok($$update curriculum_lesson_plans set session_id = (select ai5 from ref) where session_id = (select dm3 from ref)$$, null,
                 'A lesson plan cannot be moved to another session', 'a lesson plan cannot be moved to another session');
delete from curriculum_lesson_plans where session_id = (select dm3 from ref);
select is((select count(*)::int from curriculum_lesson_plans where session_id = (select dm3 from ref)), 1, 'the coordinator cannot delete a lesson plan');

-- ---------- programme director (approves, does not edit) ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000003","role":"authenticated"}', true);
update curriculum_lesson_plans set content = jsonb_set(content, '{purpose}', '"director edit"') where session_id = (select ai5 from ref);
select isnt((select content ->> 'purpose' from curriculum_lesson_plans where session_id = (select ai5 from ref)), 'director edit', 'the director cannot edit content (same as curriculum sessions)');
select lives_ok($$select set_lesson_plan_approval((select eb4 from ref), true)$$, 'the director approves a lesson plan');
select ok((select status = 'approved' and approved_by = '77777777-0000-0000-0000-000000000003' and approved_at is not null from curriculum_lesson_plans where session_id = (select eb4 from ref)),
          'approval records who approved and when');
select ok((select is_approved and title = 'Value proposition and business model' from curriculum_sessions where id = (select eb4 from ref)), 'approving the plan does not change the approved session record');

-- ---------- edits after approval go back to draft ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
update curriculum_lesson_plans set content = jsonb_set(content, '{homework}', '["Changed after approval"]') where session_id = (select eb4 from ref);
select ok((select status = 'draft' and approved_by is null and approved_at is null from curriculum_lesson_plans where session_id = (select eb4 from ref)), 'editing an approved plan sends it back to draft');
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_lesson_plan_approval((select eb4 from ref), true);
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000004","role":"authenticated"}', true);
update curriculum_teaching_notes set content = jsonb_set(content, '{facilitator,preparation}', '["Changed note"]') where session_id = (select eb4 from ref);
select is((select status::text from curriculum_lesson_plans where session_id = (select eb4 from ref)), 'draft', 'editing the teaching notes of an approved plan also sends it back to draft');
update curriculum_lesson_plans set approved_by = '77777777-0000-0000-0000-000000000003', approved_at = now() where session_id = (select ai5 from ref);
select ok((select status = 'draft' and approved_by is null from curriculum_lesson_plans where session_id = (select ai5 from ref)), 'approval fields cannot be forged on a draft plan');

-- ---------- founder ----------
select set_config('request.jwt.claims', '{"sub":"77777777-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$update curriculum_lesson_plans set status = 'approved' where session_id = (select ai5 from ref)$$, 'a founder may approve a plan');
select is((select approved_by::text from curriculum_lesson_plans where session_id = (select ai5 from ref)), '77777777-0000-0000-0000-000000000001', 'the founder is recorded as approver');

-- ---------- audit and anonymous access ----------
select set_config('request.jwt.claims', '', true);
reset role;
select ok((select count(*) from audit_logs where table_name = 'curriculum_lesson_plans' and actor_id = '77777777-0000-0000-0000-000000000004') >= 2, 'lesson plan edits are written to the audit log with the editor');
set local role anon;
select throws_ok($$select count(*) from curriculum_lesson_plans$$, '42501', null, 'signed-out visitors cannot read lesson plans');
reset role;

select * from finish();
rollback;
