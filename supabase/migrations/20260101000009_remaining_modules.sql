-- DIRA LEARN: mentorship, M&E, certificates and alumni, notifications, projects, settings, safeguarding, user management
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.

-- ============ 0. Profile guards ============
-- A trusted session is the service role (Edge Functions) or a direct database connection (SQL editor, migrations, tests).
-- Requests through the API always carry a JWT, so they are never trusted this way.
-- Bug fix: the old guard blocked the service role (auth.uid() is null there), so convert-application could not set a role.
create or replace function is_trusted_session() returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or coalesce(current_setting('request.jwt.claims', true), '') = '' $$;

create or replace function guard_profile_privileged() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_trusted_session() then return new; end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.organization_id is distinct from old.organization_id)
     and not is_admin() then
    raise exception 'Only a super administrator can change role, status or organisation';
  end if;
  return new;
end $$;

-- Role changes must keep the data consistent, and the system must never lose its last administrator.
create or replace function guard_profile_integrity() returns trigger language plpgsql security definer set search_path = public as $$
declare has_participant boolean; remaining int;
begin
  if is_trusted_session() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status then
    if auth.uid() = old.id then
      raise exception 'You cannot change your own role or status';
    end if;
  end if;
  if new.role is distinct from old.role then
    select exists (select 1 from participants where profile_id = new.id) into has_participant;
    if new.role = 'participant' and not has_participant then
      raise exception 'A participant account is created by converting an accepted application';
    end if;
    if old.role = 'participant' and has_participant then
      raise exception 'A participant cannot be given another role. Mark the participant as withdrawn instead';
    end if;
  end if;
  if old.role = 'super_admin' and old.status = 'active' and (new.role <> 'super_admin' or new.status <> 'active') then
    select count(*) into remaining from profiles where role = 'super_admin' and status = 'active' and id <> old.id;
    if remaining = 0 then raise exception 'There must always be at least one active super administrator'; end if;
  end if;
  return new;
end $$;
create trigger trg_guard_profile_integrity before update on profiles for each row execute function guard_profile_integrity();

-- Mentees can see the name of their own mentor.
create policy profiles_mentee on profiles for select to authenticated
  using (id in (select mentor_id from mentorship_assignments where participant_id = my_participant_id()));

-- Super administrators see account emails and last sign-in (auth.users is otherwise unreadable).
create or replace function admin_list_users()
returns table(id uuid, email text, role role_code, status account_status, first_name text, last_name text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.role, p.status, p.first_name, p.last_name, p.created_at, u.last_sign_in_at
  from profiles p join auth.users u on u.id = p.id
  where is_admin() order by p.created_at desc $$;
revoke all on function admin_list_users() from public, anon;
grant execute on function admin_list_users() to authenticated;

-- ============ 1. Mentorship ============
alter table mentorship_sessions add column if not exists shared_with_mentee boolean not null default false;
alter table mentorship_sessions add column if not exists created_at timestamptz not null default now();
-- One mentor per participant (proposal: keeps the participant view simple).
create unique index if not exists uq_one_mentor_per_participant on mentorship_assignments(participant_id);

create or replace function guard_mentorship_assignment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.mentor_id and role = 'mentor' and status = 'active') then
    raise exception 'The mentor must be an active account with the mentor role';
  end if;
  if exists (select 1 from participants where id = new.participant_id and status = 'withdrawn') then
    raise exception 'A withdrawn participant cannot be given a mentor';
  end if;
  return new;
end $$;
create trigger trg_guard_mentorship_assignment before insert or update on mentorship_assignments for each row execute function guard_mentorship_assignment();
create trigger aud_mentorship after insert or update or delete on mentorship_assignments for each row execute function audit_row();

create or replace function guard_mentorship_session() returns trigger language plpgsql as $$
begin
  if new.held_on > current_date then raise exception 'A mentoring session cannot be dated in the future'; end if;
  if jsonb_typeof(new.action_points) is distinct from 'array' then raise exception 'Action points must be a list'; end if;
  if jsonb_array_length(new.action_points) > 20 then raise exception 'At most 20 action points per session'; end if;
  return new;
