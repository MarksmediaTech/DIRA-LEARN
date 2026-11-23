-- DIRA LEARN: email system (templates, outbox, bulk sends, reminders, event emails).
-- STATUS: written, NOT yet executed. Sending itself happens in the `send-emails` Edge Function using RESEND_API_KEY,
-- which lives only in the function environment. Without that key nothing is sent and the outbox simply stays queued.
-- Supabase Auth's own emails (sign-up confirmation, password reset) are NOT sent from here: point Supabase Auth SMTP at the
-- same provider (see docs/EMAIL_SETUP.md).

alter table profiles add column if not exists email_opt_out boolean not null default false;  -- skipped by bulk and announcement email

-- ============ templates ============
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  name text not null,
  subject text not null check (length(subject) between 3 and 200),
  body text not null check (length(body) between 3 and 10000),   -- plain text with {{placeholders}}; the sender wraps it in the DIRA layout
  is_system boolean not null default false,                      -- system templates are used by automation; they can be edited, not deleted
  is_active boolean not null default true,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table email_templates enable row level security;
create policy emailtpl_read on email_templates for select to authenticated using (is_staff());
create policy emailtpl_insert on email_templates for insert to authenticated with check (is_staff() and not is_system);
create policy emailtpl_update on email_templates for update to authenticated using (is_staff()) with check (is_staff());
create policy emailtpl_delete on email_templates for delete to authenticated using (is_staff() and not is_system);
create or replace function guard_email_template() returns trigger language plpgsql as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  if tg_op = 'UPDATE' and (new.key is distinct from old.key or new.is_system is distinct from old.is_system) then raise exception 'A template key cannot be changed'; end if;
  return new;
end $$;
create trigger trg_email_template before insert or update on email_templates for each row execute function guard_email_template();
create trigger aud_email_templates after insert or update or delete on email_templates for each row execute function audit_row();

-- Draft wording for the templates automation uses. Management should review and edit it before switching automation on.
insert into email_templates(key, name, subject, body, is_system) values
 ('notification', 'In-app notification copy', '{{title}}', E'Hello {{first_name}},\n\n{{body}}\n\nSign in to DIRA Learn for details.', true),
 ('session_reminder', 'Session reminder', 'Reminder: {{session_title}} on {{session_date}}', E'Hello {{first_name}},\n\nThis is a reminder that "{{session_title}}" for {{cohort_name}} starts on {{session_date}} at {{session_time}} ({{session_mode}}).\n{{session_place}}\n\nSee you there.', true),
 ('assignment_reminder', 'Assignment due reminder', 'Reminder: {{assignment_title}} is due {{due_date}}', E'Hello {{first_name}},\n\nYour assignment "{{assignment_title}}" for {{cohort_name}} is due on {{due_date}}. Sign in to DIRA Learn to submit it.', true),
 ('cohort_welcome', 'Cohort welcome', 'Welcome to {{cohort_name}}', E'Hello {{first_name}},\n\nYou are enrolled in {{cohort_name}} ({{programme_name}}). Sign in to DIRA Learn to see your schedule.', false)
on conflict (key) do nothing;

-- ============ outbox ============
create type email_status as enum ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'cancelled');
create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_user_id uuid references profiles(id) on delete set null,
  to_email text not null,
  template_key text,
  campaign text,                                     -- label for bulk sends and automation, for reporting
  subject text not null,
  body text not null,                                -- fully rendered plain text
  status email_status not null default 'queued',
  scheduled_for timestamptz not null default now(),
  attempts int not null default 0,
  provider_id text,                                  -- id returned by the email provider; the webhook matches on it
  error text,
  sent_at timestamptz,
  claimed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on email_outbox(status, scheduled_for);
create index on email_outbox(provider_id);
alter table email_outbox enable row level security;
-- Addresses and message bodies are personal data: only the programme management roles can read them. All writes go through functions.
create policy emailout_read on email_outbox for select to authenticated using (is_staff());
revoke insert, update, delete on email_outbox from authenticated, anon;

create table email_reminder_log (        -- prevents sending the same reminder twice
  kind text not null, ref_id uuid not null, user_id uuid not null references profiles(id) on delete cascade, created_at timestamptz not null default now(),
  primary key (kind, ref_id, user_id)
);
alter table email_reminder_log enable row level security;   -- no policies: functions only

-- ============ rendering ============
create or replace function render_text(t text, v jsonb) returns text language plpgsql immutable as $$
declare k text; val text; out text := t;
begin
  for k, val in select * from jsonb_each_text(v) loop out := replace(out, '{{' || k || '}}', coalesce(val, '')); end loop;
  if out ~ '\{\{[a-z_]+\}\}' then raise exception 'Unresolved placeholder in template: %', (regexp_match(out, '\{\{[a-z_]+\}\}'))[1]; end if;
  return out;
