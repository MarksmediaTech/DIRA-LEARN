-- ROLLBACK for migration 024. Run in the Supabase SQL editor ONLY if migration 024 must be undone, newest migration first
-- (26, then 25, then 24). Back up the database first. Afterwards delete version 20260101000024 from
-- supabase_migrations.schema_migrations so `supabase db push` can apply it again later.
-- WARNING: this removes the safeguarding officer positions, the record history (safeguarding_actions), access grants and
-- access logs, and the new columns on safeguarding_records (urgency, acknowledgement, resolution, legal hold, copies of
-- reported messages). EXPORT those tables first. Records themselves are kept; their new statuses are mapped back
-- (acknowledged / in progress / referred -> under review; resolved -> closed). Executives regain read access to records.
begin;
drop trigger if exists trg_route_safety_report on connect_reports;
drop function if exists route_safety_report();
drop function if exists connect_handle_report(uuid, text, text, text);
drop function if exists sg_escalate_report(uuid, text, text, text);
drop function if exists connect_oversight_read(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.connect_handle_report(p_report uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.connect_oversight_read(p_conversation uuid, p_reason text)
 RETURNS TABLE(id uuid, sender_name text, body text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from connect_oversight o where o.profile_id = auth.uid() and o.scope = 'private') then
    raise exception 'You have not been granted private conversation oversight';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'A written reason of at least 10 characters is required'; end if;
  if not exists (select 1 from connect_conversations c where c.id = p_conversation and c.kind = 'direct') then raise exception 'Not a private conversation'; end if;
  insert into connect_oversight_log(profile_id, conversation_id, reason) values (auth.uid(), p_conversation, btrim(p_reason));
  return query select m.id, btrim(pr.first_name || ' ' || pr.last_name), m.body, m.created_at
    from connect_messages m join profiles pr on pr.id = m.sender_id where m.conversation_id = p_conversation order by m.created_at desc limit 200;
end $function$
;
CREATE OR REPLACE FUNCTION public.guard_connect_oversight()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r role_code;
begin
  select role into r from profiles where id = new.profile_id;
  if r is null or r not in ('super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator') then
    raise exception 'Oversight can only be granted to executives and programme staff';
  end if;
  new.granted_by := coalesce(auth.uid(), new.granted_by);
  return new;
end $function$
;
revoke all on function connect_handle_report(uuid, text, text), connect_oversight_read(uuid, text) from public, anon;
grant execute on function connect_handle_report(uuid, text, text), connect_oversight_read(uuid, text) to authenticated;
alter table connect_oversight_log drop column if exists safeguarding_record_id, drop column if exists basis;

drop trigger if exists trg_log_safeguarding on safeguarding_records;
drop trigger if exists trg_safeguarding_no_delete on safeguarding_records;
drop policy if exists sg_officer_read on safeguarding_records;
drop policy if exists sg_officer_insert on safeguarding_records;
drop policy if exists sg_officer_update on safeguarding_records;
create policy safe_admin_read on safeguarding_records for select to authenticated using (is_executive());
create policy safe_admin_insert on safeguarding_records for insert to authenticated with check (is_executive());
create policy safe_admin_update on safeguarding_records for update to authenticated using (is_executive()) with check (is_executive());
CREATE OR REPLACE FUNCTION public.guard_safeguarding()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then new.reported_by := coalesce(auth.uid(), new.reported_by);
  else new.reported_by := old.reported_by; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $function$
;
alter table safeguarding_records disable trigger trg_guard_safeguarding;
update safeguarding_records set status = case when status in ('resolved') then 'closed' when status in ('acknowledged', 'in_progress', 'referred') then 'under_review' else status end
 where status not in ('open', 'under_review', 'closed');
alter table safeguarding_records enable trigger trg_guard_safeguarding;
alter table safeguarding_records drop constraint chk_safeguarding_status;
alter table safeguarding_records add constraint chk_safeguarding_status check (status in ('open', 'under_review', 'closed'));
drop index if exists idx_sg_records_status;
drop index if exists idx_sg_records_conversation;
drop table if exists safeguarding_access_log;
drop table if exists safeguarding_actions;
drop table if exists safeguarding_access_grants;
drop table if exists safeguarding_officer_history;
drop table if exists safeguarding_settings;
drop table if exists safeguarding_officers;
alter table safeguarding_records drop column if exists urgency, drop column if exists source, drop column if exists source_report_id,
  drop column if exists conversation_id, drop column if exists reported_message, drop column if exists reported_sender,
  drop column if exists ack_due_at, drop column if exists acknowledged_at, drop column if exists acknowledged_by,
  drop column if exists responsible_officer, drop column if exists resolution, drop column if exists resolved_at,
  drop column if exists legal_hold, drop column if exists legal_hold_reason, drop column if exists retention_review_on,
  drop column if exists overdue_alerted_at;
drop function if exists sg_my_position() cascade;
drop function if exists is_safeguarding_officer() cascade;
drop function if exists sg_acting_officer() cascade;
drop function if exists sg_is_acting_lead();
drop function if exists sg_officer_ids();
drop function if exists sg_notify(uuid, text);
drop function if exists sg_appoint(text, uuid, text);
drop function if exists sg_remove_officer(text, text);
drop function if exists sg_set_unavailable(timestamptz, text);
drop function if exists sg_officers();
drop function if exists sg_waiting_without_officer();
drop function if exists sg_raise_concern(uuid, text, text);
drop function if exists sg_grant_exceptional_access(uuid, int, text);
drop function if exists sg_revoke_exceptional_access(uuid);
drop function if exists sg_exceptional_read(uuid, text);
drop function if exists sg_exceptional_index();
drop function if exists sg_overdue_check();
drop function if exists log_safeguarding_change();
drop function if exists block_safeguarding_delete();
drop function if exists guard_safeguarding_action();
delete from email_templates where key = 'safeguarding_alert' and is_system;
commit;
