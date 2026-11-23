-- DIRA LEARN - PENDING database change: Chat, notification bell, Google Calendar sync (prepared 22 Nov 2026). NOT APPLIED.
-- Apply only after the owner approves it, AFTER 20261122000001_participant_programme_track.sql, by pasting the whole file
-- into the Supabase SQL Editor and pressing Run. One transaction: it applies completely or not at all. It refuses to run twice.
-- Undo: 20261122000002_chat_notifications_calendar_rollback.sql
--
-- WHAT IT ADDS (nothing is removed; existing data is kept):
--  Chat (extends DIRA Connect, so moderation, reports, mutes, locks, legal holds and virus scanning keep applying)
--   - conversation kinds 'dm' (one-to-one between any two people allowed to talk, see chat_can_dm) and 'group' (named group,
--     explicit members); table connect_members; replies (connect_messages.reply_to); emoji reactions (connect_reactions)
--   - attachments: audio, video, Office, PDF, images, text - a documented list with per-category size limits in
--     chat_file_rules (editable by the executive roles); checked by the database on every upload, plus the storage bucket limits
--   - functions for the Chat screens: chat_inbox, chat_messages, chat_search, chat_contacts, chat_start_dm, chat_create_group,
--     chat_add_members, chat_remove_member, chat_rename_group, chat_read_state, chat_react
--  Announcements
--   - all staff roles (programme staff, trainers, mentors, M&E officers) may publish within their access (ann_can_target);
--     audience everyone / track / cohort; pin; edit and delete by the author (and executives); attachments in a new private,
--     virus-scanned bucket 'announcement-files'; emoji reactions (announcement_reactions). Learners still cannot publish.
--  Notifications (bell)
--   - notifications.link / actor_id / dedupe_key: where a notification opens, who caused it, and at most ONE unread
--     notification per conversation / announcement update (no floods); notifications added to Realtime for live updates
--   - new notifications for: direct and group messages (to members only), replies, reactions, announcement updates
--  Google Calendar (one-way, DIRA LEARN is the source of truth)
--   - table gcal_events: one row per scheduled session with its Google event id and sync state; every insert, change,
--     cancellation and deletion of a session schedule queues a sync; the Edge Function google-calendar-sync does the work
-- PERMISSIONS: every new table has Row Level Security and explicit grants (signed-out visitors: none; no TRUNCATE/REFERENCES/
-- TRIGGER); existing policies are only replaced where named below, never loosened for learners.

do $guard$
begin
  if pg_catalog.to_regclass('public.participants') is null then raise exception 'STOP: DIRA LEARN is not installed here. Nothing was changed.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participants' and column_name = 'programme_track_id') then
    raise exception 'STOP: apply 20261122000001_participant_programme_track.sql first. Nothing was changed.';
  end if;
  if pg_catalog.to_regclass('public.connect_members') is not null then
    raise exception 'STOP: this change is already applied (connect_members exists). Nothing was changed.';
  end if;
end $guard$;

-- =====================================================================================================================
-- 1. Files: supported formats and size limits (server-side; the website shows the same list)
-- =====================================================================================================================
create table public.chat_file_rules (
  mime_type text primary key,
  category text not null check (category in ('document', 'image', 'audio', 'video')),
  label text not null,
  max_bytes bigint not null check (max_bytes between 1 and 52428800),   -- 50 MB is the upload limit of the Supabase free plan
  updated_at timestamptz not null default now()
);
comment on table public.chat_file_rules is 'Chat and announcement attachments: the accepted file types and their size limits (22 Nov 2026). Executives may change max_bytes (at most 50 MB) or remove a type. SVG, HTML and executables are deliberately not accepted.';
insert into public.chat_file_rules(mime_type, category, label, max_bytes) values
  ('application/pdf', 'document', 'PDF', 10485760),
  ('application/msword', 'document', 'Word (.doc)', 10485760),
  ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'Word (.docx)', 10485760),
  ('application/vnd.ms-excel', 'document', 'Excel (.xls)', 10485760),
  ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document', 'Excel (.xlsx)', 10485760),
  ('application/vnd.ms-powerpoint', 'document', 'PowerPoint (.ppt)', 26214400),
  ('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document', 'PowerPoint (.pptx)', 26214400),
  ('application/vnd.oasis.opendocument.text', 'document', 'OpenDocument text (.odt)', 10485760),
  ('application/vnd.oasis.opendocument.spreadsheet', 'document', 'OpenDocument spreadsheet (.ods)', 10485760),
  ('application/vnd.oasis.opendocument.presentation', 'document', 'OpenDocument presentation (.odp)', 26214400),
  ('text/plain', 'document', 'Text (.txt)', 2097152),
  ('text/csv', 'document', 'CSV (.csv)', 2097152),
  ('image/jpeg', 'image', 'JPEG image', 10485760),
  ('image/png', 'image', 'PNG image', 10485760),
  ('image/webp', 'image', 'WebP image', 10485760),
  ('image/gif', 'image', 'GIF image', 10485760),
  ('audio/webm', 'audio', 'Audio (WebM, recorded in the browser)', 20971520),
  ('audio/ogg', 'audio', 'Audio (Ogg)', 20971520),
  ('audio/mpeg', 'audio', 'Audio (MP3)', 20971520),
  ('audio/mp4', 'audio', 'Audio (M4A/AAC)', 20971520),
  ('audio/wav', 'audio', 'Audio (WAV)', 20971520),
  ('video/mp4', 'video', 'Video (MP4)', 52428800),
  ('video/webm', 'video', 'Video (WebM)', 52428800),
  ('video/quicktime', 'video', 'Video (MOV)', 52428800);
alter table public.chat_file_rules enable row level security;
create policy dira_active_account on public.chat_file_rules as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));
create policy cfr_read on public.chat_file_rules for select to authenticated using (true);
create policy cfr_update on public.chat_file_rules for update to authenticated using (is_executive()) with check (is_executive());
create policy cfr_delete on public.chat_file_rules for delete to authenticated using (is_executive());

create or replace function public.chat_file_problem(p_mime text, p_size bigint) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from chat_file_rules r where r.mime_type = p_mime) then 'This file type is not accepted'
    when p_size is null or p_size < 1 then 'The file is empty'
    when p_size > (select r.max_bytes from chat_file_rules r where r.mime_type = p_mime) then 'The file is larger than allowed for its type'
    else null end $$;

-- DIRA Connect's list of accepted types now comes from the same rules (it was a fixed list of 6 types).
create or replace function public.connect_allowed_mime(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_file_rules r where r.mime_type = p) $$;

