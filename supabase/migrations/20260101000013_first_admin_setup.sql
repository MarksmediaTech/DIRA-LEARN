-- First-time setup inside the app: the first super administrator is claimed on the /setup page, not with SQL.
-- The Edge Function `claim-first-admin` checks a secret setup code (SETUP_CODE) and then calls claim_first_admin().
-- NOT yet executed or tested.

-- Is there still no active super administrator? Signed-in users only (anonymous visitors cannot ask).
create or replace function first_admin_needed() returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where role = 'super_admin' and status = 'active') $$;
revoke all on function first_admin_needed() from public, anon;
grant execute on function first_admin_needed() to authenticated, service_role;

-- Promote one applicant account to super administrator, only while there is no active super administrator.
-- An advisory lock makes two simultaneous claims safe: the second sees the first and gets false.
-- Only the service role (the Edge Function) can run this; browsers cannot.
create or replace function claim_first_admin(p_user uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare changed int;
begin
  perform pg_advisory_xact_lock(hashtext('dira_claim_first_admin'));
  if exists (select 1 from profiles where role = 'super_admin' and status = 'active') then return false; end if;
  update profiles set role = 'super_admin', status = 'active' where id = p_user and role = 'applicant';
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function claim_first_admin(uuid) from public, anon, authenticated;
grant execute on function claim_first_admin(uuid) to service_role;
