-- pgTAP tests for migration 20260101000021_daily_briefs.sql. NOT yet executed.
-- Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(25);

-- ---------- fixtures (superuser) ----------
insert into auth.users(id, instance_id, aud, role, email)
select ('44440000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db' || n || '@brief.test' from generate_series(1, 9) n;
update profiles set role='founder', status='active'                where id = '44440000-0000-0000-0000-000000000001';
update profiles set role='programme_coordinator', status='active'  where id = '44440000-0000-0000-0000-000000000002';  -- will be authorised
update profiles set role='programme_coordinator', status='active'  where id = '44440000-0000-0000-0000-000000000003';  -- not authorised
update profiles set role='trainer', status='active'                where id = '44440000-0000-0000-0000-000000000004';  -- authorised, cohort 1 only
update profiles set role='trainer', status='active'                where id = '44440000-0000-0000-0000-000000000005';  -- not authorised
update profiles set role='participant', status='active'            where id in ('44440000-0000-0000-0000-000000000006','44440000-0000-0000-0000-000000000007','44440000-0000-0000-0000-000000000008');
insert into participants(id, profile_id, participant_no) values
  ('44441111-0000-0000-0000-000000000006','44440000-0000-0000-0000-000000000006','DB-1'),   -- cohort 1, access active
  ('44441111-0000-0000-0000-000000000007','44440000-0000-0000-0000-000000000007','DB-2'),   -- cohort 2, access active
  ('44441111-0000-0000-0000-000000000008','44440000-0000-0000-0000-000000000008','DB-3');   -- cohort 1, access scheduled
insert into cohorts(id, programme_id, name, start_date, end_date, capacity, access_opens_at) values
  ('44442222-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','DB one', current_date - 3, current_date + 30, 10, now() - interval '3 days'),
  ('44442222-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','DB two', current_date - 3, current_date + 30, 10, now() - interval '3 days');
insert into cohort_enrolments(cohort_id, participant_id) values
  ('44442222-0000-0000-0000-000000000001','44441111-0000-0000-0000-000000000006'),
  ('44442222-0000-0000-0000-000000000002','44441111-0000-0000-0000-000000000007'),
  ('44442222-0000-0000-0000-000000000001','44441111-0000-0000-0000-000000000008');
insert into trainer_assignments(cohort_id, trainer_id) values ('44442222-0000-0000-0000-000000000001','44440000-0000-0000-0000-000000000004');
insert into learner_access(participant_id, cohort_id, opens_at_override) values ('44441111-0000-0000-0000-000000000008','44442222-0000-0000-0000-000000000001', now() + interval '10 days');

-- ---------- authorisation ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$insert into daily_briefs(brief_date, title) values (current_date, 'Unauthorised brief')$$, null, null, 'staff who are not authorised cannot create a brief');
select throws_ok($$insert into brief_publishers(profile_id) values ('44440000-0000-0000-0000-000000000003')$$, null, null, 'staff cannot authorise themselves');

select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$insert into brief_publishers(profile_id) values ('44440000-0000-0000-0000-000000000002')$$, 'a founder can authorise a staff member');
select lives_ok($$insert into brief_publishers(profile_id) values ('44440000-0000-0000-0000-000000000004')$$, 'a founder can authorise a facilitator');
select throws_ok($$insert into brief_publishers(profile_id) values ('44440000-0000-0000-0000-000000000006')$$, null, null, 'a learner can never be authorised to publish');
select ok(can_publish_briefs(), 'executives are always authorised');

-- ---------- staff and facilitators ----------
select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$insert into daily_briefs(id, brief_date, cohort_id, title, reflection, objectives, reflection_question, status) values ('44443333-0000-0000-0000-000000000001', current_date, '44442222-0000-0000-0000-000000000001', 'Cohort one brief', 'Small steps count.', array['Finish the pitch outline','Practise out loud'], 'What helped you most yesterday?', 'published')$$, 'authorised staff can publish a brief for one cohort');
select lives_ok($$insert into daily_briefs(id, brief_date, title, status) values ('44443333-0000-0000-0000-000000000002', current_date, 'All cohorts brief', 'published')$$, 'authorised staff can publish a brief for all cohorts');
select throws_ok($$insert into daily_briefs(brief_date, cohort_id, title, status) values (current_date, '44442222-0000-0000-0000-000000000001', 'Second live brief', 'published')$$, null, null, 'only one live brief per day per audience');
select throws_ok($$insert into brief_publishers(profile_id) values ('44440000-0000-0000-0000-000000000005')$$, null, null, 'authorised staff cannot authorise others');

select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$insert into daily_briefs(id, brief_date, cohort_id, title) values ('44443333-0000-0000-0000-000000000003', current_date + 1, '44442222-0000-0000-0000-000000000001', 'Tomorrow draft')$$, 'an authorised facilitator can draft for their own cohort');
select throws_ok($$insert into daily_briefs(brief_date, cohort_id, title) values (current_date + 1, '44442222-0000-0000-0000-000000000002', 'Wrong cohort')$$, null, 'Facilitators can write briefs only for their own cohorts', 'but not for another cohort');
select throws_ok($$insert into daily_briefs(brief_date, title) values (current_date + 2, 'All cohorts by a facilitator')$$, null, 'Facilitators can write briefs only for their own cohorts', 'and not for all cohorts');
select throws_ok($$update daily_briefs set status = 'scheduled', publish_at = now() - interval '1 hour' where id = '44443333-0000-0000-0000-000000000003'$$, null, 'Choose a future time to schedule publication', 'scheduling needs a future time');
select lives_ok($$update daily_briefs set status = 'scheduled', publish_at = now() + interval '1 day' where id = '44443333-0000-0000-0000-000000000003'$$, 'a future time can be scheduled');

select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$insert into daily_briefs(brief_date, cohort_id, title) values (current_date + 3, '44442222-0000-0000-0000-000000000001', 'Unauthorised facilitator')$$, null, null, 'a facilitator who is not authorised cannot create a brief');

-- ---------- learners ----------
select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from daily_briefs), 2, 'a learner sees the published brief for their cohort and the all-cohorts brief, not the scheduled or draft one');
select throws_ok($$insert into daily_briefs(brief_date, title) values (current_date + 4, 'Learner brief')$$, null, null, 'a learner cannot create a brief');
select is((select count(*)::int from daily_brief_events), 0, 'a learner cannot read the publication history');

select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is((select count(*)::int from daily_briefs where cohort_id is not null), 0, 'a learner in another cohort cannot see this cohort''s brief');

select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from daily_briefs), 0, 'a learner whose access has not opened yet sees no briefs');

-- ---------- history and scheduled publication ----------
select set_config('request.jwt.claims', '{"sub":"44440000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((select count(*) from daily_brief_events where brief_id = '44443333-0000-0000-0000-000000000003' and action = 'scheduled') = 1, 'the history records the scheduling');
reset role;
select set_config('request.jwt.claims', '', true);   -- the sweep and maintenance run without a signed-in user
select throws_ok($$update daily_brief_events set title = 'Tampered'$$, null, 'Publication history cannot be edited or deleted', 'the history cannot be edited, even by the database owner');
update daily_briefs set publish_at = now() - interval '1 minute' where id = '44443333-0000-0000-0000-000000000003';
select is(publish_due_briefs(), 1, 'the sweep publishes a brief whose time has come');
select ok((select count(*) from daily_brief_events where brief_id = '44443333-0000-0000-0000-000000000003' and action = 'published_on_schedule') = 1, 'and records it as published on schedule');

select * from finish();
rollback;
