-- DIRA LEARN: Phase 4 completion, part 1 – designated safeguarding officers, confidential safeguarding records, escalation,
-- and stricter private-conversation oversight (management decisions of 19 Nov 2026, see docs/SAFEGUARDING.md).
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000024_safeguarding_officers_down.sql
--
-- WHAT IT DOES
--   * Safeguarding Lead and Deputy are DESIGNATED positions (table safeguarding_officers). Nobody holds them when this runs.
--     An executive appoints them, never themselves. The Deputy acts when the Lead is unavailable or not appointed.
--   * Safeguarding records become confidential: ONLY the current Lead and Deputy can read or change them. Executives lose their
--     automatic access (they keep it only through an explicit, time-limited, audited exceptional grant made by someone else).
--   * Records gain urgency, acknowledgement target, responsible officer, status history (safeguarding_actions), resolution,
--     legal hold and a retention-review date. Nothing is deleted, and records are NOT written to the general audit log
--     (which executives can read); they have their own restricted logs.
--   * Escalating a DIRA Connect report creates a safeguarding record (with a copy of the reported message) and notifies the
--     acting officer. A report with reason "safety concern" goes to safeguarding automatically.
--   * Notifications and emails never contain names or details.
--   * Private-conversation oversight: no self-granting; a 'private' grant reads only REPORTED or ESCALATED conversations; the
--     acting Safeguarding Lead may read another private conversation only with a documented safeguarding record and a reason.
--     Every read is logged.
-- NOT DONE HERE (management decisions): the safeguarding records retention period; the exact "prompt action" time for urgent
--   concerns (defaults below: acknowledge urgent within 60 minutes, others within 24 hours, both editable by executives).

-- ============ 1. designated officers ============
create table safeguarding_officers (
  position text primary key check (position in ('lead', 'deputy')),
  profile_id uuid not null unique references profiles(id),
  appointed_by uuid not null references profiles(id),
  appointed_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) >= 10),
  unavailable_until timestamptz,
  unavailable_note text check (unavailable_note is null or length(unavailable_note) <= 300),
  constraint sg_no_self_appointment check (profile_id <> appointed_by)
);

create table safeguarding_officer_history (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  profile_id uuid references profiles(id),
  event text not null check (event in ('appointed', 'removed', 'unavailable', 'available')),
  actor_id uuid references profiles(id),
  reason text,
  created_at timestamptz not null default now()
);

create table safeguarding_settings (
  id boolean primary key default true check (id),
  urgent_ack_minutes int not null default 60 check (urgent_ack_minutes between 5 and 1440),
  standard_ack_hours int not null default 24 check (standard_ack_hours between 1 and 168),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into safeguarding_settings(id) values (true);

-- The signed-in person's position, if any (an inactive account holds no position).
create or replace function sg_my_position() returns text language sql stable security definer set search_path = public as $$
  select o.position from safeguarding_officers o join profiles p on p.id = o.profile_id
  where o.profile_id = auth.uid() and p.status = 'active' $$;
create or replace function is_safeguarding_officer() returns boolean language sql stable security definer set search_path = public as $$
  select sg_my_position() is not null $$;
-- Who acts as Lead right now: the Lead unless unavailable or not appointed, otherwise the Deputy.
create or replace function sg_acting_officer() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.profile_id from safeguarding_officers o join profiles p on p.id = o.profile_id
      where o.position = 'lead' and p.status = 'active' and (o.unavailable_until is null or o.unavailable_until <= now())),
    (select o.profile_id from safeguarding_officers o join profiles p on p.id = o.profile_id where o.position = 'deputy' and p.status = 'active')) $$;
create or replace function sg_is_acting_lead() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and sg_acting_officer() = auth.uid() $$;
create or replace function sg_officer_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select o.profile_id from safeguarding_officers o join profiles p on p.id = o.profile_id where p.status = 'active' $$;