alter table public.connect_attachments drop constraint connect_attachments_size_bytes_check;
alter table public.connect_attachments add constraint connect_attachments_size_bytes_check check (size_bytes >= 1 and size_bytes <= 52428800);
create or replace function public.chat_check_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
declare problem text := chat_file_problem(new.mime_type, new.size_bytes);
begin
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  return new;
end $$;
create trigger trg_chat_check_attachment before insert on public.connect_attachments for each row execute function public.chat_check_attachment();
-- migration 25's attachment guard, unchanged except that type and size now follow chat_file_rules (was: 6 types, 10 MB)
create or replace function public.guard_connect_attachment() returns trigger language plpgsql security definer set search_path = public as $$
declare m connect_messages; obj storage.objects; real_size bigint; real_mime text; problem text;
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
  problem := chat_file_problem(real_mime, real_size);
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  if (select count(*) from connect_attachments where message_id = new.message_id) >= 3 then raise exception 'At most 3 files per message'; end if;
  new.size_bytes := real_size; new.mime_type := real_mime;
  new.file_name := left(regexp_replace(btrim(new.file_name), '[\\/\x00-\x1f<>:"|?*]', '_', 'g'), 200);
  new.uploaded_by := auth.uid(); new.scan_status := 'not_scanned'; new.created_at := now();
  return new;
end $$;

update storage.buckets set file_size_limit = 52428800, allowed_mime_types = (select array_agg(mime_type order by mime_type) from public.chat_file_rules)
 where id = 'connect-attachments';
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-files', 'announcement-files', false, 52428800, (select array_agg(mime_type order by mime_type) from public.chat_file_rules))
on conflict (id) do nothing;

-- announcement files are virus-scanned like the other buckets of migration 35 (the uploader may open their own file meanwhile)
create or replace function public.scanned_bucket(p_bucket text) returns boolean language sql immutable set search_path = public as $$
  select p_bucket in ('application-documents', 'submissions', 'project-evidence', 'course-materials', 'learning-resources', 'announcement-files') $$;

-- =====================================================================================================================
-- 2. Notifications: link, actor, de-duplication, Realtime
-- =====================================================================================================================
alter table public.notifications add column link text, add column actor_id uuid references public.profiles(id) on delete set null, add column dedupe_key text;
alter table public.notifications add constraint notifications_link_check check (link is null or (link ~ '^/[A-Za-z0-9/_?=&.-]*$' and length(link) <= 300));
create unique index notifications_one_unread_per_key on public.notifications (user_id, dedupe_key) where read_at is null and dedupe_key is not null;
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create or replace function public.guard_notification_update() returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.title is distinct from old.title
     or new.body is distinct from old.body or new.created_at is distinct from old.created_at
     or new.link is distinct from old.link or new.actor_id is distinct from old.actor_id or new.dedupe_key is distinct from old.dedupe_key then
    raise exception 'Only the read time of a notification can be changed';
  end if;
  return new;
end $$;

-- one place that creates notifications for the new features: skips the actor, inactive accounts, and keys already unread
create or replace function public.chat_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if not exists (select 1 from profiles where id = p_user and status = 'active') then return; end if;
  insert into notifications(user_id, kind, title, body, link, actor_id, dedupe_key)
  values (p_user, p_kind, left(p_title, 140), left(p_body, 200), p_link, p_actor, p_key)
  on conflict (user_id, dedupe_key) where read_at is null and dedupe_key is not null do nothing;
end $$;

create or replace function public.chat_display_name(p uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'A DIRA LEARN user') from profiles where id = p $$;

-- =====================================================================================================================
-- 3. Conversations: one-to-one ('dm') and groups ('group')
-- =====================================================================================================================
alter table public.connect_conversations drop constraint connect_conversations_kind_check;
alter table public.connect_conversations drop constraint connect_conv_shape;
alter table public.connect_conversations add column title text, add column dm_key text;
alter table public.connect_conversations add constraint connect_conversations_kind_check check (kind in ('direct', 'cohort', 'safeguarding', 'dm', 'group'));
alter table public.connect_conversations add constraint connect_conv_shape check (
     (kind = 'cohort' and cohort_id is not null and learner_id is null and facilitator_id is null)
  or (kind = 'direct' and learner_id is not null and facilitator_id is not null and cohort_id is null)
  or (kind = 'safeguarding' and learner_id is not null and facilitator_id is null and cohort_id is null)
  or (kind = 'dm' and dm_key is not null and cohort_id is null and learner_id is null and facilitator_id is null)
  or (kind = 'group' and title is not null and cohort_id is null and learner_id is null and facilitator_id is null));
alter table public.connect_conversations add constraint connect_conversations_title_check check (title is null or length(btrim(title)) between 1 and 80);
create unique index uq_connect_dm on public.connect_conversations (dm_key) where kind = 'dm';

create table public.connect_members (
  conversation_id uuid not null references public.connect_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_owner boolean not null default false,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index connect_members_profile_idx on public.connect_members (profile_id);
alter table public.connect_members enable row level security;
create policy dira_active_account on public.connect_members as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));

-- Roles in chat: 'learner' (participant), 'programme' (super_admin, founder, co_founder, programme_director, programme_coordinator),
-- 'trainer', 'mentor', 'me' (M&E officer). Applicants and alumni accounts are not in chat.
create or replace function public.chat_role_class(p uuid) returns text language sql stable security definer set search_path = public as $$
  select case when pr.status <> 'active' then null
    when pr.role = 'participant' then 'learner'
    when pr.role in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator') then 'programme'
    when pr.role = 'trainer' then 'trainer' when pr.role = 'mentor' then 'mentor' when pr.role = 'me_officer' then 'me' else null end
  from profiles pr where pr.id = p $$;

