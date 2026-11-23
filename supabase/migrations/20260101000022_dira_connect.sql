-- DIRA LEARN: DIRA Connect, private messaging and cohort discussions (master instruction, Phase 4).
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- WHAT IT ADDS
--   * connect_conversations: one DISCUSSION per cohort (created automatically) and PRIVATE conversations, each between one learner
--     and one facilitator (a trainer assigned to that learner's cohort).
--   * connect_messages (plain text, 1 to 2000 characters, no attachments), connect_reads (unread counts), connect_reports,
--     connect_mutes, connect_oversight (explicit grants), connect_oversight_log, connect_hidden_originals.
--   * Row level security on every table, plus access functions so the rules live in the database, not the screen.
--   * Realtime: connect_messages is added to the supabase_realtime publication (Realtime still applies the same read policy).
--
-- WHO CAN SEE WHAT
--   Private conversation: ONLY the learner and that facilitator (and only while the facilitator is still assigned to the learner's
--     cohort and the learner's learning access is Active). No administrator, executive or other staff member can read it by default.
--   Cohort discussion: learners enrolled in that cohort (access Active) and trainers assigned to it. Executives and people granted
--     'discussions' oversight can READ it (not post). Nobody can see another cohort's discussion.
--   Private oversight: only a person explicitly granted 'private' oversight, only through connect_oversight_read() which demands a
--     written reason and writes a log entry that executives can review. NO ONE has this grant when the migration runs.
-- SAFEGUARDING: a member can report any message. The report keeps a snapshot of THAT message only, so a moderator never gets the rest of a
--   private conversation. Moderators (executives and people granted 'reports') can dismiss, hide the message, or escalate. They can also
--   lock a cohort discussion and mute a learner from discussions. The safeguarding PROCESS (who handles an escalation, timelines,
--   under-18 rules) is a management decision and is NOT invented here. See docs/DIRA_CONNECT.md.
-- STARTING A PRIVATE CONVERSATION: learners start them; facilitators respond. (Management decision: may facilitators start them?)

-- ============ tables ============
create table connect_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'cohort')),
  cohort_id uuid references cohorts(id) on delete cascade,          -- cohort discussions
  learner_id uuid references participants(id) on delete cascade,    -- private conversations
  facilitator_id uuid references profiles(id) on delete cascade,    -- private conversations
  locked boolean not null default false,
  locked_by uuid references profiles(id),
  locked_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  constraint connect_conv_shape check (
    (kind = 'cohort' and cohort_id is not null and learner_id is null and facilitator_id is null) or
    (kind = 'direct' and learner_id is not null and facilitator_id is not null and cohort_id is null))
);
create unique index uq_connect_cohort on connect_conversations (cohort_id) where kind = 'cohort';
create unique index uq_connect_direct on connect_conversations (learner_id, facilitator_id) where kind = 'direct';
create index idx_connect_conv_facilitator on connect_conversations (facilitator_id) where kind = 'direct';

create table connect_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references connect_conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references profiles(id),
  hide_reason text
);
create index idx_connect_messages_conv on connect_messages (conversation_id, created_at desc);
create index idx_connect_messages_sender on connect_messages (sender_id, created_at desc);

