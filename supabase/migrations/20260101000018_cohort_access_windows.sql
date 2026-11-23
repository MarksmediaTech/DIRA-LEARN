-- DIRA LEARN: cohort intakes and learning-access windows (master instruction, Phase 5).
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- WHAT IT ADDS
--   * cohorts: intake label, season, recruitment period, learning-portal access opening and closing times.
--     (Programme start and end dates already exist as cohorts.start_date / end_date and are unchanged.)
--   * learner_access: a per-learner, per-cohort override (own opening/closing time, or suspension). Extending one learner never
--     changes the cohort and never touches another learner.
--   * learner_access_events: append-only access history.
--   * learner_access_state(): ONE function that decides pending / scheduled / active / expired / suspended from the database clock.
--   * RESTRICTIVE row level security policies: a participant whose learning access is not 'active' cannot read or write learning
--     resources, assignments, submissions, assessment results, course content or lesson progress, nor the matching storage files.
--     Restrictive policies can only narrow what existing policies allow; they never grant anything, so no other cohort's data is exposed.
-- ACCOUNT STATUS vs LEARNING ACCESS: profiles.status (active / pending / deactivated) is unchanged and separate. A learner can have an
--   active account and 'scheduled' learning access. Staff, trainers, mentors and M&E are never affected by access windows.
-- SAFE FOR EXISTING DATA: existing cohorts are back-filled so that nobody loses access they have today (opens at the earlier of the
--   cohort start date and its creation time, no closing time). Cohorts created later start with NO opening time, which means
--   'pending' (no access) until an administrator sets one. Administrators should add closing times to existing cohorts.

-- ============ 1. cohort columns ============
alter table cohorts
  add column if not exists intake_label text check (intake_label is null or length(btrim(intake_label)) between 1 and 80),
  add column if not exists season text check (season is null or length(btrim(season)) between 1 and 80),
  add column if not exists recruitment_opens_on date,
  add column if not exists recruitment_closes_on date,
  add column if not exists access_opens_at timestamptz,
  add column if not exists access_closes_at timestamptz;

alter table cohorts add constraint cohorts_recruitment_order check (recruitment_closes_on is null or recruitment_opens_on is null or recruitment_closes_on >= recruitment_opens_on);
alter table cohorts add constraint cohorts_access_order check (access_closes_at is null or access_opens_at is null or access_closes_at > access_opens_at);

update cohorts set access_opens_at = least(start_date::timestamptz, created_at) where access_opens_at is null;

create index if not exists idx_cohorts_recruitment on cohorts (recruitment_opens_on);
create index if not exists idx_cohorts_access on cohorts (access_opens_at, access_closes_at);

-- ============ 2. per-learner overrides and history ============
create type learner_access_status as enum ('pending', 'scheduled', 'active', 'expired', 'suspended');