end $$;
create trigger trg_guard_mentorship_session before insert or update on mentorship_sessions for each row execute function guard_mentorship_session();

-- The mentor chooses per session whether the mentee can read it (default: private to the mentor and staff).
create policy ms_mentee_read on mentorship_sessions for select to authenticated using (
  shared_with_mentee and exists (select 1 from mentorship_assignments a where a.id = assignment_id and a.participant_id = my_participant_id()));

-- ============ 2. Monitoring and evaluation ============
alter table me_indicators add column if not exists created_by uuid references profiles(id);
alter table me_indicators add column if not exists is_active boolean not null default true;
alter table me_records add column if not exists note text;
alter table me_records add column if not exists recorded_by uuid references profiles(id);
alter table me_records add constraint chk_me_value check (
  (data_quality = 'missing' and value is null) or (data_quality <> 'missing' and value is not null));

create policy me_indicators_me on me_indicators for all to authenticated
  using (app_role() = 'me_officer') with check (app_role() = 'me_officer');

create or replace function guard_me_record() returns trigger language plpgsql security definer set search_path = public as $$
declare ind_prog uuid; coh_prog uuid;
begin
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  if new.cohort_id is not null then
    select programme_id into ind_prog from me_indicators where id = new.indicator_id;
    select programme_id into coh_prog from cohorts where id = new.cohort_id;
    if ind_prog is not null and coh_prog is distinct from ind_prog then
      raise exception 'The cohort does not belong to the indicator''s programme';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_me_record before insert or update on me_records for each row execute function guard_me_record();
create trigger aud_me_indicators after insert or update or delete on me_indicators for each row execute function audit_row();
create trigger aud_me_records after insert or update or delete on me_records for each row execute function audit_row();

-- ============ 3. Graduation rules, certificates, alumni ============
alter table graduation_rules add column if not exists require_final_project boolean not null default true;
alter table graduation_rules add column if not exists require_reflection boolean not null default true;
alter table graduation_rules add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_graduation_rule_programme on graduation_rules(programme_id);

-- Editing an approved rule sends it back to draft. Approval records who and when. No overall-percent rule yet:
-- the weights are unapproved, so a threshold on them would be a guess.
create or replace function guard_graduation_rule() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.min_overall_percent is not null then raise exception 'An overall-percent rule is not supported until assessment weights are approved'; end if;
  if new.min_sessions_attended is not null and new.min_sessions_attended < 1 then raise exception 'Minimum sessions must be at least 1'; end if;
  if tg_op = 'UPDATE' and old.is_approved and (
       new.min_sessions_attended is distinct from old.min_sessions_attended or new.require_core_sessions is distinct from old.require_core_sessions
       or new.require_final_project is distinct from old.require_final_project or new.require_reflection is distinct from old.require_reflection) then
    new.is_approved := false;
  end if;
  if new.is_approved and (tg_op = 'INSERT' or not old.is_approved) then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  if not new.is_approved then new.approved_by := null; new.approved_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_guard_graduation_rule before insert or update on graduation_rules for each row execute function guard_graduation_rule();
create trigger aud_graduation_rules after insert or update or delete on graduation_rules for each row execute function audit_row();

alter table certificates add column if not exists rules_id uuid references graduation_rules(id);
alter table certificates add column if not exists revoked_at timestamptz;
alter table certificates add column if not exists revoked_by uuid references profiles(id);
alter table certificates add column if not exists revoked_reason text;

-- Certificates change only through issue_certificate() and revoke_certificate(); direct writes are refused.
create or replace function guard_certificate_write() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.certificate_fn', true), '') <> '1' then
    raise exception 'Certificates are issued and revoked only through issue_certificate and revoke_certificate';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_certificate_write before insert or update or delete on certificates for each row execute function guard_certificate_write();

