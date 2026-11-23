-- DIRA LEARN V13: curriculum revision - Digital Marketing replaces Digital Skills, and every session gets a detailed lesson plan.
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000030_curriculum_v13_down.sql
-- GENERATED: this file is built by tools/curriculum/build_v13.py from tools/curriculum/migration_30_template.sql (rules, sections 1-5)
-- and curriculum/v13/*.yaml (content, section 6). Edit those, then run the build.
--
-- WHAT CHANGES
--   * The track with code 'digital' is renamed from Digital Skills to Digital Marketing. Its id and code stay the same, so every
--     enrolment, application preference, schedule, assignment and result keeps pointing at the same track.
--   * New: curriculum_lesson_plans (what learners see: purpose, objectives, topics, timed segments, activities, assessment
--     questions, expected outputs, homework) and curriculum_teaching_notes (staff and facilitators only: step-by-step teaching
--     content, demonstrations, marking guidance, facilitator instructions). One of each per curriculum session.
--   * Draft session records (title, description, objectives, activities, expected output, notes) are refreshed to V13.
--
-- WHAT NEVER CHANGES
--   * No duration, week, session number, track, date, time or timetable allocation. A lesson plan is only attached when the
--     session's duration equals the V13 plan; the segments of every plan must add up to the session's duration, and the
--     database refuses any lesson plan (or later duration change) where they do not.
--   * An APPROVED session record is never edited (Entrepreneurship & Business session 4, Value proposition and business model).
--   * curriculum_sessions.topics and the Curriculum Approval Centre (proposals and their history) are not touched.
--   * Nothing is approved: every new lesson plan is a draft until a Super Administrator, Founder, Co-Founder or Programme
--     Director approves it (the same people who approve curriculum sessions today).
--   * A session record or lesson plan that someone has already edited is left as it is (the outcome is reported).
--   * No user data, permission, safeguarding rule or security policy outside these new tables is changed.

-- ============ 1. tables ============
create type lesson_plan_status as enum ('draft', 'approved');

create table curriculum_lesson_plans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references curriculum_sessions(id) on delete restrict,
  version text not null check (length(btrim(version)) between 1 and 40),
  content jsonb not null,
  status lesson_plan_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint lesson_plan_shape check (
    jsonb_typeof(content) = 'object' and content ? 'purpose'
    and jsonb_typeof(content -> 'objectives') = 'array' and jsonb_typeof(content -> 'topics') = 'array'
    and jsonb_typeof(content -> 'segments') = 'array' and jsonb_array_length(content -> 'segments') between 1 and 20),
  constraint lesson_plan_size check (pg_column_size(content) < 200000),
  constraint lesson_plan_approval_fields check ((status = 'draft' and approved_at is null and approved_by is null) or (status = 'approved' and approved_at is not null))
);

create table curriculum_teaching_notes (                     -- facilitator material; never shown to learners or applicants
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references curriculum_lesson_plans(session_id) on delete cascade,
  content jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint teaching_notes_shape check (jsonb_typeof(content) = 'object' and jsonb_typeof(content -> 'segments') = 'array'),
  constraint teaching_notes_size check (pg_column_size(content) < 300000)
);

-- The V13 content as delivered (data only, read by load_curriculum_v13), and the values it replaced (used by the rollback).
create table curriculum_v13_tracks (code text primary key, name text not null, focus text not null, previous_name text not null, previous_focus text);
create table curriculum_v13_sessions (
  track_code text not null, session_no int not null, week_no int not null, duration_minutes int not null,
  previous_title text not null, preserve_approved boolean not null, session jsonb not null, plan jsonb not null, notes jsonb not null,
  primary key (track_code, session_no));
create table curriculum_v13_previous (kind text not null check (kind in ('track', 'session')), ref uuid not null, data jsonb not null,
  saved_at timestamptz not null default now(), primary key (kind, ref));
alter table curriculum_v13_tracks enable row level security;
alter table curriculum_v13_sessions enable row level security;
alter table curriculum_v13_previous enable row level security;   -- no policies: not readable or writable through the API
revoke all on curriculum_v13_tracks, curriculum_v13_sessions, curriculum_v13_previous from anon, authenticated;

-- ============ 2. who may do what ============
-- Edit: the same people who may edit curriculum sessions today (executives and the programme coordinator).
-- Approve: the same people who may approve curriculum sessions today (set_curriculum_approval).
-- Read teaching notes: programme staff and facilitators. Learners, applicants, mentors and M&E officers cannot.
create or replace function can_edit_curriculum() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_executive() or app_role() = 'programme_coordinator', false) $$;
create or replace function can_approve_lesson_plans() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'founder', 'co_founder', 'programme_director'), false) $$;
create or replace function can_read_teaching_notes() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer'), false) $$;
revoke all on function can_edit_curriculum(), can_approve_lesson_plans(), can_read_teaching_notes() from public, anon;
grant execute on function can_edit_curriculum(), can_approve_lesson_plans(), can_read_teaching_notes() to authenticated;

alter table curriculum_lesson_plans enable row level security;
alter table curriculum_teaching_notes enable row level security;
create policy lesson_plans_read on curriculum_lesson_plans for select to authenticated using (true);   -- like curriculum_sessions
create policy lesson_plans_insert on curriculum_lesson_plans for insert to authenticated with check (can_edit_curriculum());
create policy lesson_plans_update on curriculum_lesson_plans for update to authenticated using (can_edit_curriculum()) with check (can_edit_curriculum());
create policy lesson_plans_delete on curriculum_lesson_plans for delete to authenticated using (is_executive());
create policy teaching_notes_read on curriculum_teaching_notes for select to authenticated using (can_read_teaching_notes());
create policy teaching_notes_insert on curriculum_teaching_notes for insert to authenticated with check (can_edit_curriculum());
create policy teaching_notes_update on curriculum_teaching_notes for update to authenticated using (can_edit_curriculum()) with check (can_edit_curriculum());
create policy teaching_notes_delete on curriculum_teaching_notes for delete to authenticated using (is_executive());
revoke all on curriculum_lesson_plans, curriculum_teaching_notes from anon;
grant select, insert, update, delete on curriculum_lesson_plans, curriculum_teaching_notes to authenticated;

-- ============ 3. guards ============
-- Approval can only be given by an approver; any edit of approved content sends it back to draft; approval fields cannot be forged.
create or replace function guard_lesson_plan() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if is_trusted_session() then return new; end if;                 -- migrations, seed and service role
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      if not can_approve_lesson_plans() then raise exception 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.approved_by := null; new.approved_at := null;
    end if;
    return new;
  end if;
  if new.session_id is distinct from old.session_id then raise exception 'A lesson plan cannot be moved to another session'; end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      if not can_approve_lesson_plans() then raise exception 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.approved_by := null; new.approved_at := null;             -- back to draft: allowed for anyone who may edit
    end if;
  elsif old.status = 'approved' and (new.content, new.version) is distinct from (old.content, old.version) then
    new.status := 'draft'; new.approved_by := null; new.approved_at := null;   -- edited after approval: needs approval again
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;
create trigger trg_guard_lesson_plan before insert or update on curriculum_lesson_plans for each row execute function guard_lesson_plan();

-- Changing the teaching notes of an approved plan also sends the plan back to draft.
create or replace function guard_teaching_notes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if is_trusted_session() then return new; end if;
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then raise exception 'Teaching notes cannot be moved to another session'; end if;
  if tg_op = 'INSERT' or new.content is distinct from old.content then
    update curriculum_lesson_plans set status = 'draft' where session_id = new.session_id and status = 'approved';
  end if;
  return new;
end $$;
create trigger trg_guard_teaching_notes before insert or update on curriculum_teaching_notes for each row execute function guard_teaching_notes();

-- Timing: the segments must add up exactly to the session's timetabled duration. Checked at the end of each transaction, so a
-- duration and its plan can only ever change together, and never so that they disagree.
create or replace function lesson_plan_timing_problem(p_session uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare dur int; segs jsonb; nsegs int; total int; bad int; notes_segs int;
begin
  select cs.duration_minutes, lp.content -> 'segments', jsonb_array_length(tn.content -> 'segments')
    into dur, segs, notes_segs
    from curriculum_sessions cs join curriculum_lesson_plans lp on lp.session_id = cs.id
    left join curriculum_teaching_notes tn on tn.session_id = cs.id
   where cs.id = p_session;
  if segs is null then return null; end if;                          -- no lesson plan: nothing to check
  select count(*) filter (where jsonb_typeof(e -> 'minutes') <> 'number' or (e ->> 'minutes')::numeric <> trunc((e ->> 'minutes')::numeric) or (e ->> 'minutes')::numeric < 1)
    into bad from jsonb_array_elements(segs) e;
  if bad > 0 then return 'every segment needs a whole number of minutes (at least 1)'; end if;
  select sum((e ->> 'minutes')::int), count(*) into total, nsegs from jsonb_array_elements(segs) e;
  if total <> dur then return format('the segments add up to %s minutes but the session is %s minutes', total, dur); end if;
  if notes_segs is not null and notes_segs <> nsegs then return format('the teaching notes have %s segments but the lesson plan has %s', notes_segs, nsegs); end if;
  return null;
end $$;
revoke all on function lesson_plan_timing_problem(uuid) from public, anon;
grant execute on function lesson_plan_timing_problem(uuid) to authenticated;

create or replace function check_lesson_plan_timing() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; problem text;
begin
  if tg_table_name = 'curriculum_sessions' then sid := new.id; else sid := new.session_id; end if;
  problem := lesson_plan_timing_problem(sid);
  if problem is not null then
    raise exception 'Lesson plan timing does not match the timetable: %', problem using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger trg_lesson_plan_timing after insert or update on curriculum_lesson_plans
  deferrable initially deferred for each row execute function check_lesson_plan_timing();
create constraint trigger trg_teaching_notes_timing after insert or update on curriculum_teaching_notes
  deferrable initially deferred for each row execute function check_lesson_plan_timing();
create constraint trigger trg_session_duration_vs_plan after update of duration_minutes on curriculum_sessions
  deferrable initially deferred for each row when (new.duration_minutes is distinct from old.duration_minutes) execute function check_lesson_plan_timing();

create trigger aud_lesson_plans after insert or update or delete on curriculum_lesson_plans for each row execute function audit_row();
create trigger aud_teaching_notes after insert or update or delete on curriculum_teaching_notes for each row execute function audit_row();

-- ============ 4. approval (for the Programme Director, who approves but does not edit) ============
create or replace function set_lesson_plan_approval(p_session uuid, p_approved boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_approve_lesson_plans() then
    raise exception 'Only a super administrator, founder, co-founder or programme director can approve a lesson plan';
  end if;
  update curriculum_lesson_plans set status = case when p_approved then 'approved'::lesson_plan_status else 'draft'::lesson_plan_status end
   where session_id = p_session;
  if not found then raise exception 'This session has no lesson plan'; end if;
end $$;
revoke all on function set_lesson_plan_approval(uuid, boolean) from public, anon;
grant execute on function set_lesson_plan_approval(uuid, boolean) to authenticated;

-- ============ 5. applying the V13 content (idempotent; reports every outcome; approves nothing) ============
-- Tracks: the name changes only while it is still the previous name; the focus text only while it is still the previous text.
-- Sessions are matched by track code and session number. A session is skipped if its duration differs from the V13 plan.
-- Session records are refreshed only when not approved and not edited since the seed. Existing lesson plans are never replaced.
create or replace function load_curriculum_v13() returns table(item text, outcome text) language plpgsql security definer set search_path = public as $$
declare
  prog constant uuid := '00000000-0000-0000-0000-0000000000a1';
  t record; s record; tr record; cs record; n int; rec jsonb; obj text[]; act text[];
begin
  for t in select * from curriculum_v13_tracks order by code loop
    item := 'track ' || t.code;
    select * into tr from tracks where programme_id = prog and code = t.code;
    if not found then outcome := 'skipped: track not found'; return next; continue; end if;
    if tr.name = t.name and tr.focus is not distinct from t.focus then outcome := 'already current'; return next; continue; end if;
    insert into curriculum_v13_previous(kind, ref, data) values ('track', tr.id, jsonb_build_object('name', tr.name, 'focus', tr.focus)) on conflict do nothing;
    outcome := '';
    if tr.name = t.name then null;
    elsif tr.name = t.previous_name then update tracks set name = t.name where id = tr.id; outcome := 'renamed to ' || t.name;
    elsif tr.name <> t.name then outcome := 'name kept (edited since the seed: ' || tr.name || ')'; end if;
    if tr.focus is not distinct from t.focus then null;
    elsif tr.focus is not distinct from t.previous_focus then update tracks set focus = t.focus where id = tr.id; outcome := concat_ws('; ', nullif(outcome, ''), 'focus updated');
    elsif tr.focus is distinct from t.focus then outcome := concat_ws('; ', nullif(outcome, ''), 'focus kept (edited since the seed)'); end if;
    return next;
  end loop;

  for s in select * from curriculum_v13_sessions order by case when track_code = 'core' then 0 else 1 end, track_code, session_no loop
    item := case when s.track_code = 'core' then 'core' else s.track_code end || ' session ' || s.session_no;
    select c.* into cs from curriculum_sessions c left join tracks tk on tk.id = c.track_id
     where c.programme_id = prog and c.session_no = s.session_no
       and ((s.track_code = 'core' and c.track_id is null) or (s.track_code <> 'core' and tk.code = s.track_code));
    if not found then outcome := 'skipped: session not found'; return next; continue; end if;
    if cs.duration_minutes <> s.duration_minutes then
      outcome := format('skipped: the session is %s minutes but the V13 plan is %s (durations are never changed)', cs.duration_minutes, s.duration_minutes);
      return next; continue;
    end if;
    rec := s.session;
    obj := array(select jsonb_array_elements_text(rec -> 'objectives'));
    act := array(select jsonb_array_elements_text(rec -> 'activities'));
    if s.preserve_approved or cs.is_approved then
      outcome := 'approved session record kept unchanged';
    elsif (cs.title, cs.description, cs.objectives, cs.activities, cs.expected_output, cs.assessment_notes)
          is not distinct from (rec ->> 'title', rec ->> 'description', obj, act, rec ->> 'expected_output', rec ->> 'assessment_notes') then
      outcome := 'session record already current';
    elsif cs.title in (s.previous_title, rec ->> 'title') then
      insert into curriculum_v13_previous(kind, ref, data) values ('session', cs.id, jsonb_build_object(
        'title', cs.title, 'description', cs.description, 'objectives', to_jsonb(cs.objectives), 'activities', to_jsonb(cs.activities),
        'expected_output', cs.expected_output, 'assessment_notes', cs.assessment_notes, 'source', cs.source)) on conflict do nothing;
      update curriculum_sessions set title = rec ->> 'title', description = rec ->> 'description', objectives = obj, activities = act,
             expected_output = rec ->> 'expected_output', assessment_notes = rec ->> 'assessment_notes', source = 'curriculum_v13'
       where id = cs.id;
      outcome := 'session record updated';
    else
      outcome := 'session record kept (edited since the seed)';
    end if;
    insert into curriculum_lesson_plans(session_id, version, content) values (cs.id, 'V13', s.plan) on conflict (session_id) do nothing;
    get diagnostics n = row_count;
    if n = 1 then
      insert into curriculum_teaching_notes(session_id, content) values (cs.id, s.notes) on conflict (session_id) do nothing;
      outcome := outcome || '; lesson plan and teaching notes added (draft)';
    else
      outcome := outcome || '; lesson plan already present, not changed';
    end if;
    return next;
  end loop;
end $$;
revoke all on function load_curriculum_v13() from public, anon, authenticated;