-- Who may talk one-to-one (and be put in the same group by the person creating it):
--  - two staff members (any staff roles)                          - a learner and programme staff
--  - two learners who share a cohort                             - a learner and a trainer assigned to one of the learner's cohorts
--  - a learner and their assigned mentor                          (learners and M&E officers: no private chat)
create or replace function public.chat_can_dm(p_a uuid, p_b uuid) returns boolean language sql stable security definer set search_path = public as $$
  with a as (select chat_role_class(p_a) c), b as (select chat_role_class(p_b) c),
       pa as (select id from participants where profile_id = p_a and status <> 'withdrawn'),
       pb as (select id from participants where profile_id = p_b and status <> 'withdrawn')
  select coalesce(p_a <> p_b and (select c from a) is not null and (select c from b) is not null and (
       ((select c from a) <> 'learner' and (select c from b) <> 'learner')
    or ((select c from a) = 'learner' and (select c from b) = 'learner'
        and exists (select 1 from cohort_enrolments x join cohort_enrolments y on y.cohort_id = x.cohort_id
                    where x.participant_id in (select id from pa) and y.participant_id in (select id from pb)))
    or ((select c from a) = 'learner' and (select c from b) = 'programme') or ((select c from b) = 'learner' and (select c from a) = 'programme')
    or ((select c from a) = 'learner' and (select c from b) = 'trainer' and exists (select 1 from pa where connect_facilitator_assigned(pa.id, p_b)))
    or ((select c from b) = 'learner' and (select c from a) = 'trainer' and exists (select 1 from pb where connect_facilitator_assigned(pb.id, p_a)))
    or ((select c from a) = 'learner' and (select c from b) = 'mentor' and exists (select 1 from mentorship_assignments m where m.mentor_id = p_b and m.participant_id in (select id from pa)))
    or ((select c from b) = 'learner' and (select c from a) = 'mentor' and exists (select 1 from mentorship_assignments m where m.mentor_id = p_a and m.participant_id in (select id from pb)))
  ), false) $$;

-- membership and posting now also cover 'dm' and 'group' (the other kinds are exactly as before)
create or replace function public.connect_is_member(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case c.kind
      when 'direct' then
        (c.learner_id = my_participant_id() and app_role() = 'participant')
        or (c.facilitator_id = auth.uid() and app_role() = 'trainer' and connect_facilitator_assigned(c.learner_id, c.facilitator_id))
      when 'safeguarding' then
        (c.learner_id = my_participant_id() and app_role() = 'participant') or is_safeguarding_officer()
      when 'dm' then exists (select 1 from connect_members m where m.conversation_id = c.id and m.profile_id = auth.uid()) and chat_role_class(auth.uid()) is not null
      when 'group' then exists (select 1 from connect_members m where m.conversation_id = c.id and m.profile_id = auth.uid()) and chat_role_class(auth.uid()) is not null
      else
        (app_role() = 'trainer' and c.cohort_id in (select my_trainer_cohorts()))
        or (app_role() = 'participant' and exists (select 1 from cohort_enrolments e where e.cohort_id = c.cohort_id and e.participant_id = my_participant_id()))
    end
    from connect_conversations c where c.id = p_conv), false) $$;

create or replace function public.connect_can_post(p_conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not c.locked and connect_is_member(p_conv) and case c.kind
      when 'cohort' then app_role() in ('participant', 'trainer')
        and (app_role() <> 'participant' or learner_access_state(my_participant_id(), c.cohort_id) = 'active')
        and not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now())
      when 'direct' then app_role() in ('participant', 'trainer')
      -- one-to-one: only while the two may still talk (e.g. not after a learner left the cohort)
      when 'dm' then exists (select 1 from connect_members o where o.conversation_id = c.id and o.profile_id <> auth.uid() and chat_can_dm(auth.uid(), o.profile_id))
      when 'group' then not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now())
      else true end
    from connect_conversations c where c.id = p_conv), false) $$;

create policy cmem_read on public.connect_members for select to authenticated using (connect_is_member(conversation_id));

create or replace function public.chat_start_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; cid uuid; lp uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not chat_can_dm(me, p_other) then raise exception 'You cannot start a private conversation with this person' using errcode = '42501'; end if;
  -- a learner and their assigned trainer keep using DIRA Connect''s existing private conversation (one thread, not two)
  if chat_role_class(me) = 'learner' and chat_role_class(p_other) = 'trainer' then return connect_start_direct(p_other); end if;
  if chat_role_class(me) = 'trainer' and chat_role_class(p_other) = 'learner' then
    select id into lp from participants where profile_id = p_other and status <> 'withdrawn' limit 1;
    if lp is not null and connect_facilitator_assigned(lp, me) then return connect_start_direct_with_learner(lp); end if;
  end if;
  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  insert into connect_conversations(kind, dm_key, started_by) values ('dm', k, me) on conflict (dm_key) where kind = 'dm' do nothing;
  select id into cid from connect_conversations where kind = 'dm' and dm_key = k;
  insert into connect_members(conversation_id, profile_id, added_by) values (cid, me, me), (cid, p_other, me) on conflict do nothing;
  return cid;
end $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; m uuid; t text := btrim(coalesce(p_title, ''));
begin
  if chat_role_class(me) is null or chat_role_class(me) = 'learner' then raise exception 'Only staff can create group conversations' using errcode = '42501'; end if;
  if length(t) < 1 or length(t) > 80 then raise exception 'Give the group a name (at most 80 characters)'; end if;
  if coalesce(array_length(p_members, 1), 0) < 1 then raise exception 'Add at least one member'; end if;
  if array_length(p_members, 1) > 300 then raise exception 'A group can have at most 300 members'; end if;
  foreach m in array p_members loop
    if m <> me and not chat_can_dm(me, m) then raise exception 'You cannot add % to a group', chat_display_name(m) using errcode = '42501'; end if;
  end loop;
  insert into connect_conversations(kind, title, started_by) values ('group', t, me) returning id into cid;
  insert into connect_members(conversation_id, profile_id, is_owner, added_by) values (cid, me, true, me);
  insert into connect_members(conversation_id, profile_id, added_by) select cid, x, me from unnest(p_members) x where x <> me on conflict do nothing;
  perform chat_notify(x, 'group', 'You were added to the group ' || t, chat_display_name(me) || ' added you.', '/chat?c=' || cid, me, 'group-added:' || cid)
    from unnest(p_members) x where x <> me;
  return cid;
end $$;