-- Confidential notification: no names, no details. Email only when automatic email is approved.
create or replace function sg_notify(p_user uuid, p_title text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into notifications(user_id, kind, title, body) values (p_user, 'safeguarding', p_title, 'Open Safeguarding in DIRA LEARN. Details are only shown there.');
  if email_automation_enabled() then
    perform _enqueue_email(p_user, 'safeguarding_alert', jsonb_build_object('alert_title', p_title), now(), 'safeguarding', null);
  end if;
end $$;
revoke all on function sg_notify(uuid, text) from public, anon, authenticated;

insert into email_templates(key, name, subject, body, is_system) values
 ('safeguarding_alert', 'Safeguarding alert', 'DIRA LEARN: {{alert_title}}',
  E'Hello {{first_name}},\n\n{{alert_title}}.\n\nFor confidentiality this email contains no details. Please sign in to DIRA LEARN and open Safeguarding.\n\nDIRA Foundation', true)
on conflict (key) do nothing;

-- ============ 2. confidential records ============
alter table safeguarding_records drop constraint chk_safeguarding_status;
alter table safeguarding_records
  add constraint chk_safeguarding_status check (status in ('open', 'under_review', 'acknowledged', 'in_progress', 'referred', 'resolved', 'closed')),
  add column urgency text not null default 'standard' check (urgency in ('urgent', 'standard')),
  add column source text not null default 'manual' check (source in ('manual', 'raised_by_staff', 'connect_report', 'connect_safety_report')),
  add column source_report_id uuid references connect_reports(id) on delete set null,
  add column conversation_id uuid references connect_conversations(id) on delete set null,
  add column reported_message text,
  add column reported_sender uuid references profiles(id),
  add column ack_due_at timestamptz,
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references profiles(id),
  add column responsible_officer uuid references profiles(id),
  add column resolution text check (resolution is null or length(resolution) <= 2000),
  add column resolved_at timestamptz,
  add column legal_hold boolean not null default false,
  add column legal_hold_reason text,
  add column retention_review_on date,
  add column overdue_alerted_at timestamptz;
create index idx_sg_records_status on safeguarding_records (status, created_at desc);
create index idx_sg_records_conversation on safeguarding_records (conversation_id);

create table safeguarding_actions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references safeguarding_records(id),
  action text not null check (action in ('created', 'acknowledged', 'status_changed', 'assigned', 'note', 'referral', 'legal_hold_on', 'legal_hold_off', 'resolved', 'conversation_read', 'exceptional_read')),
  from_status text, to_status text,
  note text check (note is null or length(note) <= 2000),
  actor_id uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_sg_actions_record on safeguarding_actions (record_id, created_at);

-- Exceptional, time-limited access for someone who is not an officer (for example an executive during an investigation).
create table safeguarding_access_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  reason text not null check (length(btrim(reason)) >= 20),
  granted_by uuid not null references profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  constraint sg_grant_not_self check (profile_id <> granted_by)
);

-- Who read what, and why (no content): officers and executives can review it.
create table safeguarding_access_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  record_id uuid references safeguarding_records(id),
  conversation_id uuid references connect_conversations(id) on delete set null,
  basis text not null check (basis in ('exceptional_grant', 'reported_conversation', 'escalated_conversation', 'safeguarding_concern')),
  reason text not null,
  created_at timestamptz not null default now()
);

