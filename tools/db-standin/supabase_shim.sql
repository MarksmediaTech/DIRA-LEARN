-- Local stand-in for the parts of Supabase that DIRA LEARN's migrations rely on.
-- Mirrors Supabase defaults: roles, schema grants, NO automatic grants on public objects (see below), auth.uid()/role()/jwt(),
-- auth.users, storage.buckets/objects/foldername, and the supabase_realtime publication.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create schema if not exists storage;
alter database postgres set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;

create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz, confirmation_token varchar(255),
  recovery_token varchar(255), recovery_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(), phone text,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean not null default false,
  email_change text, email_change_token_new text, email_change_token_current text, phone_change text, reauthentication_token text
);
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null, provider text not null,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid primary key default gen_random_uuid(), unique (provider_id, provider)
);

create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, version text, user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin select string_to_array(name, '/') into _parts; return _parts[array_length(_parts, 1)]; end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin select string_to_array(name, '/') into _parts; select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1)); end $$;

grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
grant select on all tables in schema storage to anon, authenticated, service_role;
grant insert, update, delete on storage.objects to anon, authenticated, service_role;
grant all on auth.users to service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- Supabase's current default (new projects since 30 May 2026, all projects since 30 Oct 2026): tables, sequences and
-- functions created in public get NO automatic grants for anon, authenticated or service_role. Every grant the app needs
-- must be written in a migration. This stand-in is stricter still: new functions are not executable by PUBLIC either,
-- so a function the app calls without an explicit grant fails here first. (The old stand-in granted everything, which
-- hid the 403 on public.profiles seen in production on 21 Nov 2026.)
alter default privileges in schema public revoke execute on functions from public;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