create table connect_reads (
  conversation_id uuid not null references connect_conversations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create table connect_hidden_originals (
  message_id uuid primary key references connect_messages(id) on delete cascade,
  body text not null,
  hidden_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table connect_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references connect_messages(id) on delete cascade,
  conversation_id uuid not null references connect_conversations(id) on delete cascade,
  reporter_id uuid not null references profiles(id),
  reason text not null check (reason in ('bullying_or_harassment', 'inappropriate_content', 'personal_information', 'safety_concern', 'spam', 'other')),
  note text check (note is null or length(note) <= 500),
  snapshot_body text not null,                       -- the reported message only, as it was when reported
  snapshot_sender uuid not null references profiles(id),
  status text not null default 'open' check (status in ('open', 'dismissed', 'hidden', 'escalated')),
  handled_by uuid references profiles(id),
  handled_at timestamptz,
  handler_note text check (handler_note is null or length(handler_note) <= 500),
  created_at timestamptz not null default now(),
  constraint connect_reports_once unique (message_id, reporter_id)
);
create index idx_connect_reports_status on connect_reports (status, created_at desc);

create table connect_mutes (
  profile_id uuid primary key references profiles(id) on delete cascade,
  until timestamptz not null,
  reason text not null check (length(btrim(reason)) >= 5),
  muted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table connect_oversight (
  profile_id uuid not null references profiles(id) on delete cascade,
  scope text not null check (scope in ('discussions', 'reports', 'private')),
  reason text not null check (length(btrim(reason)) >= 10),
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (profile_id, scope)
);

create table connect_oversight_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  conversation_id uuid not null references connect_conversations(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Cohort discussions are created automatically.
create or replace function create_cohort_discussion() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into connect_conversations(kind, cohort_id) values ('cohort', new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_cohort_discussion after insert on cohorts for each row execute function create_cohort_discussion();
insert into connect_conversations(kind, cohort_id) select 'cohort', c.id from cohorts c on conflict do nothing;

-- ============ access functions (the rules live here) ============
create or replace function connect_is_moderator() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_executive() or exists (select 1 from connect_oversight o where o.profile_id = auth.uid() and o.scope = 'reports'), false) $$;

create or replace function connect_is_discussion_overseer() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_executive() or exists (select 1 from connect_oversight o where o.profile_id = auth.uid() and o.scope = 'discussions'), false) $$;

-- Is this facilitator still assigned to a cohort the learner is enrolled in?
create or replace function connect_facilitator_assigned(p_learner uuid, p_facilitator uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trainer_assignments ta join cohort_enrolments e on e.cohort_id = ta.cohort_id
                 where ta.trainer_id = p_facilitator and e.participant_id = p_learner) $$;

-- Member of the conversation right now (private: the two people; discussion: enrolled learners and assigned trainers).
create or replace function connect_is_member(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case c.kind
      when 'direct' then
        (c.learner_id = my_participant_id() and app_role() = 'participant')
        or (c.facilitator_id = auth.uid() and app_role() = 'trainer' and connect_facilitator_assigned(c.learner_id, c.facilitator_id))
      else
        (app_role() = 'trainer' and c.cohort_id in (select my_trainer_cohorts()))
        or (app_role() = 'participant' and exists (select 1 from cohort_enrolments e where e.cohort_id = c.cohort_id and e.participant_id = my_participant_id()))
    end
    from connect_conversations c where c.id = p_conv), false) $$;

create or replace function connect_can_see(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when app_role() = 'participant' then connect_is_member(p_conv) and participant_access_active()
      when connect_is_member(p_conv) then true
      else c.kind = 'cohort' and connect_is_discussion_overseer()
    end
    from connect_conversations c where c.id = p_conv), false) $$;

create or replace function connect_can_post(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not c.locked and app_role() in ('participant', 'trainer') and connect_is_member(p_conv)
       and (app_role() <> 'participant' or participant_access_active())
       and (c.kind = 'direct' or not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now()))
    from connect_conversations c where c.id = p_conv), false) $$;

revoke all on function connect_is_moderator(), connect_is_discussion_overseer(), connect_facilitator_assigned(uuid, uuid), connect_is_member(uuid), connect_can_see(uuid), connect_can_post(uuid) from public, anon;
grant execute on function connect_is_moderator(), connect_is_discussion_overseer(), connect_can_see(uuid), connect_can_post(uuid) to authenticated;