-- Records: defaults, timestamps, and an automatic history entry for every meaningful change.
create or replace function guard_safeguarding() returns trigger language plpgsql security definer set search_path = public as $$
declare s safeguarding_settings;
begin
  select * into s from safeguarding_settings limit 1;
  if tg_op = 'INSERT' then
    new.reported_by := coalesce(auth.uid(), new.reported_by);
    new.created_at := now();
    new.status := 'open';
    new.acknowledged_at := null; new.acknowledged_by := null; new.resolved_at := null; new.overdue_alerted_at := null;
    new.ack_due_at := now() + case when new.urgency = 'urgent' then make_interval(mins => s.urgent_ack_minutes) else make_interval(hours => s.standard_ack_hours) end;
  else
    new.reported_by := old.reported_by; new.created_at := old.created_at; new.source := old.source; new.source_report_id := old.source_report_id;
    new.reported_message := old.reported_message; new.reported_sender := old.reported_sender;
    if not is_trusted_session() then new.ack_due_at := old.ack_due_at; end if;  -- only server-side corrections may move the target
    if old.status = 'open' and new.status <> 'open' and old.acknowledged_at is null then
      new.acknowledged_at := now(); new.acknowledged_by := auth.uid();
    else
      new.acknowledged_at := old.acknowledged_at; new.acknowledged_by := old.acknowledged_by;
    end if;
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.resolved_at := now();
    elsif new.status not in ('resolved', 'closed') then new.resolved_at := null;
    else new.resolved_at := old.resolved_at; end if;
    if new.legal_hold and coalesce(btrim(new.legal_hold_reason), '') = '' then raise exception 'A legal hold needs a reason'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function log_safeguarding_change() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into safeguarding_actions(record_id, action, to_status, note, actor_id) values (new.id, 'created', new.status, null, actor);
    -- urgent: the Lead AND the Deputy at once; otherwise the acting officer
    if new.urgency = 'urgent' then
      perform sg_notify(o, 'An URGENT safeguarding concern needs your attention now') from sg_officer_ids() o;
    else
      perform sg_notify(sg_acting_officer(), 'A safeguarding concern needs acknowledgement within the target time');
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into safeguarding_actions(record_id, action, from_status, to_status, actor_id)
    values (new.id, case when old.status = 'open' and old.acknowledged_at is null then 'acknowledged'
                         when new.status in ('resolved', 'closed') then 'resolved'
                         else 'status_changed' end, old.status, new.status, actor);
  end if;
  if new.responsible_officer is distinct from old.responsible_officer then
    insert into safeguarding_actions(record_id, action, note, actor_id) values (new.id, 'assigned', null, actor);
  end if;
  if new.legal_hold is distinct from old.legal_hold then
    insert into safeguarding_actions(record_id, action, note, actor_id) values (new.id, case when new.legal_hold then 'legal_hold_on' else 'legal_hold_off' end, new.legal_hold_reason, actor);
  end if;
  return new;
end $$;
create trigger trg_log_safeguarding after insert or update on safeguarding_records for each row execute function log_safeguarding_change();

create or replace function block_safeguarding_delete() returns trigger language plpgsql as $$
begin raise exception 'Safeguarding records and their history cannot be deleted'; end $$;
create trigger trg_safeguarding_no_delete before delete on safeguarding_records for each row execute function block_safeguarding_delete();
create trigger trg_sg_actions_no_delete before update or delete on safeguarding_actions for each row execute function block_safeguarding_delete();
create trigger trg_sg_access_log_no_change before update or delete on safeguarding_access_log for each row execute function block_safeguarding_delete();
create trigger trg_sg_history_no_change before update or delete on safeguarding_officer_history for each row execute function block_safeguarding_delete();

create or replace function guard_safeguarding_action() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actor_id := coalesce(auth.uid(), new.actor_id);
  new.created_at := now();
  return new;
end $$;
create trigger trg_guard_sg_action before insert on safeguarding_actions for each row execute function guard_safeguarding_action();

-- ============ 3. row level security: officers only ============
drop policy if exists safe_admin_read on safeguarding_records;
drop policy if exists safe_admin_insert on safeguarding_records;
drop policy if exists safe_admin_update on safeguarding_records;
create policy sg_officer_read on safeguarding_records for select to authenticated using (is_safeguarding_officer());
create policy sg_officer_insert on safeguarding_records for insert to authenticated with check (is_safeguarding_officer());
create policy sg_officer_update on safeguarding_records for update to authenticated using (is_safeguarding_officer()) with check (is_safeguarding_officer());

