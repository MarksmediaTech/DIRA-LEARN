-- DIRA LEARN - UNDO of 20261122000002_chat_notifications_calendar.sql. Returns the database to its state before that change.
-- One transaction. Run it in the SQL Editor only after deploying the previous website and Edge Functions.
-- It REFUSES (and changes nothing) while data created by the change exists - one-to-one and group conversations, reactions,
-- announcement files, track announcements, Google Calendar sync rows - unless you edit the line below to accept deleting it.
-- Files in the 'announcement-files' bucket must be deleted in the Dashboard (Storage) first: the database does not delete stored files.
do $rollback$
declare
  v_confirm text := 'NO';   -- change to 'DELETE CHAT DATA' to accept deleting the data listed above
  n bigint;
begin
  if pg_catalog.to_regclass('public.connect_members') is null then raise notice 'The Chat change is not applied: nothing to undo.'; return; end if;
  if exists (select 1 from storage.objects where bucket_id = 'announcement-files') then
    raise exception 'STOP: the announcement-files bucket still contains files. Delete them in the Dashboard (Storage) first. Nothing was changed.';
  end if;
  select (select count(*) from connect_conversations where kind in ('dm', 'group')) + (select count(*) from connect_reactions)
       + (select count(*) from announcement_reactions) + (select count(*) from announcement_attachments)
       + (select count(*) from announcements where audience = 'track') + (select count(*) from connect_attachments where size_bytes > 10485760 or mime_type not in
         ('application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
    into n;
  if n > 0 and v_confirm <> 'DELETE CHAT DATA' then
    raise exception 'STOP: % row(s) were created with the Chat change (conversations, reactions, files, track announcements). Nothing was changed.', n;
  end if;
end $rollback$;

do $undo$
begin
  if pg_catalog.to_regclass('public.connect_members') is null then return; end if;
  -- data that only exists with the change (allowed above)
  delete from public.connect_attachments where size_bytes > 10485760 or mime_type not in
    ('application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  alter table public.connect_messages disable trigger trg_connect_message_no_delete;
  delete from public.connect_conversations where kind in ('dm', 'group');
  alter table public.connect_messages enable trigger trg_connect_message_no_delete;
  delete from public.announcements where audience = 'track';
end $undo$;

-- Realtime
do $rt$
declare t text;
begin
  foreach t in array array['notifications', 'connect_reactions', 'announcements', 'announcement_reactions', 'connect_members'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $rt$;

-- Google Calendar
drop trigger if exists trg_gcal_queue_schedule on public.session_schedules;
drop function if exists public.gcal_queue_all_future(), public.gcal_retry_failed(), public.gcal_record(uuid, boolean, text), public.gcal_claim(integer),
  public.gcal_queue_schedule(), public.gcal_event_id(uuid);
drop table if exists public.gcal_events;

-- Announcements
drop policy if exists "ann_files_read" on storage.objects;
drop policy if exists "ann_files_upload" on storage.objects;
drop policy if exists "ann_files_delete" on storage.objects;
delete from storage.buckets where id = 'announcement-files';
drop function if exists public.ann_feed(timestamptz, integer), public.ann_react(uuid, text), public.ann_file_read_ok(text), public.ann_file_upload_ok(text);
drop table if exists public.announcement_reactions, public.announcement_attachments;
drop function if exists public.chat_check_announcement_attachment();
drop trigger if exists trg_announcement_update_notify on public.announcements;
drop trigger if exists trg_guard_announcement_update on public.announcements;
drop function if exists public.announcement_update_notify(), public.guard_announcement_update();
drop policy if exists ann_read on public.announcements;
drop policy if exists ann_insert on public.announcements;
drop policy if exists ann_update on public.announcements;
drop policy if exists ann_delete on public.announcements;
create policy ann_insert on public.announcements as PERMISSIVE for INSERT to authenticated  with check (is_staff());
create policy ann_read on public.announcements as PERMISSIVE for SELECT to authenticated using (((cohort_id IS NULL) OR is_staff() OR (cohort_id IN ( SELECT my_trainer_cohorts() AS my_trainer_cohorts)) OR (cohort_id IN ( SELECT cohort_enrolments.cohort_id
   FROM cohort_enrolments
  WHERE (cohort_enrolments.participant_id = my_participant_id()))))) ;
revoke update, delete on public.announcements from authenticated;
drop index if exists public.announcements_created_idx;
alter table public.announcements drop constraint if exists announcements_audience_check, drop constraint if exists announcements_title_len,
  drop constraint if exists announcements_body_len;
alter table public.announcements drop column if exists audience, drop column if exists track_id, drop column if exists pinned,
  drop column if exists updated_at, drop column if exists edited_at;

-- Messages, conversations
drop function if exists public.chat_react(uuid, text), public.chat_read_state(uuid), public.chat_search(text), public.chat_messages(uuid, timestamptz, integer),
  public.chat_inbox(), public.chat_contacts(text), public.chat_rename_group(uuid, text), public.chat_remove_member(uuid, uuid),
  public.chat_add_members(uuid, uuid[]), public.chat_create_group(text, uuid[]), public.chat_start_dm(uuid);
drop trigger if exists trg_after_connect_reaction on public.connect_reactions;
drop table if exists public.connect_reactions;
drop function if exists public.after_connect_reaction();
drop trigger if exists trg_chat_check_reply on public.connect_messages;
drop function if exists public.chat_check_reply();
alter table public.connect_messages drop column if exists reply_to;
drop policy if exists cmem_read on public.connect_members;

-- original functions (as before the change; their permissions were never changed)
CREATE OR REPLACE FUNCTION public.connect_allowed_mime(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p in ('application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') $function$
;
CREATE OR REPLACE FUNCTION public.guard_connect_attachment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.scanned_bucket(p_bucket text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_bucket in ('application-documents', 'submissions', 'project-evidence', 'course-materials', 'learning-resources') $function$
;
CREATE OR REPLACE FUNCTION public.guard_notification_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.title is distinct from old.title
     or new.body is distinct from old.body or new.created_at is distinct from old.created_at then
    raise exception 'Only the read time of a notification can be changed';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.connect_is_member(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from connect_conversations c where c.id = p_conv), false) $function$
;
CREATE OR REPLACE FUNCTION public.connect_can_post(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select not c.locked and connect_is_member(p_conv) and case c.kind
      when 'cohort' then app_role() in ('participant', 'trainer')
        and (app_role() <> 'participant' or learner_access_state(my_participant_id(), c.cohort_id) = 'active')
        and not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now())
      when 'direct' then app_role() in ('participant', 'trainer')
      else true end
    from connect_conversations c where c.id = p_conv), false) $function$
;
CREATE OR REPLACE FUNCTION public.after_connect_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.announcement_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

drop table if exists public.connect_members;
drop function if exists public.chat_can_dm(uuid, uuid), public.chat_role_class(uuid);
drop index if exists public.uq_connect_dm;
alter table public.connect_conversations drop constraint if exists connect_conversations_title_check, drop constraint connect_conv_shape,
  drop constraint connect_conversations_kind_check;
alter table public.connect_conversations drop column if exists title, drop column if exists dm_key;
alter table public.connect_conversations add constraint connect_conversations_kind_check CHECK ((kind = ANY (ARRAY['direct'::text, 'cohort'::text, 'safeguarding'::text])));
alter table public.connect_conversations add constraint connect_conv_shape CHECK ((((kind = 'cohort'::text) AND (cohort_id IS NOT NULL) AND (learner_id IS NULL) AND (facilitator_id IS NULL)) OR ((kind = 'direct'::text) AND (learner_id IS NOT NULL) AND (facilitator_id IS NOT NULL) AND (cohort_id IS NULL)) OR ((kind = 'safeguarding'::text) AND (learner_id IS NOT NULL) AND (facilitator_id IS NULL) AND (cohort_id IS NULL))));

-- notifications
drop index if exists public.notifications_one_unread_per_key;
drop index if exists public.notifications_user_created_idx;
alter table public.notifications drop constraint if exists notifications_link_check;
alter table public.notifications drop column if exists link, drop column if exists actor_id, drop column if exists dedupe_key;
drop function if exists public.chat_notify(uuid, text, text, text, text, uuid, text), public.chat_display_name(uuid), public.chat_allowed_emoji(text);

-- files
drop trigger if exists trg_chat_check_attachment on public.connect_attachments;
drop function if exists public.chat_check_attachment();
alter table public.connect_attachments drop constraint connect_attachments_size_bytes_check;
alter table public.connect_attachments add constraint connect_attachments_size_bytes_check CHECK (((size_bytes >= 1) AND (size_bytes <= 10485760)));
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'] where id = 'connect-attachments';
drop function if exists public.chat_file_problem(text, bigint);
drop table if exists public.chat_file_rules;
drop function if exists public.ann_audience_ids(public.announcements), public.ann_visible(public.announcements), public.ann_can_target(text, uuid, uuid);

select 'The Chat, notification bell and Google Calendar change has been undone' as result;
