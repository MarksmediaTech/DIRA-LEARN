-- DIRA LEARN Management System: core schema (PostgreSQL / Supabase)
-- STATUS: written, NOT yet executed against a live database (see docs/TEST_REPORT.md)
create extension if not exists pgcrypto;

-- ---------- enums ----------
create type role_code as enum ('super_admin','programme_director','programme_coordinator','trainer','me_officer','mentor','participant','applicant');
create type account_status as enum ('pending','active','deactivated');
create type application_status as enum ('draft','submitted','under_review','shortlisted','accepted','rejected','waitlisted');
create type delivery_mode as enum ('online','physical','hybrid');
create type session_status as enum ('scheduled','completed','cancelled','rescheduled');
create type attendance_status as enum ('present','absent','late','excused');
create type participant_status as enum ('enrolled','active','withdrawn','completed','graduated','alumni');
create type submission_status as enum ('submitted','late','returned','graded');
create type competency_level as enum ('not_yet_assessed','developing','competent','advanced');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- identity & access ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,            -- "DIRA Foundation" (no apostrophe)
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table roles (code role_code primary key, label text not null, description text);
create table permissions (code text primary key, description text);
create table role_permissions (
  role role_code references roles(code) on delete cascade,
  permission text references permissions(code) on delete cascade,
  primary key (role, permission)
);
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  role role_code not null default 'applicant',
  status account_status not null default 'pending',
  first_name text not null default '', last_name text not null default '',
  phone text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create trigger trg_profiles_upd before update on profiles for each row execute function set_updated_at();

-- ---------- curriculum (database-driven; versioned programmes) ----------
create table programmes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, version int not null default 1,
  weeks int not null default 4, sessions_total int not null default 8,
  max_session_minutes int not null default 120,
  is_approved boolean not null default false,       -- curriculum approval flag
  created_at timestamptz not null default now(),
  unique (organization_id, name, version)
);
create table tracks (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  code text not null, name text not null, focus text, position int not null,
  unique (programme_id, code)
);
create table curriculum_sessions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  track_id uuid references tracks(id),              -- null = shared core session
  week_no int not null check (week_no between 1 and 4),
  session_no int not null check (session_no between 1 and 8),
  title text not null, description text,
  duration_minutes int not null default 120 check (duration_minutes between 1 and 120),
  objectives text[] not null default '{}',
  topics text[] not null default '{}',
  activities text[] not null default '{}',
  expected_output text, assessment_notes text,
  is_approved boolean not null default false,       -- false = draft proposal
  source text not null default 'curriculum_docx',   -- provenance of content
  unique (programme_id, track_id, session_no)
);
create unique index uq_core_session on curriculum_sessions(programme_id, session_no) where track_id is null;

-- ---------- applications ----------
create table applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references profiles(id) on delete restrict,
  programme_id uuid references programmes(id),
  status application_status not null default 'draft',
  preferred_track_id uuid references tracks(id),
  form_data jsonb not null default '{}',
  submitted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index uq_one_open_app on applications(applicant_id, programme_id);
create trigger trg_app_upd before update on applications for each row execute function set_updated_at();
create table application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  doc_type text not null, storage_path text not null, mime_type text not null, size_bytes int not null check (size_bytes <= 10485760),
  uploaded_at timestamptz not null default now()
);
create table application_events (          -- status history + reviewer notes (staff only)
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  from_status application_status, to_status application_status,
  note text, actor_id uuid references profiles(id), created_at timestamptz not null default now()
);

-- ---------- cohorts & participants ----------
create table cohorts (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id),
  name text not null, start_date date not null, end_date date not null,
  capacity int not null check (capacity > 0), archived boolean not null default false,
  created_at timestamptz not null default now(), check (end_date >= start_date)
);
create table participants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id),
  application_id uuid unique references applications(id),
  participant_no text not null unique,
  date_of_birth date,
  status participant_status not null default 'enrolled',
  created_at timestamptz not null default now()
);
create table participant_emergency_contacts (   -- sensitive: staff-only via RLS
  participant_id uuid primary key references participants(id) on delete cascade,
  contact_name text, relationship text, phone text
);
create table cohort_enrolments (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id),
  participant_id uuid not null references participants(id),
  track_id uuid references tracks(id), track_selected_at timestamptz,
  enrolled_at timestamptz not null default now(),
  unique (cohort_id, participant_id)
);
create table trainer_assignments (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  trainer_id uuid not null references profiles(id),
  track_id uuid references tracks(id),
  unique (cohort_id, trainer_id, track_id)
);
create table session_schedules (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  curriculum_session_id uuid not null references curriculum_sessions(id),
  trainer_id uuid references profiles(id),
  starts_at timestamptz not null, ends_at timestamptz not null,
  mode delivery_mode not null default 'physical',
  venue text, meeting_url text,                     -- never auto-generated
  status session_status not null default 'scheduled',
  check (ends_at > starts_at and ends_at - starts_at <= interval '2 hours'),
  unique (cohort_id, curriculum_session_id, starts_at)
);

-- ---------- attendance ----------
create table attendance (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references session_schedules(id) on delete cascade,
  participant_id uuid not null references participants(id),
  status attendance_status not null, note text,
  recorded_by uuid references profiles(id), updated_at timestamptz not null default now(),
  unique (schedule_id, participant_id)
);

-- ---------- learning content ----------
create table learning_resources (
  id uuid primary key default gen_random_uuid(),
  curriculum_session_id uuid references curriculum_sessions(id),
  track_id uuid references tracks(id), title text not null,
  kind text not null check (kind in ('document','presentation','video','link')),
  storage_path text, external_url text, uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);