create or replace function public.chat_add_members(p_conv uuid, p_members uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m uuid; n int := 0; t text;
begin
  select title into t from connect_conversations where id = p_conv and kind = 'group';
  if t is null or not exists (select 1 from connect_members where conversation_id = p_conv and profile_id = me and is_owner) then
    raise exception 'Only the group''s owner can add members' using errcode = '42501';
  end if;
  foreach m in array coalesce(p_members, '{}') loop
    if not chat_can_dm(me, m) then raise exception 'You cannot add % to this group', chat_display_name(m) using errcode = '42501'; end if;
    insert into connect_members(conversation_id, profile_id, added_by) values (p_conv, m, me) on conflict do nothing;
    if found then n := n + 1; perform chat_notify(m, 'group', 'You were added to the group ' || t, chat_display_name(me) || ' added you.', '/chat?c=' || p_conv, me, 'group-added:' || p_conv); end if;
  end loop;
  return n;
end $$;

-- the owner removes a member, or anyone leaves (p_member = yourself); the last owner cannot leave while others remain
create or replace function public.chat_remove_member(p_conv uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from connect_conversations where id = p_conv and kind = 'group') then raise exception 'Not a group conversation'; end if;
  if p_member <> me and not exists (select 1 from connect_members where conversation_id = p_conv and profile_id = me and is_owner) then
    raise exception 'Only the group''s owner can remove members' using errcode = '42501';
  end if;
  if exists (select 1 from connect_members where conversation_id = p_conv and profile_id = p_member and is_owner)
     and (select count(*) from connect_members where conversation_id = p_conv and is_owner) = 1
     and (select count(*) from connect_members where conversation_id = p_conv) > 1 then
    raise exception 'Hand the group to another owner before leaving';
  end if;
  delete from connect_members where conversation_id = p_conv and profile_id = p_member;
end $$;

create or replace function public.chat_rename_group(p_conv uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from connect_members where conversation_id = p_conv and profile_id = auth.uid() and is_owner) then
    raise exception 'Only the group''s owner can rename it' using errcode = '42501';
  end if;
  update connect_conversations set title = btrim(p_title) where id = p_conv and kind = 'group';
end $$;

-- people the signed-in user may start a conversation with (or add to a group), optionally filtered by name; at most 50
create or replace function public.chat_contacts(p_query text default null)
returns table(profile_id uuid, display_name text, role_label text) language sql stable security definer set search_path = public as $$
  select pr.id, chat_display_name(pr.id),
         case chat_role_class(pr.id) when 'learner' then 'Learner' when 'programme' then 'Programme team' when 'trainer' then 'Trainer'
                                     when 'mentor' then 'Mentor' else 'M&E' end
  from profiles pr
  where pr.status = 'active' and pr.id <> auth.uid() and chat_role_class(pr.id) is not null
    and (p_query is null or btrim(p_query) = '' or (coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and chat_can_dm(auth.uid(), pr.id)
  order by 2 limit 50 $$;

-- =====================================================================================================================
-- 4. Messages: replies, reactions, inbox, history, search, read state
-- =====================================================================================================================
alter table public.connect_messages add column reply_to uuid references public.connect_messages(id) on delete set null;
create or replace function public.chat_check_reply() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to is not null and not exists (select 1 from connect_messages m where m.id = new.reply_to and m.conversation_id = new.conversation_id) then
    raise exception 'A reply must answer a message of the same conversation';
  end if;
  return new;
end $$;
create trigger trg_chat_check_reply before insert on public.connect_messages for each row execute function public.chat_check_reply();

-- the emoji offered for reactions (the website shows the same set)
create or replace function public.chat_allowed_emoji(p text) returns boolean language sql immutable as $$
  select p = any (array['👍','❤️','😂','😮','😢','🙏','👏','🎉','🔥','💯','✅','👀','🤔','💡','📌','🙌']) $$;

create table public.connect_reactions (
  message_id uuid not null references public.connect_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (chat_allowed_emoji(emoji)),
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);
alter table public.connect_reactions enable row level security;
create policy dira_active_account on public.connect_reactions as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));
create policy creact_read on public.connect_reactions for select to authenticated
  using (exists (select 1 from connect_messages m where m.id = message_id and m.hidden_at is null and connect_can_see(m.conversation_id)));
create policy creact_insert on public.connect_reactions for insert to authenticated
  with check (profile_id = auth.uid() and exists (select 1 from connect_messages m join connect_conversations c on c.id = m.conversation_id
                                                  where m.id = message_id and m.hidden_at is null and c.kind <> 'safeguarding' and connect_can_post(m.conversation_id)));
create policy creact_delete on public.connect_reactions for delete to authenticated using (profile_id = auth.uid());

create or replace function public.after_connect_reaction() returns trigger language plpgsql security definer set search_path = public as $$
declare m connect_messages;
begin
  select * into m from connect_messages where id = new.message_id;
  perform chat_notify(m.sender_id, 'reaction', chat_display_name(new.profile_id) || ' reacted ' || new.emoji || ' to your message', null,
                      '/chat?c=' || m.conversation_id || '&m=' || m.id, new.profile_id, 'reaction:' || m.id);
  return new;
end $$;
create trigger trg_after_connect_reaction after insert on public.connect_reactions for each row execute function public.after_connect_reaction();

-- notifications for new messages (replaces the migration-22 version; 'direct' and 'safeguarding' keep their texts and rules,
-- and now carry a link; 'dm' and 'group' notify every other member once per unread conversation; cohort discussions stay quiet)
create or replace function public.after_connect_message() returns trigger language plpgsql security definer set search_path = public as $$
declare c connect_conversations; recipient uuid; learner_profile uuid; last_seen timestamptz; who text := chat_display_name(new.sender_id); r record;
begin
  update connect_conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into c from connect_conversations where id = new.conversation_id;
  if new.reply_to is not null then
    perform chat_notify((select sender_id from connect_messages where id = new.reply_to), 'reply', who || ' replied to your message', null,
                        '/chat?c=' || c.id || '&m=' || new.id, new.sender_id, 'reply:' || c.id);
  end if;
  if c.kind = 'cohort' then return new; end if;
  if c.kind in ('dm', 'group') then
    for r in select m.profile_id from connect_members m where m.conversation_id = c.id and m.profile_id <> new.sender_id loop
      perform chat_notify(r.profile_id, case c.kind when 'dm' then 'message' else 'group_message' end,
                          case c.kind when 'dm' then 'New message from ' || who else who || ' in ' || c.title end,
                          left(new.body, 80), '/chat?c=' || c.id, new.sender_id, 'conv:' || c.id);
    end loop;
    return new;
  end if;
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
    insert into notifications(user_id, kind, title, body, link) values (recipient, 'message', 'New message from the safeguarding team', 'Open Chat to read it.', '/chat?c=' || c.id);
  else
    insert into notifications(user_id, kind, title, body, link, actor_id) values (recipient, 'message', 'New private message', 'You have a new message in Chat.', '/chat?c=' || c.id, new.sender_id);
  end if;
  return new;
end $$;

-- inbox for the Chat screens: every conversation the user can see, with title, last message, unread count and the other person
create or replace function public.chat_inbox()
returns table(conversation_id uuid, kind text, title text, subtitle text, other_profile_id uuid, last_message_at timestamptz,
              last_message text, last_sender_id uuid, unread bigint, locked boolean, is_owner boolean, member_count int, can_post boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind,
    case c.kind
      when 'cohort' then (select name from cohorts where id = c.cohort_id)
      when 'group' then c.title
      when 'dm' then (select chat_display_name(m.profile_id) from connect_members m where m.conversation_id = c.id and m.profile_id <> auth.uid() limit 1)
      when 'safeguarding' then case when c.learner_id = my_participant_id() then 'Safeguarding team' else chat_display_name((select profile_id from participants where id = c.learner_id)) end
      else case when c.facilitator_id = auth.uid() then chat_display_name((select profile_id from participants where id = c.learner_id)) else chat_display_name(c.facilitator_id) end end,
    case c.kind when 'cohort' then 'Cohort discussion' when 'group' then 'Group' when 'safeguarding' then 'Safeguarding (confidential)' else 'Direct message' end,
    case c.kind
      when 'dm' then (select m.profile_id from connect_members m where m.conversation_id = c.id and m.profile_id <> auth.uid() limit 1)
      when 'direct' then case when c.facilitator_id = auth.uid() then (select profile_id from participants where id = c.learner_id) else c.facilitator_id end
      else null end,
    c.last_message_at,
    (select case when lm.hidden_at is null then left(lm.body, 120) else 'Message removed by a moderator' end from connect_messages lm where lm.conversation_id = c.id order by lm.created_at desc limit 1),
    (select lm.sender_id from connect_messages lm where lm.conversation_id = c.id order by lm.created_at desc limit 1),
    (select count(*) from connect_messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.hidden_at is null
       and m.created_at > coalesce((select r.last_read_at from connect_reads r where r.conversation_id = c.id and r.profile_id = auth.uid()), '-infinity'::timestamptz)),
    c.locked,
    coalesce((select m.is_owner from connect_members m where m.conversation_id = c.id and m.profile_id = auth.uid()), false),
    case when c.kind in ('dm', 'group') then (select count(*)::int from connect_members m where m.conversation_id = c.id) else null end,
    connect_can_post(c.id)
  from connect_conversations c where connect_can_see(c.id)
  order by c.last_message_at desc nulls last, c.created_at desc $$;

-- one page of a conversation (newest first), with sender, reply preview, attachments and reactions; marks nothing as read
create or replace function public.chat_messages(p_conv uuid, p_before timestamptz default null, p_limit int default 50)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, hidden boolean,
              reply_to uuid, reply_sender text, reply_body text, attachments jsonb, reactions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.sender_id, chat_display_name(m.sender_id),
         case when m.hidden_at is null then m.body else null end, m.created_at, m.hidden_at is not null,
         m.reply_to,
         (select chat_display_name(r.sender_id) from connect_messages r where r.id = m.reply_to),
         (select case when r.hidden_at is null then left(r.body, 140) else 'Message removed' end from connect_messages r where r.id = m.reply_to),
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.storage_path, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes, 'scan', a.scan_status) order by a.created_at)
                   from connect_attachments a where a.message_id = m.id and m.hidden_at is null), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine) order by x.first)
                   from (select rc.emoji, count(*) n, bool_or(rc.profile_id = auth.uid()) mine, min(rc.created_at) first
                         from connect_reactions rc where rc.message_id = m.id group by rc.emoji) x where m.hidden_at is null), '[]'::jsonb)
  from connect_messages m
  where m.conversation_id = p_conv and connect_can_see(p_conv) and (p_before is null or m.created_at < p_before)
  order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) $$;