end $$;

create or replace function email_automation_enabled() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'enabled')::boolean and is_approved from system_settings where key = 'email_automation'), false) $$;
insert into system_settings(key, value, note) values ('email_automation', '{"enabled": false}', 'Automatic emails (reminders and event emails). Off until management approves it.') on conflict (key) do nothing;

-- Core enqueue: one rendered email for one user. Internal; callers check permission.
create or replace function _enqueue_email(p_user uuid, p_template text, p_vars jsonb, p_when timestamptz, p_campaign text, p_by uuid) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare t email_templates; u record; v jsonb; new_id uuid;
begin
  select * into t from email_templates where key = p_template and is_active;
  if not found then return null; end if;
  select p.id, p.first_name, p.last_name, p.status, au.email::text as email into u from profiles p join auth.users au on au.id = p.id where p.id = p_user;
  if not found or u.email is null or u.status = 'deactivated' then return null; end if;
  v := jsonb_build_object('first_name', coalesce(nullif(u.first_name, ''), 'there'), 'last_name', coalesce(u.last_name, '')) || coalesce(p_vars, '{}'::jsonb);
  insert into email_outbox(to_user_id, to_email, template_key, campaign, subject, body, scheduled_for, created_by)
  values (u.id, u.email, p_template, p_campaign, render_text(t.subject, v), render_text(t.body, v), coalesce(p_when, now()), p_by) returning email_outbox.id into new_id;
  return new_id;
end $$;
revoke all on function _enqueue_email(uuid, text, jsonb, timestamptz, text, uuid) from public, anon, authenticated;

