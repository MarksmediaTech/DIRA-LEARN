-- DIRA LEARN: assignments, submissions and grading rules
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.

-- ---------- 1. Assignments ----------
-- max_score is optional: null means "feedback only, no mark".
alter table assignments add column if not exists max_score numeric(6,2) check (max_score is null or max_score > 0);

create or replace function guard_assignment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from submissions s where s.assignment_id = old.id) then
      raise exception 'This assignment already has submissions and cannot be deleted';
    end if;
    return old;
  end if;
  -- UPDATE: cohort and marking scale are locked once work has been handed in
  if exists (select 1 from submissions s where s.assignment_id = old.id)
     and (new.cohort_id <> old.cohort_id or new.max_score is distinct from old.max_score or new.track_id is distinct from old.track_id) then
    raise exception 'Cohort, track and maximum score cannot change once submissions exist';
  end if;
  new.created_by := old.created_by;
  return new;
end $$;
create trigger trg_guard_assignment before insert or update or delete on assignments for each row execute function guard_assignment();
create trigger aud_assignments after insert or update or delete on assignments for each row execute function audit_row();

-- ---------- 2. Submissions ----------
-- Participants insert their own work. The database decides the attempt number, the on-time/late status
-- and clears any grading fields, so none of it can be set from the browser.
create or replace function guard_submission() returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record; owner uuid; last_attempt int; last_status submission_status; newer boolean;
begin
  select * into a from assignments where id = new.assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from cohort_enrolments e where e.participant_id = new.participant_id and e.cohort_id = a.cohort_id
                   and (a.track_id is null or e.track_id = a.track_id)) then
      raise exception 'You are not enrolled for this assignment';
    end if;
    if coalesce(btrim(new.body), '') = '' and new.storage_path is null then
      raise exception 'Add your answer or attach a file';
    end if;
    if new.storage_path is not null then
      select profile_id into owner from participants where id = new.participant_id;
      if left(new.storage_path, 37) <> owner::text || '/' then raise exception 'Invalid file location'; end if;
    end if;

    select attempt, status into last_attempt, last_status from submissions
      where assignment_id = new.assignment_id and participant_id = new.participant_id order by attempt desc limit 1;
    if found then
      if not a.allow_resubmission then raise exception 'Resubmission is not allowed for this assignment'; end if;
      if last_status <> 'returned' then raise exception 'You can submit again only after your trainer returns your work'; end if;
      new.attempt := last_attempt + 1;
    else
      new.attempt := 1;
    end if;

    new.status := case when a.due_at is not null and now() > a.due_at then 'late' else 'submitted' end;
    new.submitted_at := now();
    new.feedback := null; new.score := null; new.graded_by := null;
    return new;
  end if;

  -- UPDATE (grading by a trainer or staff)
  if new.assignment_id <> old.assignment_id or new.participant_id <> old.participant_id or new.attempt <> old.attempt
     or new.body is distinct from old.body or new.storage_path is distinct from old.storage_path or new.submitted_at <> old.submitted_at then
    raise exception 'Submitted work cannot be changed';
  end if;
  if new.status is not distinct from old.status and new.score is not distinct from old.score and new.feedback is not distinct from old.feedback then
    return new;   -- nothing graded
  end if;

  select exists (select 1 from submissions s where s.assignment_id = new.assignment_id and s.participant_id = new.participant_id and s.attempt > new.attempt) into newer;
  if newer then raise exception 'Only the latest attempt can be graded'; end if;

  if new.status not in ('graded', 'returned') then raise exception 'Grade the work or return it for revision'; end if;
  if new.status = 'graded' then
    if a.max_score is null then
      if new.score is not null then raise exception 'This assignment has no marks; give feedback only'; end if;
    else
      if new.score is null then raise exception 'Enter a score'; end if;
      if new.score < 0 or new.score > a.max_score then raise exception 'Score must be between 0 and %', a.max_score; end if;
    end if;
  else  -- returned for revision
    if not a.allow_resubmission then raise exception 'This assignment does not allow resubmission'; end if;
    if coalesce(btrim(new.feedback), '') = '' then raise exception 'Say what needs to change before returning the work'; end if;
    if new.score is not null then raise exception 'A returned submission has no score yet'; end if;
  end if;
  new.graded_by := coalesce(auth.uid(), old.graded_by);
  return new;
end $$;
create trigger trg_guard_submission before insert or update on submissions for each row execute function guard_submission();
create trigger aud_submissions after insert or update or delete on submissions for each row execute function audit_row();

-- Trainers: read and grade only (the old policy allowed insert and delete as well). Staff may grade too.
drop policy if exists sub_trainer on submissions;
create policy sub_trainer_read on submissions for select to authenticated using (trainer_can_see_participant(participant_id));
create policy sub_grade on submissions for update to authenticated
  using (is_staff() or (app_role() = 'trainer' and trainer_can_see_participant(participant_id)))
  with check (is_staff() or (app_role() = 'trainer' and trainer_can_see_participant(participant_id)));
