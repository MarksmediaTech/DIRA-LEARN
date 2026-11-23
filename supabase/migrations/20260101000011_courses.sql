-- DIRA LEARN: courses as a layer ON TOP of programmes, tracks, cohorts and curriculum sessions.
-- A course belongs to a programme and may optionally be tied to one track and/or one cohort. It does not replace or change
-- the curriculum, sessions, attendance or results; it adds modules, lessons, learning materials, enrolment and progress.
-- STATUS: written, NOT yet executed.

create type course_format as enum ('online', 'physical', 'hybrid', 'self_paced');
create type course_status as enum ('draft', 'published', 'archived');
create type lesson_kind as enum ('reading', 'pdf', 'presentation', 'video', 'link');

create table courses (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id),
  track_id uuid references tracks(id),
  cohort_id uuid references cohorts(id),
  title text not null check (length(trim(title)) between 3 and 160),
  summary text check (summary is null or length(summary) <= 2000),
  format course_format not null default 'online',
  status course_status not null default 'draft',
  starts_on date, ends_on date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create table course_trainers (
  course_id uuid not null references courses(id) on delete cascade,
  trainer_id uuid not null references profiles(id),
  primary key (course_id, trainer_id)
);
create table course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  position int not null default 0,
  title text not null check (length(trim(title)) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  created_at timestamptz not null default now()
);
create table course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_modules(id) on delete cascade,
  position int not null default 0,
  title text not null check (length(trim(title)) between 2 and 160),
  kind lesson_kind not null,
  body text check (body is null or length(body) <= 20000),
  storage_path text, external_url text, mime_type text,
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  created_at timestamptz not null default now(),
  check (
    (kind = 'reading' and body is not null and length(trim(body)) > 0)
    or (kind = 'link' and external_url ~ '^https?://')
    or (kind in ('pdf', 'presentation', 'video') and (storage_path is not null or external_url ~ '^https?://'))
  ),
  check (external_url is null or external_url ~ '^https?://')
);
create table course_enrolments (
  course_id uuid not null references courses(id) on delete cascade,
  participant_id uuid not null references participants(id),
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references profiles(id),
  primary key (course_id, participant_id)
);
create table lesson_progress (
  lesson_id uuid not null references course_lessons(id) on delete cascade,
  participant_id uuid not null references participants(id),
  completed_at timestamptz not null default now(),
  primary key (lesson_id, participant_id)
);
create index on course_modules(course_id, position);
create index on course_lessons(module_id, position);
create index on course_enrolments(participant_id);

-- ============ helper functions (security definer, so policies do not recurse) ============
create or replace function is_course_trainer(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_trainers where course_id = cid and trainer_id = auth.uid()) $$;
create or replace function course_of_module(mid uuid) returns uuid language sql stable security definer set search_path = public as $$
  select course_id from course_modules where id = mid $$;
create or replace function course_of_lesson(lid uuid) returns uuid language sql stable security definer set search_path = public as $$
  select m.course_id from course_lessons l join course_modules m on m.id = l.module_id where l.id = lid $$;
-- Participants see a course only while it is published and they are enrolled in it.
create or replace function participant_can_view_course(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_enrolments e join courses c on c.id = e.course_id
                 where e.course_id = cid and c.status = 'published' and e.participant_id = my_participant_id()) $$;
