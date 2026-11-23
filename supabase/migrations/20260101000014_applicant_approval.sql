-- DIRA LEARN: in-system applicant approval (Approve / Reject inside the administrator dashboard)
-- STATUS: written, NOT yet executed. Run `supabase db reset` then `supabase test db` on a LOCAL database first.
-- SAFE TO APPLY TO A LIVE DATABASE: additive only. It adds functions and two email templates and replaces three
-- existing functions. It does not change, delete or backfill any rows, and it never touches existing profiles
-- (including the Super Administrator account).
--
-- Design (reuses the existing tables: profiles, applications, application_events, participants, audit_logs,
-- notifications, email_templates, email_outbox):
--   * Pending  = submitted | under_review | shortlisted | waitlisted
--   * Approved = accepted      (applicant becomes a participant)
--   * Rejected = rejected      (applicant stays an applicant; no participant access)
--   * ONLY decide_application() can approve or reject. It runs on the server (security definer), checks the caller,
--     and does every step in ONE transaction: status, profile, participant record, history, audit log, notification, email.
--   * Who may decide: active super_admin or programme_director. Nobody can decide their own application.

-- ============ 1. who may decide ============
create or replace function can_decide_applications() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'programme_director'), false) $$;
revoke all on function can_decide_applications() from public, anon;
grant execute on function can_decide_applications() to authenticated;

-- ============ 2. profile guard: one narrow exception for the approval function ============
-- Unchanged rule: only a super administrator (or a trusted server session) may change role, status or organisation.
-- New, narrow exception: while decide_application() is running it may turn an ACTIVE APPLICANT into a participant
-- (and nothing else). The flag is transaction-local and cannot be set through the API.
create or replace function guard_profile_privileged() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_trusted_session() then return new; end if;
  if current_setting('dira.application_decision', true) = 'on'
     and old.role = 'applicant' and new.role = 'participant'
     and new.status is not distinct from old.status
     and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.organization_id is distinct from old.organization_id)
     and not is_admin() then
    raise exception 'Only a super administrator can change role, status or organisation';
  end if;
  return new;
end $$;

-- ============ 3. email templates (editable by staff in the Emails page) ============
insert into email_templates(key, name, subject, body, is_system) values
 ('application_approved', 'Application approved', 'Your DIRA LEARN application was approved',
  E'Hello {{first_name}},\n\nGood news: your application to the DIRA Foundation programme has been approved. You now have participant access to DIRA LEARN.\n\nSign in to see your dashboard. Details of your cohort and schedule will follow.\n\nWelcome aboard,\nDIRA Foundation', true),
 ('application_rejected', 'Application not successful', 'An update on your DIRA LEARN application',
  E'Hello {{first_name}},\n\nThank you for applying to the DIRA Foundation programme and for the time you put into your application. After careful review, we are not able to offer you a place in this cohort.\n\nThis is not a judgement of your potential. You are welcome to apply again for a future cohort. If you have questions, contact us through our website.\n\nWith best wishes,\nDIRA Foundation', true)
on conflict (key) do nothing;

