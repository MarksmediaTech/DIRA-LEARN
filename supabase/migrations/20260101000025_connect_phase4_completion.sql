-- DIRA LEARN: Phase 4 completion, part 2 – DIRA Connect messaging changes (management decisions of 19 Nov 2026).
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000025_connect_phase4_completion_down.sql
--
-- WHAT IT DOES
--   * Facilitators (trainers formally assigned to the learner's cohort) may START private conversations with those learners.
--   * Closed learning access (scheduled, expired, suspended, withdrawn) no longer cuts a learner off from SUPPORT: they keep
--     their private conversations with their assigned facilitators and can message the safeguarding team. Cohort discussions
--     and learning materials stay closed. Cohort discussions now follow the access of THAT cohort.
--   * Safeguarding-team conversations: a learner can message the designated safeguarding officers privately. Only the learner
--     and the current Lead and Deputy can read them; no oversight grant, moderator or executive can. They are never purged.
--   * Attachments: PDF, Word, Excel, PowerPoint, JPG and PNG, up to 10 MB, at most 3 per message, in a private bucket.
--     Access follows the conversation. Files are NOT virus-scanned (Supabase has no built-in scanner): the screen says so,
--     and a file marked "infected" by a future scanner is blocked. Links in messages are shown safely by the screens.
--   * Retention: ordinary messages are deleted 12 months after the learner's (or the cohort's) last cohort end date, but only
--     when an executive switches retention ON (it is OFF after this migration). Never deleted: safeguarding-team
--     conversations, conversations with any report, conversations linked to a safeguarding record (or of a learner with one),
--     and anything under a legal hold.

-- ============ 1. conversation kinds ============
alter table connect_conversations drop constraint connect_conv_shape;
alter table connect_conversations drop constraint if exists connect_conversations_kind_check;
alter table connect_conversations add constraint connect_conversations_kind_check check (kind in ('direct', 'cohort', 'safeguarding'));
alter table connect_conversations add constraint connect_conv_shape check (
  (kind = 'cohort' and cohort_id is not null and learner_id is null and facilitator_id is null) or
  (kind = 'direct' and learner_id is not null and facilitator_id is not null and cohort_id is null) or
  (kind = 'safeguarding' and learner_id is not null and facilitator_id is null and cohort_id is null));
alter table connect_conversations add column started_by uuid references profiles(id);
create unique index uq_connect_safeguarding on connect_conversations (learner_id) where kind = 'safeguarding';

-- ============ 2. access rules ============
create or replace function connect_is_member(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case c.kind
      when 'direct' then
        (c.learner_id = my_participant_id() and app_role() = 'participant')
        or (c.facilitator_id = auth.uid() and app_role() = 'trainer' and connect_facilitator_assigned(c.learner_id, c.facilitator_id))
      when 'safeguarding' then
        (c.learner_id = my_participant_id() and app_role() = 'participant') or is_safeguarding_officer()
      else
        (app_role() = 'trainer' and c.cohort_id in (select my_trainer_cohorts()))
        or (app_role() = 'participant' and exists (select 1 from cohort_enrolments e where e.cohort_id = c.cohort_id and e.participant_id = my_participant_id()))
    end
    from connect_conversations c where c.id = p_conv), false) $$;

-- Learners read a cohort discussion only while THEIR access to that cohort is Active; private and safeguarding conversations stay open.
create or replace function connect_can_see(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when connect_is_member(p_conv) then
        c.kind <> 'cohort' or app_role() <> 'participant' or learner_access_state(my_participant_id(), c.cohort_id) = 'active'
      else c.kind = 'cohort' and connect_is_discussion_overseer()
    end
    from connect_conversations c where c.id = p_conv), false) $$;

create or replace function connect_can_post(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not c.locked and connect_is_member(p_conv) and case c.kind
      when 'cohort' then app_role() in ('participant', 'trainer')
        and (app_role() <> 'participant' or learner_access_state(my_participant_id(), c.cohort_id) = 'active')
        and not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now())
      when 'direct' then app_role() in ('participant', 'trainer')
      else true end
    from connect_conversations c where c.id = p_conv), false) $$;