create or replace function can_view_course(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() or app_role() = 'me_officer' or is_course_trainer(cid) or participant_can_view_course(cid) $$;
create or replace function can_edit_course(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() or is_course_trainer(cid) $$;

-- ============ row-level security ============
alter table courses enable row level security;
alter table course_trainers enable row level security;
alter table course_modules enable row level security;
alter table course_lessons enable row level security;
alter table course_enrolments enable row level security;
alter table lesson_progress enable row level security;

create policy courses_read on courses for select to authenticated using (can_view_course(id) or created_by = auth.uid());
create policy courses_staff_write on courses for all to authenticated using (is_staff()) with check (is_staff());
-- Trainers may create courses (always as drafts, see guard) and edit the ones they are assigned to.
create policy courses_trainer_insert on courses for insert to authenticated with check (app_role() = 'trainer' and created_by = auth.uid());
create policy courses_trainer_update on courses for update to authenticated using (app_role() = 'trainer' and is_course_trainer(id)) with check (app_role() = 'trainer' and is_course_trainer(id));

create policy ctrainers_read on course_trainers for select to authenticated using (is_staff() or trainer_id = auth.uid() or app_role() = 'me_officer');
create policy ctrainers_write on course_trainers for all to authenticated using (is_staff()) with check (is_staff());

create policy cmodules_read on course_modules for select to authenticated using (can_view_course(course_id));
create policy cmodules_write on course_modules for all to authenticated using (can_edit_course(course_id)) with check (can_edit_course(course_id));
create policy clessons_read on course_lessons for select to authenticated using (can_view_course(course_of_module(module_id)));
create policy clessons_write on course_lessons for all to authenticated using (can_edit_course(course_of_module(module_id))) with check (can_edit_course(course_of_module(module_id)));

create policy cenrol_read on course_enrolments for select to authenticated using (is_staff() or app_role() = 'me_officer' or is_course_trainer(course_id) or participant_id = my_participant_id());
create policy cenrol_write on course_enrolments for all to authenticated using (is_staff()) with check (is_staff());

create policy lprog_read on lesson_progress for select to authenticated using (is_staff() or app_role() = 'me_officer' or is_course_trainer(course_of_lesson(lesson_id)) or participant_id = my_participant_id());
create policy lprog_self_insert on lesson_progress for insert to authenticated with check (participant_id = my_participant_id() and participant_can_view_course(course_of_lesson(lesson_id)));
create policy lprog_self_delete on lesson_progress for delete to authenticated using (participant_id = my_participant_id() and participant_can_view_course(course_of_lesson(lesson_id)));

-- ============ guards ============
create or replace function guard_course() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.status := 'draft';   -- every course starts as a draft; publishing is a separate step once it has lessons
  elsif app_role() = 'trainer' then
    if new.status is distinct from old.status then raise exception 'Only programme management can publish or archive a course'; end if;
    if new.programme_id is distinct from old.programme_id or new.cohort_id is distinct from old.cohort_id or new.track_id is distinct from old.track_id then
      raise exception 'Only programme management can move a course to another programme, track or cohort';
    end if;
  end if;
  if new.track_id is not null and not exists (select 1 from tracks where id = new.track_id and programme_id = new.programme_id) then raise exception 'The track belongs to a different programme'; end if;
  if new.cohort_id is not null and not exists (select 1 from cohorts where id = new.cohort_id and programme_id = new.programme_id) then raise exception 'The cohort belongs to a different programme'; end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') and not exists (select 1 from course_modules m join course_lessons l on l.module_id = m.id where m.course_id = new.id) and tg_op = 'UPDATE' then
    raise exception 'Add at least one lesson before publishing';
  end if;
  return new;
end $$;
create trigger trg_guard_course before insert or update on courses for each row execute function guard_course();

-- A trainer who creates a course is assigned to it automatically.
create or replace function course_creator_assigned() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null and exists (select 1 from profiles where id = new.created_by and role = 'trainer' and status = 'active') then
    insert into course_trainers(course_id, trainer_id) values (new.id, new.created_by) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_course_creator_assigned after insert on courses for each row execute function course_creator_assigned();

create or replace function guard_course_trainer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.trainer_id and role = 'trainer' and status = 'active') then raise exception 'Only an active trainer account can be assigned to a course'; end if;
  return new;
end $$;
create trigger trg_guard_course_trainer before insert on course_trainers for each row execute function guard_course_trainer();

create or replace function guard_course_enrolment() returns trigger language plpgsql security definer set search_path = public as $$
declare c courses; p participants; pu uuid;
begin
  select * into c from courses where id = new.course_id;
  if c.status = 'archived' then raise exception 'An archived course cannot take new enrolments'; end if;
  select * into p from participants where id = new.participant_id;
  if p.status = 'withdrawn' then raise exception 'A withdrawn participant cannot be enrolled'; end if;
  if c.cohort_id is not null and not exists (select 1 from cohort_enrolments where cohort_id = c.cohort_id and participant_id = new.participant_id) then
    raise exception 'This course is for one cohort and the participant is not enrolled in it';
  end if;
  if c.track_id is not null and not exists (select 1 from cohort_enrolments e join cohorts k on k.id = e.cohort_id where e.participant_id = new.participant_id and e.track_id = c.track_id and k.programme_id = c.programme_id) then
    raise exception 'This course is for one track and the participant has not chosen it';
  end if;
  new.enrolled_by := coalesce(auth.uid(), new.enrolled_by);
  select profile_id into pu from participants where id = new.participant_id;
  insert into notifications(user_id, kind, title, body) values (pu, 'course', 'You were enrolled in a course', c.title);
  return new;
end $$;
create trigger trg_guard_course_enrolment before insert on course_enrolments for each row execute function guard_course_enrolment();

-- Lesson files must live under the course's own folder, so storage rules can tell which course a file belongs to.
create or replace function guard_course_lesson() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  cid := course_of_module(new.module_id);
  if new.storage_path is not null and new.storage_path not like cid::text || '/%' then raise exception 'Lesson files must be stored in the course folder'; end if;
  return new;
end $$;
create trigger trg_guard_course_lesson before insert or update on course_lessons for each row execute function guard_course_lesson();

-- Completed lessons count only for lessons in a course the participant is enrolled in (policy already checks); no double counting by design (primary key).
create trigger aud_courses after insert or update or delete on courses for each row execute function audit_row();
create trigger aud_course_trainers after insert or delete on course_trainers for each row execute function audit_row();
create trigger aud_course_enrolments after insert or delete on course_enrolments for each row execute function audit_row();

-- ============ progress ============
create view v_course_progress with (security_invoker = true) as
select e.course_id, e.participant_id,
  (select count(*) from course_lessons l join course_modules m on m.id = l.module_id where m.course_id = e.course_id)::int as lessons_total,
  (select count(*) from lesson_progress lp join course_lessons l on l.id = lp.lesson_id join course_modules m on m.id = l.module_id
     where m.course_id = e.course_id and lp.participant_id = e.participant_id)::int as lessons_done
from course_enrolments e;

-- ============ storage: private bucket, 50 MB, type allow-list ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('course-materials', 'course-materials', false, 52428800, array['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','video/mp4','image/jpeg','image/png'])
on conflict (id) do nothing;

-- The first folder of every path is the course id: '<course_id>/<lesson file>'. Unreadable ids give no access.
create or replace function course_of_path(name text) returns uuid language plpgsql immutable as $$
begin return (storage.foldername(name))[1]::uuid; exception when others then return null; end $$;

create policy storage_course_read on storage.objects for select to authenticated
  using (bucket_id = 'course-materials' and course_of_path(name) is not null and can_view_course(course_of_path(name)));
create policy storage_course_write on storage.objects for insert to authenticated
  with check (bucket_id = 'course-materials' and course_of_path(name) is not null and can_edit_course(course_of_path(name)));
create policy storage_course_update on storage.objects for update to authenticated
  using (bucket_id = 'course-materials' and course_of_path(name) is not null and can_edit_course(course_of_path(name)));
create policy storage_course_delete on storage.objects for delete to authenticated
  using (bucket_id = 'course-materials' and course_of_path(name) is not null and can_edit_course(course_of_path(name)));

-- Email copies of notifications now include course enrolments.
create or replace function notification_to_email() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not email_automation_enabled() then return new; end if;
  if new.kind not in ('announcement', 'assignment', 'certificate', 'application', 'course') then return new; end if;
  if exists (select 1 from profiles where id = new.user_id and email_opt_out) then return new; end if;
  perform _enqueue_email(new.user_id, 'notification', jsonb_build_object('title', new.title, 'body', coalesce(new.body, '')), now(), 'event:' || new.kind, null);
  return new;
end $$;
