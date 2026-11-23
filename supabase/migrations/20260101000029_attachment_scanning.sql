-- DIRA LEARN: secure attachments – no download until a virus scanner has marked the file clean.
-- STATUS: executed and tested locally (PostgreSQL 16 + Supabase stand-in). NOT applied to any Supabase project.
-- Rollback: supabase/rollback/20260101000029_attachment_scanning_down.sql
--
-- WHAT CHANGES
--   * Every new attachment starts as 'pending' (waiting for a virus check). Members of the conversation can SEE that a file
--     was shared (name, type, size, status), but NOBODY can download it until a scanner marks it 'clean'.
--     That includes the uploader, moderators, oversight readers and safeguarding officers.
--   * Files that are 'infected' are hidden from everyone. Files whose scan failed 3 times become 'scan_failed' (not downloadable).
--   * Existing 'not_scanned' files (from migration 25) are no longer downloadable either. They are queued for scanning.
--   * The scan-attachments Edge Function (service role only) claims pending files, sends them to the scanner chosen by DIRA,
--     and records the result. If no scanner is configured it does nothing, so files simply stay unavailable.
--   * Every scan result is logged (connect_attachment_scans).

alter table connect_attachments drop constraint if exists connect_attachments_scan_status_check;
alter table connect_attachments add constraint connect_attachments_scan_status_check
  check (scan_status in ('not_scanned', 'pending', 'scanning', 'clean', 'infected', 'scan_failed'));
alter table connect_attachments
  add column scan_attempts int not null default 0,
  add column scan_claimed_at timestamptz,
  add column scanned_at timestamptz,
  add column scan_engine text,
  add column scan_detail text;
update connect_attachments set scan_status = 'pending' where scan_status = 'not_scanned';
create index idx_connect_attach_pending on connect_attachments (created_at) where scan_status in ('pending', 'scanning');

create table connect_attachment_scans (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references connect_attachments(id) on delete cascade,
  result text not null check (result in ('clean', 'infected', 'error')),
  engine text, detail text check (detail is null or length(detail) <= 500),
  created_at timestamptz not null default now()
);
alter table connect_attachment_scans enable row level security;
create policy cas_read on connect_attachment_scans for select to authenticated using (is_executive() or connect_is_moderator());

-- New attachments always start pending; users cannot choose their own scan status.
create or replace function guard_connect_attachment_scan() returns trigger language plpgsql as $$
begin
  if not is_trusted_session() then
    new.scan_status := 'pending'; new.scan_attempts := 0; new.scan_claimed_at := null; new.scanned_at := null; new.scan_engine := null; new.scan_detail := null;
  end if;
  return new;
end $$;
-- named to run after trg_guard_connect_attachment (which still sets 'not_scanned'); this one has the final say
create trigger trg_guard_connect_attachment_scan before insert on connect_attachments for each row execute function guard_connect_attachment_scan();

-- Listing: members see that a file exists (and its status) unless it is infected or its message is hidden.
create or replace function connect_attachment_visible(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from connect_attachments a join connect_messages m on m.id = a.message_id
                 where a.storage_path = p_name and a.scan_status <> 'infected'
                   and ((m.hidden_at is null and connect_can_see(a.conversation_id))
                        or exists (select 1 from connect_oversight_log l where l.profile_id = auth.uid() and l.conversation_id = a.conversation_id
                                   and l.created_at > now() - interval '1 hour'))) $$;
-- Downloading: as above, AND the file must have been scanned clean.
create or replace function connect_attachment_read_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select connect_attachment_visible(p_name) and exists (select 1 from connect_attachments a where a.storage_path = p_name and a.scan_status = 'clean') $$;
revoke all on function connect_attachment_visible(text) from public, anon;
grant execute on function connect_attachment_visible(text) to authenticated;

drop policy if exists cat_read on connect_attachments;
create policy cat_read on connect_attachments for select to authenticated using (connect_attachment_visible(storage_path));
-- (storage policy connect_attach_read already calls connect_attachment_read_ok, which now requires 'clean')

