-- DIRA LEARN: Daily Briefs (master instruction, Phase 3).
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- WHAT IT ADDS
--   * daily_briefs: one brief per day, for one cohort or for all cohorts (cohort_id null). Draft, scheduled, published, withdrawn.
--   * brief_publishers: which programme staff and facilitators are AUTHORISED to write and publish briefs. Super Admin, Founder and
--     Co-Founder are always authorised and are the only ones who can grant or remove authorisation.
--   * daily_brief_events: append-only publication history (created, edited, scheduled, published, withdrawn ...).
--   * Scheduling: a scheduled brief becomes visible to learners at its time through the read policy itself (no timer needed);
--     publish_due_briefs() (called by the send-emails schedule) then marks it published and records the history.
-- WHO MAY DO WHAT
--   learners: read published briefs for their own cohort(s), or for all cohorts, while their learning access is Active. Nothing else.
--   authorised facilitators (trainers): write briefs for THEIR OWN cohorts only, never "all cohorts".
--   authorised staff (director, coordinator): any cohort or all cohorts.
--   executives: everything, plus granting authorisation.
--   Everyone else: nothing. Unauthorised publishing is refused by the database, not only hidden on screen.
-- DECISION FOR MANAGEMENT: "authorised" is implemented as an explicit grant by an executive. See docs/DAILY_BRIEFS.md.

create type brief_status as enum ('draft', 'scheduled', 'published', 'withdrawn');

-- ============ authorised publishers ============
create table brief_publishers (
  profile_id uuid primary key references profiles(id) on delete cascade,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now()
);
create or replace function guard_brief_publisher() returns trigger language plpgsql security definer set search_path = public as $$
declare r role_code;
begin
  select role into r from profiles where id = new.profile_id;
  if r is null or r not in ('programme_director', 'programme_coordinator', 'trainer') then
    raise exception 'Only programme staff and facilitators can be authorised to publish briefs (executives already can)';
  end if;
  new.granted_by := coalesce(auth.uid(), new.granted_by);
  return new;
end $$;
create trigger trg_guard_brief_publisher before insert on brief_publishers for each row execute function guard_brief_publisher();
create trigger aud_brief_publishers after insert or update or delete on brief_publishers for each row execute function audit_row();
alter table brief_publishers enable row level security;
create policy bp_read   on brief_publishers for select to authenticated using (is_executive() or profile_id = auth.uid());
create policy bp_insert on brief_publishers for insert to authenticated with check (is_executive());
create policy bp_delete on brief_publishers for delete to authenticated using (is_executive());

create or replace function can_publish_briefs() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_executive() or (app_role() in ('programme_director', 'programme_coordinator', 'trainer')
         and exists (select 1 from brief_publishers bp where bp.profile_id = auth.uid())), false) $$;
revoke all on function can_publish_briefs() from public, anon;
grant execute on function can_publish_briefs() to authenticated;