-- ============ 3. starting conversations ============
create or replace function connect_my_facilitators() returns table(profile_id uuid, display_name text) language sql stable security definer set search_path = public as $$
  select distinct p.id, btrim(p.first_name || ' ' || p.last_name)
  from cohort_enrolments e join trainer_assignments ta on ta.cohort_id = e.cohort_id join profiles p on p.id = ta.trainer_id
  where app_role() = 'participant' and e.participant_id = my_participant_id() and p.role = 'trainer' and p.status = 'active' $$;

create or replace function connect_start_direct(p_facilitator uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := my_participant_id(); cid uuid;
begin
  if app_role() is distinct from 'participant' or me is null then raise exception 'Only learners can start a private conversation with a facilitator'; end if;
  if not exists (select 1 from profiles where id = p_facilitator and role = 'trainer' and status = 'active') or not connect_facilitator_assigned(me, p_facilitator) then
    raise exception 'You can only message a facilitator assigned to your cohort';
  end if;
  insert into connect_conversations(kind, learner_id, facilitator_id, started_by) values ('direct', me, p_facilitator, auth.uid())
  on conflict (learner_id, facilitator_id) where kind = 'direct' do nothing;
  select id into cid from connect_conversations where kind = 'direct' and learner_id = me and facilitator_id = p_facilitator;
  return cid;
end $$;

-- Learners a facilitator may message: those enrolled in a cohort the facilitator is assigned to.
create or replace function connect_my_learners() returns table(participant_id uuid, display_name text, cohort_names text) language sql stable security definer set search_path = public as $$
  select pa.id, btrim(p.first_name || ' ' || p.last_name), string_agg(distinct co.name, ', ')
  from trainer_assignments ta join cohort_enrolments e on e.cohort_id = ta.cohort_id join cohorts co on co.id = e.cohort_id
  join participants pa on pa.id = e.participant_id join profiles p on p.id = pa.profile_id
  where app_role() = 'trainer' and ta.trainer_id = auth.uid() and p.status = 'active'
  group by pa.id, p.first_name, p.last_name order by 2 $$;

create or replace function connect_start_direct_with_learner(p_learner uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if app_role() is distinct from 'trainer' then raise exception 'Only facilitators can start a conversation with a learner'; end if;
  if not exists (select 1 from participants pa join profiles p on p.id = pa.profile_id where pa.id = p_learner and p.status = 'active')
     or not connect_facilitator_assigned(p_learner, auth.uid()) then
    raise exception 'You can only message learners in a cohort you are assigned to';
  end if;
  insert into connect_conversations(kind, learner_id, facilitator_id, started_by) values ('direct', p_learner, auth.uid(), auth.uid())
  on conflict (learner_id, facilitator_id) where kind = 'direct' do nothing;
  select id into cid from connect_conversations where kind = 'direct' and learner_id = p_learner and facilitator_id = auth.uid();
  return cid;
end $$;

-- What support a learner can reach (shown on the Connect page).
create or replace function connect_my_support() returns table(safeguarding_available boolean, learning_access_open boolean) language sql stable security definer set search_path = public as $$
  select sg_acting_officer() is not null, participant_access_active() where app_role() = 'participant' $$;

create or replace function connect_start_safeguarding() returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := my_participant_id(); cid uuid;
begin
  if app_role() is distinct from 'participant' or me is null then raise exception 'Only learners can start a conversation with the safeguarding team'; end if;
  if sg_acting_officer() is null then
    raise exception 'The safeguarding team has not been set up yet. Please speak to your facilitator or contact DIRA Foundation directly';
  end if;
  insert into connect_conversations(kind, learner_id, started_by) values ('safeguarding', me, auth.uid())
  on conflict (learner_id) where kind = 'safeguarding' do nothing;
  select id into cid from connect_conversations where kind = 'safeguarding' and learner_id = me;
  return cid;
end $$;

-- ============ 4. thread list and messages ============
create or replace function connect_threads()
returns table(conversation_id uuid, kind text, title text, subtitle text, last_message_at timestamptz, unread bigint, locked boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind,
         case c.kind
           when 'cohort' then (select name from cohorts where id = c.cohort_id)
           when 'safeguarding' then case when c.learner_id = my_participant_id() then 'Safeguarding team'
                                     else (select btrim(first_name || ' ' || last_name) from profiles where id = (select profile_id from participants where id = c.learner_id)) end
           else case when c.facilitator_id = auth.uid() then (select btrim(first_name || ' ' || last_name) from profiles where id = (select profile_id from participants where id = c.learner_id))
                     else (select btrim(first_name || ' ' || last_name) from profiles where id = c.facilitator_id) end end,
         case c.kind when 'cohort' then 'Cohort discussion' when 'safeguarding' then 'Safeguarding (confidential)' else 'Private conversation' end,
         c.last_message_at,
         (select count(*) from connect_messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.hidden_at is null
            and m.created_at > coalesce((select r.last_read_at from connect_reads r where r.conversation_id = c.id and r.profile_id = auth.uid()), '-infinity'::timestamptz)),
         c.locked
  from connect_conversations c where connect_can_see(c.id)
  order by c.last_message_at desc nulls last, c.created_at desc $$;

drop function if exists connect_thread_messages(uuid, timestamptz, int);
create or replace function connect_thread_messages(p_conversation uuid, p_before timestamptz default null, p_limit int default 50)
returns table(id uuid, sender_id uuid, sender_name text, sender_role text, body text, created_at timestamptz, hidden boolean, mine boolean, attachments jsonb)
language plpgsql stable security definer set search_path = public as $$
declare learner_profile uuid; k text;
begin
  if not connect_can_see(p_conversation) then return; end if;
  select c.kind, pa.profile_id into k, learner_profile from connect_conversations c left join participants pa on pa.id = c.learner_id where c.id = p_conversation;
  return query
    select m.id, m.sender_id,
           case when pr.role = 'trainer' or (k = 'safeguarding' and m.sender_id is distinct from learner_profile) then btrim(pr.first_name || ' ' || pr.last_name)
                else btrim(pr.first_name || ' ' || left(coalesce(pr.last_name, ''), 1) || '.') end,
           case when k = 'safeguarding' and m.sender_id is distinct from learner_profile then 'Safeguarding team'
                when pr.role = 'trainer' then 'Facilitator' else 'Learner' end,
           m.body, m.created_at, (m.hidden_at is not null), (m.sender_id = auth.uid()),
           case when m.hidden_at is not null then '[]'::jsonb else coalesce((
             select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'path', a.storage_path, 'mime', a.mime_type, 'size', a.size_bytes, 'scan', a.scan_status) order by a.created_at)
             from connect_attachments a where a.message_id = m.id and a.scan_status <> 'infected'), '[]'::jsonb) end
    from connect_messages m join profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
    order by m.created_at desc, m.id desc limit least(greatest(p_limit, 1), 100);
end $$;

-- Notifications: one per burst; safeguarding messages from a learner alert the acting officer (no details anywhere).
create or replace function after_connect_message() returns trigger language plpgsql security definer set search_path = public as $$
declare c connect_conversations; recipient uuid; learner_profile uuid; last_seen timestamptz;
begin
  update connect_conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into c from connect_conversations where id = new.conversation_id;
  if c.kind = 'cohort' then return new; end if;
  select profile_id into learner_profile from participants where id = c.learner_id;
  if c.kind = 'direct' then
    recipient := case when new.sender_id = c.facilitator_id then learner_profile else c.facilitator_id end;
  else
    recipient := case when new.sender_id = learner_profile then sg_acting_officer() else learner_profile end;
  end if;
  if recipient is null then return new; end if;
  select last_read_at into last_seen from connect_reads where conversation_id = c.id and profile_id = recipient;
  if exists (select 1 from connect_messages m where m.conversation_id = c.id and m.sender_id = new.sender_id and m.id <> new.id
             and m.created_at > coalesce(last_seen, '-infinity'::timestamptz)) then
    return new;
  end if;
  if c.kind = 'safeguarding' and new.sender_id = learner_profile then
    perform sg_notify(recipient, 'A learner has sent a message to the safeguarding team');
  elsif c.kind = 'safeguarding' then
    insert into notifications(user_id, kind, title, body) values (recipient, 'message', 'New message from the safeguarding team', 'Open DIRA Connect to read it.');
  else
    insert into notifications(user_id, kind, title, body) values (recipient, 'message', 'New private message', 'You have a new message in DIRA Connect.');
  end if;
  return new;
end $$;

-- Safeguarding-team conversations are not reported to moderators (that would show them to people outside the team).
create or replace function connect_report_message(p_message uuid, p_reason text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare m connect_messages; files text;
begin
  select * into m from connect_messages where id = p_message;
  if not found or not connect_is_member(m.conversation_id) or not connect_can_see(m.conversation_id) then raise exception 'You can only report messages in your own conversations'; end if;
  if (select kind from connect_conversations where id = m.conversation_id) = 'safeguarding' then
    raise exception 'Safeguarding conversations cannot be reported to moderators. Please contact DIRA Foundation directly about any concern';
  end if;
  if m.sender_id = auth.uid() then raise exception 'You cannot report your own message'; end if;
  select string_agg(a.file_name, ', ') into files from connect_attachments a where a.message_id = m.id;
  insert into connect_reports(message_id, conversation_id, reporter_id, reason, note, snapshot_body, snapshot_sender)
  values (m.id, m.conversation_id, auth.uid(), p_reason, nullif(btrim(coalesce(p_note, '')), ''), m.body || coalesce(E'\n[Attachments: ' || files || ']', ''), m.sender_id)
  on conflict (message_id, reporter_id) do nothing;
end $$;

-- ============ 5. attachments ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('connect-attachments', 'connect-attachments', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create table connect_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references connect_messages(id) on delete cascade,
  conversation_id uuid not null references connect_conversations(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  scan_status text not null default 'not_scanned' check (scan_status in ('not_scanned', 'pending', 'clean', 'infected')),
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_connect_attach_msg on connect_attachments (message_id);

create or replace function connect_allowed_mime(p text) returns boolean language sql immutable as $$
  select p in ('application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') $$;

-- Path rule: <conversation id>/<uploader id>/<file>. The uploader must be allowed to post there.
create or replace function connect_attachment_upload_ok(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/'); conv uuid;
begin
  if array_length(parts, 1) <> 3 or parts[2] is distinct from auth.uid()::text then return false; end if;
  begin conv := parts[1]::uuid; exception when others then return false; end;
  return connect_can_post(conv);
end $$;
-- Download rule: the file belongs to a visible, not hidden, not infected message, or the reader opened this conversation
-- through logged oversight in the last hour.
create or replace function connect_attachment_read_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from connect_attachments a join connect_messages m on m.id = a.message_id
                 where a.storage_path = p_name and a.scan_status <> 'infected'
                   and ((m.hidden_at is null and connect_can_see(a.conversation_id))
                        or exists (select 1 from connect_oversight_log l where l.profile_id = auth.uid() and l.conversation_id = a.conversation_id
                                   and l.created_at > now() - interval '1 hour'))) $$;
revoke all on function connect_attachment_upload_ok(text), connect_attachment_read_ok(text) from public, anon;
grant execute on function connect_attachment_upload_ok(text), connect_attachment_read_ok(text) to authenticated;

create policy connect_attach_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'connect-attachments' and connect_attachment_upload_ok(name));
create policy connect_attach_read on storage.objects for select to authenticated
  using (bucket_id = 'connect-attachments' and connect_attachment_read_ok(name));

-- The attachment row is checked against the stored file: size and type are taken from what Storage recorded for the upload,
-- not from the attachment row. Storage records the type the uploader declared (it does not inspect contents), so this stops
-- mismatches and wrong declarations; only a virus scanner can detect a disguised file (see docs/DIRA_CONNECT.md).
create or replace function guard_connect_attachment() returns trigger language plpgsql security definer set search_path = public as $$
declare m connect_messages; obj storage.objects; real_size bigint; real_mime text;
begin
  if is_trusted_session() then return new; end if;
  select * into m from connect_messages where id = new.message_id;
  if not found or m.sender_id <> auth.uid() or m.conversation_id <> new.conversation_id or m.hidden_at is not null or m.created_at < now() - interval '15 minutes' then
    raise exception 'Attach files only to a message you have just sent';
  end if;
  if new.storage_path not like new.conversation_id::text || '/' || auth.uid()::text || '/%' then raise exception 'The file is not in this conversation''s folder'; end if;
  select * into obj from storage.objects where bucket_id = 'connect-attachments' and name = new.storage_path;
  if not found then raise exception 'Upload the file before attaching it'; end if;
  real_size := coalesce((obj.metadata ->> 'size')::bigint, new.size_bytes);
  real_mime := coalesce(obj.metadata ->> 'mimetype', new.mime_type);
  if not connect_allowed_mime(real_mime) then raise exception 'Only PDF, Word, Excel, PowerPoint, JPG and PNG files can be attached'; end if;
  if real_size > 10485760 then raise exception 'Files can be at most 10 MB'; end if;
  if (select count(*) from connect_attachments where message_id = new.message_id) >= 3 then raise exception 'At most 3 files per message'; end if;
  new.size_bytes := real_size; new.mime_type := real_mime;
  new.file_name := left(regexp_replace(btrim(new.file_name), '[\\/\x00-\x1f<>:"|?*]', '_', 'g'), 200);
  new.uploaded_by := auth.uid(); new.scan_status := 'not_scanned'; new.created_at := now();
  return new;
end $$;
create trigger trg_guard_connect_attachment before insert on connect_attachments for each row execute function guard_connect_attachment();

alter table connect_attachments enable row level security;
create policy cat_read on connect_attachments for select to authenticated using (connect_attachment_read_ok(storage_path));
create policy cat_insert on connect_attachments for insert to authenticated with check (uploaded_by = auth.uid() and connect_can_post(conversation_id));

-- ============ 6. retention and legal holds ============
create table connect_retention_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  months int not null default 12 check (months between 1 and 120),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
insert into connect_retention_settings(id) values (true);

create table connect_legal_holds (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references connect_conversations(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  cohort_id uuid references cohorts(id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 10),
  placed_by uuid references profiles(id),
  placed_at timestamptz not null default now(),
  released_by uuid references profiles(id),
  released_at timestamptz,
  release_reason text,
  constraint connect_hold_one_target check (num_nonnulls(conversation_id, participant_id, cohort_id) = 1)
);

create table connect_retention_log (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  conversations int not null, messages int not null, files int not null
);

alter table connect_retention_settings enable row level security;
alter table connect_legal_holds enable row level security;
alter table connect_retention_log enable row level security;
create policy crs_read on connect_retention_settings for select to authenticated using (is_executive() or is_safeguarding_officer());
create policy crs_update on connect_retention_settings for update to authenticated using (is_executive()) with check (is_executive());
create policy clh_read on connect_legal_holds for select to authenticated using (is_executive() or is_safeguarding_officer());
create policy crl_read on connect_retention_log for select to authenticated using (is_executive());
create trigger aud_connect_retention_settings after update on connect_retention_settings for each row execute function audit_row();
create trigger aud_connect_legal_holds after insert or update on connect_legal_holds for each row execute function audit_row();

create or replace function guard_connect_retention_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now(); return new; end $$;
create trigger trg_guard_connect_retention before update on connect_retention_settings for each row execute function guard_connect_retention_settings();

create or replace function connect_place_hold(p_conversation uuid, p_participant uuid, p_cohort uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if not (is_executive() or is_safeguarding_officer()) then raise exception 'Only executives and safeguarding officers can place a legal hold'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'Write a reason of at least 10 characters'; end if;
  insert into connect_legal_holds(conversation_id, participant_id, cohort_id, reason, placed_by) values (p_conversation, p_participant, p_cohort, btrim(p_reason), auth.uid()) returning id into hid;
  return hid;
end $$;
create or replace function connect_release_hold(p_hold uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_executive() or is_safeguarding_officer()) then raise exception 'Only executives and safeguarding officers can release a legal hold'; end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'Write a reason of at least 10 characters'; end if;
  update connect_legal_holds set released_at = now(), released_by = auth.uid(), release_reason = btrim(p_reason) where id = p_hold and released_at is null;
  if not found then raise exception 'That hold is not active'; end if;
end $$;

-- One row per conversation: when it ends, when it may be purged, and whether something protects it.
create or replace function connect_retention_candidates()
returns table(conversation_id uuid, kind text, ends_on date, purge_after date, held boolean, hold_reason text)
language sql stable security definer set search_path = public as $$
  with s as (select months from connect_retention_settings limit 1),
  base as (
    select c.id, c.kind, c.learner_id, c.cohort_id,
           case when c.kind = 'cohort' then (select co.end_date from cohorts co where co.id = c.cohort_id)
                else (select max(co.end_date) from cohort_enrolments e join cohorts co on co.id = e.cohort_id where e.participant_id = c.learner_id) end as ends_on
    from connect_conversations c)
  select b.id, b.kind, b.ends_on, (b.ends_on + make_interval(months => (select months from s)))::date,
         h.reason is not null, h.reason
  from base b
  left join lateral (select case
      when b.kind = 'safeguarding' then 'Safeguarding conversation (separate retention policy)'
      when exists (select 1 from connect_reports r where r.conversation_id = b.id) then 'Contains a reported message'
      when exists (select 1 from safeguarding_records sr where sr.conversation_id = b.id or (b.learner_id is not null and sr.participant_id = b.learner_id)) then 'Linked to a safeguarding record'
      when exists (select 1 from connect_legal_holds lh where lh.released_at is null and (lh.conversation_id = b.id
                     or (b.learner_id is not null and lh.participant_id = b.learner_id)
                     or lh.cohort_id = b.cohort_id
                     or (b.learner_id is not null and lh.cohort_id in (select e.cohort_id from cohort_enrolments e where e.participant_id = b.learner_id)))) then 'Legal hold'
    end as reason) h on true $$;
revoke all on function connect_retention_candidates() from public, anon, authenticated;

-- Preview for executives and officers (no message content).
create or replace function connect_retention_status()
returns table(conversation_id uuid, kind text, messages bigint, ends_on date, purge_after date, due boolean, held boolean, hold_reason text)
language sql stable security definer set search_path = public as $$
  select r.conversation_id, r.kind, (select count(*) from connect_messages m where m.conversation_id = r.conversation_id),
         r.ends_on, r.purge_after, coalesce(r.purge_after <= current_date, false), r.held, r.hold_reason
  from connect_retention_candidates() r
  where (is_executive() or is_safeguarding_officer()) and exists (select 1 from connect_messages m where m.conversation_id = r.conversation_id)
  order by r.purge_after nulls last $$;

-- Run by the send-emails schedule (service role). Returns the stored files to remove from Storage.
create or replace function connect_retention_purge() returns table(storage_path text) language plpgsql security definer set search_path = public as $$
declare en boolean; cv record; nconv int := 0; nmsg int := 0; nfile int := 0; paths text[] := '{}'; k int;
begin
  select enabled into en from connect_retention_settings limit 1;
  if not coalesce(en, false) then return; end if;
  perform set_config('dira.connect_purge', 'on', true);
  for cv in select r.conversation_id from connect_retention_candidates() r where r.purge_after <= current_date and not r.held loop
    paths := paths || coalesce(array(select a.storage_path from connect_attachments a where a.conversation_id = cv.conversation_id), '{}');
    delete from connect_attachments a where a.conversation_id = cv.conversation_id; get diagnostics k = row_count; nfile := nfile + k;
    delete from connect_reads r where r.conversation_id = cv.conversation_id;
    delete from connect_messages m where m.conversation_id = cv.conversation_id; get diagnostics k = row_count;
    if k > 0 then nconv := nconv + 1; nmsg := nmsg + k; end if;
  end loop;
  perform set_config('dira.connect_purge', 'off', true);
  if nconv > 0 then insert into connect_retention_log(conversations, messages, files) values (nconv, nmsg, nfile); end if;
  return query select unnest(paths);
end $$;

-- Users still can never delete messages; only the retention job can, inside a trusted server session.
create or replace function block_connect_message_delete() returns trigger language plpgsql as $$
begin
  if current_setting('dira.connect_purge', true) = 'on' and is_trusted_session() then return old; end if;
  raise exception 'Messages cannot be deleted';
end $$;

-- ============ 7. grants ============
revoke all on function connect_my_learners(), connect_start_direct_with_learner(uuid), connect_my_support(), connect_start_safeguarding(),
  connect_thread_messages(uuid, timestamptz, int), connect_place_hold(uuid, uuid, uuid, text), connect_release_hold(uuid, text),
  connect_retention_status(), connect_retention_purge() from public, anon;
grant execute on function connect_my_learners(), connect_start_direct_with_learner(uuid), connect_my_support(), connect_start_safeguarding(),
  connect_thread_messages(uuid, timestamptz, int), connect_place_hold(uuid, uuid, uuid, text), connect_release_hold(uuid, text),
  connect_retention_status() to authenticated;
revoke execute on function connect_retention_purge() from authenticated;

-- Realtime: new attachments appear live too (Realtime applies the cat_read policy).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table connect_attachments;
  end if;
end $$;
grant execute on function connect_retention_purge() to service_role;