-- search in every conversation the user can see (moderator-removed messages are never found); at most 50 results
create or replace function public.chat_search(p_query text)
returns table(conversation_id uuid, message_id uuid, sender_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.conversation_id, m.id, chat_display_name(m.sender_id), left(m.body, 200), m.created_at
  from connect_messages m
  where length(btrim(coalesce(p_query, ''))) >= 2 and m.hidden_at is null
    and m.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and connect_can_see(m.conversation_id)
  order by m.created_at desc limit 50 $$;

-- when the other members last read a 'dm' or 'group' conversation (for "Seen" ticks); only for its members
create or replace function public.chat_read_state(p_conv uuid)
returns table(profile_id uuid, last_read_at timestamptz) language sql stable security definer set search_path = public as $$
  select r.profile_id, r.last_read_at from connect_reads r
  where r.conversation_id = p_conv and r.profile_id <> auth.uid() and connect_is_member(p_conv)
    and exists (select 1 from connect_conversations c where c.id = p_conv and c.kind in ('dm', 'group', 'direct'))
    and (exists (select 1 from connect_members m where m.conversation_id = p_conv and m.profile_id = r.profile_id)
         or exists (select 1 from connect_conversations c where c.id = p_conv and c.kind = 'direct')) $$;

-- toggle a reaction on a message (adds it, or removes it when it is already yours); returns true when added
create or replace function public.chat_react(p_message uuid, p_emoji text) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  delete from connect_reactions where message_id = p_message and profile_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into connect_reactions(message_id, profile_id, emoji) values (p_message, auth.uid(), p_emoji);
  return true;
end $$;

-- =====================================================================================================================
-- 5. Announcements: all staff publish within their access, audiences, pin, edit/delete, attachments, reactions
-- =====================================================================================================================
alter table public.announcements add column audience text, add column track_id uuid references public.tracks(id),
  add column pinned boolean not null default false, add column updated_at timestamptz, add column edited_at timestamptz;
update public.announcements set audience = case when cohort_id is null then 'everyone' else 'cohort' end;
alter table public.announcements alter column audience set not null, alter column audience set default 'everyone';
alter table public.announcements add constraint announcements_audience_check check (
     (audience = 'everyone' and cohort_id is null and track_id is null)
  or (audience = 'cohort' and cohort_id is not null and track_id is null)
  or (audience = 'track' and track_id is not null and cohort_id is null));
alter table public.announcements add constraint announcements_title_len check (length(btrim(title)) between 1 and 160);
alter table public.announcements add constraint announcements_body_len check (length(body) <= 5000);
create index announcements_created_idx on public.announcements (pinned desc, created_at desc);

-- Who may publish to which audience (owner request: all staff, excluding learners, within their existing access):
--  programme staff and M&E officers: everyone, any track, any cohort; trainers: their own cohorts, or a track they teach;
--  mentors: a cohort in which they mentor someone. Learners and applicants: never.
create or replace function public.ann_can_target(p_audience text, p_cohort uuid, p_track uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case chat_role_class(auth.uid())
    when 'programme' then true when 'me' then true
    when 'trainer' then (p_audience = 'cohort' and p_cohort in (select my_trainer_cohorts()))
                     or (p_audience = 'track' and exists (select 1 from trainer_assignments ta where ta.trainer_id = auth.uid() and ta.track_id = p_track))
    when 'mentor' then p_audience = 'cohort' and exists (select 1 from mentorship_assignments ma join cohort_enrolments e on e.participant_id = ma.participant_id
                                                        where ma.mentor_id = auth.uid() and e.cohort_id = p_cohort)
    else false end, false) $$;

-- who sees an announcement (unchanged for 'everyone' and 'cohort'; 'track' = staff, trainers of the track, and learners in it)
create or replace function public.ann_visible(a public.announcements) returns boolean
language sql stable security definer set search_path = public as $$
  select a.created_by = auth.uid() or case a.audience
    when 'everyone' then true
    when 'cohort' then is_staff() or app_role() = 'me_officer' or a.cohort_id in (select my_trainer_cohorts())
      or a.cohort_id in (select e.cohort_id from cohort_enrolments e where e.participant_id = my_participant_id())
      or exists (select 1 from mentorship_assignments ma join cohort_enrolments e on e.participant_id = ma.participant_id where ma.mentor_id = auth.uid() and e.cohort_id = a.cohort_id)
    when 'track' then is_staff() or app_role() = 'me_officer'
      or exists (select 1 from trainer_assignments ta where ta.trainer_id = auth.uid() and ta.track_id = a.track_id)
      or exists (select 1 from participants p where p.profile_id = auth.uid() and p.status <> 'withdrawn'
                 and (p.programme_track_id = a.track_id or exists (select 1 from cohort_enrolments e where e.participant_id = p.id and e.track_id = a.track_id)))
    else false end $$;

drop policy ann_insert on public.announcements;
drop policy ann_read on public.announcements;
create policy ann_read on public.announcements for select to authenticated using (ann_visible(announcements));
create policy ann_insert on public.announcements for insert to authenticated with check (ann_can_target(audience, cohort_id, track_id));
create policy ann_update on public.announcements for update to authenticated
  using (created_by = auth.uid() or is_executive()) with check (ann_can_target(audience, cohort_id, track_id) or is_executive());
create policy ann_delete on public.announcements for delete to authenticated using (created_by = auth.uid() or is_executive());

create or replace function public.guard_announcement_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
  if new.title is distinct from old.title or new.body is distinct from old.body then new.edited_at := now(); end if;
  return new;
end $$;
create trigger trg_guard_announcement_update before update on public.announcements for each row execute function public.guard_announcement_update();

-- the people an announcement is for (used for notifications); same reach as ann_visible, active accounts only
create or replace function public.ann_audience_ids(a public.announcements) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct s.u from (
    select p.profile_id as u from participants p join cohort_enrolments e on e.participant_id = p.id
      where a.audience = 'cohort' and e.cohort_id = a.cohort_id and p.status <> 'withdrawn'
    union select ta.trainer_id from trainer_assignments ta where a.audience = 'cohort' and ta.cohort_id = a.cohort_id
    union select p.profile_id from participants p where a.audience = 'track' and p.status <> 'withdrawn'
      and (p.programme_track_id = a.track_id or exists (select 1 from cohort_enrolments e where e.participant_id = p.id and e.track_id = a.track_id))
    union select ta.trainer_id from trainer_assignments ta where a.audience = 'track' and ta.track_id = a.track_id
    union select pr.id from profiles pr where a.audience = 'everyone' and pr.status = 'active' and pr.role in ('participant', 'trainer', 'mentor', 'me_officer')
      and not exists (select 1 from participants p where p.profile_id = pr.id and p.status = 'withdrawn')
  ) s join profiles pr on pr.id = s.u and pr.status = 'active' where s.u is not null $$;

create or replace function public.announcement_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select ann_audience_ids(new) loop
    perform chat_notify(u, 'announcement', new.title, left(new.body, 200), '/chat?a=' || new.id, new.created_by, 'ann:' || new.id);
  end loop;
  return new;
end $$;

create or replace function public.announcement_update_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.title is not distinct from old.title and new.body is not distinct from old.body then return new; end if;
  for u in select ann_audience_ids(new) loop
    perform chat_notify(u, 'announcement', 'Updated: ' || new.title, left(new.body, 200), '/chat?a=' || new.id, auth.uid(), 'ann-update:' || new.id);
  end loop;
  return new;
end $$;
create trigger trg_announcement_update_notify after update on public.announcements for each row execute function public.announcement_update_notify();

create table public.announcement_attachments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index announcement_attachments_ann_idx on public.announcement_attachments (announcement_id);
create or replace function public.chat_check_announcement_attachment() returns trigger language plpgsql security definer set search_path = public as $$
declare problem text := chat_file_problem(new.mime_type, new.size_bytes);
begin
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  if split_part(new.storage_path, '/', 1) <> new.announcement_id::text then raise exception 'The file must be stored under its announcement'; end if;
  return new;
end $$;
create trigger trg_check_announcement_attachment before insert on public.announcement_attachments for each row execute function public.chat_check_announcement_attachment();
alter table public.announcement_attachments enable row level security;
create policy dira_active_account on public.announcement_attachments as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));
create policy aatt_read on public.announcement_attachments for select to authenticated
  using (exists (select 1 from announcements a where a.id = announcement_id and ann_visible(a)));
