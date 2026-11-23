-- DIRA LEARN: READ-ONLY production pre-flight. Safe on production: SELECT only, it changes nothing.
-- Run in Supabase > SQL Editor BEFORE and AFTER applying migrations, and keep both results: the counts prove that no user,
-- profile, applicant or record was lost. Shows numbers only - no names, emails or other personal data.
select 'counts' as part, item, n from (values
  ('auth users',              (select count(*) from auth.users)),
  ('profiles',                (select count(*) from public.profiles)),
  ('applications',            (select count(*) from public.applications)),
  ('participants',            (select count(*) from public.participants)),
  ('cohort enrolments',       (select count(*) from public.cohort_enrolments)),
  ('attendance rows',         (select count(*) from public.attendance)),
  ('submissions',             (select count(*) from public.submissions)),
  ('curriculum sessions',     (select count(*) from public.curriculum_sessions)),
  ('approved sessions',       (select count(*) from public.curriculum_sessions where is_approved)),
  ('topic proposals pending', (select count(*) from public.curriculum_topic_proposals where status = 'pending'))
) v(item, n)
union all
select 'profiles by role', role::text, count(*) from public.profiles group by role
union all
select 'tables WITHOUT row level security (should be none)', c.relname, 0
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'security gap fixed by migration 33 (1 = gap present)', 'signed-out visitors can call set_curriculum_approval',
       case when to_regprocedure('public.set_curriculum_approval(uuid,boolean)') is not null
             and has_function_privilege('anon', 'public.set_curriculum_approval(uuid,boolean)', 'execute') then 1 else 0 end
union all
select 'API pre-request check (migration 34)', coalesce((select string_agg(x, ',') from pg_roles r, unnest(coalesce(r.rolconfig, '{}'::text[])) x
        where r.rolname = 'authenticator' and x like 'pgrst.db_pre_request=%'), 'none set'), 0
union all
select 'deactivated or pending accounts (blocked completely after migration 34)', status::text, count(*) from public.profiles where status <> 'active' group by status
union all
select 'stored files that wait for a virus scan after migration 35 (not deleted)', bucket_id, count(*) from storage.objects
  where bucket_id in ('application-documents', 'submissions', 'project-evidence', 'course-materials', 'learning-resources') group by bucket_id
order by 1, 2;
