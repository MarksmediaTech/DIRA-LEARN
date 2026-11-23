-- Rollback of migration 39. Run in one transaction, then delete version 20260101000039 from
-- supabase_migrations.schema_migrations. Restores the two functions exactly as defined in migration 24 (19 Nov 2026): only an
-- appointed, active Safeguarding Lead or Deputy can read records; before an appointment nobody can, Super Administrators
-- included, and new-concern alerts reach nobody.

create or replace function sg_my_position() returns text language sql stable security definer set search_path = public as $$
  select o.position from safeguarding_officers o join profiles p on p.id = o.profile_id
  where o.profile_id = auth.uid() and p.status = 'active' $$;

create or replace function sg_officer_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select o.profile_id from safeguarding_officers o join profiles p on p.id = o.profile_id where p.status = 'active' $$;