alter table safeguarding_officers enable row level security;
alter table safeguarding_officer_history enable row level security;
alter table safeguarding_settings enable row level security;
alter table safeguarding_actions enable row level security;
alter table safeguarding_access_grants enable row level security;
alter table safeguarding_access_log enable row level security;
-- Who holds the positions is not secret inside the organisation: staff and executives can see it.
create policy sgo_read on safeguarding_officers for select to authenticated using (is_staff());
create policy sgoh_read on safeguarding_officer_history for select to authenticated using (is_executive() or is_safeguarding_officer());
create policy sgs_read on safeguarding_settings for select to authenticated using (is_staff() or is_safeguarding_officer());
create policy sgs_update on safeguarding_settings for update to authenticated using (is_executive()) with check (is_executive());
create policy sga_read on safeguarding_actions for select to authenticated using (is_safeguarding_officer());
create policy sga_insert on safeguarding_actions for insert to authenticated with check (is_safeguarding_officer() and action in ('note', 'referral')
  and exists (select 1 from safeguarding_records r where r.id = record_id));
create policy sgg_read on safeguarding_access_grants for select to authenticated using (is_safeguarding_officer() or is_executive() or profile_id = auth.uid());
create policy sgl_read on safeguarding_access_log for select to authenticated using (is_safeguarding_officer() or is_executive());
-- officers, grants and logs change only through the functions below (no insert/update/delete policies).
create trigger aud_safeguarding_settings after update on safeguarding_settings for each row execute function audit_row();