-- ============ 4. the decision function ============
create or replace function decide_application(p_app uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  a applications;
  approve boolean;
  reason text := nullif(btrim(p_reason), '');
  f jsonb;
  dob date;
  pid uuid;
  new_status application_status;
  vars jsonb;
begin
  if actor is null or not can_decide_applications() then
    raise exception 'Only a super administrator or programme director can approve or reject applications';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'The decision must be approve or reject'; end if;
  approve := p_decision = 'approve';
  if reason is not null and length(reason) > 1000 then raise exception 'The reason is too long (1000 characters at most)'; end if;

  select * into a from applications where id = p_app for update;          -- row lock: two admins cannot decide at once
  if not found then raise exception 'Application not found'; end if;
  if a.applicant_id = actor then raise exception 'You cannot decide your own application'; end if;
  if a.status not in ('submitted', 'under_review', 'shortlisted', 'waitlisted') then
    raise exception 'Only pending applications can be approved or rejected (this one is %)', a.status;
  end if;

  f := coalesce(a.form_data, '{}'::jsonb);
  new_status := case when approve then 'accepted'::application_status else 'rejected'::application_status end;
  perform set_config('dira.application_transition', 'on', true);          -- lets the status trigger accept this change
  perform set_config('dira.application_decision', 'on', true);            -- lets the profile guard accept applicant -> participant

  if approve then
    if not exists (select 1 from profiles where id = a.applicant_id and role = 'applicant' and status = 'active') then
      raise exception 'This account is not an active applicant account, so it cannot be approved as a participant';
    end if;
    select id into pid from participants where application_id = a.id or profile_id = a.applicant_id limit 1;
    if pid is null then
      begin dob := (f ->> 'dateOfBirth')::date; exception when others then dob := null; end;
      insert into participants(profile_id, application_id, participant_no, date_of_birth)
        values (a.applicant_id, a.id, next_participant_no(), dob) returning id into pid;
    end if;
    insert into portfolios(participant_id) values (pid) on conflict do nothing;
    update profiles set role = 'participant',
      first_name = coalesce(nullif(btrim(f ->> 'firstName'), ''), first_name),
      last_name  = coalesce(nullif(btrim(f ->> 'lastName'), ''), last_name),
      phone      = coalesce(nullif(btrim(f ->> 'phone'), ''), phone)
    where id = a.applicant_id;
  end if;

  update applications set status = new_status where id = a.id;
  insert into application_events(application_id, from_status, to_status, note, actor_id)
    values (a.id, a.status, new_status, reason, actor);
  insert into audit_logs(actor_id, table_name, row_id, action, old_data, new_data)
    values (actor, 'applications', a.id::text, case when approve then 'application_approved' else 'application_rejected' end,
            jsonb_build_object('status', a.status),
            jsonb_build_object('status', new_status, 'decision', p_decision, 'reason', reason, 'decided_by', actor,
                               'decided_at', now(), 'applicant_id', a.applicant_id, 'participant_id', pid));

  -- In-app notification. Kind 'application_decision' is deliberately NOT one of the kinds that the notification-to-email
  -- trigger copies, so the applicant gets exactly one email (queued below), not two.
  insert into notifications(user_id, kind, title, body)
    values (a.applicant_id, 'application_decision',
            case when approve then 'Your application was approved' else 'An update on your application' end,
            case when approve then 'Welcome to DIRA LEARN. Your cohort details will follow.' else 'Open My application to read the update.' end);

  -- Decision emails are transactional: sent even when marketing opt-out is on or event automation is off.
  -- The internal reason is never put in the email. Sending itself is done by the existing send-emails function.
  vars := jsonb_build_object('first_name', coalesce(nullif(btrim(f ->> 'firstName'), ''), 'there'));
  perform _enqueue_email(a.applicant_id, case when approve then 'application_approved' else 'application_rejected' end,
                         vars, now(), 'event:application_decision', actor);

  return jsonb_build_object('status', new_status, 'participant_id', pid);
end $$;
revoke all on function decide_application(uuid, text, text) from public, anon;
grant execute on function decide_application(uuid, text, text) to authenticated;

-- ============ 5. staff can see applicant emails (auth.users is otherwise unreadable) ============
create or replace function application_emails() returns table(application_id uuid, email text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_staff() then raise exception 'Only programme staff can view applicant emails'; end if;
  return query select a.id, au.email::text from applications a join auth.users au on au.id = a.applicant_id where a.status <> 'draft';
end $$;
revoke all on function application_emails() from public, anon;
grant execute on function application_emails() to authenticated;

-- ============ 6. the old status route can no longer approve or reject ============
-- Same function as before, plus one rule: approving goes through decide_application(); rejecting needs approval rights.
create or replace function transition_application(p_app uuid, p_to application_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur application_status;
begin
  if not is_staff() then raise exception 'Only programme staff can review applications'; end if;
  select status into cur from applications where id = p_app for update;
  if cur is null then raise exception 'Application not found'; end if;
  if not application_transition_allowed(cur, p_to) then
    raise exception 'An application cannot move from % to %', cur, p_to;
  end if;
  if (p_to = 'rejected' or cur = 'rejected') and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when rejecting or reconsidering an application';
  end if;
  if p_to in ('accepted', 'rejected') then
    raise exception 'Applications are approved or rejected with the Approve and Reject actions, by a super administrator or programme director';
  end if;
  perform set_config('dira.application_transition', 'on', true);
  update applications set status = p_to where id = p_app;
  insert into application_events(application_id, from_status, to_status, note, actor_id)
    values (p_app, cur, p_to, nullif(btrim(p_note), ''), auth.uid());
end $$;

-- ============ 7. avoid a second, neutral notification when the decision function already wrote one ============
create or replace function notify_application_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('dira.application_decision', true) = 'on' then return new; end if;
  insert into notifications(user_id, kind, title, body) values (new.applicant_id, 'application', 'There is an update on your application', 'Open My application to read it.');
  return new;
end $$;
