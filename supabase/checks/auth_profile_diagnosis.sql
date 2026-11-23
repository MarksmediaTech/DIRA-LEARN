-- DIRA LEARN - why does "Loading your account…" appear after email verification? READ-ONLY (SELECT only, changes nothing).
-- Run in Supabase > SQL Editor of the live project and send the result. No e-mail address or other personal data is shown.
select item, result from (
  select 1 as o, 'trigger on auth.users that creates profiles' as item,
         coalesce((select case tgenabled when 'D' then 'DISABLED' else 'present, enabled' end || ' -> ' || tgfoid::regprocedure::text
                   from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'), 'MISSING') as result
  union all select 2, 'function handle_new_user()',
         coalesce((select 'present: ' || left(regexp_replace(prosrc, '\s+', ' ', 'g'), 140) from pg_proc
                   where proname = 'handle_new_user' and pronamespace = 'public'::regnamespace), 'MISSING')
  union all select 3, 'sign-in accounts without a profile (these people see the problem)',
         (select count(*)::text from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id))
  union all select 4, '... of them created in the last 7 days',
         (select count(*)::text from auth.users u where u.created_at > now() - interval '7 days' and not exists (select 1 from public.profiles p where p.id = u.id))
  union all select 5, '... of them with a verified e-mail address',
         (select count(*)::text from auth.users u where u.email_confirmed_at is not null and not exists (select 1 from public.profiles p where p.id = u.id))
  union all select 6, 'profiles columns the app reads (id, role, status, first_name, last_name, organization_id)',
         (select coalesce(nullif(string_agg(c, ', '), ''), 'all present') from unnest(array['id','role','status','first_name','last_name','organization_id']) c
          where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c))
  union all select 7, 'row-level security on profiles', (select case when relrowsecurity then 'on' else 'OFF' end from pg_class where oid = 'public.profiles'::regclass)
  union all select 8, 'policy letting a user read their own profile (profiles_self)',
         coalesce((select permissive || ' ' || cmd || ' using ' || qual from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self'), 'MISSING')
  union all select 9, 'restrictive policies on profiles (must not block an active applicant)',
         coalesce((select string_agg(policyname || ': ' || qual, ' | ') from pg_policies where schemaname = 'public' and tablename = 'profiles' and permissive = 'RESTRICTIVE'), 'none')
  union all select 10, 'status of profiles created in the last 7 days',
         coalesce((select string_agg(s, ', ') from (select status::text || ' ' || count(*) as s from public.profiles p join auth.users u on u.id = p.id
                   where u.created_at > now() - interval '7 days' group by status) x), 'none')
  union all select 11, 'API pre-request check (migration 34)',
         coalesce((select string_agg(x, ',') from pg_roles r, unnest(coalesce(r.rolconfig, '{}'::text[])) x where r.rolname = 'authenticator' and x like 'pgrst.db_pre_request=%'), 'none')
  union all select 12, 'select privilege on profiles for signed-in users', case when has_table_privilege('authenticated', 'public.profiles', 'select') then 'yes' else 'NO' end
) d order by o;
