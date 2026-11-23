-- ROLLBACK for migration 29 (attachment virus checks). Back up first.
-- WARNING: after this rollback, files that were never scanned become downloadable again (the migration 25 behaviour).
-- Only roll back if you accept that, or first switch attachments off. Afterwards delete version 20260101000029 from
-- supabase_migrations.schema_migrations, and remove the scan-attachments Edge Function and its schedule.
begin;
drop function if exists connect_scan_queue();
drop function if exists connect_record_scan(uuid, text, text, text);
drop function if exists connect_claim_scans(int);
drop policy if exists cat_read on connect_attachments;
CREATE OR REPLACE FUNCTION public.connect_attachment_read_ok(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from connect_attachments a join connect_messages m on m.id = a.message_id
                 where a.storage_path = p_name and a.scan_status <> 'infected'
                   and ((m.hidden_at is null and connect_can_see(a.conversation_id))
                        or exists (select 1 from connect_oversight_log l where l.profile_id = auth.uid() and l.conversation_id = a.conversation_id
                                   and l.created_at > now() - interval '1 hour'))) $function$
;
CREATE OR REPLACE FUNCTION public.connect_thread_messages(p_conversation uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, sender_id uuid, sender_name text, sender_role text, body text, created_at timestamp with time zone, hidden boolean, mine boolean, attachments jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

create policy cat_read on connect_attachments for select to authenticated using (connect_attachment_read_ok(storage_path));
drop function if exists connect_attachment_visible(text);
drop trigger if exists trg_guard_connect_attachment_scan on connect_attachments;
drop function if exists guard_connect_attachment_scan();
drop table if exists connect_attachment_scans;
drop index if exists idx_connect_attach_pending;
update connect_attachments set scan_status = 'not_scanned' where scan_status in ('pending', 'scanning', 'scan_failed');
alter table connect_attachments drop constraint connect_attachments_scan_status_check;
alter table connect_attachments add constraint connect_attachments_scan_status_check check (scan_status in ('not_scanned', 'pending', 'clean', 'infected'));
alter table connect_attachments drop column if exists scan_attempts, drop column if exists scan_claimed_at, drop column if exists scanned_at,
  drop column if exists scan_engine, drop column if exists scan_detail;
commit;