-- ============ 4. functions: officers ============
create or replace function sg_appoint(p_position text, p_profile uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare r role_code; st account_status; prev uuid; pending int;
begin
  if not is_executive() then raise exception 'Only a super administrator, Founder or Co-Founder can appoint safeguarding officers'; end if;
  if p_position not in ('lead', 'deputy') then raise exception 'Choose Lead or Deputy'; end if;
  if p_profile = auth.uid() then raise exception 'You cannot appoint yourself. Another executive must make this appointment'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'Write a reason of at least 10 characters'; end if;
  select role, status into r, st from profiles where id = p_profile;
  if r is null or st <> 'active' or r not in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator') then
    raise exception 'Safeguarding officers must be active executives or programme staff';
  end if;
  if exists (select 1 from safeguarding_officers where profile_id = p_profile and position <> p_position) then
    raise exception 'The Lead and the Deputy must be different people';
  end if;
  select profile_id into prev from safeguarding_officers where position = p_position;
  if prev is not null then
    insert into safeguarding_officer_history(position, profile_id, event, actor_id, reason) values (p_position, prev, 'removed', auth.uid(), 'Replaced: ' || btrim(p_reason));
    delete from safeguarding_officers where position = p_position;
  end if;
  insert into safeguarding_officers(position, profile_id, appointed_by, reason) values (p_position, p_profile, auth.uid(), btrim(p_reason));
  insert into safeguarding_officer_history(position, profile_id, event, actor_id, reason) values (p_position, p_profile, 'appointed', auth.uid(), btrim(p_reason));
  perform sg_notify(p_profile, case p_position when 'lead' then 'You have been appointed Safeguarding Lead' else 'You have been appointed Safeguarding Deputy' end);
  select count(*) into pending from safeguarding_records where status = 'open';
  if pending > 0 then perform sg_notify(p_profile, 'Safeguarding concerns are waiting for acknowledgement'); end if;
end $$;

create or replace function sg_remove_officer(p_position text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare prev uuid;
begin
  if not is_executive() then raise exception 'Only a super administrator, Founder or Co-Founder can remove safeguarding officers'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'Write a reason of at least 10 characters'; end if;
  select profile_id into prev from safeguarding_officers where position = p_position;
  if prev is null then raise exception 'Nobody holds that position'; end if;
  delete from safeguarding_officers where position = p_position;
  insert into safeguarding_officer_history(position, profile_id, event, actor_id, reason) values (p_position, prev, 'removed', auth.uid(), btrim(p_reason));
end $$;

-- The Lead (or an executive on the Lead's behalf) marks the Lead unavailable; the Deputy then acts and is told.
create or replace function sg_set_unavailable(p_until timestamptz, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare lead uuid; dep uuid;
begin
  select profile_id into lead from safeguarding_officers where position = 'lead';
  if lead is null then raise exception 'No Safeguarding Lead is appointed'; end if;
  if not (auth.uid() = lead or is_executive()) then raise exception 'Only the Safeguarding Lead or an executive can change the Lead''s availability'; end if;
  if p_until is not null and p_until <= now() then raise exception 'Choose a future time, or clear it to mark the Lead available'; end if;
  update safeguarding_officers set unavailable_until = p_until, unavailable_note = nullif(btrim(coalesce(p_note, '')), '') where position = 'lead';
  insert into safeguarding_officer_history(position, profile_id, event, actor_id, reason)
  values ('lead', lead, case when p_until is null then 'available' else 'unavailable' end, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''));
  select profile_id into dep from safeguarding_officers where position = 'deputy';
  if p_until is not null then perform sg_notify(dep, 'You are acting Safeguarding Lead while the Lead is unavailable'); end if;
end $$;

create or replace function sg_officers()
returns table(officer_position text, profile_id uuid, display_name text, appointed_at timestamptz, unavailable_until timestamptz, acting boolean)
language sql stable security definer set search_path = public as $$
  select o.position, o.profile_id, btrim(p.first_name || ' ' || p.last_name), o.appointed_at, o.unavailable_until, o.profile_id = sg_acting_officer()
  from safeguarding_officers o join profiles p on p.id = o.profile_id
  where is_staff() or is_safeguarding_officer() order by o.position desc $$;

-- Executives see THAT escalations are waiting with nobody appointed, never what they are.
create or replace function sg_waiting_without_officer() returns int language sql stable security definer set search_path = public as $$
  select case when is_executive() and sg_acting_officer() is null then (select count(*)::int from safeguarding_records where status = 'open') else 0 end $$;

-- ============ 5. functions: concerns and records ============
-- Any staff member, facilitator or mentor can raise a concern. They cannot read it back afterwards.
create or replace function sg_raise_concern(p_participant uuid, p_summary text, p_urgency text default 'standard') returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(app_role()::text, '') not in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor', 'me_officer') then
    raise exception 'Only DIRA staff, facilitators and mentors can raise a safeguarding concern here. Learners can use Report or message the safeguarding team';
  end if;
  if p_summary is null or length(btrim(p_summary)) < 20 then raise exception 'Describe the concern factually in at least 20 characters'; end if;
  if p_urgency not in ('urgent', 'standard') then raise exception 'Choose urgent or standard'; end if;
  insert into safeguarding_records(participant_id, summary, urgency, source) values (p_participant, btrim(p_summary), p_urgency, 'raised_by_staff');
end $$;

-- Exceptional access for a non-officer: granted by an officer or by a DIFFERENT executive, at most 7 days, never to oneself.
create or replace function sg_grant_exceptional_access(p_profile uuid, p_days int, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_safeguarding_officer() or is_executive()) then raise exception 'Only a safeguarding officer or an executive can grant exceptional access'; end if;
  if p_profile = auth.uid() then raise exception 'You cannot grant access to yourself'; end if;
  if p_days not between 1 and 7 then raise exception 'Exceptional access lasts between 1 and 7 days'; end if;
  if p_reason is null or length(btrim(p_reason)) < 20 then raise exception 'Write a reason of at least 20 characters'; end if;
  if not exists (select 1 from profiles where id = p_profile and status = 'active' and role in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator')) then
    raise exception 'Exceptional access can only be given to active executives or programme staff';
  end if;
  insert into safeguarding_access_grants(profile_id, reason, granted_by, expires_at) values (p_profile, btrim(p_reason), auth.uid(), now() + make_interval(days => p_days));
  perform sg_notify(sg_acting_officer(), 'Exceptional access to safeguarding records was granted');
end $$;

create or replace function sg_revoke_exceptional_access(p_grant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_safeguarding_officer() or is_executive()) then raise exception 'Only a safeguarding officer or an executive can revoke access'; end if;
  update safeguarding_access_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant and revoked_at is null;
end $$;

-- An exceptional reader sees one record and its history, with a written reason, logged, and the acting officer is told.
create or replace function sg_exceptional_read(p_record uuid, p_reason text)
returns table(id uuid, created_at timestamptz, urgency text, status text, summary text, reported_message text, resolution text, history jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from safeguarding_access_grants g where g.profile_id = auth.uid() and g.revoked_at is null and g.expires_at > now()) then
    raise exception 'You do not have exceptional access to safeguarding records';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A written reason of at least 10 characters is required'; end if;
  if not exists (select 1 from safeguarding_records r where r.id = p_record) then raise exception 'Record not found'; end if;
  insert into safeguarding_access_log(profile_id, record_id, basis, reason) values (auth.uid(), p_record, 'exceptional_grant', btrim(p_reason));
  insert into safeguarding_actions(record_id, action, note, actor_id) values (p_record, 'exceptional_read', btrim(p_reason), auth.uid());
  perform sg_notify(sg_acting_officer(), 'A safeguarding record was opened under exceptional access');
  return query select r.id, r.created_at, r.urgency, r.status, r.summary, r.reported_message, r.resolution,
    coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'note', a.note) order by a.created_at) from safeguarding_actions a where a.record_id = r.id), '[]'::jsonb)
    from safeguarding_records r where r.id = p_record;