-- What a participant has done in one cohort, using the same counting as the results page.
-- security invoker: the caller's own row-level security applies.
create or replace function participant_completion(p_participant uuid, p_cohort uuid)
returns table(sessions_attended int, core_attended int, core_total int, final_submitted boolean, reflection_submitted boolean)
language sql stable set search_path = public as $$
  with enrol as (select track_id from cohort_enrolments where participant_id = p_participant and cohort_id = p_cohort),
  sched as (
    select s.id, s.curriculum_session_id, cs.track_id from session_schedules s join curriculum_sessions cs on cs.id = s.curriculum_session_id
    where s.cohort_id = p_cohort and s.status <> 'cancelled'),
  att as (
    select distinct sc.curriculum_session_id, (sc.track_id is null) as is_core
    from sched sc join attendance a on a.schedule_id = sc.id
    where a.participant_id = p_participant and a.status in ('present', 'late')
      and (sc.track_id is null or sc.track_id = (select track_id from enrol)))
  select (select count(*)::int from att),
         (select count(*) filter (where is_core)::int from att),
         (select count(distinct curriculum_session_id)::int from sched where track_id is null),
         exists (select 1 from submissions sub join assignments asg on asg.id = sub.assignment_id
                 where sub.participant_id = p_participant and asg.cohort_id = p_cohort and asg.component = 'final_project'),
         exists (select 1 from submissions sub join assignments asg on asg.id = sub.assignment_id
                 where sub.participant_id = p_participant and asg.cohort_id = p_cohort and asg.component = 'reflection') $$;

