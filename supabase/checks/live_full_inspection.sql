-- DIRA LEARN - full READ-ONLY inspection of a live Supabase project (audit, 20 Nov 2026).
-- Only SELECT statements: it changes nothing. Run in Supabase > SQL Editor (or via a read-only connector) and save the output.
-- Part A is a schema fingerprint: compare it line by line with supabase/checks/expected_schema_fingerprint.txt
-- (produced from this package's migrations). Part B is data health: counts only, no names, e-mails or messages.

-- ===================== PART A: schema fingerprint (one row per object, sorted) =====================
select line from (
  select 'table ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity as line
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
  union all
  select 'column ' || table_name || '.' || column_name || ' ' || data_type || '/' || udt_name || ' null=' || is_nullable
         || ' default=' || coalesce(column_default, '-')
    from information_schema.columns where table_schema = 'public'
     and table_name in (select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v'))
  union all
  select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p','u','f','c','x')
  union all
  select 'index ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'policy ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd || ' to=' || array_to_string(roles, ',')
         || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') definer=' || p.prosecdef
         || ' config=' || coalesce(array_to_string(p.proconfig, ','), '-') || ' md5=' || md5(p.prosrc)
         || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'trigger ' || tgrelid::regclass::text || ' ' || tgname || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace))
  union all
  select 'trigger-auth ' || tgname || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and tgrelid = 'auth.users'::regclass
  union all
  select 'view ' || c.relname || ' options=' || coalesce(array_to_string(c.reloptions, ','), '-') || ' md5=' || md5(pg_get_viewdef(c.oid))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v','m')
  union all
  select 'type ' || t.typname || ' = ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by t.typname
  union all
  select 'bucket ' || id || ' public=' || public || ' size=' || coalesce(file_size_limit::text, '-')
         || ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), '-') from storage.buckets
  union all
  select 'realtime ' || schemaname || '.' || tablename from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  select 'role-setting authenticator ' || s from pg_roles r, unnest(coalesce(r.rolconfig, '{}'::text[])) s
    where r.rolname = 'authenticator' and s like 'pgrst.%'
  union all
  select 'table-grant-anon ' || table_name || ' ' || string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' group by table_name
  union all
  -- signed-in users' and the server role's table grants (added 21 Nov 2026: their absence caused the production 403 on profiles)
  select 'table-grant-' || grantee || ' ' || table_name || ' ' || string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('authenticated', 'service_role')
   group by grantee, table_name
) f order by line;

-- ===================== PART B: migration history and data health (counts only) =====================
-- B1 migration history: run supabase/checks/live_migration_check.sql (it explains the error you get when no history exists).

select 'B2 ' || label as check, n::text as result from (
  select 'auth users' label, (select count(*) from auth.users) n
  union all select 'auth users without a profile', (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id))
  union all select 'profiles without an auth user', (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id))
  union all select 'duplicate auth e-mails (case-insensitive)', (select count(*) from (select lower(email) from auth.users where email is not null group by 1 having count(*) > 1) d)
  union all select 'auth users banned', (select count(*) from auth.users where banned_until > now())
  union all select 'auth users e-mail not confirmed', (select count(*) from auth.users where email_confirmed_at is null)
  union all select 'participants whose profile is not role participant', (select count(*) from public.participants pa join public.profiles p on p.id = pa.profile_id where p.role <> 'participant')
  union all select 'participant profiles without a participant record', (select count(*) from public.profiles p where p.role = 'participant' and not exists (select 1 from public.participants pa where pa.profile_id = p.id))
  union all select 'duplicate participant per profile', (select count(*) from (select profile_id from public.participants group by 1 having count(*) > 1) d)
  union all select 'participants enrolled in more than one cohort', (select count(*) from (select participant_id from public.cohort_enrolments group by 1 having count(*) > 1) d)
  union all select 'trainer assignments held by a non-trainer or inactive profile (audit finding H1)', (select count(*) from public.trainer_assignments t join public.profiles p on p.id = t.trainer_id where p.role <> 'trainer' or p.status <> 'active')
  union all select 'mentor assignments held by a non-mentor or inactive profile', (select count(*) from public.mentorship_assignments m join public.profiles p on p.id = m.mentor_id where p.role <> 'mentor' or p.status <> 'active')
  union all select 'deactivated profiles', (select count(*) from public.profiles where status = 'deactivated')
  union all select 'active super administrators', (select count(*) from public.profiles where role = 'super_admin' and status = 'active')
  union all select 'safeguarding officers who are not active', (select count(*) from public.safeguarding_officers o join public.profiles p on p.id = o.profile_id where p.status <> 'active')
  union all select 'curriculum sessions', (select count(*) from public.curriculum_sessions)
  union all select 'curriculum sessions approved', (select count(*) from public.curriculum_sessions where is_approved)
  union all select 'lesson plans', (select count(*) from public.curriculum_lesson_plans)
  union all select 'lesson plans not draft', (select count(*) from public.curriculum_lesson_plans where status <> 'draft')
  union all select 'pending topic proposals', (select count(*) from public.curriculum_topic_proposals where status = 'pending')
  union all select 'connect attachments not scanned clean', (select count(*) from public.connect_attachments where scan_status <> 'clean')
) x order by 1;

select 'B3 profiles by role and status' as check, role::text || ' / ' || status::text || ': ' || count(*) as result
  from public.profiles group by role, status order by 2;
