-- ROLLBACK for migration 025. Run in the Supabase SQL editor ONLY if migration 025 must be undone, newest migration first
-- (26, then 25, then 24). Back up the database first. Afterwards delete version 20260101000025 from
-- supabase_migrations.schema_migrations so `supabase db push` can apply it again later.
-- This rollback REFUSES to run while safeguarding-team conversations or attachments exist, because undoing it would delete them.
-- Export and deal with that data first (it may be safeguarding evidence and fall under a legal hold).
begin;
do $$ begin
  if exists (select 1 from connect_conversations where kind = 'safeguarding') then
    raise exception 'Rollback 25 stopped: safeguarding-team conversations exist. Export them and agree what to do with the Safeguarding Lead first';
  end if;
  if exists (select 1 from connect_attachments) or exists (select 1 from storage.objects where bucket_id = 'connect-attachments') then
    raise exception 'Rollback 25 stopped: DIRA Connect attachments exist. Export them first';
  end if;
end $$;
drop policy if exists connect_attach_upload on storage.objects;
drop policy if exists connect_attach_read on storage.objects;
do $$ begin
  delete from storage.buckets where id = 'connect-attachments';
exception when others then
  raise notice 'Could not remove the empty connect-attachments bucket here (%). Delete it in Supabase Storage instead.', sqlerrm;
end $$;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'connect_attachments') then
    alter publication supabase_realtime drop table connect_attachments;
  end if;
end $$;
drop table if exists connect_attachments;
drop table if exists connect_retention_log;
drop table if exists connect_legal_holds;
drop table if exists connect_retention_settings;
drop function if exists connect_my_learners();
drop function if exists connect_start_direct_with_learner(uuid);
drop function if exists connect_my_support();
drop function if exists connect_start_safeguarding();
drop function if exists connect_attachment_upload_ok(text);
drop function if exists connect_attachment_read_ok(text);
drop function if exists guard_connect_attachment();
drop function if exists connect_allowed_mime(text);
drop function if exists guard_connect_retention_settings();
drop function if exists connect_place_hold(uuid, uuid, uuid, text);
drop function if exists connect_release_hold(uuid, text);
drop function if exists connect_retention_status();
drop function if exists connect_retention_purge();
drop function if exists connect_retention_candidates();
drop function if exists connect_thread_messages(uuid, timestamptz, int);
-- previous definitions (as left by migrations 22 and 23)
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
      else
        (app_role() = 'trainer' and c.cohort_id in (select my_trainer_cohorts()))
        or (app_role() = 'participant' and exists (select 1 from cohort_enrolments e where e.cohort_id = c.cohort_id and e.participant_id = my_participant_id()))
    end
    from connect_conversations c where c.id = p_conv), false) $function$
;
CREATE OR REPLACE FUNCTION public.connect_can_see(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when app_role() = 'participant' then connect_is_member(p_conv) and participant_access_active()
      when connect_is_member(p_conv) then true
      else c.kind = 'cohort' and connect_is_discussion_overseer()
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
    select not c.locked and app_role() in ('participant', 'trainer') and connect_is_member(p_conv)
       and (app_role() <> 'participant' or participant_access_active())
       and (c.kind = 'direct' or not exists (select 1 from connect_mutes m where m.profile_id = auth.uid() and m.until > now()))
    from connect_conversations c where c.id = p_conv), false) $function$
;
CREATE OR REPLACE FUNCTION public.connect_my_facilitators()
 RETURNS TABLE(profile_id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct p.id, btrim(p.first_name || ' ' || p.last_name)
  from cohort_enrolments e join trainer_assignments ta on ta.cohort_id = e.cohort_id join profiles p on p.id = ta.trainer_id
  where app_role() = 'participant' and participant_access_active() and e.participant_id = my_participant_id() and p.role = 'trainer' and p.status = 'active' $function$
;
CREATE OR REPLACE FUNCTION public.connect_start_direct(p_facilitator uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.connect_threads()
 RETURNS TABLE(conversation_id uuid, kind text, title text, subtitle text, last_message_at timestamp with time zone, unread bigint, locked boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  order by c.last_message_at desc nulls last, c.created_at desc $function$
;
CREATE OR REPLACE FUNCTION public.connect_thread_messages(p_conversation uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, sender_id uuid, sender_name text, sender_role text, body text, created_at timestamp with time zone, hidden boolean, mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.after_connect_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.connect_report_message(p_message uuid, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m connect_messages;
begin
  select * into m from connect_messages where id = p_message;
  if not found or not connect_is_member(m.conversation_id) or not connect_can_see(m.conversation_id) then raise exception 'You can only report messages in your own conversations'; end if;
  if m.sender_id = auth.uid() then raise exception 'You cannot report your own message'; end if;
  insert into connect_reports(message_id, conversation_id, reporter_id, reason, note, snapshot_body, snapshot_sender)
  values (m.id, m.conversation_id, auth.uid(), p_reason, nullif(btrim(coalesce(p_note, '')), ''), m.body, m.sender_id)
  on conflict (message_id, reporter_id) do nothing;
end $function$
;
CREATE OR REPLACE FUNCTION public.block_connect_message_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin raise exception 'Messages cannot be deleted'; end $function$
;
revoke all on function connect_thread_messages(uuid, timestamptz, int) from public, anon;
grant execute on function connect_thread_messages(uuid, timestamptz, int) to authenticated;
drop index if exists uq_connect_safeguarding;
alter table connect_conversations drop constraint connect_conv_shape;
alter table connect_conversations drop constraint connect_conversations_kind_check;
alter table connect_conversations add constraint connect_conversations_kind_check check (kind in ('direct', 'cohort'));
alter table connect_conversations add constraint connect_conv_shape check (
    (kind = 'cohort' and cohort_id is not null and learner_id is null and facilitator_id is null) or
    (kind = 'direct' and learner_id is not null and facilitator_id is not null and cohort_id is null));
alter table connect_conversations drop column if exists started_by;
commit;