create or replace function issue_certificate(p_participant uuid, p_cohort uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare prog uuid; r graduation_rules; c record; cid uuid; pstatus participant_status; pprofile uuid;
begin
  if app_role() not in ('super_admin', 'programme_director') then raise exception 'Only a super administrator or programme director can issue certificates'; end if;
  select programme_id into prog from cohorts where id = p_cohort;
  if prog is null then raise exception 'Cohort not found'; end if;
  if not exists (select 1 from cohort_enrolments where cohort_id = p_cohort and participant_id = p_participant) then raise exception 'The participant is not enrolled in this cohort'; end if;
  select status, profile_id into pstatus, pprofile from participants where id = p_participant;
  if pstatus = 'withdrawn' then raise exception 'A withdrawn participant cannot receive a certificate'; end if;
  select * into r from graduation_rules where programme_id = prog and is_approved;
  if not found then raise exception 'Graduation rules have not been approved by management'; end if;
  if exists (select 1 from certificates where participant_id = p_participant and cohort_id = p_cohort and not revoked) then raise exception 'This participant already has an active certificate for this cohort'; end if;

  select * into c from participant_completion(p_participant, p_cohort);
  if r.min_sessions_attended is not null and c.sessions_attended < r.min_sessions_attended then
    raise exception 'Attendance requirement not met (% of % sessions)', c.sessions_attended, r.min_sessions_attended; end if;
  if r.require_core_sessions and (c.core_total = 0 or c.core_attended < c.core_total) then raise exception 'Core sessions requirement not met'; end if;
  if r.require_final_project and not c.final_submitted then raise exception 'The final project has not been submitted'; end if;
  if r.require_reflection and not c.reflection_submitted then raise exception 'The reflection has not been submitted'; end if;

  perform set_config('app.certificate_fn', '1', true);
  insert into certificates(participant_id, cohort_id, issued_by, rules_id) values (p_participant, p_cohort, auth.uid(), r.id) returning id into cid;
  perform set_config('app.certificate_fn', '', true);
  update participants set status = 'graduated' where id = p_participant and status in ('enrolled', 'active', 'completed');
  insert into notifications(user_id, kind, title, body) values (pprofile, 'certificate', 'Your certificate is ready', 'Open Certificates to view or print it.');
  return cid;
end $$;
grant execute on function issue_certificate(uuid, uuid) to authenticated;

create or replace function revoke_certificate(p_certificate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pprofile uuid; n int;
begin
  if app_role() not in ('super_admin', 'programme_director') then raise exception 'Only a super administrator or programme director can revoke certificates'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'A written reason is required'; end if;
  perform set_config('app.certificate_fn', '1', true);
  update certificates set revoked = true, revoked_at = now(), revoked_by = auth.uid(), revoked_reason = trim(p_reason)
    where id = p_certificate and not revoked;
  get diagnostics n = row_count;  -- PERFORM would overwrite FOUND, so count rows explicitly
  perform set_config('app.certificate_fn', '', true);
  if n = 0 then raise exception 'Certificate not found or already revoked'; end if;
  select p.profile_id into pprofile from certificates c join participants p on p.id = c.participant_id where c.id = p_certificate;
  insert into notifications(user_id, kind, title, body) values (pprofile, 'certificate', 'A certificate was withdrawn', 'Please contact the programme team if you have questions.');
end $$;
grant execute on function revoke_certificate(uuid, text) to authenticated;

-- Alumni: staff move a graduate into the alumni list; alumni keep their own follow-up record up to date.
create or replace function mark_alumni(p_participant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only programme staff can do this'; end if;
  if not exists (select 1 from participants where id = p_participant and status = 'graduated') then raise exception 'Only a graduated participant can become an alumnus'; end if;
  update participants set status = 'alumni' where id = p_participant;
  insert into alumni(participant_id) values (p_participant) on conflict (participant_id) do nothing;
end $$;
grant execute on function mark_alumni(uuid) to authenticated;
create trigger trg_alumni_upd before update on alumni for each row execute function set_updated_at();

-- ============ 4. Notifications and announcements ============
create or replace function set_announcement_author() returns trigger language plpgsql as $$
begin new.created_by := coalesce(auth.uid(), new.created_by); return new; end $$;
create trigger trg_announcement_author before insert on announcements for each row execute function set_announcement_author();

-- Every announcement becomes an in-app notification for the people it is addressed to.
create or replace function announcement_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(user_id, kind, title, body)
  select distinct s.u, 'announcement', new.title, left(new.body, 200) from (
    select p.profile_id as u from participants p join cohort_enrolments e on e.participant_id = p.id
      where new.cohort_id is not null and e.cohort_id = new.cohort_id and p.status <> 'withdrawn'
    union select ta.trainer_id from trainer_assignments ta where new.cohort_id is not null and ta.cohort_id = new.cohort_id
    union select pr.id from profiles pr where new.cohort_id is null and pr.status = 'active' and pr.role in ('participant', 'trainer', 'mentor', 'me_officer')
      and not exists (select 1 from participants p where p.profile_id = pr.id and p.status = 'withdrawn')
  ) s where s.u is not null and s.u is distinct from new.created_by;
  return new;
end $$;
create trigger trg_announcement_notify after insert on announcements for each row execute function announcement_notify();
-- Announcements are a record of what people were told: staff can post but not edit or delete.
drop policy if exists ann_write on announcements;
create policy ann_insert on announcements for insert to authenticated with check (is_staff());
create trigger aud_announcements after insert or update or delete on announcements for each row execute function audit_row();

create or replace function notify_submission_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(user_id, kind, title, body)
  select p.profile_id, 'assignment', case when new.status = 'graded' then 'Your work was graded' else 'Your work was returned for revision' end,
         (select a.title from assignments a where a.id = new.assignment_id)
  from participants p where p.id = new.participant_id;
  return new;
end $$;
create trigger trg_notify_submission after update of status on submissions for each row
  when (old.status is distinct from new.status and new.status in ('graded', 'returned')) execute function notify_submission_update();

-- Neutral wording on purpose: the decision itself is read in the application, not in a notification.
-- Acceptance is announced when the application is converted (Edge Function), so it is not repeated here.
create or replace function notify_application_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(user_id, kind, title, body) values (new.applicant_id, 'application', 'There is an update on your application', 'Open My application to read it.');
  return new;
end $$;
create trigger trg_notify_application after update of status on applications for each row
  when (old.status is distinct from new.status and new.status in ('shortlisted', 'waitlisted', 'rejected')) execute function notify_application_update();

-- People may mark their notifications read, but not rewrite them.
create or replace function guard_notification_update() returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.title is distinct from old.title
     or new.body is distinct from old.body or new.created_at is distinct from old.created_at then
    raise exception 'Only the read time of a notification can be changed';
  end if;
  return new;
end $$;
create trigger trg_guard_notification before update on notifications for each row execute function guard_notification_update();

-- ============ 5. Projects and portfolio ============
alter table participant_projects add constraint chk_project_status check (status in ('in_progress', 'submitted', 'needs_revision', 'reviewed'));
alter table participant_projects add constraint chk_project_milestones check (jsonb_typeof(milestones) = 'array');

create or replace function guard_project() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if app_role() = 'participant' then
    if exists (select 1 from participants where id = my_participant_id() and status = 'withdrawn') then raise exception 'Withdrawn participants cannot change projects'; end if;
    if tg_op = 'INSERT' then
      new.feedback := null; new.status := 'in_progress';
    else
      if new.participant_id is distinct from old.participant_id or new.feedback is distinct from old.feedback then raise exception 'You cannot change feedback or ownership'; end if;
      if old.status in ('submitted', 'reviewed') then raise exception 'This project is locked until a trainer returns it'; end if;
      if new.status = 'needs_revision' then new.status := 'in_progress'; end if;  -- editing a returned project means working on it again
      if new.status not in ('in_progress', 'submitted') then raise exception 'You can only keep working or submit'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_project before insert or update on participant_projects for each row execute function guard_project();
create trigger aud_projects after insert or update or delete on participant_projects for each row execute function audit_row();

create or replace function guard_project_evidence() returns trigger language plpgsql security definer set search_path = public as $$
declare pstatus text; powner uuid;
begin
  if app_role() = 'participant' then
    select status, participant_id into pstatus, powner from participant_projects where id = new.project_id;
    if powner is distinct from my_participant_id() then raise exception 'Not your project'; end if;
    if pstatus not in ('in_progress', 'needs_revision') then raise exception 'Evidence cannot be added while the project is submitted or reviewed'; end if;
    if new.storage_path not like auth.uid()::text || '/%' then raise exception 'Evidence files must be stored in your own folder'; end if;
  end if;
  return new;
end $$;
create trigger trg_guard_project_evidence before insert on project_evidence for each row execute function guard_project_evidence();

-- ============ 6. Settings (approval workflow) ============
alter table system_settings add column if not exists approved_by uuid references profiles(id);
alter table system_settings add column if not exists approved_at timestamptz;
create or replace function guard_setting() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.is_approved and new.value is distinct from old.value then new.is_approved := false; end if;
  if new.is_approved and (tg_op = 'INSERT' or not old.is_approved) then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  if not new.is_approved then new.approved_by := null; new.approved_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_guard_setting before insert or update on system_settings for each row execute function guard_setting();

-- ============ 7. Safeguarding (super administrator only; no delete) ============
alter table safeguarding_records add column if not exists status text not null default 'open';
alter table safeguarding_records add column if not exists updated_at timestamptz not null default now();
alter table safeguarding_records add constraint chk_safeguarding_status check (status in ('open', 'under_review', 'closed'));
alter table safeguarding_records add constraint chk_safeguarding_severity check (severity is null or severity in ('low', 'medium', 'high'));
drop policy if exists safe_admin on safeguarding_records;
create policy safe_admin_read on safeguarding_records for select to authenticated using (is_admin());
create policy safe_admin_insert on safeguarding_records for insert to authenticated with check (is_admin());
create policy safe_admin_update on safeguarding_records for update to authenticated using (is_admin()) with check (is_admin());
create or replace function guard_safeguarding() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.reported_by := coalesce(auth.uid(), new.reported_by);
  else new.reported_by := old.reported_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_guard_safeguarding before insert or update on safeguarding_records for each row execute function guard_safeguarding();
-- No audit trigger on purpose: it would copy case details into a second table.

-- ============ 8. Audit log is append-only ============
revoke update, delete, truncate on audit_logs from authenticated, anon;
