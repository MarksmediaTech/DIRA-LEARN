-- DIRA LEARN: assign work to individual learners (master instruction, Phase 2).
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- RULE: an assignment with NO recipient rows is for the whole cohort (or its track), exactly as today.
--       An assignment WITH recipient rows is for those learners only: other learners cannot see it, cannot submit to it,
--       and are not counted as missing it. Existing assignments are unaffected (they have no recipient rows).
-- Learners still only see their own submissions, feedback and grades (unchanged policies). Access windows from migrations 18 and 19 still apply.

create table assignment_recipients (
  assignment_id uuid not null references assignments(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (assignment_id, participant_id)
);
create index idx_assignment_recipients_participant on assignment_recipients (participant_id);
create trigger aud_assignment_recipients after insert or update or delete on assignment_recipients for each row execute function audit_row();

-- A recipient must be enrolled in the assignment's cohort (and on its track, if it has one). Work already submitted cannot be unassigned.
create or replace function guard_assignment_recipient() returns trigger language plpgsql security definer set search_path = public as $$
declare a assignments;
begin
  if tg_op = 'INSERT' then
    select * into a from assignments where id = new.assignment_id;
    if not found then raise exception 'Assignment not found'; end if;
    if not exists (select 1 from cohort_enrolments e where e.participant_id = new.participant_id and e.cohort_id = a.cohort_id
                   and (a.track_id is null or e.track_id = a.track_id)) then
      raise exception 'That learner is not enrolled for this assignment';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from submissions s where s.assignment_id = old.assignment_id and s.participant_id = old.participant_id)
       and exists (select 1 from assignments a2 where a2.id = old.assignment_id) then
      raise exception 'This learner has already submitted, so the assignment cannot be taken away';
    end if;
    return old;
  end if;
  raise exception 'Recipients cannot be edited; add or remove them';
end $$;
create trigger trg_guard_assignment_recipient before insert or update or delete on assignment_recipients for each row execute function guard_assignment_recipient();

alter table assignment_recipients enable row level security;
-- Read: staff, M&E, the trainer of that cohort, and the learner for their own rows only.
create policy arc_read on assignment_recipients for select to authenticated using (
  is_staff() or app_role() = 'me_officer' or participant_id = my_participant_id()
  or exists (select 1 from assignments a where a.id = assignment_id and a.cohort_id in (select my_trainer_cohorts())));
-- Write: staff, and the trainer of that cohort. Learners can never add themselves.
create policy arc_insert on assignment_recipients for insert to authenticated with check (
  is_staff() or exists (select 1 from assignments a where a.id = assignment_id and a.cohort_id in (select my_trainer_cohorts())));
create policy arc_delete on assignment_recipients for delete to authenticated using (
  is_staff() or exists (select 1 from assignments a where a.id = assignment_id and a.cohort_id in (select my_trainer_cohorts())));

-- Hide an individual assignment from every learner who is not a recipient. Restrictive: it can only narrow existing access.
create or replace function assignment_visible_to_me(p_assignment uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case when app_role() = 'participant' then
    (not exists (select 1 from assignment_recipients r where r.assignment_id = p_assignment)
     or exists (select 1 from assignment_recipients r where r.assignment_id = p_assignment and r.participant_id = my_participant_id()))
  else true end $$;
revoke all on function assignment_visible_to_me(uuid) from public, anon;
grant execute on function assignment_visible_to_me(uuid) to authenticated;

create policy assignments_recipient_scope on assignments as restrictive for select to authenticated using ((select assignment_visible_to_me(id)));

-- ============ existing functions, rewritten from their stored source (abort if the expected text is missing) ============
do $$
declare r record; def text; newdef text;
begin
  for r in
    select * from (values
      -- submitting: a learner who was not chosen cannot submit
      ('guard_submission()',
       E'raise exception ''You are not enrolled for this assignment'';\n    end if;',
       E'raise exception ''You are not enrolled for this assignment'';\n    end if;\n' ||
       E'    if exists (select 1 from assignment_recipients r where r.assignment_id = a.id)\n' ||
       E'       and not exists (select 1 from assignment_recipients r where r.assignment_id = a.id and r.participant_id = new.participant_id) then\n' ||
       E'      raise exception ''This assignment was not assigned to you'';\n    end if;'),
      -- deadline reminders: only remind the chosen learners
      ('queue_reminders()',
       'and not exists (select 1 from submissions sb where sb.assignment_id = a.id and sb.participant_id = pa.id)',
       'and not exists (select 1 from submissions sb where sb.assignment_id = a.id and sb.participant_id = pa.id)' || E'\n      ' ||
       'and (not exists (select 1 from assignment_recipients ar where ar.assignment_id = a.id) or exists (select 1 from assignment_recipients ar where ar.assignment_id = a.id and ar.participant_id = pa.id))')
    ) as t(sig, old_txt, new_txt)
  loop
    def := pg_get_functiondef(('public.' || r.sig)::regprocedure);
    newdef := replace(def, r.old_txt, r.new_txt);
    if newdef = def then raise exception 'Migration 20: expected text not found in function %, nothing was changed', r.sig; end if;
    execute newdef;
  end loop;
end $$;
