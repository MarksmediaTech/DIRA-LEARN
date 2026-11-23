# Installing the DIRA LEARN database in the browser (Supabase Dashboard → SQL Editor)

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


Written 21 Nov 2026 for the Supabase project **`odfiawrvmaafdskbkptv`**. It is empty, with one existing confirmed sign-in account that must be kept. You need only a web browser and Notepad: no PostgreSQL, CMD or PowerShell.

The installation is the complete release: all **39 migrations** and the **seed**, unchanged and in the same order as `01_initialize_production.sql`. Every security rule is included: row-level security, explicit permissions and the account-status check. It is split into files small enough to paste. All files are in `supabase/production_init/sql_editor/`.

| Step | File | What it does | Changes data? |
|---|---|---|---|
| 0 | `STEP-0_precheck-read-only.sql` | Confirms the project is empty and safe to install into | No |
| 1 | `STEP-1_part-1-of-6_migrations-01-15.sql` | Core tables, security, applications, courses, roles | Yes |
| 2 | `STEP-2_part-2-of-6_migrations-16-29.sql` | Curriculum approval, access rules, Daily Briefs, DIRA Connect, safeguarding, performance, file scanning | Yes |
| 3 | `STEP-3_part-3-of-6_migrations-30-30.sql` | Curriculum V13 (lesson plans; large file, about 400 KB) | Yes |
| 4 | `STEP-4_part-4-of-6_migrations-31-31.sql` | Curriculum V13.1 (large file) | Yes |
| 5 | `STEP-5_part-5-of-6_migrations-32-32.sql` | Curriculum V13.2 (large file) | Yes |
| 6 | `STEP-6_part-6-of-6_migrations-33-39_and-seed.sql` | Security hardening, account status, file scanning, profile repair, Digital Marketing topics, **permissions (38)**, interim safeguarding access (39), then the programme data | Yes |
| 7 | `STEP-7_verify-read-only.sql` | Checks the installation (16 checks) | No |
| 8 | `STEP-8_first-super-admin.sql` | Makes your existing account the first Super Administrator (**edit one line**) | Yes (one profile) |

**Safety:**
- Each of steps 1–6 applies **completely or not at all**. If anything fails, that step is rolled back entirely, and you can run it again once the cause is fixed.
- Each step refuses to run out of order or twice. It then shows "STOP: …" and changes nothing.
- Your existing account (email, password, confirmation) is never changed. It automatically receives a basic `applicant` profile; step 8 turns that into Super Administrator.

## Windows line endings: fixed (21 Nov 2026)

The first attempt stopped at step 2 with `Migration 20: expected text not found in function guard_submission()`.

- **Cause:** copying from Notepad into the browser stores Windows line breaks. Seven older migrations change functions by searching their stored text for phrases with plain line breaks, so they could not find them.
- **Fix:** steps 1–6 now normalise the line breaks of existing functions before each of those migrations, and at the end of every step. This does nothing when the text has plain line breaks.
- **Tested:** the complete installation was run with real Windows line endings. The result was identical to the original release: the same schema, the same function sources and the same row counts, with no stray characters in any data.

**A project where step 1 already ran with the old files** (like `odfiawrvmaafdskbkptv`, which holds migrations 01–15): the new step 2 continues from there, because migrations 01–15 are unchanged. The release plan is a new Supabase project, though, so use a new, empty project and start at step 0.

## Before you start

1. **Backup:** the project is empty apart from one account, so there is no data to lose. If the project is on a paid plan, a backup is shown under *Database → Backups*.
2. Download and extract `DIRA-LEARN-SQL-EDITOR-INSTALL.zip`: right-click → *Extract All*. You get a folder with the nine `STEP-…` files.
3. Sign in to supabase.com and open the project **`odfiawrvmaafdskbkptv`**. Check the project name at the top of the page.

## How to run each step (the same for every file)

1. In Supabase, click **SQL Editor** in the left menu, then **New query** (or the **+** button). The editor must be **empty**.
2. Open the step's file **in Notepad**: right-click the file → *Open with* → *Notepad*. Do not double-click, because Windows may open `.sql` files in another program.
3. In Notepad press **Ctrl+A** (select all), then **Ctrl+C** (copy).
4. Click into the empty SQL Editor and press **Ctrl+V** (paste). For the large files (steps 3–5) the paste can take a few seconds.
5. Make sure **nothing is highlighted** in the editor. Click once at the end of the text. If some text is selected, Supabase runs only the selection.
6. Click **Run** (bottom right), or press **Ctrl+Enter**.
7. Wait for the result under the editor. Every step takes seconds, and the editor allows up to one minute.
8. Compare the result with the table below. Then click **New query** again for the next step. Do not run the next step in the same tab with the old text still in it.

If Supabase shows a confirmation box before running, choose **Run this query**. For example, it may warn that the query contains a "destructive operation", because the scripts contain lines like `drop policy if exists` that only replace their own objects in this new database. Never choose an option that changes the script. If the editor's AI assistant offers to "fix" an error, ignore it and send the error to Claude instead.