create policy aatt_insert on public.announcement_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (select 1 from announcements a where a.id = announcement_id and a.created_by = auth.uid()));
create policy aatt_delete on public.announcement_attachments for delete to authenticated
  using (exists (select 1 from announcements a where a.id = announcement_id and (a.created_by = auth.uid() or is_executive())));

create table public.announcement_reactions (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (chat_allowed_emoji(emoji)),
  created_at timestamptz not null default now(),
  primary key (announcement_id, profile_id, emoji)
);
alter table public.announcement_reactions enable row level security;
create policy dira_active_account on public.announcement_reactions as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));
create policy areact_read on public.announcement_reactions for select to authenticated using (exists (select 1 from announcements a where a.id = announcement_id and ann_visible(a)));
create policy areact_insert on public.announcement_reactions for insert to authenticated
  with check (profile_id = auth.uid() and exists (select 1 from announcements a where a.id = announcement_id and ann_visible(a)));
create policy areact_delete on public.announcement_reactions for delete to authenticated using (profile_id = auth.uid());

create or replace function public.ann_react(p_announcement uuid, p_emoji text) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  delete from announcement_reactions where announcement_id = p_announcement and profile_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into announcement_reactions(announcement_id, profile_id, emoji) values (p_announcement, auth.uid(), p_emoji);
  return true;
end $$;

