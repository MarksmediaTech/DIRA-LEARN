-- DIRA LEARN: READ-ONLY check of which migrations a Supabase database really has.
-- Safe to run on production: it only reads (SELECT). It changes nothing.
-- Paste the whole file into Supabase > SQL Editor > New query, press Run, and send the two result tables to Claude.
--
-- Part 1: what Supabase's own migration history says (exists only if `supabase db push` was ever used).
select 'history' as part, version, name
from supabase_migrations.schema_migrations
order by version;
