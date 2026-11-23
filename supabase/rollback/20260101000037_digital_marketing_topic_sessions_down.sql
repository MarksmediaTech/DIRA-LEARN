-- Rollback of migration 37 (Digital Marketing topic proposals on the V13.2 sessions). Run in one transaction, then delete version
-- 20260101000037 from supabase_migrations.schema_migrations. Restores the state after migration 36 exactly:
--   * the 11 Digital Marketing proposals back on their 8 Nov 2026 sessions (5, 6, 7) with no description;
--   * the topics lists of Digital Marketing draft records 3-7 as seeded (3 and 4 empty; 5, 6, 7 the 8 Nov lists);
--   * the migration 37 note removed from the notes of draft records 3-8;
--   * seed_initial_topic_proposals() exactly as defined in migration 16; the two migration 37 functions dropped.
-- It REFUSES, changing nothing, if any of the 11 has been reviewed since (an approved topic is not moved back silently).
-- DIRA's 8 Nov 2026 approval stays recorded in docs/ASSUMPTIONS_AND_DECISIONS.md.

do $$
declare
  prog constant uuid := '00000000-0000-0000-0000-0000000000a1';
  marker constant text := 'DIRA approval of 8 Nov 2026';
  dm uuid; bad text;
begin
  select id into dm from tracks where programme_id = prog and code = 'digital';
  if dm is not null then
    select string_agg(p.title || ' (' || p.status || ')', '; ') into bad
      from curriculum_topic_proposals p join digital_marketing_topic_map_37() m on lower(btrim(p.title)) = lower(m.title)
     where p.track_id = dm and (p.status <> 'pending' or p.reviewed_by is not null or p.reviewed_at is not null
                                or exists (select 1 from curriculum_topic_events e where e.proposal_id = p.id));
    if bad is not null then
      raise exception 'rollback 37 refused: these Digital Marketing topics have been reviewed since migration 37: %. Nothing was changed.', bad;
    end if;

    update curriculum_topic_proposals p set session_id = cs.id, description = null
      from digital_marketing_topic_map_37() m
      join curriculum_sessions cs on cs.programme_id = prog and cs.track_id = dm and cs.session_no = m.approved_session
     where p.track_id = dm and lower(btrim(p.title)) = lower(m.title);

    update curriculum_sessions cs set topics = v.topics
      from (values
        (3, '{}'::text[]),
        (4, '{}'::text[]),
        (5, array['Digital footprint and online safety', 'Introduction to digital marketing',
                  'Social media marketing (Facebook, Instagram, TikTok, LinkedIn)', 'Content planning and creation']),
        (6, array['Canva for marketing graphics', 'Marketing copywriting, captions and calls to action', 'WhatsApp Business']),
        (7, array['Digital advertising fundamentals', 'SEO fundamentals', 'Marketing analytics and measuring campaign performance',
                  'Developing a practical digital marketing strategy'])) as v(session_no, topics)
     where cs.programme_id = prog and cs.track_id = dm and cs.session_no = v.session_no and not cs.is_approved;

    update curriculum_sessions cs
       set assessment_notes = nullif(rtrim(left(cs.assessment_notes, position(marker in cs.assessment_notes) - 1)), '')
     where cs.programme_id = prog and cs.track_id = dm and cs.session_no between 3 and 8 and not cs.is_approved
       and position(marker in coalesce(cs.assessment_notes, '')) > 0;
  end if;
end $$;

-- seed_initial_topic_proposals() exactly as in migration 16
create or replace function seed_initial_topic_proposals() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into curriculum_topic_proposals(session_id, title)
  select cs.id, v.title
  from (values
    ('digital', 5, 'Digital footprint and online safety'),
    ('digital', 5, 'Introduction to digital marketing'),
    ('digital', 5, 'Social media marketing (Facebook, Instagram, TikTok, LinkedIn)'),
    ('digital', 5, 'Content planning and creation'),
    ('digital', 6, 'Canva for marketing graphics'),
    ('digital', 6, 'Marketing copywriting, captions and calls to action'),
    ('digital', 6, 'WhatsApp Business'),
    ('digital', 7, 'Digital advertising fundamentals'),
    ('digital', 7, 'SEO fundamentals'),
    ('digital', 7, 'Marketing analytics and measuring campaign performance'),
    ('digital', 7, 'Developing a practical digital marketing strategy'),
    ('content', 6, 'Visual hierarchy'),
    ('content', 6, 'Consistent branding'),
    ('content', 6, 'Consent and credit for people, images and music'),
    ('entrepreneurship', 4, 'Introduction to digital marketing'),
    ('entrepreneurship', 4, 'Social media marketing (Facebook, Instagram, TikTok, LinkedIn)'),
    ('entrepreneurship', 4, 'Content planning and creation'),
    ('entrepreneurship', 4, 'Canva for marketing graphics'),
    ('entrepreneurship', 4, 'Marketing copywriting, captions and calls to action'),
    ('entrepreneurship', 4, 'WhatsApp Business'),
    ('entrepreneurship', 4, 'Digital advertising fundamentals'),
    ('entrepreneurship', 4, 'SEO fundamentals'),
    ('entrepreneurship', 4, 'Marketing analytics and measuring campaign performance'),
    ('entrepreneurship', 4, 'Developing a practical digital marketing strategy')
  ) as v(track_code, session_no, title)
  join tracks t on t.programme_id = '00000000-0000-0000-0000-0000000000a1' and t.code = v.track_code
  join curriculum_sessions cs on cs.track_id = t.id and cs.session_no = v.session_no
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function seed_initial_topic_proposals() from public, anon, authenticated;

drop function apply_digital_marketing_approval_37();
drop function digital_marketing_topic_map_37();
