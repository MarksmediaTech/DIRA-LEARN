-- Emulates the role the Supabase Dashboard SQL Editor runs as ("postgres" on Supabase), for tools/baseline/install_check.sh.
-- Found 21 Nov 2026: STEP-3 failed on a real project with "permission denied to set parameter session_replication_role",
-- because on Supabase that role is NOT a superuser, while the local stand-in ran everything as a superuser. This role has
-- what Supabase's "postgres" role has and nothing more: no superuser; CREATEROLE, CREATEDB, BYPASSRLS; owns schema public and
-- the realtime publication; may create triggers on auth.users; manages storage buckets and policies through membership of
-- the storage owner role; administers the API roles (needed for ALTER ROLE authenticator SET ...).
-- Run as a superuser in each test database after supabase_shim.sql. The role itself is cluster-wide.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sql_editor') then
    create role sql_editor login nosuperuser createrole createdb bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'storage_owner_emul') then create role storage_owner_emul nologin; end if;
end $$;
grant anon, authenticated, service_role, authenticator to sql_editor with admin option;
grant storage_owner_emul to sql_editor;
grant usage on schema storage to storage_owner_emul;   -- the owner role needs the schema for its own foreign-key checks
do $$ begin execute format('grant create on database %I to sql_editor', current_database()); end $$;
alter schema public owner to sql_editor;
grant usage on schema auth, storage, extensions to sql_editor;
grant select, trigger, references on auth.users to sql_editor;
grant execute on all functions in schema auth to sql_editor;
alter table storage.buckets owner to storage_owner_emul;
alter table storage.objects owner to storage_owner_emul;
alter publication supabase_realtime owner to sql_editor;
-- same strictness as the shim for objects this role creates: no automatic EXECUTE for PUBLIC on new functions
alter default privileges for role sql_editor in schema public revoke execute on functions from public;
-- Supabase's default privileges for tables this role creates in public, as observed on a real project on 21 Nov 2026
-- (STEP-5 check 16: 107 tables/views, signed-out 321 = 107 x TRUNCATE/REFERENCES/TRIGGER, signed-in 256 intended + 321)
alter default privileges for role sql_editor in schema public grant truncate, references, trigger on tables to anon, authenticated, service_role;
-- On Supabase the SQL Editor's role can register the API pre-request function (STEP-5 check 11 passed on the real project)
grant set on parameter pgrst.db_pre_request to sql_editor;