## Expected results

| Step | The result must show |
|---|---|
| 0 | The last row `VERDICT` with status **`SAFE_TO_INITIALIZE`**, and the row about sign-in accounts showing `1 total, 1 email-confirmed`. If it says **STOP**, do not continue: send a screenshot of the table to Claude. |
| 1 | `Part 1 of 6 completed: migrations 01-15 installed. Next: STEP-2.` and `migrations_recorded 15` |
| 2 | `Part 2 of 6 completed …` and `migrations_recorded 29` |
| 3 | `Part 3 of 6 completed …` and `migrations_recorded 30` |
| 4 | `Part 4 of 6 completed …` and `migrations_recorded 31` |
| 5 | `Part 5 of 6 completed …` and `migrations_recorded 32` |
| 6 | `Part 6 of 6 completed …` with `migrations_recorded 39`, `organisations 1`, `programmes 1`, `tracks 4`, `sessions 26`, `sign_in_accounts 1`, `accounts_without_profile 0`, `profiles_readable_by_signed_in_users true` |
| 7 | 16 rows saying **`ok`**, and the last row `VERDICT` **`READY`**. |
| 8 | `The first Super Administrator is set. …` with your email, `role super_admin`, `status active`, `email_confirmed true` |

## Step 8: the first Super Administrator (your existing account)

1. Open `STEP-8_first-super-admin.sql` in Notepad.
2. Find the line that ends with `<<< the only line to edit`:
   ```sql
   v_email text := 'PUT-THE-EMAIL-ADDRESS-HERE';       -- <<< the only line to edit
   ```
   Replace `PUT-THE-EMAIL-ADDRESS-HERE` with the email address of your existing account. Keep the single quotes, for example `'name@example.org'`. To check the exact address, see *Authentication → Users*.
3. Copy everything, paste it into a new SQL Editor query, and click **Run**.

What it does: it uses the same protected database function as the app's `/setup` page (`claim_first_admin`). It promotes only an account that is email-confirmed, not blocked or deleted, and still `applicant`, and only while no Super Administrator exists. Otherwise it says "STOP: …" and changes nothing. Only the account's DIRA LEARN role changes; its password and sign-in stay the same. A second run is refused, because first-time setup closes once a Super Administrator exists.

Afterwards, sign in on the website with that account; the dashboard should open. If you run step 7 again, checks 7 and 8 now say `FAIL`, which is correct: an administrator exists. All other rows must still say `ok`.

You do **not** need the `claim-first-admin` Edge Function or a `SETUP_CODE` for this. Leave `SETUP_CODE` unset, so the website's `/setup` page stays switched off.

## If a step says "STOP" or shows an error

- **"STOP: this is part N of 6, but the database records …":** the steps were run out of order or twice. Nothing was changed. Run the step the message names.
- **Any other error in steps 1–6:** nothing of that step was kept. Take a screenshot of the error and send it to Claude before trying again.
- **"Failed to fetch", "timeout" or the page reloads during steps 3–5:** the browser or connection dropped the large request. Check step 7 or run the failed step again: it either completed (then a re-run says "STOP … each part only once") or nothing was kept.

## After the database: connect the website

- Cloudflare build variables for this project:
  - `VITE_SUPABASE_URL` = `https://odfiawrvmaafdskbkptv.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = the **publishable / anon** key (*Project Settings → API*; never the secret or service-role key)

  See `RELEASE_GUIDE_2026-11-21.md`, part C.
- Supabase → *Authentication → URL Configuration*: set **Site URL** to the website address, and add it under **Redirect URLs** (for example `https://dira-learn.marksmedia-studios.workers.dev/**`). Otherwise email confirmation and password-reset links point to the wrong place.

## How this was validated (21 Nov 2026)

`tools/release/sql_editor_check.sh`: 44/44. Every file was executed exactly as the SQL Editor does: the whole text sent as one query (`tools/release/run_as_sql_editor.py`, libpq `PQexec`). It ran on a local stand-in for Supabase with Supabase's current default permissions and one existing confirmed account:
- **Byte for byte:** the 39 migrations and the seed are identical to `supabase/migrations/` and to their copies in `01_initialize_production.sql`, each exactly once and in order. No psql commands, no transaction control, every file under 450 KB.
- **Same result:** the database produced is identical to the original psql bundle and to `expected_schema_fingerprint.txt`: tables, policies, functions and every permission.
- **Account and admin:** the existing account is unchanged and receives its applicant profile. Verification says `READY`. Step 8 makes the account Super Administrator, which can then read its own profile as a signed-in user (no 403).
- **Refusals:** step 8 refuses an unedited file, an unknown address, an unconfirmed account and a second run. Parts run out of order or twice are refused and change nothing.
- **Failure recovery:** a failure at the end of part 4 left nothing of part 4; re-running it then completed the installation identically.
- **Wrapped transactions:** also identical if the editor adds its own transaction around each text.

Not tested here: the real Supabase Dashboard (no access from this workspace).
