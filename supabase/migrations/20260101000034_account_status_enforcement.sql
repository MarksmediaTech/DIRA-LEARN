-- Migration 34 - account status enforcement (post-audit fix H1/M1, 20 Nov 2026).
-- Problem: access helpers such as my_trainer_cohorts() looked only at assignment rows, so a deactivated trainer (or a trainer
-- whose role was changed) kept reading cohort submissions and enrolments and could create and edit assignments. Deactivation
-- also left the person able to sign in.
-- This migration:
--   1. account_is_active(): the one definition of "this signed-in person may use DIRA LEARN" (profile status = active).
--   2. check_request(): runs before every Data API request (PostgREST pre-request) and refuses inactive accounts, so an
--      existing session token stops working at once - also for SECURITY DEFINER functions.
--   3. A RESTRICTIVE policy on every table with row-level security, and on storage.objects, so the same rule holds for
--      Storage and Realtime, which do not run the pre-request check.
--   4. Access helpers re-check status and role (trainer, mentor, learner), so a role change or the removal of a cohort
--      assignment takes effect on the next request.
--   5. admin_set_account_status(): the only way to deactivate or reactivate (super administrator, reason required, never the
--      own account, never the last active super administrator); every change is kept in account_status_events.
--      Blocking sign-in itself (Supabase Auth ban) is done by the set-account-status Edge Function after this call.
-- Nothing is deleted: accounts, submissions, messages, audit logs and all other records stay as they are.
-- Rollback: supabase/rollback/20260101000034_account_status_enforcement_down.sql (restores the saved definitions).

-- ---------- 0. backup of everything this migration replaces (used by the rollback) ----------
create table security_fix_34_backup (kind text not null, name text not null, data text, primary key (kind, name));
alter table security_fix_34_backup enable row level security;
revoke all on security_fix_34_backup from anon, authenticated;

insert into security_fix_34_backup(kind, name, data)
select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('my_trainer_cohorts', 'mentor_has_mentee', 'is_course_trainer', 'my_participant_id', 'my_learning_access',
                    'connect_facilitator_assigned');
insert into security_fix_34_backup(kind, name, data)
select 'role_setting', 'authenticator', s from pg_roles r, unnest(coalesce(r.rolconfig, '{}'::text[])) s
where r.rolname = 'authenticator' and s like 'pgrst.db_pre_request=%' and s <> 'pgrst.db_pre_request=public.check_request';

-- ---------- 1. the rule ----------
create or replace function account_is_active() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.status = 'active' from profiles p where p.id = auth.uid()), false) $$;
comment on function account_is_active() is 'True only for a signed-in person whose DIRA LEARN profile is active (migration 34).';

-- ---------- 2. pre-request check for the Data API ----------
create or replace function check_request() returns void language plpgsql stable security definer set search_path = public as $$
begin
  -- Signed-out visitors and server calls (no user id) pass; RLS and grants still apply to them.
  if auth.uid() is not null and exists (select 1 from profiles p where p.id = auth.uid() and p.status <> 'active') then
    raise exception using errcode = '42501', message = 'DIRA_ACCOUNT_INACTIVE',
      hint = 'This account is not active. Contact the DIRA Foundation programme team.';
  end if;
end $$;
comment on function check_request() is 'PostgREST pre-request check (migration 34): refuses every Data API request from an inactive account.';