-- announcement feed for the Chat screens: newest first, pinned on top, with author, audience, attachments and reactions
create or replace function public.ann_feed(p_before timestamptz default null, p_limit int default 30)
returns table(id uuid, title text, body text, audience text, audience_label text, cohort_id uuid, track_id uuid, pinned boolean,
              created_by uuid, author_name text, created_at timestamptz, edited_at timestamptz, can_edit boolean, attachments jsonb, reactions jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.title, a.body, a.audience,
    case a.audience when 'everyone' then 'Everyone' when 'cohort' then 'Cohort: ' || coalesce((select name from cohorts where id = a.cohort_id), '?')
                    else 'Track: ' || coalesce((select name from tracks where id = a.track_id), '?') end,
    a.cohort_id, a.track_id, a.pinned, a.created_by, chat_display_name(a.created_by), a.created_at, a.edited_at,
    (a.created_by = auth.uid() or is_executive()),
    coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.storage_path, 'name', f.file_name, 'mime', f.mime_type, 'size', f.size_bytes) order by f.created_at)
              from announcement_attachments f where f.announcement_id = a.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine) order by x.first)
              from (select r.emoji, count(*) n, bool_or(r.profile_id = auth.uid()) mine, min(r.created_at) first from announcement_reactions r where r.announcement_id = a.id group by r.emoji) x), '[]'::jsonb)
  from announcements a
  where ann_visible(a) and (p_before is null or a.created_at < p_before)
  order by (p_before is null and a.pinned) desc, a.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100) $$;

