-- DIRA LEARN - production initialization, STEP 0b: read-only pre-check for a PARTIALLY initialized database (21 Nov 2026)
-- Use this instead of 00_precheck_readonly.sql when migrations 01-37 were already applied (for example with
-- `supabase db push`) but the seed did not complete and signed-in users get 403 on /rest/v1/profiles. It only READS.
-- The last row is the verdict:
--   CONTINUE   -> run 01b_continue_after_37.sql (migrations 38-39 + seed), then 02_verify_readonly.sql
--   ALREADY_38 -> migrations 38-39 are already recorded (01-39 complete): run only the seed step described in PRODUCTION_DB_INITIALIZATION.md
--   STOP       -> do not run anything; send this table to Claude
with
expected(version) as (select to_char(20260101000000 + g, 'FM00000000000000') from generate_series(1, 37) g),
hist as (
  select case when to_regclass('supabase_migrations.schema_migrations') is null then null
              else (xpath('/row/v/text()', query_to_xml(
                     'select string_agg(version, '','' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text end as v),
counts as (
  select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t), false, true, '')))[1]::text::int as n, t
    from unnest(array['organizations', 'programmes', 'tracks', 'curriculum_sessions', 'curriculum_lesson_plans', 'curriculum_topic_proposals', 'system_settings', 'profiles']) t
   where to_regclass('public.' || t) is not null),
checks(ord, item, status, detail) as (
  select 1, 'migration history', case when (select v from hist) = (select string_agg(version, ',' order by version) from expected) then 'ok'
                                      when (select v from hist) = (select string_agg(to_char(20260101000000 + g, 'FM00000000000000'), ',' order by g) from generate_series(1, 39) g) then 'already-38'
                                      else 'STOP' end,
         coalesce((select v from hist), 'no history table')
  union all
  select 2, 'DIRA LEARN tables present (99 from migrations 01-37)', case when (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')) >= 99 then 'ok' else 'STOP' end,
         (select count(*) || ' tables in public' from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p'))
  union all
  select 3, 'sign-up trigger on auth.users', case when exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and tgenabled <> 'D') then 'ok' else 'STOP' end,
         coalesce((select string_agg(tgname, ', ') from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal), 'none')
  union all
  select 4, 'signed-in users can read profiles (expected false before migration 38: this is the 403)', 'info',
         has_table_privilege('authenticated', 'public.profiles', 'select')::text
  union all
  select 5, 'reference and curriculum data already present (the seed is safe to re-run either way)', 'info',
         coalesce((select string_agg(t || ' ' || n, ', ' order by t) from counts where t <> 'profiles'), 'none')
  union all
  select 6, 'sign-in accounts and profiles (kept unchanged)', 'info',
         (select count(*) from auth.users) || ' accounts, ' || coalesce((select n from counts where t = 'profiles'), 0) || ' profiles, '
         || (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) || ' accounts without a profile'
  union all
  select 7, 'administrators already present', 'info',
         coalesce((select string_agg(role::text || ' ' || n, ', ') from (select role, count(*) n from public.profiles where role <> 'applicant' group by 1) r), 'none')
         || case when exists (select 1 from public.profiles where role = 'super_admin' and status = 'active')
                 then ' (an active Super Administrator exists: the first-admin claim is not needed)' else '' end
)
select ord, item, status, detail from checks
union all
select 99, 'VERDICT',
       case when exists (select 1 from checks where status = 'STOP') then 'STOP'
            when exists (select 1 from checks where status = 'already-38') then 'ALREADY_38'
            else 'CONTINUE' end,
       case when exists (select 1 from checks where status = 'STOP') then 'Do not run anything. Send this table to Claude.'
            when exists (select 1 from checks where status = 'already-38') then 'Migrations 01-39 are recorded. Run only the seed step, then 02_verify_readonly.sql.'
            else 'Back up, then run 01b_continue_after_37.sql with psql, then 02_verify_readonly.sql.' end
order by ord;
