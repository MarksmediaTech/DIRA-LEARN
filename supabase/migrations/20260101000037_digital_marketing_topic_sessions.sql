-- Migration 37 - Digital Marketing topic proposals follow the V13.2 sessions; DIRA's 8 Nov 2026 approval is recorded (21 Nov 2026).
-- DIRA (owner) approved Digital Marketing Sessions 5, 6 and 7 - their topics and practical outputs - on 8 Nov 2026
-- (docs/ASSUMPTIONS_AND_DECISIONS.md). V13 (19 Nov 2026) later spread that content over Sessions 3-8, but the 11 topic proposals
-- created by migration 16 still pointed at the 8 Nov session numbers. This migration:
--   1. moves each of the 11 Digital Marketing proposals to the session that teaches the topic in V13.2 (titles unchanged) and writes
--      the 8 Nov approval into its description. ALL 11 STAY PENDING: they are approved formally in the Curriculum Approval Centre;
--   2. redefines seed_initial_topic_proposals() with the corrected sessions (every other row unchanged), so a re-run of the seed
--      can never recreate them at the old session numbers;
--   3. sets the topics list of Digital Marketing draft records 3-7 to the proposals they now carry, and adds a note to records 3-8
--      saying which approved topics and outputs they carry forward. The records stay DRAFT (is_approved = false).
-- It never: approves anything, changes a status, reviewer or history row, edits an approved session record, a lesson plan, a
-- duration, another track, the Entrepreneurship Session 4 proposals or record, or programmes.is_approved.
-- It REFUSES (and changes nothing) if any of the 11 proposals has already been reviewed, or if a move would duplicate a topic.
-- Idempotent: running it or apply_digital_marketing_approval_37() again changes nothing. seed.sql calls the function too, because
-- on a fresh database the curriculum sessions are created by the seed, after the migrations.
-- Rollback: supabase/rollback/20260101000037_digital_marketing_topic_sessions_down.sql

-- ============ 1. the mapping (8 Nov session -> V13.2 session), one place for everything below ============
create or replace function digital_marketing_topic_map_37()
returns table(title text, approved_session int, current_session int) language sql immutable as $$
  values ('Digital footprint and online safety', 5, 3),
         ('Introduction to digital marketing', 5, 3),
         ('Social media marketing (Facebook, Instagram, TikTok, LinkedIn)', 5, 4),
         ('Content planning and creation', 5, 5),
         ('Canva for marketing graphics', 6, 5),
         ('Marketing copywriting, captions and calls to action', 6, 6),
         ('WhatsApp Business', 6, 4),
         ('Digital advertising fundamentals', 7, 7),
         ('SEO fundamentals', 7, 6),
         ('Marketing analytics and measuring campaign performance', 7, 7),
         ('Developing a practical digital marketing strategy', 7, 7) $$;
revoke all on function digital_marketing_topic_map_37() from public, anon, authenticated;
grant execute on function digital_marketing_topic_map_37() to service_role;

-- ============ 2. apply: re-map, describe, topics lists and notes (idempotent) ============
create or replace function apply_digital_marketing_approval_37() returns text
language plpgsql security definer set search_path = public as $$
declare
  prog constant uuid := '00000000-0000-0000-0000-0000000000a1';
  marker constant text := 'DIRA approval of 8 Nov 2026';
  dm uuid; n_moved int := 0; n_desc int := 0; n_topics int := 0; n_notes int := 0; bad text;
