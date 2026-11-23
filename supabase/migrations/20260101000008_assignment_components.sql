-- DIRA LEARN: tag each assignment with the assessment component it feeds.
-- STATUS: written, NOT yet executed. Run `supabase db reset` and `supabase test db` and fix any errors.
-- The component decides where a graded score counts in the (unapproved, draft) weighted result:
--   task          -> "Session tasks and portfolio" (30% draft)
--   final_project -> "Final track project/demonstration" (40% draft)
--   reflection    -> "Reflection and next-step plan" (10% draft)
-- Engagement (20% draft) comes from attendance, not from an assignment.
alter table assignments add column if not exists component text not null default 'task'
  check (component in ('task', 'final_project', 'reflection'));

-- Once work has been handed in, changing the component would silently change people's results.
create or replace function guard_assignment_component() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.component is distinct from old.component
     and exists (select 1 from submissions s where s.assignment_id = old.id) then
    raise exception 'The assessment component cannot change once submissions exist';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_assignment_component on assignments;
create trigger trg_guard_assignment_component before update on assignments for each row execute function guard_assignment_component();
