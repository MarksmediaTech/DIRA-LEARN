-- DIRA LEARN: add the Founder and Co-Founder roles.
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`.
-- This file is separate on purpose: a new enum value cannot be used in the same transaction that adds it, so the
-- approval-centre migration (20260101000016) that uses these roles must be a later file.
-- ADDITIVE ONLY: existing roles, accounts and passwords are untouched. Founder and Co-Founder are NOT added to is_staff() or
-- is_admin(): on their own they get no applications, users, settings or safeguarding access. They are given only what the
-- Curriculum Approval Centre needs. A super administrator assigns them in Users.
-- ROLLBACK NOTE: PostgreSQL cannot remove an enum value. Unused values are harmless; to "undo", simply do not assign the roles.
alter type role_code add value if not exists 'founder';
alter type role_code add value if not exists 'co_founder';
