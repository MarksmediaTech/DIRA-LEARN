-- DIRA LEARN: helper functions, signup trigger, role-escalation guard, Row Level Security
-- STATUS: written, NOT yet executed or RLS-tested (see docs/TEST_REPORT.md)

create or replace function app_role() returns role_code language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active' $$;
create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin','programme_director','programme_coordinator'), false) $$;
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'super_admin', false) $$;
create or replace function my_participant_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from participants where profile_id = auth.uid() $$;
create or replace function my_trainer_cohorts() returns setof uuid language sql stable security definer set search_path = public as $$
  select cohort_id from trainer_assignments where trainer_id = auth.uid() $$;
create or replace function trainer_can_see_participant(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cohort_enrolments e where e.participant_id = pid and e.cohort_id in (select my_trainer_cohorts())) $$;
create or replace function mentor_has_mentee(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from mentorship_assignments m where m.mentor_id = auth.uid() and m.participant_id = pid) $$;

-- New sign-ups are ALWAYS applicants; roles are never taken from client metadata.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles(id, role, status) values (new.id, 'applicant', 'active'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Only an active super administrator may change role/status/org.
create or replace function guard_profile_privileged() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.organization_id is distinct from old.organization_id)
     and not is_admin() then
    raise exception 'Only a super administrator can change role, status or organisation';
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on profiles for each row execute function guard_profile_privileged();

-- Enable RLS everywhere (default deny)
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop; end $$;

-- Reference / curriculum: readable by signed-in users, editable by admin + coordinator
do $$ declare t text; begin
  foreach t in array array['organizations','roles','permissions','role_permissions','programmes','tracks','curriculum_sessions','assessment_definitions','competencies','competency_links','me_indicators','graduation_rules']
  loop
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on %I for all to authenticated using (is_admin() or app_role()=''programme_coordinator'') with check (is_admin() or app_role()=''programme_coordinator'')', t||'_write', t);
  end loop; end $$;
-- Graduation rules are policy: only super admin may write (override coordinator)
drop policy graduation_rules_write on graduation_rules;
create policy graduation_rules_write on graduation_rules for all to authenticated using (is_admin()) with check (is_admin());

-- Profiles
create policy profiles_self on profiles for select to authenticated using (id = auth.uid());
create policy profiles_staff on profiles for select to authenticated using (is_staff() or app_role() = 'me_officer');
create policy profiles_trainer on profiles for select to authenticated using (
  app_role()='trainer' and exists (select 1 from participants p where p.profile_id = profiles.id and trainer_can_see_participant(p.id)));
create policy profiles_mentor on profiles for select to authenticated using (
  app_role()='mentor' and exists (select 1 from participants p where p.profile_id = profiles.id and mentor_has_mentee(p.id)));
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- Applications: applicant sees/edits own drafts; staff manage; reviewer notes (events) staff only
create policy apps_own_read on applications for select to authenticated using (applicant_id = auth.uid());
create policy apps_own_insert on applications for insert to authenticated with check (applicant_id = auth.uid() and status = 'draft');
create policy apps_own_update on applications for update to authenticated using (applicant_id = auth.uid() and status in ('draft','submitted'))
  with check (applicant_id = auth.uid() and status in ('draft','submitted'));
create policy apps_staff on applications for all to authenticated using (is_staff()) with check (is_staff());
create policy appdocs_own on application_documents for all to authenticated
  using (exists (select 1 from applications a where a.id = application_id and a.applicant_id = auth.uid()))
  with check (exists (select 1 from applications a where a.id = application_id and a.applicant_id = auth.uid()));
create policy appdocs_staff on application_documents for all to authenticated using (is_staff()) with check (is_staff());
create policy appevents_staff on application_events for all to authenticated using (is_staff()) with check (is_staff());

-- Participants & sensitive data
create policy part_self on participants for select to authenticated using (profile_id = auth.uid());
create policy part_staff on participants for all to authenticated using (is_staff()) with check (is_staff());
create policy part_me on participants for select to authenticated using (app_role()='me_officer');
create policy part_trainer on participants for select to authenticated using (app_role()='trainer' and trainer_can_see_participant(id));
create policy part_mentor on participants for select to authenticated using (app_role()='mentor' and mentor_has_mentee(id));
create policy emerg_staff on participant_emergency_contacts for all to authenticated using (is_staff()) with check (is_staff());