begin
  select id into dm from tracks where programme_id = prog and code = 'digital';
  if dm is null then return 'migration 37: no Digital Marketing track, nothing to do'; end if;

  -- refuse if any of the 11 has been reviewed (approved, rejected, reopened or with any history)
  select string_agg(p.title || ' (' || p.status || ')', '; ') into bad
    from curriculum_topic_proposals p join digital_marketing_topic_map_37() m on lower(btrim(p.title)) = lower(m.title)
   where p.track_id = dm
     and (p.status <> 'pending' or p.reviewed_by is not null or p.reviewed_at is not null
          or exists (select 1 from curriculum_topic_events e where e.proposal_id = p.id));
  if bad is not null then
    raise exception 'migration 37: these Digital Marketing topics have already been reviewed and are not moved: %. Nothing was changed.', bad;
  end if;

  -- refuse if a move would put the same topic twice on one session
  select string_agg(m.title, '; ') into bad
    from digital_marketing_topic_map_37() m
   where (select count(*) from curriculum_topic_proposals p where p.track_id = dm and lower(btrim(p.title)) = lower(m.title)) > 1;
  if bad is not null then
    raise exception 'migration 37: these Digital Marketing topics exist more than once: %. Nothing was changed.', bad;
  end if;

  -- 1. move to the V13.2 session (only pending, never-reviewed proposals reach this point)
  with target as (
    select m.title, cs.id as session_id from digital_marketing_topic_map_37() m
      join curriculum_sessions cs on cs.programme_id = prog and cs.track_id = dm and cs.session_no = m.current_session)
  update curriculum_topic_proposals p set session_id = t.session_id
    from target t where p.track_id = dm and lower(btrim(p.title)) = lower(t.title) and p.session_id <> t.session_id;
  get diagnostics n_moved = row_count;

  -- 2. the approval, visible to the reviewer in the Approval Centre
  update curriculum_topic_proposals p
     set description = format('Approved by DIRA on 8 Nov 2026 as a topic of Digital Marketing Session %s (owner''s written approval of '
                              'Sessions 5, 6 and 7, their topics and practical outputs; see docs/ASSUMPTIONS_AND_DECISIONS.md). '
                              'Taught in Session %s since the V13.2 revision. Awaiting formal approval in the Curriculum Approval Centre.',
                              m.approved_session, m.current_session)
    from digital_marketing_topic_map_37() m
   where p.track_id = dm and lower(btrim(p.title)) = lower(m.title) and p.status = 'pending'
     and p.description is distinct from format('Approved by DIRA on 8 Nov 2026 as a topic of Digital Marketing Session %s (owner''s written approval of '
                              'Sessions 5, 6 and 7, their topics and practical outputs; see docs/ASSUMPTIONS_AND_DECISIONS.md). '
                              'Taught in Session %s since the V13.2 revision. Awaiting formal approval in the Curriculum Approval Centre.',
                              m.approved_session, m.current_session);
  get diagnostics n_desc = row_count;

  -- 3. topics lists of the DRAFT records 3-7 = the proposals they carry (approved records are never edited)
  update curriculum_sessions cs
     set topics = coalesce((select array_agg(m.title order by m.approved_session, m.title) from digital_marketing_topic_map_37() m
                             where m.current_session = cs.session_no), '{}')
   where cs.programme_id = prog and cs.track_id = dm and cs.session_no between 3 and 7 and not cs.is_approved
     and cs.topics is distinct from coalesce((select array_agg(m.title order by m.approved_session, m.title) from digital_marketing_topic_map_37() m
                                              where m.current_session = cs.session_no), '{}');
  get diagnostics n_topics = row_count;

  -- 4. notes on the DRAFT records 3-8: which approved topics and outputs they carry forward
  update curriculum_sessions cs
     set assessment_notes = coalesce(cs.assessment_notes || ' ', '') || v.note
    from (values
      (3, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session carries the approved topics "Digital footprint and online safety" and "Introduction to digital marketing" and the approved output "improved online profile" (all from approved Session 5). This V13.2 record itself is a draft awaiting session approval.'),
      (4, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session carries the approved topics "Social media marketing (Facebook, Instagram, TikTok, LinkedIn)" (from approved Session 5) and "WhatsApp Business" and the approved output "WhatsApp Business profile plan" (both from approved Session 6). This V13.2 record itself is a draft awaiting session approval.'),
      (5, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session carries the approved topics "Content planning and creation" (approved Session 5) and "Canva for marketing graphics" (from approved Session 6), the approved output "two-week content calendar" (approved Session 5) and the graphics for the approved output "three posts with captions" (from approved Session 6). This V13.2 record itself is a draft awaiting session approval.'),
      (6, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session carries the approved topics "Marketing copywriting, captions and calls to action" (approved Session 6) and "SEO fundamentals" (from approved Session 7) and the captions for the approved output "three posts with captions" (approved Session 6). This V13.2 record itself is a draft awaiting session approval.'),
      (7, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session carries the approved topics "Digital advertising fundamentals", "Marketing analytics and measuring campaign performance" and "Developing a practical digital marketing strategy" and the approved output "digital marketing portfolio project" (built here as the campaign plan) with practice of the "three-minute walk-through" (all approved Session 7). This V13.2 record itself is a draft awaiting session approval.'),
      (8, marker || ' (Digital Marketing Sessions 5-7, topics and practical outputs): this session delivers the approved output "three-minute walk-through" of the digital marketing portfolio project (from approved Session 7), now the three-minute campaign presentation. This V13.2 record itself is a draft awaiting session approval.')
    ) as v(session_no, note)
   where cs.programme_id = prog and cs.track_id = dm and cs.session_no = v.session_no and not cs.is_approved
     and position(marker in coalesce(cs.assessment_notes, '')) = 0;
  get diagnostics n_notes = row_count;

  return format('migration 37: %s proposal(s) moved, %s description(s) written, %s topics list(s) and %s note(s) updated; nothing approved',
                n_moved, n_desc, n_topics, n_notes);
end $$;
revoke all on function apply_digital_marketing_approval_37() from public, anon, authenticated;
grant execute on function apply_digital_marketing_approval_37() to service_role;

-- ============ 3. the initial queue with the corrected Digital Marketing sessions (other rows exactly as in migration 16) ============
create or replace function seed_initial_topic_proposals() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into curriculum_topic_proposals(session_id, title)
  select cs.id, v.title
  from (select 'digital'::text as track_code, m.current_session as session_no, m.title from digital_marketing_topic_map_37() m
        union all
        select * from (values
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
          ('entrepreneurship', 4, 'Developing a practical digital marketing strategy')) as o(track_code, session_no, title)
       ) as v(track_code, session_no, title)
  join tracks t on t.programme_id = '00000000-0000-0000-0000-0000000000a1' and t.code = v.track_code
  join curriculum_sessions cs on cs.track_id = t.id and cs.session_no = v.session_no
  -- a Digital Marketing topic that already exists on another session is moved by apply_digital_marketing_approval_37(), not duplicated
  where not (v.track_code = 'digital' and exists (select 1 from curriculum_topic_proposals p
                                                   where p.track_id = t.id and lower(btrim(p.title)) = lower(btrim(v.title))))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function seed_initial_topic_proposals() from public, anon, authenticated;

-- ============ 4. run it on this database (a fresh database has no sessions yet: seed.sql runs it again at the end) ============
do $$ begin raise notice '%', apply_digital_marketing_approval_37(); end $$;
