-- DIRA LEARN: Founder and Co-Founder receive administrative permissions equivalent to the Super Administrator.
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- Board decision (master instruction, Phase 8): super_admin, founder and co_founder have equivalent ADMINISTRATIVE access.
-- This replaces the earlier rule (migration 15/16) that Founder and Co-Founder were not general staff.
--
-- DESIGN
--   * is_executive()  NEW. active super_admin, founder or co_founder. Used for administrative areas.
--   * is_staff()      now also includes founder and co_founder (they gain every area staff can reach).
--   * is_admin()      UNCHANGED (super_admin only). It still guards ROLE / STATUS / ORGANISATION changes, the profiles
--                     "for all" policy and the last-administrator protection, so a founder cannot promote anyone to
--                     super_admin or create another founder. WHO MAY ASSIGN ROLES is a management decision, see
--                     docs/EXECUTIVE_ROLES.md. The first-super-admin bootstrap (claim_first_admin) is NOT touched.
--   * Functions that hard-code ('super_admin','programme_director') are rewritten in place from their stored source, and the
--     migration aborts if a rewrite changes nothing, so a silent no-op cannot be mistaken for success.
-- ADDITIVE for existing users: no account, role or password changes.

-- ============ 1. helpers ============
create or replace function is_executive() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'founder', 'co_founder'), false) $$;
revoke all on function is_executive() from public, anon;
grant execute on function is_executive() to authenticated;

create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'), false) $$;

-- ============ 2. functions with hard-coded role lists (rewritten from stored source, abort if nothing changed) ============
do $$
declare
  r record;
  def text;
  newdef text;
begin
  for r in
    select * from (values
      ('guard_curriculum_session()',                     'app_role() not in (''super_admin'', ''programme_director'')', 'app_role() not in (''super_admin'', ''founder'', ''co_founder'', ''programme_director'')'),
      ('set_curriculum_approval(uuid,boolean)',          'app_role() not in (''super_admin'', ''programme_director'')', 'app_role() not in (''super_admin'', ''founder'', ''co_founder'', ''programme_director'')'),
      ('issue_certificate(uuid,uuid)',                   'app_role() not in (''super_admin'', ''programme_director'')', 'app_role() not in (''super_admin'', ''founder'', ''co_founder'', ''programme_director'')'),
      ('revoke_certificate(uuid,text)',                  'app_role() not in (''super_admin'', ''programme_director'')', 'app_role() not in (''super_admin'', ''founder'', ''co_founder'', ''programme_director'')'),
      ('can_decide_applications()',                      'app_role() in (''super_admin'', ''programme_director'')',     'app_role() in (''super_admin'', ''founder'', ''co_founder'', ''programme_director'')'),
      ('admin_list_users()',                             'where is_admin()',                                           'where is_executive()'),
      ('enqueue_bulk_email(text,text,uuid,timestamptz)', 'pr.role in (''super_admin'', ''programme_director''',          'pr.role in (''super_admin'', ''founder'', ''co_founder'', ''programme_director''')
    ) as t(sig, old_txt, new_txt)
  loop
    def := pg_get_functiondef(('public.' || r.sig)::regprocedure);
    newdef := replace(def, r.old_txt, r.new_txt);
    if newdef = def then
      raise exception 'Migration 17: expected text not found in function %, nothing was changed', r.sig;
    end if;
    execute newdef;
  end loop;
end $$;

-- ============ 3. policies: administrative areas move from is_admin() to is_executive() ============
-- Reference and curriculum tables (editable by executives and the coordinator; readable by everyone signed in, unchanged).
do $$ declare t text; begin
  foreach t in array array['organizations','roles','permissions','role_permissions','programmes','tracks','curriculum_sessions','assessment_definitions','competencies','competency_links','me_indicators']
  loop
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_executive() or app_role()=''programme_coordinator'') with check (is_executive() or app_role()=''programme_coordinator'')', t || '_write', t);
  end loop;
end $$;

drop policy if exists graduation_rules_write on graduation_rules;
create policy graduation_rules_write on graduation_rules for all to authenticated using (is_executive()) with check (is_executive());

drop policy if exists cert_write on certificates;
create policy cert_write on certificates for all to authenticated
  using (is_executive() or app_role()='programme_director') with check (is_executive() or app_role()='programme_director');

drop policy if exists mer_write on me_records;
create policy mer_write on me_records for all to authenticated
  using (app_role()='me_officer' or is_executive()) with check (app_role()='me_officer' or is_executive());

drop policy if exists set_write on system_settings;
create policy set_write on system_settings for all to authenticated using (is_executive()) with check (is_executive());

drop policy if exists audit_admin on audit_logs;
create policy audit_admin on audit_logs for select to authenticated using (is_executive());

drop policy if exists safe_admin_read on safeguarding_records;
drop policy if exists safe_admin_insert on safeguarding_records;
drop policy if exists safe_admin_update on safeguarding_records;
create policy safe_admin_read on safeguarding_records for select to authenticated using (is_executive());
create policy safe_admin_insert on safeguarding_records for insert to authenticated with check (is_executive());
create policy safe_admin_update on safeguarding_records for update to authenticated using (is_executive()) with check (is_executive());

-- Executives can READ every profile (needed for the Users page). Writing role, status or organisation still requires
-- is_admin() (super_admin only) through guard_profile_privileged and the profiles_admin_all policy, both unchanged.
drop policy if exists profiles_exec_read on profiles;
create policy profiles_exec_read on profiles for select to authenticated using (is_executive());