-- Thread messages list attachments with their status (infected ones are left out, as before).
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
             select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'path', a.storage_path, 'mime', a.mime_type, 'size', a.size_bytes,
                    'scan', case when a.scan_status = 'not_scanned' then 'pending' else a.scan_status end) order by a.created_at)
             from connect_attachments a where a.message_id = m.id and a.scan_status <> 'infected'), '[]'::jsonb) end
    from connect_messages m join profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation and (p_before is null or m.created_at < p_before)
    order by m.created_at desc, m.id desc limit least(greatest(p_limit, 1), 100);
end $$;

-- ============ the scan job (service role only) ============
-- Claim up to p_limit files to scan. A claim older than 15 minutes is treated as abandoned and can be claimed again.
create or replace function connect_claim_scans(p_limit int default 10)
returns table(attachment_id uuid, storage_path text, file_name text, mime_type text, size_bytes bigint) language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select a.id from connect_attachments a
    where a.scan_status = 'pending' or (a.scan_status = 'scanning' and a.scan_claimed_at < now() - interval '15 minutes')
    order by a.created_at limit greatest(1, least(p_limit, 50)) for update skip locked)
  update connect_attachments a set scan_status = 'scanning', scan_claimed_at = now(), scan_attempts = a.scan_attempts + 1
  from c where a.id = c.id
  returning a.id, a.storage_path, a.file_name, a.mime_type, a.size_bytes;
end $$;

-- Record a result. 'error' puts the file back in the queue, or marks it scan_failed after 3 attempts.
create or replace function connect_record_scan(p_attachment uuid, p_result text, p_engine text default null, p_detail text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a connect_attachments; final text;
begin
  if p_result not in ('clean', 'infected', 'error') then raise exception 'Result must be clean, infected or error'; end if;
  select * into a from connect_attachments where id = p_attachment for update;
  if not found then raise exception 'Attachment not found'; end if;
  final := case p_result when 'error' then (case when a.scan_attempts >= 3 then 'scan_failed' else 'pending' end) else p_result end;
  update connect_attachments set scan_status = final, scanned_at = case when p_result = 'error' then scanned_at else now() end,
         scan_engine = coalesce(left(p_engine, 100), scan_engine), scan_detail = left(p_detail, 500), scan_claimed_at = null where id = p_attachment;
  insert into connect_attachment_scans(attachment_id, result, engine, detail) values (p_attachment, p_result, left(p_engine, 100), left(p_detail, 500));
  if final = 'infected' then
    -- the sender is told their file was blocked; moderators can see it in the scan log
    insert into notifications(user_id, kind, title, body) values (a.uploaded_by, 'message', 'A file you shared was blocked', 'Our virus check found a problem with ' || left(a.file_name, 100) || '. It cannot be opened.');
  end if;
  return final;
end $$;

-- Executives and moderators see how many files are waiting (to notice when no scanner is configured).
create or replace function connect_scan_queue() returns table(pending int, scanning int, clean int, infected int, scan_failed int, oldest_pending timestamptz)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where scan_status in ('pending', 'not_scanned'))::int, count(*) filter (where scan_status = 'scanning')::int,
         count(*) filter (where scan_status = 'clean')::int, count(*) filter (where scan_status = 'infected')::int,
         count(*) filter (where scan_status = 'scan_failed')::int, min(created_at) filter (where scan_status in ('pending', 'not_scanned'))
  from connect_attachments where is_executive() or connect_is_moderator() $$;

revoke all on function connect_claim_scans(int), connect_record_scan(uuid, text, text, text), connect_scan_queue() from public, anon, authenticated;
grant execute on function connect_claim_scans(int), connect_record_scan(uuid, text, text, text) to service_role;
grant execute on function connect_scan_queue() to authenticated;
revoke all on function connect_thread_messages(uuid, timestamptz, int) from public, anon;
grant execute on function connect_thread_messages(uuid, timestamptz, int) to authenticated;
