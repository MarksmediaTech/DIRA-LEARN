-- DIRA LEARN: Curriculum Approval Centre (topic-level approval by Founder, Co-Founder and Super Administrator)
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`.
-- ADDITIVE ONLY: new tables, functions and a view. No existing curriculum row, policy or account is changed or deleted.
-- Rollback: supabase/rollback/20260101000016_curriculum_approval_centre_down.sql
--
-- How it fits the existing curriculum:
--   * curriculum_sessions.topics (text[]) already holds "proposed extra topics" that the app shows as "awaiting approval".
--     Those are NOT edited. Each proposed topic now also has a row in curriculum_topic_proposals with a status.
--   * Official teaching topics = APPROVED proposals. v_session_topics gives the app approved_topics (official) and
--     awaiting_topics (still pending; rejected ones are hidden). Pending and rejected topics never count as official content.
--   * The existing session-level approval (is_approved, set_curriculum_approval: super admin + programme director) is
--     unchanged. Approving a topic does not edit curriculum_sessions, so it cannot reset a session's approval.

-- ============ 1. reference rows and the approval permission ============
insert into roles(code, label) values ('founder', 'Founder'), ('co_founder', 'Co-Founder') on conflict do nothing;

create or replace function can_approve_curriculum() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('founder', 'co_founder', 'super_admin'), false) $$;
revoke all on function can_approve_curriculum() from public, anon;
grant execute on function can_approve_curriculum() to authenticated;

-- ============ 2. tables ============
create type topic_status as enum ('pending', 'approved', 'rejected');

create table curriculum_topic_proposals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references curriculum_sessions(id) on delete restrict,
  track_id uuid references tracks(id),                       -- always the session's track (set by trigger); null for shared core sessions
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (description is null or length(description) <= 2000),
  status topic_status not null default 'pending',
  submitted_by uuid references profiles(id),                 -- null = part of the initial proposal list
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  reviewer_comment text check (reviewer_comment is null or length(reviewer_comment) <= 1000),
  created_at timestamptz not null default now(),
  constraint topic_review_fields check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)),
  constraint topic_reject_needs_reason check (status <> 'rejected' or length(btrim(coalesce(reviewer_comment, ''))) > 0)
);
-- one proposal per title per session (case-insensitive); the same title in a different session or track is a different proposal
create unique index uq_topic_per_session on curriculum_topic_proposals(session_id, lower(btrim(title)));
create index on curriculum_topic_proposals(status, submitted_at);
create index on curriculum_topic_proposals(track_id, session_id);

create table curriculum_topic_events (                       -- the approval history; never edited or deleted
  id bigint generated always as identity primary key,
  proposal_id uuid not null references curriculum_topic_proposals(id) on delete restrict,
  from_status topic_status,
  to_status topic_status not null,
  actor_id uuid references profiles(id),
  comment text,
  created_at timestamptz not null default now()
);
create index on curriculum_topic_events(proposal_id, created_at);

-- ============ 3. guards ============
create or replace function set_topic_track() returns trigger language plpgsql as $$
begin new.track_id := (select track_id from curriculum_sessions where id = new.session_id); return new; end $$;
create trigger trg_topic_track before insert or update of session_id on curriculum_topic_proposals for each row execute function set_topic_track();

-- Status, reviewer and comment can only change through review_curriculum_topic() (or a trusted maintenance session).
create or replace function guard_topic_update() returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at or new.reviewer_comment is distinct from old.reviewer_comment)
     and not (current_setting('dira.topic_review', true) = 'on' or is_trusted_session()) then
    raise exception 'A topic can only be approved or rejected with the review action';
  end if;
  return new;
end $$;
create trigger trg_guard_topic_update before update on curriculum_topic_proposals for each row execute function guard_topic_update();

create or replace function forbid_topic_delete() returns trigger language plpgsql as $$
begin raise exception 'Topic proposals are never deleted. Reject a topic instead'; end $$;
create trigger trg_forbid_topic_delete before delete on curriculum_topic_proposals for each row execute function forbid_topic_delete();

create or replace function forbid_topic_event_change() returns trigger language plpgsql as $$
begin raise exception 'The approval history cannot be changed'; end $$;
create trigger trg_topic_event_immutable before update or delete on curriculum_topic_events for each row execute function forbid_topic_event_change();

-- ============ 4. row level security: read only; every change goes through a function ============
alter table curriculum_topic_proposals enable row level security;
alter table curriculum_topic_events enable row level security;
revoke all on table curriculum_topic_proposals, curriculum_topic_events from anon, authenticated;
grant select on table curriculum_topic_proposals, curriculum_topic_events to authenticated;
-- approvers see everything; everyone else sees only APPROVED topics. No insert, update or delete policy exists for anyone.
create policy topic_read on curriculum_topic_proposals for select to authenticated using (can_approve_curriculum() or status = 'approved');
create policy topic_events_read on curriculum_topic_events for select to authenticated using (can_approve_curriculum());

-- ============ 5. the decision function ============
create or replace function review_curriculum_topic(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  p curriculum_topic_proposals;
  c text := nullif(btrim(p_comment), '');
  new_state topic_status;
begin
  if actor is null or not can_approve_curriculum() then
    raise exception 'Only the Founder, Co-Founder or a Super Administrator can approve or reject curriculum topics';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject', 'reopen') then raise exception 'The decision must be approve, reject or reopen'; end if;
  if c is not null and length(c) > 1000 then raise exception 'The comment is too long (1000 characters at most)'; end if;

  select * into p from curriculum_topic_proposals where id = p_id for update;
  if not found then raise exception 'Topic not found'; end if;

  if p_decision = 'reopen' then
    if p.status <> 'rejected' then raise exception 'Only a rejected topic can be reconsidered (this one is %)', p.status; end if;
    new_state := 'pending';
  else
    if p.status <> 'pending' then raise exception 'Only a pending topic can be approved or rejected (this one is %)', p.status; end if;
    if p_decision = 'reject' and c is null then raise exception 'Give a reason when rejecting a topic'; end if;
    new_state := case when p_decision = 'approve' then 'approved'::topic_status else 'rejected'::topic_status end;
  end if;

  perform set_config('dira.topic_review', 'on', true);
  update curriculum_topic_proposals set status = new_state,
    reviewed_by = case when new_state = 'pending' then null else actor end,
    reviewed_at = case when new_state = 'pending' then null else now() end,
    reviewer_comment = case when new_state = 'pending' then null else c end
  where id = p.id;
  insert into curriculum_topic_events(proposal_id, from_status, to_status, actor_id, comment) values (p.id, p.status, new_state, actor, c);
  insert into audit_logs(actor_id, table_name, row_id, action, old_data, new_data)
    values (actor, 'curriculum_topic_proposals', p.id::text, 'curriculum_topic_' || case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'reopened' end,
            jsonb_build_object('status', p.status), jsonb_build_object('status', new_state, 'title', p.title, 'session_id', p.session_id, 'comment', c, 'decided_at', now()));
  return jsonb_build_object('status', new_state);
end $$;
revoke all on function review_curriculum_topic(uuid, text, text) from public, anon;
grant execute on function review_curriculum_topic(uuid, text, text) to authenticated;

-- ============ 6. read functions for the Approval Centre (approvers only; they include reviewer names, which a founder could not read from profiles) ============
create or replace function curriculum_proposals_list() returns table(
  id uuid, track_id uuid, track_name text, track_position int, session_id uuid, session_no int, week_no int, session_title text,
  session_description text, session_objectives text[], title text, description text, status topic_status, submitted_at timestamptz,
  submitted_by_name text, reviewed_at timestamptz, reviewed_by_name text, reviewer_comment text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_approve_curriculum() then raise exception 'Only the Founder, Co-Founder or a Super Administrator can open the Curriculum Approval Centre'; end if;
  return query
    select p.id, cs.track_id, t.name, t.position, cs.id, cs.session_no, cs.week_no, cs.title, cs.description, cs.objectives,
           p.title, p.description, p.status, p.submitted_at,
           nullif(btrim(coalesce(sb.first_name, '') || ' ' || coalesce(sb.last_name, '')), ''), p.reviewed_at,
           nullif(btrim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')), ''), p.reviewer_comment
    from curriculum_topic_proposals p
    join curriculum_sessions cs on cs.id = p.session_id
    left join tracks t on t.id = cs.track_id
    left join profiles sb on sb.id = p.submitted_by
    left join profiles rb on rb.id = p.reviewed_by
    order by t.position nulls last, cs.session_no, p.title;
end $$;
revoke all on function curriculum_proposals_list() from public, anon;
grant execute on function curriculum_proposals_list() to authenticated;

create or replace function curriculum_topic_history(p_id uuid) returns table(
  id bigint, from_status topic_status, to_status topic_status, actor_name text, comment text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_approve_curriculum() then raise exception 'Only the Founder, Co-Founder or a Super Administrator can view the approval history'; end if;
  return query
    select e.id, e.from_status, e.to_status, nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), ''), e.comment, e.created_at
    from curriculum_topic_events e left join profiles a on a.id = e.actor_id
    where e.proposal_id = p_id order by e.created_at desc, e.id desc;
end $$;
revoke all on function curriculum_topic_history(uuid) from public, anon;
grant execute on function curriculum_topic_history(uuid) to authenticated;

-- ============ 7. what the rest of the app shows ============
-- approved_topics = official teaching topics. awaiting_topics = the session's own proposed list minus anything already decided.
-- Rejected topics appear in neither. Runs with the owner's rights on purpose (it exposes only approved titles and the proposed
-- list that curriculum_sessions already shows every signed-in user).
create view v_session_topics as
  select cs.id as session_id,
    coalesce((select array_agg(p.title order by p.reviewed_at, p.title) from curriculum_topic_proposals p
              where p.session_id = cs.id and p.status = 'approved'), '{}'::text[]) as approved_topics,
    coalesce((select array_agg(u.topic order by u.n) from unnest(cs.topics) with ordinality as u(topic, n)
              where not exists (select 1 from curriculum_topic_proposals p
                                where p.session_id = cs.id and lower(btrim(p.title)) = lower(btrim(u.topic)) and p.status in ('approved', 'rejected'))), '{}'::text[]) as awaiting_topics
  from curriculum_sessions cs;
revoke all on v_session_topics from anon;
grant select on v_session_topics to authenticated;

-- ============ 8. the initial approval queue (idempotent; never approves anything, never duplicates) ============
-- Matches by track code + session number in the current programme. If a session is not found, nothing is invented for it.
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

select seed_initial_topic_proposals();   -- existing databases; a fresh `supabase db reset` runs it again at the end of seed.sql