create table learner_access (
  participant_id uuid not null references participants(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  opens_at_override timestamptz,
  closes_at_override timestamptz,
  suspended boolean not null default false,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (participant_id, cohort_id),
  constraint learner_access_order check (closes_at_override is null or opens_at_override is null or closes_at_override > opens_at_override)
);

create table learner_access_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  cohort_id uuid not null references cohorts(id) on delete cascade,
  action text not null check (action in ('override_set', 'override_cleared', 'suspended', 'reinstated')),
  opens_at timestamptz,
  closes_at timestamptz,
  reason text not null check (length(btrim(reason)) >= 5),
  actor uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_learner_access_events_p on learner_access_events (participant_id, created_at desc);
create index idx_learner_access_events_c on learner_access_events (cohort_id, created_at desc);

create or replace function block_access_event_change() returns trigger language plpgsql as $$
begin raise exception 'Access history cannot be edited or deleted'; end $$;
create trigger trg_access_events_append_only before update or delete on learner_access_events for each row execute function block_access_event_change();

create trigger aud_learner_access after insert or update or delete on learner_access for each row execute function audit_row();

alter table learner_access enable row level security;
alter table learner_access_events enable row level security;
-- Read: staff only. No insert/update/delete policy for anyone: all changes go through the functions below.
create policy learner_access_staff_read on learner_access for select to authenticated using (is_staff());
create policy learner_access_events_staff_read on learner_access_events for select to authenticated using (is_staff());

-- ============ 3. the access decision (database clock only) ============
-- Visible only for yourself, for staff, or for a trainer of that learner's cohort. Anyone else gets NULL.
create or replace function learner_access_state(p_participant uuid, p_cohort uuid) returns learner_access_status
language plpgsql stable security definer set search_path = public as $$
declare
  c cohorts; a learner_access; opens timestamptz; closes timestamptz;
begin
  if not (is_staff() or p_participant = my_participant_id() or trainer_can_see_participant(p_participant)) then return null; end if;
  select * into c from cohorts where id = p_cohort;
  if not found then return null; end if;
  if not exists (select 1 from cohort_enrolments where participant_id = p_participant and cohort_id = p_cohort) then return 'pending'; end if;
  select * into a from learner_access where participant_id = p_participant and cohort_id = p_cohort;
  if found and a.suspended then return 'suspended'; end if;
  opens := coalesce(a.opens_at_override, c.access_opens_at);
  closes := coalesce(a.closes_at_override, c.access_closes_at);
  if opens is null then return 'pending'; end if;
  if now() < opens then return 'scheduled'; end if;
  if closes is not null and now() >= closes then return 'expired'; end if;
  return 'active';
end $$;
revoke all on function learner_access_state(uuid, uuid) from public, anon;
grant execute on function learner_access_state(uuid, uuid) to authenticated;

-- True for every role except participant. A participant needs at least one enrolment whose access is 'active' right now.
create or replace function participant_access_active() returns boolean language sql stable security definer set search_path = public as $$
  select case when app_role() = 'participant' then exists (
    select 1 from cohort_enrolments e join participants p on p.id = e.participant_id
    where p.profile_id = auth.uid() and learner_access_state(e.participant_id, e.cohort_id) = 'active')
  else true end $$;
revoke all on function participant_access_active() from public, anon;
grant execute on function participant_access_active() to authenticated;

-- What the learner sees about their own access (no other learner, no other cohort).
create or replace function my_learning_access()
returns table(cohort_id uuid, cohort_name text, status learner_access_status, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.cohort_id, c.name, learner_access_state(e.participant_id, e.cohort_id),
         coalesce(a.opens_at_override, c.access_opens_at), coalesce(a.closes_at_override, c.access_closes_at)
  from cohort_enrolments e
  join participants p on p.id = e.participant_id and p.profile_id = auth.uid()
  join cohorts c on c.id = e.cohort_id
  left join learner_access a on a.participant_id = e.participant_id and a.cohort_id = e.cohort_id $$;
revoke all on function my_learning_access() from public, anon;
grant execute on function my_learning_access() to authenticated;

-- ============ 4. staff actions (all recorded in the history) ============
create or replace function set_learner_access_override(p_participant uuid, p_cohort uuid, p_opens_at timestamptz, p_closes_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only programme staff can change learner access'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'A written reason is required'; end if;
  if not exists (select 1 from cohort_enrolments where participant_id = p_participant and cohort_id = p_cohort) then
    raise exception 'The learner is not enrolled in this cohort';
  end if;
  insert into learner_access(participant_id, cohort_id, opens_at_override, closes_at_override, updated_by)
    values (p_participant, p_cohort, p_opens_at, p_closes_at, auth.uid())
  on conflict (participant_id, cohort_id) do update
    set opens_at_override = excluded.opens_at_override, closes_at_override = excluded.closes_at_override, updated_by = auth.uid(), updated_at = now();
  insert into learner_access_events(participant_id, cohort_id, action, opens_at, closes_at, reason, actor)
    values (p_participant, p_cohort, case when p_opens_at is null and p_closes_at is null then 'override_cleared' else 'override_set' end, p_opens_at, p_closes_at, btrim(p_reason), auth.uid());
end $$;
revoke all on function set_learner_access_override(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function set_learner_access_override(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function set_learner_suspension(p_participant uuid, p_cohort uuid, p_suspended boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only programme staff can change learner access'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'A written reason is required'; end if;
  if not exists (select 1 from cohort_enrolments where participant_id = p_participant and cohort_id = p_cohort) then
    raise exception 'The learner is not enrolled in this cohort';
  end if;
  insert into learner_access(participant_id, cohort_id, suspended, updated_by)
    values (p_participant, p_cohort, p_suspended, auth.uid())
  on conflict (participant_id, cohort_id) do update set suspended = excluded.suspended, updated_by = auth.uid(), updated_at = now();
  insert into learner_access_events(participant_id, cohort_id, action, reason, actor)
    values (p_participant, p_cohort, case when p_suspended then 'suspended' else 'reinstated' end, btrim(p_reason), auth.uid());
end $$;
revoke all on function set_learner_suspension(uuid, uuid, boolean, text) from public, anon;
grant execute on function set_learner_suspension(uuid, uuid, boolean, text) to authenticated;

-- Staff overview of one cohort: every enrolled learner with status and effective window.
create or replace function cohort_access_roster(p_cohort uuid)
returns table(participant_id uuid, participant_no text, learner_name text, status learner_access_status, opens_at timestamptz, closes_at timestamptz, has_override boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.participant_no, btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
         learner_access_state(p.id, e.cohort_id),
         coalesce(a.opens_at_override, c.access_opens_at), coalesce(a.closes_at_override, c.access_closes_at),
         (a.opens_at_override is not null or a.closes_at_override is not null)
  from cohort_enrolments e
  join cohorts c on c.id = e.cohort_id
  join participants p on p.id = e.participant_id
  join profiles pr on pr.id = p.profile_id
  left join learner_access a on a.participant_id = p.id and a.cohort_id = e.cohort_id
  where e.cohort_id = p_cohort and is_staff()
  order by pr.last_name, pr.first_name $$;
revoke all on function cohort_access_roster(uuid) from public, anon;
grant execute on function cohort_access_roster(uuid) to authenticated;

create or replace function learner_access_history(p_participant uuid)
returns table(created_at timestamptz, cohort_name text, action text, opens_at timestamptz, closes_at timestamptz, reason text, actor_name text)
language sql stable security definer set search_path = public as $$
  select ev.created_at, c.name, ev.action, ev.opens_at, ev.closes_at, ev.reason, btrim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, ''))
  from learner_access_events ev join cohorts c on c.id = ev.cohort_id left join profiles ap on ap.id = ev.actor
  where ev.participant_id = p_participant and is_staff() order by ev.created_at desc $$;
revoke all on function learner_access_history(uuid) from public, anon;
grant execute on function learner_access_history(uuid) to authenticated;

-- ============ 5. enforcement: restrictive policies on protected programme content ============
do $$ declare t text; begin
  foreach t in array array['learning_resources', 'assignments', 'submissions', 'assessment_results', 'course_modules', 'course_lessons', 'lesson_progress']
  loop
    execute format('drop policy if exists %I on %I', t || '_access_window', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using ((select participant_access_active())) with check ((select participant_access_active()))', t || '_access_window', t);
  end loop;
end $$;

-- Stored files: submissions and learning resources follow the same rule. Other buckets are not affected.
drop policy if exists storage_access_window on storage.objects;
create policy storage_access_window on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('submissions', 'learning-resources') or (select participant_access_active()))
  with check (bucket_id not in ('submissions', 'learning-resources') or (select participant_access_active()));
