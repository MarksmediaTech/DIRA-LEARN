-- DIRA LEARN: record of bulk learner invitations. STATUS: written, NOT yet executed.
-- Imported learners are invited as APPLICANTS. They set a password, complete the application form and go through the normal
-- review; nobody becomes a participant by being imported. Only the import-learners Edge Function (service role) writes here.

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references profiles(id),
  file_name text,
  total int not null default 0,
  invited int not null default 0,
  already_registered int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now()
);
create table import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_no int not null,
  email text not null,
  first_name text, last_name text,
  outcome text not null check (outcome in ('invited', 'already_registered', 'failed')),
  message text
);
create index on import_rows(batch_id);
alter table import_batches enable row level security;
alter table import_rows enable row level security;
-- The rows hold personal data (names and emails), so only programme management reads them.
create policy impbatch_read on import_batches for select to authenticated using (is_staff());
create policy improws_read on import_rows for select to authenticated using (is_staff());
revoke insert, update, delete on import_batches, import_rows from authenticated, anon;