-- Cohorts, enrolments, schedules
create policy cohorts_read on cohorts for select to authenticated using (is_staff() or app_role()='me_officer' or id in (select my_trainer_cohorts())
  or id in (select cohort_id from cohort_enrolments where participant_id = my_participant_id()));
create policy cohorts_write on cohorts for all to authenticated using (is_staff()) with check (is_staff());
create policy enrol_self on cohort_enrolments for select to authenticated using (participant_id = my_participant_id());
create policy enrol_staff on cohort_enrolments for all to authenticated using (is_staff()) with check (is_staff());
create policy enrol_ro on cohort_enrolments for select to authenticated using (app_role()='me_officer' or cohort_id in (select my_trainer_cohorts()));
create policy ta_read on trainer_assignments for select to authenticated using (trainer_id = auth.uid() or is_staff());
create policy ta_write on trainer_assignments for all to authenticated using (is_staff()) with check (is_staff());
create policy sched_read on session_schedules for select to authenticated using (is_staff() or app_role()='me_officer' or cohort_id in (select my_trainer_cohorts())
  or cohort_id in (select cohort_id from cohort_enrolments where participant_id = my_participant_id()));
create policy sched_write on session_schedules for all to authenticated using (is_staff()) with check (is_staff());

-- Attendance: staff + assigned trainers write; participants read own
create policy att_self on attendance for select to authenticated using (participant_id = my_participant_id());
create policy att_ro on attendance for select to authenticated using (is_staff() or app_role()='me_officer');
create policy att_trainer on attendance for all to authenticated
  using (app_role()='trainer' and exists (select 1 from session_schedules s where s.id = schedule_id and s.cohort_id in (select my_trainer_cohorts())))
  with check (app_role()='trainer' and exists (select 1 from session_schedules s where s.id = schedule_id and s.cohort_id in (select my_trainer_cohorts())));
create policy att_staff on attendance for all to authenticated using (is_staff()) with check (is_staff());

-- Learning content: participants only see content for their cohort/track
create policy res_read on learning_resources for select to authenticated using (is_staff() or app_role() in ('trainer','me_officer')
  or track_id is null or track_id in (select track_id from cohort_enrolments where participant_id = my_participant_id()));
create policy res_write on learning_resources for all to authenticated using (is_staff() or app_role()='trainer') with check (is_staff() or app_role()='trainer');
create policy asg_read on assignments for select to authenticated using (is_staff() or app_role()='me_officer' or cohort_id in (select my_trainer_cohorts())
  or exists (select 1 from cohort_enrolments e where e.participant_id = my_participant_id() and e.cohort_id = assignments.cohort_id
             and (assignments.track_id is null or assignments.track_id = e.track_id)));
create policy asg_write on assignments for all to authenticated using (is_staff() or cohort_id in (select my_trainer_cohorts()))
  with check (is_staff() or cohort_id in (select my_trainer_cohorts()));
create policy sub_self_read on submissions for select to authenticated using (participant_id = my_participant_id());
create policy sub_self_insert on submissions for insert to authenticated with check (participant_id = my_participant_id() and graded_by is null and score is null);
create policy sub_trainer on submissions for all to authenticated using (trainer_can_see_participant(participant_id)) with check (trainer_can_see_participant(participant_id));
create policy sub_staff on submissions for select to authenticated using (is_staff() or app_role()='me_officer');

-- Assessment results, competency assessments, projects, portfolios (same access shape)
do $$ declare t text; begin
  foreach t in array array['assessment_results','competency_assessments','participant_projects','portfolios','alumni','certificates']
  loop
    execute format('create policy %I on %I for select to authenticated using (participant_id = my_participant_id())', t||'_self', t);
    execute format('create policy %I on %I for select to authenticated using (is_staff() or app_role()=''me_officer'' or (app_role()=''trainer'' and trainer_can_see_participant(participant_id)) or (app_role()=''mentor'' and mentor_has_mentee(participant_id)))', t||'_ro', t);
  end loop; end $$;
create policy ares_write on assessment_results for all to authenticated using (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)))
  with check (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)));
create policy cass_write on competency_assessments for all to authenticated using (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)))
  with check (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)));
create policy proj_self_write on participant_projects for all to authenticated using (participant_id = my_participant_id()) with check (participant_id = my_participant_id());
create policy proj_staff_write on participant_projects for all to authenticated using (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)))
  with check (is_staff() or (app_role()='trainer' and trainer_can_see_participant(participant_id)));