-- ============ message guard, bookkeeping and notification ============
create or replace function guard_connect_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.body := btrim(new.body);
  new.sender_id := coalesce(auth.uid(), new.sender_id);
  new.hidden_at := null; new.hidden_by := null; new.hide_reason := null;
  if not is_trusted_session() and (select count(*) from connect_messages m where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 15 then
    raise exception 'You are sending messages too quickly. Please wait a moment';
  end if;
  return new;
end $$;
create trigger trg_guard_connect_message before insert on connect_messages for each row execute function guard_connect_message();

create or replace function after_connect_message() returns trigger language plpgsql security definer set search_path = public as $$
declare c connect_conversations; recipient uuid; last_seen timestamptz;
begin
  update connect_conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into c from connect_conversations where id = new.conversation_id;
  if c.kind = 'direct' then
    select case when new.sender_id = c.facilitator_id then (select profile_id from participants where id = c.learner_id) else c.facilitator_id end into recipient;
    if recipient is not null then
      select last_read_at into last_seen from connect_reads where conversation_id = c.id and profile_id = recipient;
      -- one notification per burst: skip when the recipient already has an unread message from this sender here
      if not exists (select 1 from connect_messages m where m.conversation_id = c.id and m.sender_id = new.sender_id and m.id <> new.id and m.created_at > coalesce(last_seen, '-infinity'::timestamptz)) then
        insert into notifications(user_id, kind, title, body) values (recipient, 'message', 'New private message', 'You have a new message in DIRA Connect.');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_after_connect_message after insert on connect_messages for each row execute function after_connect_message();

-- Messages are never edited or deleted by users; only the moderation function below changes a message (hide).
create or replace function block_connect_message_delete() returns trigger language plpgsql as $$
begin raise exception 'Messages cannot be deleted'; end $$;
create trigger trg_connect_message_no_delete before delete on connect_messages for each row execute function block_connect_message_delete();

-- ============ row level security ============
alter table connect_conversations enable row level security;
alter table connect_messages enable row level security;
alter table connect_reads enable row level security;
alter table connect_hidden_originals enable row level security;
alter table connect_reports enable row level security;
alter table connect_mutes enable row level security;
alter table connect_oversight enable row level security;
alter table connect_oversight_log enable row level security;

create policy cc_read on connect_conversations for select to authenticated using (connect_can_see(id));
create policy cm_read on connect_messages for select to authenticated using (connect_can_see(conversation_id));
create policy cm_insert on connect_messages for insert to authenticated with check (sender_id = auth.uid() and connect_can_post(conversation_id));
create policy cr_read on connect_reads for select to authenticated using (profile_id = auth.uid());
create policy cr_insert on connect_reads for insert to authenticated with check (profile_id = auth.uid() and connect_can_see(conversation_id));
create policy cr_update on connect_reads for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid() and connect_can_see(conversation_id));
create policy chO_read on connect_hidden_originals for select to authenticated using (connect_is_moderator());
create policy crep_read on connect_reports for select to authenticated using (reporter_id = auth.uid() or connect_is_moderator());
create policy cmu_read on connect_mutes for select to authenticated using (connect_is_moderator() or profile_id = auth.uid());
create policy cov_read on connect_oversight for select to authenticated using (is_executive() or profile_id = auth.uid());
create policy cov_insert on connect_oversight for insert to authenticated with check (is_executive());
create policy cov_delete on connect_oversight for delete to authenticated using (is_executive());
create policy covl_read on connect_oversight_log for select to authenticated using (is_executive());
-- No insert/update/delete policy exists for conversations, reports, mutes, hidden originals or the oversight log: they change only through the functions below.

-- Oversight grants: only staff and executives, always with a reason; the grant is audited.
create or replace function guard_connect_oversight() returns trigger language plpgsql security definer set search_path = public as $$
declare r role_code;
begin
  select role into r from profiles where id = new.profile_id;
  if r is null or r not in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator') then
    raise exception 'Oversight can only be granted to executives and programme staff';
  end if;
  new.granted_by := coalesce(auth.uid(), new.granted_by);
  return new;
end $$;
create trigger trg_guard_connect_oversight before insert on connect_oversight for each row execute function guard_connect_oversight();
create trigger aud_connect_oversight after insert or update or delete on connect_oversight for each row execute function audit_row();
create trigger aud_connect_mutes after insert or update or delete on connect_mutes for each row execute function audit_row();

-- ============ functions the screens call ============
-- Facilitators a learner may message: trainers assigned to the learner's cohort.
create or replace function connect_my_facilitators() returns table(profile_id uuid, display_name text) language sql stable security definer set search_path = public as $$
  select distinct p.id, btrim(p.first_name || ' ' || p.last_name)
  from cohort_enrolments e join trainer_assignments ta on ta.cohort_id = e.cohort_id join profiles p on p.id = ta.trainer_id
  where app_role() = 'participant' and participant_access_active() and e.participant_id = my_participant_id() and p.role = 'trainer' and p.status = 'active' $$;