do $$
declare previous text := (select data from security_fix_34_backup where kind = 'role_setting' and name = 'authenticator');
begin
  if previous is not null and previous <> 'pgrst.db_pre_request=public.check_request' then
    raise exception 'The API already uses another pre-request function (%). Stop and combine them by hand; nothing was changed.', previous;
  end if;
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.check_request''';
  notify pgrst, 'reload config';
exception when insufficient_privilege then
  -- The table-level rules below still protect every table; report the missing step instead of failing the deployment.
  raise warning 'Could not register check_request() as the API pre-request function (no permission). Run in the SQL Editor: alter role authenticator set pgrst.db_pre_request = ''public.check_request''; notify pgrst, ''reload config'';';
end $$;

-- ---------- 3. restrictive policies: inactive accounts see and change nothing (Data API, Storage, Realtime) ----------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
           order by 1 loop
    execute format('create policy dira_active_account on public.%I as restrictive for all to authenticated '
                   'using ((select account_is_active())) with check ((select account_is_active()))', t.relname);
  end loop;
end $$;
create policy dira_active_account on storage.objects as restrictive for all to authenticated
  using ((select account_is_active())) with check ((select account_is_active()));

-- ---------- 4. access helpers re-check status and role ----------
-- app_role() already returns NULL for inactive profiles, so "app_role() = 'trainer'" means "an active trainer, now".
create or replace function my_trainer_cohorts() returns setof uuid language sql stable security definer set search_path = public as $$
  select ta.cohort_id from trainer_assignments ta where ta.trainer_id = auth.uid() and app_role() = 'trainer' $$;
create or replace function mentor_has_mentee(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app_role() is not distinct from 'mentor'
     and exists (select 1 from mentorship_assignments m where m.mentor_id = auth.uid() and m.participant_id = pid) $$;
create or replace function is_course_trainer(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app_role() is not distinct from 'trainer'
     and exists (select 1 from course_trainers where course_id = cid and trainer_id = auth.uid()) $$;
create or replace function my_participant_id() returns uuid language sql stable security definer set search_path = public as $$
  select pa.id from participants pa join profiles p on p.id = pa.profile_id
  where pa.profile_id = auth.uid() and p.status = 'active' $$;
create or replace function my_learning_access()
returns table(cohort_id uuid, cohort_name text, status learner_access_status, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.cohort_id, c.name, learner_access_state(e.participant_id, e.cohort_id),
         coalesce(a.opens_at_override, c.access_opens_at), coalesce(a.closes_at_override, c.access_closes_at)
  from cohort_enrolments e
  join participants p on p.id = e.participant_id and p.profile_id = auth.uid()
  join profiles pr on pr.id = p.profile_id and pr.status = 'active'
  join cohorts c on c.id = e.cohort_id
  left join learner_access a on a.participant_id = e.participant_id and a.cohort_id = e.cohort_id $$;
-- A learner cannot start or continue a private conversation with someone who is no longer an active trainer.
create or replace function connect_facilitator_assigned(p_learner uuid, p_facilitator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trainer_assignments ta
                 join cohort_enrolments e on e.cohort_id = ta.cohort_id
                 join profiles f on f.id = ta.trainer_id and f.status = 'active' and f.role = 'trainer'
                 where ta.trainer_id = p_facilitator and e.participant_id = p_learner) $$;

-- ---------- 5. deactivation and reactivation ----------
create table account_status_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  old_status account_status not null,
  new_status account_status not null,
  reason text not null check (length(btrim(reason)) between 10 and 500),
  changed_by uuid references profiles(id),
  sign_in_blocked boolean,               -- set by the set-account-status Edge Function after the Supabase Auth ban or unban
  created_at timestamptz not null default now()
);
create index account_status_events_profile_idx on account_status_events(profile_id, created_at desc);
alter table account_status_events enable row level security;
create policy dira_active_account on account_status_events as restrictive for all to authenticated
  using ((select account_is_active())) with check ((select account_is_active()));
create policy ase_read on account_status_events for select to authenticated using (is_executive());
revoke insert, update, delete, truncate on account_status_events from anon, authenticated;

create or replace function guard_account_status_events() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Account status history cannot be deleted'; end if;
  if not is_trusted_session()
     or new.profile_id <> old.profile_id or new.old_status <> old.old_status or new.new_status <> old.new_status
     or new.reason <> old.reason or new.changed_by is distinct from old.changed_by or new.created_at <> old.created_at then
    raise exception 'Account status history cannot be changed';
  end if;
  return new;
end $$;
create trigger trg_guard_account_status_events before update or delete on account_status_events
  for each row execute function guard_account_status_events();
create trigger aud_account_status_events after insert or update on account_status_events for each row execute function audit_row();

-- Status changes outside admin_set_account_status() (or a server process) are refused, so every change has a reason.
create or replace function guard_profile_status_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not is_trusted_session()
     and coalesce(current_setting('dira.account_status_change', true), '') <> 'on' then
    raise exception 'Account status is changed only with Deactivate or Reactivate on the Users page (a reason is required)';
  end if;
  return new;
end $$;
create trigger trg_guard_profile_status_change before update of status on profiles
  for each row execute function guard_profile_status_change();

create or replace function admin_set_account_status(p_profile uuid, p_status account_status, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare cur record; ev uuid;
begin
  if not is_admin() then
    raise exception 'Only a super administrator can deactivate or reactivate accounts' using errcode = '42501';
  end if;
  if p_profile is null or p_profile = auth.uid() then raise exception 'You cannot change the status of your own account'; end if;
  if p_status is null or p_status not in ('active', 'deactivated') then raise exception 'The new status must be active or deactivated'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 or length(btrim(p_reason)) > 500 then
    raise exception 'Give a reason of 10 to 500 characters';
  end if;
  select id, role, status into cur from profiles where id = p_profile for update;
  if not found then raise exception 'Account not found'; end if;
  if cur.status = p_status then raise exception 'The account is already %', p_status; end if;
  if p_status = 'deactivated' and cur.role = 'super_admin'
     and not exists (select 1 from profiles where role = 'super_admin' and status = 'active' and id <> p_profile) then
    raise exception 'The last active super administrator cannot be deactivated';
  end if;
  perform set_config('dira.account_status_change', 'on', true);
  update profiles set status = p_status where id = p_profile;
  perform set_config('dira.account_status_change', 'off', true);
  insert into account_status_events(profile_id, old_status, new_status, reason, changed_by)
  values (p_profile, cur.status, p_status, btrim(p_reason), auth.uid()) returning id into ev;
  return ev;
end $$;
comment on function admin_set_account_status(uuid, account_status, text) is
  'Deactivate or reactivate an account with a reason (super administrator only). Records account_status_events. Migration 34.';

-- ---------- 6. execute rights (new functions are not callable by signed-out visitors, except the pre-request check) ----------
revoke execute on function account_is_active(), admin_set_account_status(uuid, account_status, text),
  guard_account_status_events(), guard_profile_status_change() from public, anon;
grant execute on function account_is_active(), admin_set_account_status(uuid, account_status, text) to authenticated, service_role;
revoke execute on function check_request() from public;
grant execute on function check_request() to anon, authenticated, service_role;