-- storage: announcement files under <announcement id>/<file>; uploaded by the announcement's author; read by its audience
-- (and, through migration 35's restrictive policy, only after a clean virus scan - the uploader may open their own file meanwhile)
create or replace function public.ann_file_read_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from announcement_attachments f join announcements a on a.id = f.announcement_id where f.storage_path = p_name and ann_visible(a)) $$;
create or replace function public.ann_file_upload_ok(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/'); aid uuid;
begin
  if array_length(parts, 1) <> 2 then return false; end if;
  begin aid := parts[1]::uuid; exception when others then return false; end;
  return exists (select 1 from announcements a where a.id = aid and a.created_by = auth.uid());
end $$;
create policy "ann_files_read" on storage.objects for select to authenticated using (bucket_id = 'announcement-files' and ann_file_read_ok(name));
create policy "ann_files_upload" on storage.objects for insert to authenticated with check (bucket_id = 'announcement-files' and ann_file_upload_ok(name));
create policy "ann_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'announcement-files' and exists (select 1 from announcements a where a.id::text = split_part(name, '/', 1) and (a.created_by = auth.uid() or is_executive())));

-- =====================================================================================================================
-- 6. Google Calendar sync queue (one-way: DIRA LEARN -> one organisation calendar)
-- =====================================================================================================================
create table public.gcal_events (
  schedule_id uuid primary key,                 -- session_schedules.id (no foreign key: the row must outlive a deleted schedule)
  google_event_id text not null,                -- deterministic: 'dira' + the schedule id without dashes (prevents duplicates)
  operation text not null check (operation in ('upsert', 'delete')),
  state text not null default 'pending' check (state in ('pending', 'syncing', 'synced', 'failed', 'deleted')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);
create index gcal_events_queue_idx on public.gcal_events (state, next_attempt_at);
alter table public.gcal_events enable row level security;
create policy dira_active_account on public.gcal_events as restrictive for all to authenticated using ((select account_is_active())) with check ((select account_is_active()));
create policy gcal_read on public.gcal_events for select to authenticated using (is_staff() or app_role() = 'trainer');

create or replace function public.gcal_event_id(p uuid) returns text language sql immutable as $$ select 'dira' || replace(p::text, '-', '') $$;

-- every change to a scheduled session queues a sync; a failure here can never block the DIRA LEARN calendar
create or replace function public.gcal_queue_schedule() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(new.id, old.id); op text;
begin
  op := case when tg_op = 'DELETE' or new.status = 'cancelled' then 'delete' else 'upsert' end;
  begin
    insert into gcal_events(schedule_id, google_event_id, operation, state, attempts, last_error, next_attempt_at, updated_at)
    values (sid, gcal_event_id(sid), op, 'pending', 0, null, now(), now())
    on conflict (schedule_id) do update set operation = excluded.operation, state = 'pending', attempts = 0, last_error = null,
      next_attempt_at = now(), claimed_at = null, updated_at = now();
  exception when others then
    raise warning 'Google Calendar sync could not be queued for session schedule %: %', sid, sqlerrm;
  end;
  return coalesce(new, old);
end $$;
create trigger trg_gcal_queue_schedule after insert or update or delete on public.session_schedules for each row execute function public.gcal_queue_schedule();

-- service role only (Edge Function google-calendar-sync): claim due rows (abandoned claims after 10 minutes) with event details
create or replace function public.gcal_claim(p_limit int default 20)
returns table(schedule_id uuid, google_event_id text, operation text, attempts int, title text, description text, location text,
              starts_at timestamptz, ends_at timestamptz)
language sql volatile security definer set search_path = public as $$
  with due as (
    select g.schedule_id from gcal_events g
    where (g.state = 'pending' and g.next_attempt_at <= now()) or (g.state = 'syncing' and g.claimed_at < now() - interval '10 minutes')
    order by g.next_attempt_at limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked),
  claimed as (update gcal_events g set state = 'syncing', claimed_at = now(), attempts = g.attempts + 1 from due where g.schedule_id = due.schedule_id returning g.*)
  select c.schedule_id, c.google_event_id, case when s.id is null then 'delete' else c.operation end, c.attempts,
    'DIRA LEARN: ' || coalesce(cs.title, 'Session') || coalesce(' (' || co.name || ')', ''),
    concat_ws(E'\n', 'Cohort: ' || co.name, 'Mode: ' || s.mode::text, case when s.meeting_url is not null then 'Join: ' || s.meeting_url end,
              'Managed by DIRA LEARN - changes made in Google Calendar are overwritten.'),
    s.venue, s.starts_at, s.ends_at
  from claimed c left join session_schedules s on s.id = c.schedule_id
  left join curriculum_sessions cs on cs.id = s.curriculum_session_id left join cohorts co on co.id = s.cohort_id $$;

create or replace function public.gcal_record(p_schedule uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g gcal_events;
begin
  select * into g from gcal_events where schedule_id = p_schedule for update;
  if not found or g.state <> 'syncing' then return; end if;     -- changed again meanwhile: the newer queued state wins
  if p_ok then
    update gcal_events set state = case when operation = 'delete' then 'deleted' else 'synced' end, synced_at = now(), last_error = null,
      claimed_at = null, updated_at = now() where schedule_id = p_schedule;
  else
    update gcal_events set state = case when attempts >= 8 then 'failed' else 'pending' end, last_error = left(p_error, 500), claimed_at = null,
      next_attempt_at = now() + make_interval(mins => least(power(2, attempts)::int, 240)), updated_at = now() where schedule_id = p_schedule;
  end if;
end $$;

-- staff: try failed syncs again now; and queue every future session once (e.g. right after setting up Google Calendar)
create or replace function public.gcal_retry_failed() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_staff() or app_role() = 'trainer') then raise exception 'Not allowed' using errcode = '42501'; end if;
  update gcal_events set state = 'pending', attempts = 0, next_attempt_at = now(), updated_at = now() where state = 'failed';
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.gcal_queue_all_future() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into gcal_events(schedule_id, google_event_id, operation)
  select s.id, gcal_event_id(s.id), case when s.status = 'cancelled' then 'delete' else 'upsert' end from session_schedules s where s.ends_at > now()
  on conflict (schedule_id) do update set state = 'pending', operation = excluded.operation, attempts = 0, next_attempt_at = now(), updated_at = now()
    where gcal_events.state in ('failed', 'synced');
  get diagnostics n = row_count; return n;
end $$;

-- =====================================================================================================================
-- 7. Realtime (live messages, reactions, announcements and notifications; Row Level Security decides who receives what)
-- =====================================================================================================================
do $rt$
declare t text;
begin
  foreach t in array array['notifications', 'connect_reactions', 'announcements', 'announcement_reactions', 'connect_members'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $rt$;

-- =====================================================================================================================
-- 8. Permissions (explicit, as migration 38: Supabase may add default privileges to new tables, so remove them first)
-- =====================================================================================================================
revoke all on public.chat_file_rules, public.connect_members, public.connect_reactions, public.announcement_attachments,
  public.announcement_reactions, public.gcal_events from anon, authenticated, service_role, public;
grant select, insert, update, delete on public.chat_file_rules, public.connect_members, public.connect_reactions, public.announcement_attachments,
  public.announcement_reactions, public.gcal_events to service_role;
grant select, update, delete on public.chat_file_rules to authenticated;
grant select on public.connect_members to authenticated;
grant select, insert, delete on public.connect_reactions to authenticated;
grant select, insert, delete on public.announcement_attachments to authenticated;
grant select, insert, delete on public.announcement_reactions to authenticated;
grant select on public.gcal_events to authenticated;
grant update, delete on public.announcements to authenticated;

do $fn$
declare f text;
begin
  foreach f in array array['chat_file_problem(text,bigint)', 'chat_check_attachment()', 'chat_notify(uuid,text,text,text,text,uuid,text)', 'chat_display_name(uuid)',
    'chat_role_class(uuid)', 'chat_can_dm(uuid,uuid)', 'chat_start_dm(uuid)', 'chat_create_group(text,uuid[])', 'chat_add_members(uuid,uuid[])',
    'chat_remove_member(uuid,uuid)', 'chat_rename_group(uuid,text)', 'chat_contacts(text)', 'chat_check_reply()', 'chat_allowed_emoji(text)',
    'after_connect_reaction()', 'chat_inbox()', 'chat_messages(uuid,timestamptz,integer)', 'chat_search(text)', 'chat_read_state(uuid)',
    'chat_react(uuid,text)', 'ann_can_target(text,uuid,uuid)', 'ann_visible(announcements)', 'guard_announcement_update()', 'ann_audience_ids(announcements)',
    'announcement_update_notify()', 'chat_check_announcement_attachment()', 'ann_react(uuid,text)', 'ann_feed(timestamptz,integer)',
    'ann_file_read_ok(text)', 'ann_file_upload_ok(text)', 'gcal_event_id(uuid)', 'gcal_queue_schedule()', 'gcal_claim(integer)', 'gcal_record(uuid,boolean,text)',
    'gcal_retry_failed()', 'gcal_queue_all_future()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['chat_file_problem(text,bigint)', 'chat_display_name(uuid)', 'chat_role_class(uuid)', 'chat_can_dm(uuid,uuid)', 'chat_start_dm(uuid)',
    'chat_create_group(text,uuid[])', 'chat_add_members(uuid,uuid[])', 'chat_remove_member(uuid,uuid)', 'chat_rename_group(uuid,text)', 'chat_contacts(text)',
    'chat_allowed_emoji(text)', 'chat_inbox()', 'chat_messages(uuid,timestamptz,integer)', 'chat_search(text)', 'chat_read_state(uuid)', 'chat_react(uuid,text)',
    'ann_can_target(text,uuid,uuid)', 'ann_visible(announcements)', 'ann_react(uuid,text)', 'ann_feed(timestamptz,integer)', 'ann_file_read_ok(text)',
    'ann_file_upload_ok(text)', 'gcal_retry_failed()', 'gcal_queue_all_future()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- queue processing is for the Edge Function (service role) only
  revoke all on function public.gcal_claim(integer), public.gcal_record(uuid, boolean, text), public.chat_notify(uuid, text, text, text, text, uuid, text) from authenticated;
end $fn$;

-- =====================================================================================================================
-- 9. Self-check: refuse (and change nothing) if the result is not as intended
-- =====================================================================================================================
do $check$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
    and c.relname in ('chat_file_rules', 'connect_members', 'connect_reactions', 'announcement_attachments', 'announcement_reactions', 'gcal_events');
  if bad is not null then raise exception 'Row Level Security missing on: %', bad; end if;
  if exists (select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon') then
    raise exception 'signed-out visitors would have table access';
  end if;
  if exists (select 1 from information_schema.table_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
             and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
             and table_name in ('chat_file_rules', 'connect_members', 'connect_reactions', 'announcement_attachments', 'announcement_reactions', 'gcal_events')) then
    raise exception 'TRUNCATE/REFERENCES/TRIGGER granted on a new table';
  end if;
  select string_agg(tp.table_name || '.' || tp.privilege_type, ', ') into bad from information_schema.table_privileges tp
    join pg_class c on c.relname = tp.table_name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')   -- views have no policies
   where tp.table_schema = 'public' and tp.grantee = 'authenticated'
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = tp.table_name and p.permissive = 'PERMISSIVE'
                     and p.roles && array['authenticated', 'public']::name[] and (p.cmd = 'ALL' or p.cmd = tp.privilege_type));
  if bad is not null then raise exception 'grants without a policy: %', bad; end if;
  if has_function_privilege('authenticated', 'public.gcal_claim(integer)', 'execute') or has_function_privilege('anon', 'public.chat_inbox()', 'execute') then
    raise exception 'function permissions are not as intended';
  end if;
end $check$;

select 'Chat, notification bell and Google Calendar sync are ready' as result,
       'Next: deploy the Edge Function google-calendar-sync (optional) and the website; run STEP-5 (expect READY)' as next_step;
