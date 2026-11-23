-- DIRA LEARN: participant-facing learning resources
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.
--
-- Problems in the earlier policies, fixed here:
--  * participants could read EVERY resource, including trainer-only prep material;
--  * applicants could read core resources (the policy never checked the reader was a participant);
--  * any signed-in user could read any file in the learning-resources bucket;
--  * external_url accepted any text (for example a javascript: link).

-- 1. Trainers choose what participants see. Default is trainers-only so nothing is shared by accident.
alter table learning_resources add column if not exists visible_to_participants boolean not null default false;

-- NOT VALID: enforced for every new or changed row; existing rows (if any) are not re-checked.
alter table learning_resources add constraint chk_resource_url
  check (external_url is null or external_url ~* '^https?://[^[:space:]]+$') not valid;

create or replace function set_resource_uploader() returns trigger language plpgsql security definer set search_path = public as $$
begin new.uploaded_by := coalesce(auth.uid(), new.uploaded_by); return new; end $$;
create trigger trg_resource_uploader before insert on learning_resources for each row execute function set_resource_uploader();
create trigger aud_resources after insert or update or delete on learning_resources for each row execute function audit_row();

-- 2. Row access. Participants: shared items only, core or their own track, and not once withdrawn.
drop policy if exists res_read on learning_resources;
create policy res_read on learning_resources for select to authenticated using (
  is_staff() or app_role() in ('trainer', 'me_officer')
  or (app_role() = 'participant' and visible_to_participants
      and exists (select 1 from participants p where p.id = my_participant_id() and p.status <> 'withdrawn')
      and (track_id is null or track_id in (select e.track_id from cohort_enrolments e where e.participant_id = my_participant_id())))
);

-- 3. File access follows the row: a file can be read only if the caller can read its learning_resources row
-- (the subquery runs under the caller's own row-level security).
drop policy if exists storage_resources_read on storage.objects;
create policy storage_resources_read on storage.objects for select to authenticated using (
  bucket_id = 'learning-resources'
  and (is_staff() or app_role() in ('trainer', 'me_officer')
       or exists (select 1 from learning_resources r where r.storage_path = storage.objects.name))
);
