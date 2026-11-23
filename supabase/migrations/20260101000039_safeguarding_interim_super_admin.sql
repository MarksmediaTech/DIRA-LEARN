-- Migration 39 - safeguarding: Super Administrators hold interim access until a Lead or Deputy is appointed (21 Nov 2026).
-- OWNER DECISION (21 Nov 2026): "Super Admins can read safeguarding records until a Safeguarding Lead or Deputy is appointed."
-- It changes the rule of migration 24 (19 Nov 2026), under which nobody could read records before an appointment.
--
-- How: sg_my_position() returns 'interim' for an ACTIVE profile with role super_admin while NO active Safeguarding Lead or
-- Deputy is appointed. Every safeguarding permission already follows sg_my_position() through is_safeguarding_officer(), so the
-- interim holder can do what an officer can do: read and update records, add notes and referrals, see the access log, and
-- handle the safeguarding-team conversations in DIRA Connect, and see open concerns on the dashboard. sg_officer_ids() returns
-- the same interim holders, so they receive the URGENT-concern and OVERDUE alerts (which follow sg_officer_ids). A standard
-- concern alerts only the acting Lead/Deputy (sg_acting_officer, unchanged), so before an appointment it sends no immediate
-- alert; it appears on the interim holder's dashboard and alerts them when it passes its acknowledgement target.
-- * Only role super_admin. Founder and Co-Founder are NOT included (the decision names Super Admins).
-- * Ends automatically the moment an active Lead or Deputy exists, and resumes if none is left (for example after removal or
--   deactivation). An officer marked "unavailable" still counts as appointed.
-- * No table, policy, grant or data changes: only these two function bodies, written out in full (no text patching).
-- Rollback: supabase/rollback/20260101000039_safeguarding_interim_super_admin_down.sql

create or replace function sg_my_position() returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.position from safeguarding_officers o join profiles p on p.id = o.profile_id
      where o.profile_id = auth.uid() and p.status = 'active'),
    (select 'interim' from profiles me
      where me.id = auth.uid() and me.role = 'super_admin' and me.status = 'active'
        and not exists (select 1 from safeguarding_officers o join profiles p on p.id = o.profile_id where p.status = 'active'))
  ) $$;

create or replace function sg_officer_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select o.profile_id from safeguarding_officers o join profiles p on p.id = o.profile_id where p.status = 'active'
  union all
  select me.id from profiles me
   where me.role = 'super_admin' and me.status = 'active'
     and not exists (select 1 from safeguarding_officers o join profiles p on p.id = o.profile_id where p.status = 'active') $$;

-- self-check: the function grants are unchanged (create or replace keeps them); abort if not
do $check$
begin
  if not has_function_privilege('authenticated', 'public.sg_my_position()', 'execute') then
    raise exception 'migration 39 self-check: signed-in users cannot call sg_my_position()';
  end if;
  if has_function_privilege('anon', 'public.sg_my_position()', 'execute') or has_function_privilege('anon', 'public.sg_officer_ids()', 'execute') then
    raise exception 'migration 39 self-check: signed-out visitors can call a safeguarding function';
  end if;
  raise notice 'migration 39: interim safeguarding access for Super Administrators in place; self-check passed';
end $check$;