end $$;
-- Record ids an exceptional reader may choose from (dates and urgency only).
create or replace function sg_exceptional_index() returns table(id uuid, created_at timestamptz, urgency text, status text) language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, r.urgency, r.status from safeguarding_records r
  where exists (select 1 from safeguarding_access_grants g where g.profile_id = auth.uid() and g.revoked_at is null and g.expires_at > now())
  order by r.created_at desc limit 200 $$;

-- Reminder job (send-emails schedule): unacknowledged concerns past their target alert BOTH officers, once.
create or replace function sg_overdue_check() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from safeguarding_records where status = 'open' and acknowledged_at is null and ack_due_at < now() and overdue_alerted_at is null loop
    perform sg_notify(o, 'A safeguarding concern has passed its acknowledgement target') from sg_officer_ids() o;
    update safeguarding_records set overdue_alerted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ============ 6. DIRA Connect: escalation and oversight ============
-- Escalation creates a confidential record; the moderator chooses the urgency. Other actions are unchanged.
drop function if exists connect_handle_report(uuid, text, text);
create or replace function connect_handle_report(p_report uuid, p_action text, p_note text default null, p_urgency text default 'standard') returns void
language plpgsql security definer set search_path = public as $$
declare r connect_reports; c connect_conversations; learner uuid;
begin
  if not connect_is_moderator() then raise exception 'Only moderators can handle reports'; end if;
  if p_action not in ('dismiss', 'hide', 'escalate') then raise exception 'Unknown action'; end if;
  select * into r from connect_reports where id = p_report;
  if not found then raise exception 'Report not found'; end if;
  if p_action = 'hide' then
    insert into connect_hidden_originals(message_id, body, hidden_by) select m.id, m.body, auth.uid() from connect_messages m where m.id = r.message_id and m.hidden_at is null on conflict do nothing;
    update connect_messages set body = 'This message was removed by a moderator.', hidden_at = now(), hidden_by = auth.uid(), hide_reason = nullif(btrim(coalesce(p_note, '')), '') where id = r.message_id and hidden_at is null;
  end if;
  if p_action = 'escalate' then
    if r.status = 'escalated' then raise exception 'This report is already with safeguarding'; end if;
    if p_urgency not in ('urgent', 'standard') then raise exception 'Choose urgent or standard'; end if;
    perform sg_escalate_report(r.id, p_urgency, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Escalated from a DIRA Connect report'), 'connect_report');
    return;
  end if;
  if r.status = 'escalated' then
    if p_action = 'dismiss' then raise exception 'An escalated report is handled by safeguarding and cannot be dismissed'; end if;
    return;  -- hiding an escalated message keeps the report with safeguarding
  end if;
  update connect_reports set status = case p_action when 'dismiss' then 'dismissed' else 'hidden' end,
         handled_by = auth.uid(), handled_at = now(), handler_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_report;
end $$;

-- Shared by moderator escalation and automatic safety-concern routing. Not callable from the app.
create or replace function sg_escalate_report(p_report uuid, p_urgency text, p_summary text, p_source text) returns uuid language plpgsql security definer set search_path = public as $$
declare r connect_reports; c connect_conversations; learner uuid; rid uuid;
begin
  select * into r from connect_reports where id = p_report;
  select * into c from connect_conversations where id = r.conversation_id;
  learner := coalesce(c.learner_id, (select p.id from participants p where p.profile_id = r.snapshot_sender));
  insert into safeguarding_records(participant_id, summary, urgency, source, source_report_id, conversation_id, reported_message, reported_sender)
  values (learner, left(p_summary, 2000), p_urgency, p_source, r.id, r.conversation_id, r.snapshot_body, r.snapshot_sender) returning id into rid;
  update connect_reports set status = 'escalated', handled_by = auth.uid(), handled_at = now(), handler_note = left(p_summary, 500) where id = p_report;
  return rid;
end $$;
revoke all on function sg_escalate_report(uuid, text, text, text) from public, anon, authenticated;

-- A "safety concern" report goes straight to safeguarding (moderators still see that it was escalated).
create or replace function route_safety_report() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reason = 'safety_concern' then
    perform sg_escalate_report(new.id, 'standard', 'A learner or facilitator reported a message as a safety concern' ||
      coalesce(': ' || new.note, ''), 'connect_safety_report');
  end if;
  return new;
end $$;
create trigger trg_route_safety_report after insert on connect_reports for each row execute function route_safety_report();

-- No self-granting of any oversight permission: a DIFFERENT executive must grant it.
create or replace function guard_connect_oversight() returns trigger language plpgsql security definer set search_path = public as $$
declare r role_code;
begin
  select role into r from profiles where id = new.profile_id;
  if r is null or r not in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator') then
    raise exception 'Oversight can only be granted to executives and programme staff';
  end if;
  if not is_trusted_session() and new.profile_id = auth.uid() then
    raise exception 'You cannot grant oversight to yourself. Another executive must approve it';
  end if;
  new.granted_by := coalesce(auth.uid(), new.granted_by);
  new.granted_at := now();
  return new;
end $$;

alter table connect_oversight_log
  add column basis text not null default 'reported_conversation' check (basis in ('reported_conversation', 'escalated_conversation', 'safeguarding_concern')),
  add column safeguarding_record_id uuid references safeguarding_records(id);

-- The ONLY way anyone outside a private conversation reads it.
--   * holders of the 'private' grant, and safeguarding officers: only conversations that were REPORTED or ESCALATED;
--   * the ACTING Safeguarding Lead: any private conversation, but only by naming a safeguarding record and giving a reason.
-- Every read is logged (and, for a record, added to its history). Hidden messages are shown with their original text.
drop function if exists connect_oversight_read(uuid, text);
create or replace function connect_oversight_read(p_conversation uuid, p_reason text, p_safeguarding_record uuid default null)
returns table(id uuid, sender_name text, body text, created_at timestamptz, hidden boolean)
language plpgsql security definer set search_path = public as $$
declare has_grant boolean; officer boolean; reported boolean; escalated boolean; b text;
begin
  has_grant := exists (select 1 from connect_oversight o where o.profile_id = auth.uid() and o.scope = 'private');
  officer := is_safeguarding_officer();
  if not (has_grant or officer) then raise exception 'You have not been granted private conversation oversight'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A written reason of at least 10 characters is required'; end if;
  if not exists (select 1 from connect_conversations c where c.id = p_conversation and c.kind = 'direct') then raise exception 'Not a private conversation'; end if;
  escalated := exists (select 1 from connect_reports r where r.conversation_id = p_conversation and r.status = 'escalated')
            or exists (select 1 from safeguarding_records s where s.conversation_id = p_conversation);
  reported := exists (select 1 from connect_reports r where r.conversation_id = p_conversation);
  if p_safeguarding_record is not null then
    if not sg_is_acting_lead() then raise exception 'Only the acting Safeguarding Lead can open a conversation for a safeguarding record'; end if;
    if not exists (select 1 from safeguarding_records s where s.id = p_safeguarding_record and s.status not in ('resolved', 'closed')) then
      raise exception 'Name an open safeguarding record';
    end if;
    b := 'safeguarding_concern';
  elsif escalated then b := 'escalated_conversation';
  elsif reported then b := 'reported_conversation';
  else raise exception 'This conversation has not been reported or escalated. The acting Safeguarding Lead can open it only for a documented safeguarding record';
  end if;
  insert into connect_oversight_log(profile_id, conversation_id, reason, basis, safeguarding_record_id) values (auth.uid(), p_conversation, btrim(p_reason), b, p_safeguarding_record);
  if officer then
    insert into safeguarding_access_log(profile_id, record_id, conversation_id, basis, reason) values (auth.uid(), p_safeguarding_record, p_conversation, b, btrim(p_reason));
  end if;
  if p_safeguarding_record is not null then
    insert into safeguarding_actions(record_id, action, note, actor_id) values (p_safeguarding_record, 'conversation_read', btrim(p_reason), auth.uid());
  end if;
  return query select m.id, btrim(pr.first_name || ' ' || pr.last_name), coalesce(h.body, m.body), m.created_at, (m.hidden_at is not null)
    from connect_messages m join profiles pr on pr.id = m.sender_id left join connect_hidden_originals h on h.message_id = m.id
    where m.conversation_id = p_conversation order by m.created_at desc limit 200;
end $$;

-- ============ 7. grants ============
revoke all on function sg_my_position(), is_safeguarding_officer(), sg_acting_officer(), sg_is_acting_lead(), sg_officer_ids(),
  sg_appoint(text, uuid, text), sg_remove_officer(text, text), sg_set_unavailable(timestamptz, text), sg_officers(), sg_waiting_without_officer(),
  sg_raise_concern(uuid, text, text), sg_grant_exceptional_access(uuid, int, text), sg_revoke_exceptional_access(uuid),
  sg_exceptional_read(uuid, text), sg_exceptional_index(), sg_overdue_check(),
  connect_handle_report(uuid, text, text, text), connect_oversight_read(uuid, text, uuid) from public, anon;
grant execute on function sg_my_position(), is_safeguarding_officer(), sg_is_acting_lead(),
  sg_appoint(text, uuid, text), sg_remove_officer(text, text), sg_set_unavailable(timestamptz, text), sg_officers(), sg_waiting_without_officer(),
  sg_raise_concern(uuid, text, text), sg_grant_exceptional_access(uuid, int, text), sg_revoke_exceptional_access(uuid),
  sg_exceptional_read(uuid, text), sg_exceptional_index(),
  connect_handle_report(uuid, text, text, text), connect_oversight_read(uuid, text, uuid) to authenticated;
revoke execute on function sg_overdue_check(), sg_acting_officer(), sg_officer_ids() from authenticated;
grant execute on function sg_overdue_check() to service_role;