create or replace function connect_start_direct(p_facilitator uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := my_participant_id(); cid uuid;
begin
  if app_role() <> 'participant' or me is null then raise exception 'Only learners can start a private conversation'; end if;
  if not participant_access_active() then raise exception 'Your learning access is not open'; end if;
  if not exists (select 1 from profiles where id = p_facilitator and role = 'trainer' and status = 'active') or not connect_facilitator_assigned(me, p_facilitator) then
    raise exception 'You can only message a facilitator assigned to your cohort';
  end if;
  insert into connect_conversations(kind, learner_id, facilitator_id) values ('direct', me, p_facilitator) on conflict (learner_id, facilitator_id) where kind = 'direct' do nothing;
  select id into cid from connect_conversations where kind = 'direct' and learner_id = me and facilitator_id = p_facilitator;
  return cid;
end $$;

create or replace function connect_threads()
returns table(conversation_id uuid, kind text, title text, subtitle text, last_message_at timestamptz, unread bigint, locked boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind,
         case c.kind when 'cohort' then (select name from cohorts where id = c.cohort_id)
              else case when c.facilitator_id = auth.uid() then (select btrim(first_name || ' ' || last_name) from profiles where id = (select profile_id from participants where id = c.learner_id))
                        else (select btrim(first_name || ' ' || last_name) from profiles where id = c.facilitator_id) end end,
         case c.kind when 'cohort' then 'Cohort discussion' else 'Private conversation' end,
         c.last_message_at,
         (select count(*) from connect_messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.hidden_at is null
            and m.created_at > coalesce((select r.last_read_at from connect_reads r where r.conversation_id = c.id and r.profile_id = auth.uid()), '-infinity'::timestamptz)),
         c.locked
  from connect_conversations c where connect_can_see(c.id)
  order by c.last_message_at desc nulls last, c.created_at desc $$;

create or replace function connect_thread_messages(p_conversation uuid, p_before timestamptz default null, p_limit int default 50)
returns table(id uuid, sender_id uuid, sender_name text, sender_role text, body text, created_at timestamptz, hidden boolean, mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not connect_can_see(p_conversation) then return; end if;
  return query
    select m.id, m.sender_id,
           case when pr.role = 'trainer' then btrim(pr.first_name || ' ' || pr.last_name)
                else btrim(pr.first_name || ' ' || left(coalesce(pr.last_name, ''), 1) || '.') end,
           case when pr.role = 'trainer' then 'Facilitator' else 'Learner' end,
           m.body, m.created_at, (m.hidden_at is not null), (m.sender_id = auth.uid())
    from connect_messages m join profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
    order by m.created_at desc, m.id desc limit least(greatest(p_limit, 1), 100);
end $$;

create or replace function connect_mark_read(p_conversation uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not connect_can_see(p_conversation) then return; end if;
  insert into connect_reads(conversation_id, profile_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, profile_id) do update set last_read_at = now();
end $$;

create or replace function connect_report_message(p_message uuid, p_reason text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare m connect_messages;
begin
  select * into m from connect_messages where id = p_message;
  if not found or not connect_is_member(m.conversation_id) or not connect_can_see(m.conversation_id) then raise exception 'You can only report messages in your own conversations'; end if;
  if m.sender_id = auth.uid() then raise exception 'You cannot report your own message'; end if;
  insert into connect_reports(message_id, conversation_id, reporter_id, reason, note, snapshot_body, snapshot_sender)
  values (m.id, m.conversation_id, auth.uid(), p_reason, nullif(btrim(coalesce(p_note, '')), ''), m.body, m.sender_id)
  on conflict (message_id, reporter_id) do nothing;
end $$;

create or replace function connect_list_reports(p_status text default 'open')
returns table(id uuid, created_at timestamptz, reason text, note text, snapshot_body text, sender_id uuid, sender_name text, conversation_id uuid, conversation_kind text, conversation_title text, status text, handler_note text)
language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, r.reason, r.note, r.snapshot_body, r.snapshot_sender, btrim(sp.first_name || ' ' || sp.last_name), r.conversation_id, c.kind,
         case c.kind when 'cohort' then (select name from cohorts where id = c.cohort_id) else 'Private conversation' end, r.status, r.handler_note
  from connect_reports r join connect_conversations c on c.id = r.conversation_id join profiles sp on sp.id = r.snapshot_sender
  where connect_is_moderator() and (p_status = 'all' or r.status = p_status) order by r.created_at desc limit 200 $$;

create or replace function connect_handle_report(p_report uuid, p_action text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare r connect_reports;
begin
  if not connect_is_moderator() then raise exception 'Only moderators can handle reports'; end if;
  if p_action not in ('dismiss', 'hide', 'escalate') then raise exception 'Unknown action'; end if;
  select * into r from connect_reports where id = p_report;
  if not found then raise exception 'Report not found'; end if;
  if p_action = 'hide' then
    insert into connect_hidden_originals(message_id, body, hidden_by) select m.id, m.body, auth.uid() from connect_messages m where m.id = r.message_id and m.hidden_at is null on conflict do nothing;
    update connect_messages set body = 'This message was removed by a moderator.', hidden_at = now(), hidden_by = auth.uid(), hide_reason = nullif(btrim(coalesce(p_note, '')), '') where id = r.message_id and hidden_at is null;
  end if;
  update connect_reports set status = case p_action when 'dismiss' then 'dismissed' when 'hide' then 'hidden' else 'escalated' end,
         handled_by = auth.uid(), handled_at = now(), handler_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_report;
end $$;

create or replace function connect_set_lock(p_conversation uuid, p_locked boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not connect_is_moderator() then raise exception 'Only moderators can lock a discussion'; end if;
  update connect_conversations set locked = p_locked, locked_by = case when p_locked then auth.uid() end, locked_at = case when p_locked then now() end
   where id = p_conversation and kind = 'cohort';
  if not found then raise exception 'Only cohort discussions can be locked'; end if;
end $$;

create or replace function connect_mute(p_profile uuid, p_until timestamptz, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not connect_is_moderator() then raise exception 'Only moderators can mute'; end if;
  if p_until <= now() then raise exception 'Choose a future time'; end if;
  if not exists (select 1 from profiles where id = p_profile and role in ('participant', 'trainer')) then raise exception 'Only learners and facilitators can be muted'; end if;
  insert into connect_mutes(profile_id, until, reason, muted_by) values (p_profile, p_until, btrim(p_reason), auth.uid())
  on conflict (profile_id) do update set until = excluded.until, reason = excluded.reason, muted_by = auth.uid(), created_at = now();
end $$;
create or replace function connect_unmute(p_profile uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not connect_is_moderator() then raise exception 'Only moderators can unmute'; end if;
  delete from connect_mutes where profile_id = p_profile;
end $$;

-- The ONLY way anyone but the two people can read a private conversation: an explicit 'private' grant, a written reason, and a log entry.
create or replace function connect_oversight_read(p_conversation uuid, p_reason text)
returns table(id uuid, sender_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from connect_oversight o where o.profile_id = auth.uid() and o.scope = 'private') then
    raise exception 'You have not been granted private conversation oversight';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A written reason of at least 10 characters is required'; end if;
  if not exists (select 1 from connect_conversations c where c.id = p_conversation and c.kind = 'direct') then raise exception 'Not a private conversation'; end if;
  insert into connect_oversight_log(profile_id, conversation_id, reason) values (auth.uid(), p_conversation, btrim(p_reason));
  return query select m.id, btrim(pr.first_name || ' ' || pr.last_name), m.body, m.created_at
    from connect_messages m join profiles pr on pr.id = m.sender_id where m.conversation_id = p_conversation order by m.created_at desc limit 200;
end $$;

revoke all on function connect_my_facilitators(), connect_start_direct(uuid), connect_threads(), connect_thread_messages(uuid, timestamptz, int), connect_mark_read(uuid),
  connect_report_message(uuid, text, text), connect_list_reports(text), connect_handle_report(uuid, text, text), connect_set_lock(uuid, boolean),
  connect_mute(uuid, timestamptz, text), connect_unmute(uuid), connect_oversight_read(uuid, text) from public, anon;
grant execute on function connect_my_facilitators(), connect_start_direct(uuid), connect_threads(), connect_thread_messages(uuid, timestamptz, int), connect_mark_read(uuid),
  connect_report_message(uuid, text, text), connect_list_reports(text), connect_handle_report(uuid, text, text), connect_set_lock(uuid, boolean),
  connect_mute(uuid, timestamptz, text), connect_unmute(uuid), connect_oversight_read(uuid, text) to authenticated;

-- ============ Realtime ============
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table connect_messages;
  end if;
end $$;