create policy pev_self on project_evidence for all to authenticated
  using (exists (select 1 from participant_projects p where p.id = project_id and p.participant_id = my_participant_id()))
  with check (exists (select 1 from participant_projects p where p.id = project_id and p.participant_id = my_participant_id()));
create policy pev_ro on project_evidence for select to authenticated using (is_staff() or app_role() in ('trainer','me_officer'));
create policy port_self_write on portfolios for all to authenticated using (participant_id = my_participant_id()) with check (participant_id = my_participant_id());
create policy cert_write on certificates for all to authenticated using (is_admin() or app_role()='programme_director') with check (is_admin() or app_role()='programme_director');
create policy alumni_write on alumni for all to authenticated using (is_staff()) with check (is_staff());
create policy alumni_self_update on alumni for update to authenticated using (participant_id = my_participant_id()) with check (participant_id = my_participant_id());

-- Mentorship: only the mentor involved (+ staff)
create policy ma_read on mentorship_assignments for select to authenticated using (mentor_id = auth.uid() or participant_id = my_participant_id() or is_staff());
create policy ma_write on mentorship_assignments for all to authenticated using (is_staff()) with check (is_staff());
create policy ms_mentor on mentorship_sessions for all to authenticated
  using (exists (select 1 from mentorship_assignments a where a.id = assignment_id and a.mentor_id = auth.uid()))
  with check (exists (select 1 from mentorship_assignments a where a.id = assignment_id and a.mentor_id = auth.uid()));
create policy ms_staff on mentorship_sessions for select to authenticated using (is_staff());

-- M&E
create policy mer_read on me_records for select to authenticated using (is_staff() or app_role()='me_officer');
create policy mer_write on me_records for all to authenticated using (app_role()='me_officer' or is_admin()) with check (app_role()='me_officer' or is_admin());

-- Notifications & announcements
create policy notif_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notif_own_read on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_staff on notifications for insert to authenticated with check (is_staff() or app_role()='trainer');
create policy ann_read on announcements for select to authenticated using (cohort_id is null or is_staff() or cohort_id in (select my_trainer_cohorts())
  or cohort_id in (select cohort_id from cohort_enrolments where participant_id = my_participant_id()));
create policy ann_write on announcements for all to authenticated using (is_staff()) with check (is_staff());

-- Audit logs: super admin read only; written by security-definer trigger
create policy audit_admin on audit_logs for select to authenticated using (is_admin());
-- Safeguarding: super admin only until DIRA Foundation names a designated safeguarding role
create policy safe_admin on safeguarding_records for all to authenticated using (is_admin()) with check (is_admin());
-- Settings
create policy set_read on system_settings for select to authenticated using (is_staff());
create policy set_write on system_settings for all to authenticated using (is_admin()) with check (is_admin());

-- Public certificate verification (returns only minimal fields, no table access)
create or replace function verify_certificate(cert_no text) returns table(valid boolean, issued_on date, holder text)
language sql stable security definer set search_path = public as $$
  select not c.revoked, c.issued_on, pr.first_name || ' ' || left(pr.last_name,1) || '.'
  from certificates c join participants p on p.id = c.participant_id join profiles pr on pr.id = p.profile_id
  where c.certificate_no = cert_no $$;
grant execute on function verify_certificate(text) to anon, authenticated;

-- Track selection goes through a function so participants cannot edit other enrolment columns.
create or replace function select_track(p_cohort uuid, p_track uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid := my_participant_id(); core_done int; need_core boolean;
begin
  if pid is null then raise exception 'Not a participant'; end if;
  if not exists (select 1 from cohort_enrolments where cohort_id = p_cohort and participant_id = pid) then raise exception 'Not enrolled in this cohort'; end if;
  if not exists (select 1 from tracks t join cohorts c on c.programme_id = t.programme_id where t.id = p_track and c.id = p_cohort) then raise exception 'Track not in this programme'; end if;
  select coalesce((value)::boolean, true) into need_core from system_settings where key = 'track_selection_requires_core_complete';
  if coalesce(need_core, true) then
    select count(*) into core_done from session_schedules s join curriculum_sessions cs on cs.id = s.curriculum_session_id
      where s.cohort_id = p_cohort and cs.track_id is null and s.status = 'completed';
    if core_done < 2 then raise exception 'Shared core sessions must be completed before selecting a track'; end if;
  end if;
  update cohort_enrolments set track_id = p_track, track_selected_at = now() where cohort_id = p_cohort and participant_id = pid;
end $$;
grant execute on function select_track(uuid, uuid) to authenticated;
