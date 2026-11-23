-- pgTAP tests for migration 20260101000037 (Digital Marketing topic proposals on their V13.2 sessions; DIRA's 8 Nov 2026 approval
-- recorded; nothing approved). Run on a LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(16);

create temp view dm_topics as
  select p.id, p.title, s.session_no, p.status::text as status, p.description, p.reviewed_at
    from curriculum_topic_proposals p join curriculum_sessions s on s.id = p.session_id join tracks t on t.id = p.track_id
   where t.code = 'digital';

select is((select string_agg(title || '@' || session_no, '|' order by title) from dm_topics),
  'Canva for marketing graphics@5|Content planning and creation@5|Developing a practical digital marketing strategy@7|Digital advertising fundamentals@7|Digital footprint and online safety@3|Introduction to digital marketing@3|Marketing analytics and measuring campaign performance@7|Marketing copywriting, captions and calls to action@6|SEO fundamentals@6|Social media marketing (Facebook, Instagram, TikTok, LinkedIn)@4|WhatsApp Business@4',
  'the 11 Digital Marketing topics sit on their V13.2 sessions, titles unchanged');
select is((select count(*)::int from dm_topics where status = 'pending' and reviewed_at is null), 11, 'all 11 stay pending and unreviewed');
select is((select count(*)::int from dm_topics where description like 'Approved by DIRA on 8 Nov 2026 as a topic of Digital Marketing Session %'), 11,
  'each records the 8 Nov 2026 DIRA approval');
select is((select description from dm_topics where title = 'SEO fundamentals') like '%Session 7 (%Taught in Session 6 since%', true,
  'SEO fundamentals: approved in Session 7, taught in Session 6');
select is((select count(*)::int from dm_topics where session_no not between 3 and 7), 0, 'no Digital Marketing topic on Session 8 or outside the track sessions');
select is((select count(*)::int from curriculum_topic_events), 0, 'no approval history written');
select is((select count(*)::int from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital' and s.is_approved), 0,
  'Digital Marketing session records stay draft');
select is((select count(*)::int from curriculum_sessions s join tracks t on t.id = s.track_id
            where t.code = 'digital' and s.session_no between 3 and 8 and position('DIRA approval of 8 Nov 2026' in s.assessment_notes) > 0), 6,
  'records 3-8 carry the approval note');
select is((select topics from curriculum_sessions s join tracks t on t.id = s.track_id where t.code = 'digital' and s.session_no = 4),
  array['Social media marketing (Facebook, Instagram, TikTok, LinkedIn)', 'WhatsApp Business'], 'Session 4 topics list matches its proposals');
select is((select count(*)::int from curriculum_topic_proposals p join tracks t on t.id = p.track_id
            where t.code = 'entrepreneurship' and p.status = 'pending' and p.description is null), 10, 'Entrepreneurship 4 proposals untouched and pending');
select is((select string_agg(t.code || s.session_no, ',') from curriculum_sessions s join tracks t on t.id = s.track_id where s.is_approved),
  'entrepreneurship4', 'only the Entrepreneurship Session 4 record is approved');
select is((select count(*)::int from curriculum_lesson_plans where status = 'approved'), 0, 'no lesson plan approved');
select is((select bool_or(is_approved) from programmes), false, 'programme not approved');
select is(apply_digital_marketing_approval_37(),
  'migration 37: 0 proposal(s) moved, 0 description(s) written, 0 topics list(s) and 0 note(s) updated; nothing approved', 're-running changes nothing');

-- a reviewed topic makes the function refuse
insert into auth.users(id, instance_id, aud, role, email) values
  ('37373737-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder@dm37.test');
update profiles set role = 'founder', status = 'active' where id = '37373737-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"37373737-0000-0000-0000-000000000001","role":"authenticated"}', true);
select review_curriculum_topic((select id from dm_topics where title = 'WhatsApp Business'), 'approve', 'Approved by DIRA on 8 Nov 2026');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select apply_digital_marketing_approval_37()$$, 'P0001',
  'migration 37: these Digital Marketing topics have already been reviewed and are not moved: WhatsApp Business (approved). Nothing was changed.',
  'a reviewed topic makes migration 37 refuse');
select is((select session_no from dm_topics where title = 'WhatsApp Business'), 4, 'the reviewed topic stays where it was approved');

select * from finish();
rollback;