-- Bulk send for management: audience is a cohort's participants, all participants, or all staff. Opted-out people are skipped.
create or replace function enqueue_bulk_email(p_template text, p_audience text, p_cohort uuid, p_when timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; vars jsonb; label text;
begin
  if not is_staff() then raise exception 'Only programme management can send email'; end if;
  if p_when is not null and p_when < now() - interval '5 minutes' then raise exception 'The scheduled time is in the past'; end if;
  if p_audience not in ('cohort', 'all_participants', 'all_staff') then raise exception 'Unknown audience'; end if;
  if p_audience = 'cohort' and p_cohort is null then raise exception 'Choose a cohort'; end if;
  if not exists (select 1 from email_templates where key = p_template and is_active) then raise exception 'Template not found or switched off'; end if;
  label := 'bulk:' || p_template || ':' || to_char(now(), 'YYYY-MM-DD HH24:MI');
  for r in
    select distinct pr.id as uid, c.name as cohort_name, g.name as programme_name
    from profiles pr
    left join participants pa on pa.profile_id = pr.id
    left join cohort_enrolments e on e.participant_id = pa.id and (p_audience <> 'cohort' or e.cohort_id = p_cohort)
    left join cohorts c on c.id = e.cohort_id
    left join programmes g on g.id = c.programme_id
    where pr.status = 'active' and not pr.email_opt_out
      and ((p_audience = 'cohort' and e.cohort_id = p_cohort and pa.status <> 'withdrawn')
        or (p_audience = 'all_participants' and pr.role = 'participant' and pa.status <> 'withdrawn')
        or (p_audience = 'all_staff' and pr.role in ('super_admin', 'programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor')))
  loop
    n := n + 1;
    if n > 500 then raise exception 'An audience is limited to 500 people per send'; end if;
    vars := jsonb_build_object('cohort_name', coalesce(r.cohort_name, ''), 'programme_name', coalesce(r.programme_name, ''));
    perform _enqueue_email(r.uid, p_template, vars, p_when, label, auth.uid());
  end loop;
  return n;
end $$;
grant execute on function enqueue_bulk_email(text, text, uuid, timestamptz) to authenticated;

create or replace function cancel_email(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Only programme management can cancel email'; end if;
  update email_outbox set status = 'cancelled' where id = p_id and status = 'queued';
  if not found then raise exception 'Only a queued email can be cancelled'; end if;
end $$;
grant execute on function cancel_email(uuid) to authenticated;

-- ============ event emails: every in-app notification can also become an email (opt-out respected) ============
create or replace function notification_to_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not email_automation_enabled() then return new; end if;
  if new.kind not in ('announcement', 'assignment', 'certificate', 'application') then return new; end if;
  if exists (select 1 from profiles where id = new.user_id and email_opt_out) then return new; end if;
  perform _enqueue_email(new.user_id, 'notification', jsonb_build_object('title', new.title, 'body', coalesce(new.body, '')), now(), 'event:' || new.kind, null);
  return new;
end $$;
create trigger trg_notification_to_email after insert on notifications for each row execute function notification_to_email();

-- ============ reminders: called by the send-emails function on its schedule (service role only) ============
create or replace function queue_reminders() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; new_id uuid;
begin
  if not email_automation_enabled() then return 0; end if;
  -- Sessions starting in the next 24 hours (not cancelled), for enrolled participants who have not opted out.
  for r in
    select s.id as ref, pa.profile_id as uid, cs.title, s.starts_at, s.mode, s.venue, s.meeting_url, c.name as cohort_name
    from session_schedules s join curriculum_sessions cs on cs.id = s.curriculum_session_id join cohorts c on c.id = s.cohort_id
    join cohort_enrolments e on e.cohort_id = s.cohort_id join participants pa on pa.id = e.participant_id
    join profiles pr on pr.id = pa.profile_id
    where s.status in ('scheduled', 'rescheduled') and s.starts_at > now() and s.starts_at <= now() + interval '24 hours'
      and pa.status <> 'withdrawn' and not pr.email_opt_out
      and (cs.track_id is null or cs.track_id = e.track_id)
      and not exists (select 1 from email_reminder_log l where l.kind = 'session' and l.ref_id = s.id and l.user_id = pa.profile_id)
  loop
    new_id := _enqueue_email(r.uid, 'session_reminder', jsonb_build_object('session_title', r.title,
      'session_date', to_char(r.starts_at at time zone 'Africa/Nairobi', 'FMDay DD Mon YYYY'), 'session_time', to_char(r.starts_at at time zone 'Africa/Nairobi', 'HH24:MI') || ' EAT',
      'session_mode', r.mode::text, 'session_place', coalesce(case when r.mode = 'physical' then 'Venue: ' || r.venue else 'Meeting link: ' || coalesce(r.meeting_url, 'will be shared by your trainer') end, ''), 'cohort_name', r.cohort_name), now(), 'reminder:session', null);
    insert into email_reminder_log(kind, ref_id, user_id) values ('session', r.ref, r.uid) on conflict do nothing;
    if new_id is not null then n := n + 1; end if;
  end loop;
  -- Assignments due in the next 48 hours that the participant has not submitted.
  for r in
    select a.id as ref, pa.profile_id as uid, a.title, a.due_at, c.name as cohort_name
    from assignments a join cohorts c on c.id = a.cohort_id join cohort_enrolments e on e.cohort_id = a.cohort_id
    join participants pa on pa.id = e.participant_id join profiles pr on pr.id = pa.profile_id
    where a.due_at > now() and a.due_at <= now() + interval '48 hours' and pa.status <> 'withdrawn' and not pr.email_opt_out
      and (a.track_id is null or a.track_id = e.track_id)
      and not exists (select 1 from submissions sb where sb.assignment_id = a.id and sb.participant_id = pa.id)
      and not exists (select 1 from email_reminder_log l where l.kind = 'assignment' and l.ref_id = a.id and l.user_id = pa.profile_id)
  loop
    new_id := _enqueue_email(r.uid, 'assignment_reminder', jsonb_build_object('assignment_title', r.title,
      'due_date', to_char(r.due_at at time zone 'Africa/Nairobi', 'FMDay DD Mon YYYY HH24:MI') || ' EAT', 'cohort_name', r.cohort_name), now(), 'reminder:assignment', null);
    insert into email_reminder_log(kind, ref_id, user_id) values ('assignment', r.ref, r.uid) on conflict do nothing;
    if new_id is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function queue_reminders() from public, anon, authenticated;
grant execute on function queue_reminders() to service_role;

-- ============ sender support (service role only) ============
create or replace function claim_emails(p_limit int default 25) returns setof email_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  update email_outbox set status = 'sending', attempts = attempts + 1, claimed_at = now()
  where id in (select id from email_outbox where status = 'queued' and scheduled_for <= now() and attempts < 3 order by scheduled_for limit greatest(1, least(p_limit, 100)) for update skip locked)
  returning *;
end $$;
revoke all on function claim_emails(int) from public, anon, authenticated;
grant execute on function claim_emails(int) to service_role;

-- A sender that crashed leaves rows in 'sending'; put them back after 15 minutes (the attempt counter still limits retries).
create or replace function requeue_stuck_emails() returns int language sql security definer set search_path = public as $$
  with u as (update email_outbox set status = 'queued' where status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 3 returning 1) select count(*)::int from u $$;
revoke all on function requeue_stuck_emails() from public, anon, authenticated;
grant execute on function requeue_stuck_emails() to service_role;

create or replace function email_report(p_from date, p_to date) returns table(status email_status, total bigint)
language sql stable security definer set search_path = public as $$
  select o.status, count(*) from email_outbox o where is_staff() and o.created_at >= p_from and o.created_at < p_to + 1 group by o.status $$;
grant execute on function email_report(date, date) to authenticated;
