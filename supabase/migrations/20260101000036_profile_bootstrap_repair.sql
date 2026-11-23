-- Migration 36 - every sign-in account has exactly one profile (repair for "Loading your account…", 20 Nov 2026).
-- New accounts get their profile from the trigger on_auth_user_created (migration 02): role 'applicant', status 'active',
-- the lowest access in DIRA LEARN. If that trigger is missing or was disabled in a database, people can register and verify
-- their email but have no profile, and the app cannot let them in. This migration:
--   1. keeps handle_new_user() exactly as before, except that it never fails or duplicates when a profile already exists;
--   2. (re)creates the trigger on auth.users if it is missing or disabled;
--   3. gives every existing sign-in account WITHOUT a profile the same profile the trigger would have created.
-- Nobody gets more access than a new applicant; existing profiles (roles, statuses) are not touched; nothing is deleted.
-- Safe to run more than once. Rollback: supabase/rollback/20260101000036_profile_bootstrap_repair_down.sql

create table if not exists profile_repair_36_backup (kind text not null, name text not null, data text, primary key (kind, name));
alter table profile_repair_36_backup enable row level security;
revoke all on profile_repair_36_backup from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profile_repair_36_backup' and policyname = 'dira_active_account') then
    create policy dira_active_account on profile_repair_36_backup as restrictive for all to authenticated
      using ((select account_is_active())) with check ((select account_is_active()));
  end if;
end $$;

insert into profile_repair_36_backup(kind, name, data)
select 'function', 'handle_new_user', pg_get_functiondef('public.handle_new_user()'::regprocedure)
on conflict do nothing;
insert into profile_repair_36_backup(kind, name, data)
select 'trigger', 'on_auth_user_created', coalesce((select case tgenabled when 'D' then 'disabled' else 'enabled' end
  from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'), 'missing')
on conflict do nothing;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, role, status) values (new.id, 'applicant', 'active') on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

do $$
declare n int;
begin
  with added as (
    insert into profiles(id, role, status)
    select u.id, 'applicant', 'active' from auth.users u
    where not exists (select 1 from profiles p where p.id = u.id)
    on conflict (id) do nothing
    returning id)
  insert into profile_repair_36_backup(kind, name, data) select 'backfilled', id::text, now()::text from added on conflict do nothing;
  get diagnostics n = row_count;
  raise notice 'migration 36: % sign-in account(s) without a profile received the applicant profile; trigger before: %', n,
    (select data from profile_repair_36_backup where kind = 'trigger');
end $$;

