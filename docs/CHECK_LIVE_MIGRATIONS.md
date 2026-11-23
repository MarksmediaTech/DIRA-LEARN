# Checking which migrations the live Supabase project has (read-only)

Claude cannot reach your Supabase project, so this is a two-minute task for you. Both queries only **read**; they change nothing.

1. Sign in to supabase.com and open the DIRA LEARN project.
2. Left menu: **SQL Editor** → **New query**.
3. Open `supabase/checks/live_migration_check.sql` from the project folder, copy everything, paste it, press **Run**.
   - If you see a list of versions: send it to Claude (a screenshot is fine).
   - If you see *relation "supabase_migrations.schema_migrations" does not exist*: that is useful too. It means `supabase db push` was never used; tell Claude.
4. **New query** again. Paste `supabase/checks/live_migration_check_part2.sql`, press **Run**, and send the result. It lists migrations 01 to 26 as **PRESENT** or **missing**, and also catches SQL that was pasted in by hand.
5. Optional: run `supabase/checks/under_18_check.sql` the same way. It lists any participant or live application under 18 (participant numbers and ages only, no names).

Do **not** run any other file from the `migrations` or `rollback` folders on the live project. Nothing will be pushed or deployed until you approve.

Alternative, if the Supabase CLI is installed and linked: `supabase migration list` (also read-only).