-- ============ briefs ============
create table daily_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null,
  cohort_id uuid references cohorts(id),                         -- null = all relevant cohorts
  title text not null check (length(btrim(title)) between 3 and 120),
  reflection text check (reflection is null or length(reflection) <= 1200),
  objectives text[] not null default '{}' check (cardinality(objectives) <= 8),
  reflection_question text check (reflection_question is null or length(reflection_question) <= 400),
  status brief_status not null default 'draft',
  publish_at timestamptz,
  published_at timestamptz,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_briefs_schedule_needs_time check (status <> 'scheduled' or publish_at is not null)
);
-- One live (scheduled or published) brief per day per audience; withdraw it to replace it.
create unique index uq_daily_briefs_live on daily_briefs (brief_date, coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('scheduled', 'published');
create index idx_daily_briefs_date on daily_briefs (brief_date desc);
create index idx_daily_briefs_cohort on daily_briefs (cohort_id, brief_date desc);

create or replace function brief_is_live(p_status brief_status, p_publish_at timestamptz) returns boolean language sql stable as $$
  select p_status = 'published' or (p_status = 'scheduled' and p_publish_at is not null and p_publish_at <= now()) $$;

create or replace function guard_daily_brief() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not is_trusted_session() then
      if not can_publish_briefs() then raise exception 'You are not authorised to publish daily briefs'; end if;
      if old.status <> 'draft' then raise exception 'Only drafts can be deleted. Withdraw a published brief instead'; end if;
    end if;
    return old;
  end if;

  if not is_trusted_session() then
    if not can_publish_briefs() then raise exception 'You are not authorised to publish daily briefs'; end if;
    if app_role() = 'trainer' then
      if new.cohort_id is null or new.cohort_id not in (select my_trainer_cohorts()) then
        raise exception 'Facilitators can write briefs only for their own cohorts';
      end if;
      if tg_op = 'UPDATE' and (old.cohort_id is null or old.cohort_id not in (select my_trainer_cohorts())) then
        raise exception 'Facilitators can edit briefs only for their own cohorts';
      end if;
    end if;
    if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled' or old.publish_at is distinct from new.publish_at)
       and (new.publish_at is null or new.publish_at <= now()) then
      raise exception 'Choose a future time to schedule publication';
    end if;
  end if;

  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then new.published_at := now(); end if;
  if new.status = 'draft' then new.published_at := null; end if;
  if new.status <> 'scheduled' and new.status <> 'published' and new.status <> 'withdrawn' then new.publish_at := null; end if;
  return new;
end $$;
create trigger trg_guard_daily_brief before insert or update or delete on daily_briefs for each row execute function guard_daily_brief();

-- ============ publication history (append-only) ============
create table daily_brief_events (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null,                                    -- no foreign key: history outlives a deleted draft
  action text not null check (action in ('created', 'edited', 'scheduled', 'published', 'published_on_schedule', 'withdrawn', 'returned_to_draft')),
  title text not null,
  brief_date date not null,
  cohort_id uuid,
  actor uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_daily_brief_events_brief on daily_brief_events (brief_id, created_at desc);
create or replace function block_brief_event_change() returns trigger language plpgsql as $$
begin raise exception 'Publication history cannot be edited or deleted'; end $$;
create trigger trg_brief_events_append_only before update or delete on daily_brief_events for each row execute function block_brief_event_change();

create or replace function log_daily_brief() returns trigger language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'INSERT' then act := 'created';
  elsif old.status is distinct from new.status then
    act := case new.status
      when 'published' then case when old.status = 'scheduled' and auth.uid() is null then 'published_on_schedule' else 'published' end
      when 'scheduled' then 'scheduled'
      when 'withdrawn' then 'withdrawn'
      else 'returned_to_draft' end;
  else act := 'edited';
  end if;
  insert into daily_brief_events(brief_id, action, title, brief_date, cohort_id, actor) values (new.id, act, new.title, new.brief_date, new.cohort_id, auth.uid());
  return new;
end $$;
create trigger trg_log_daily_brief after insert or update on daily_briefs for each row execute function log_daily_brief();

-- ============ row level security ============
alter table daily_briefs enable row level security;
alter table daily_brief_events enable row level security;

create policy db_staff_read on daily_briefs for select to authenticated using (is_staff());
create policy db_trainer_read on daily_briefs for select to authenticated using (
  app_role() = 'trainer' and (cohort_id in (select my_trainer_cohorts()) or (cohort_id is null and brief_is_live(status, publish_at))));
create policy db_learner_read on daily_briefs for select to authenticated using (
  app_role() = 'participant' and brief_is_live(status, publish_at)
  and (cohort_id is null or cohort_id in (select e.cohort_id from cohort_enrolments e where e.participant_id = my_participant_id())));
create policy db_insert on daily_briefs for insert to authenticated with check (can_publish_briefs());
create policy db_update on daily_briefs for update to authenticated using (can_publish_briefs()) with check (can_publish_briefs());
create policy db_delete on daily_briefs for delete to authenticated using (can_publish_briefs() and status = 'draft');
-- A learner whose learning access is not Active sees no briefs (migration 18). Restrictive: it can only narrow.
create policy daily_briefs_access_window on daily_briefs as restrictive for select to authenticated using ((select participant_access_active()));

create policy dbe_read on daily_brief_events for select to authenticated using (is_staff() or can_publish_briefs());

-- ============ scheduled publication sweep (service role only; send-emails calls it) ============
create or replace function publish_due_briefs() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update daily_briefs set status = 'published', published_at = now() where status = 'scheduled' and publish_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function publish_due_briefs() from public, anon, authenticated;
grant execute on function publish_due_briefs() to service_role;
