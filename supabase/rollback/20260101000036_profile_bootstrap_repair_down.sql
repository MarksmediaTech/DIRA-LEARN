-- Rollback for 20260101000036_profile_bootstrap_repair.sql. ONE transaction.
-- Restores handle_new_user() and the trigger state from before migration 36 (if the trigger was missing or disabled before, it
-- is missing or disabled again - new registrations would then again get no profile).
-- Profiles that migration 36 back-filled are KEPT: they belong to real sign-in accounts and may already be used
-- (applications etc.). Their ids are listed in the notice below before the backup table is removed.
begin;
do $$
declare f text; t text; ids text;
begin
  select data into f from profile_repair_36_backup where kind = 'function' and name = 'handle_new_user';
  select data into t from profile_repair_36_backup where kind = 'trigger';
  if f is not null then execute f; end if;
  if t = 'missing' then drop trigger if exists on_auth_user_created on auth.users;
  elsif t = 'disabled' then alter table auth.users disable trigger on_auth_user_created; end if;
  select string_agg(name, ', ') into ids from profile_repair_36_backup where kind = 'backfilled';
  raise notice 'rollback 36: trigger restored to "%"; back-filled profiles kept: %', t, coalesce(ids, 'none');
end $$;
drop table profile_repair_36_backup;
commit;