create table assignments (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id), curriculum_session_id uuid references curriculum_sessions(id),
  track_id uuid references tracks(id), title text not null, instructions text,
  due_at timestamptz, allow_resubmission boolean not null default false,
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);
create table submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  participant_id uuid not null references participants(id),
  attempt int not null default 1, body text, storage_path text,
  status submission_status not null default 'submitted',
  feedback text, score numeric(6,2), graded_by uuid references profiles(id),
  submitted_at timestamptz not null default now(),
  unique (assignment_id, participant_id, attempt)
);

-- ---------- assessment & competencies ----------
create table assessment_definitions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id), track_id uuid references tracks(id),
  name text not null, assessment_type text not null,
  weight_percent numeric(5,2) check (weight_percent between 0 and 100),
  max_score numeric(6,2), criteria jsonb not null default '[]',
  is_approved boolean not null default false
);
create table assessment_results (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references assessment_definitions(id),
  participant_id uuid not null references participants(id), attempt int not null default 1,
  score numeric(6,2), descriptor text, comments text, assessed_by uuid references profiles(id),
  assessed_at timestamptz not null default now(), unique (definition_id, participant_id, attempt)
);
create table competencies (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id), track_id uuid references tracks(id),
  name text not null, description text
);
create table competency_links (
  competency_id uuid not null references competencies(id) on delete cascade,
  curriculum_session_id uuid references curriculum_sessions(id),
  assignment_id uuid references assignments(id),
  assessment_definition_id uuid references assessment_definitions(id)
);
create table competency_assessments (
  id uuid primary key default gen_random_uuid(),
  competency_id uuid not null references competencies(id),
  participant_id uuid not null references participants(id),
  level competency_level not null default 'not_yet_assessed',
  evidence text, assessed_by uuid references profiles(id), assessed_at timestamptz not null default now()
);

-- ---------- projects & portfolios ----------
create table portfolios (id uuid primary key default gen_random_uuid(), participant_id uuid not null unique references participants(id));
create table participant_projects (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id), track_id uuid references tracks(id),
  title text not null, description text, milestones jsonb not null default '[]',
  status text not null default 'in_progress', feedback text, created_at timestamptz not null default now()
);
create table project_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references participant_projects(id) on delete cascade,
  storage_path text not null, mime_type text, uploaded_at timestamptz not null default now()
);

-- ---------- mentorship ----------
create table mentorship_assignments (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references profiles(id), participant_id uuid not null references participants(id),
  unique (mentor_id, participant_id)
);
create table mentorship_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references mentorship_assignments(id) on delete cascade,
  held_on date not null, summary text, action_points jsonb not null default '[]', feedback text
);

-- ---------- M&E, graduation, alumni ----------
create table me_indicators (
  id uuid primary key default gen_random_uuid(), programme_id uuid references programmes(id),
  name text not null, definition text, unit text, target numeric
);
create table me_records (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references me_indicators(id), cohort_id uuid references cohorts(id),
  value numeric, data_quality text not null default 'measured' check (data_quality in ('measured','estimated','missing')),
  recorded_on date not null default current_date
);
create table graduation_rules (            -- NOT approved policy until flagged
  id uuid primary key default gen_random_uuid(), programme_id uuid not null references programmes(id),
  min_sessions_attended int, require_core_sessions boolean not null default true, min_overall_percent numeric,
  is_approved boolean not null default false, approved_by uuid references profiles(id), approved_at timestamptz
);
create sequence certificate_seq;
create table certificates (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id), cohort_id uuid not null references cohorts(id),
  certificate_no text not null unique default ('DL-' || to_char(now(),'YYYY') || '-' || lpad(nextval('certificate_seq')::text,6,'0')),
  issued_on date not null default current_date, issued_by uuid references profiles(id), revoked boolean not null default false
);
create table alumni (
  id uuid primary key default gen_random_uuid(), participant_id uuid not null unique references participants(id),
  employment_status text, further_education text, enterprise_activity text, achievements text, updated_at timestamptz not null default now()
);

-- ---------- communications, audit, safeguarding, settings ----------
create table notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  kind text not null, title text not null, body text, read_at timestamptz, created_at timestamptz not null default now()
);
create table announcements (
  id uuid primary key default gen_random_uuid(), cohort_id uuid references cohorts(id), title text not null, body text not null,
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);
create table audit_logs (
  id bigint generated always as identity primary key, actor_id uuid, table_name text not null, row_id text,
  action text not null, old_data jsonb, new_data jsonb, created_at timestamptz not null default now()
);
create table safeguarding_records (        -- isolated: super_admin + designated role only
  id uuid primary key default gen_random_uuid(), participant_id uuid references participants(id),
  summary text not null, severity text, reported_by uuid references profiles(id), created_at timestamptz not null default now()
);
create table system_settings (
  key text primary key, value jsonb not null, is_approved boolean not null default false, note text, updated_at timestamptz not null default now()
);

-- generic audit trigger
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(actor_id, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger aud_attendance after insert or update or delete on attendance for each row execute function audit_row();
create trigger aud_profiles after update on profiles for each row execute function audit_row();
create trigger aud_results after insert or update or delete on assessment_results for each row execute function audit_row();
create trigger aud_certs after insert or update or delete on certificates for each row execute function audit_row();
create trigger aud_settings after insert or update or delete on system_settings for each row execute function audit_row();

-- indexes on foreign keys used by RLS and reports
create index on cohort_enrolments(participant_id); create index on cohort_enrolments(cohort_id, track_id);
create index on attendance(participant_id); create index on submissions(participant_id);
create index on assessment_results(participant_id); create index on competency_assessments(participant_id);
create index on session_schedules(cohort_id, starts_at); create index on notifications(user_id, read_at);
create index on applications(status); create index on audit_logs(table_name, created_at);
