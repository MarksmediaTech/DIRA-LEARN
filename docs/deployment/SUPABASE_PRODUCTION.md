# DIRA LEARN – Supabase production configuration and migration plan

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


**Status (20 Nov 2026): prepared, not applied.** The live project has not been inspected or changed: no Supabase access was
available. Step 0 must come first; everything after it needs your approval and your access.

## 0. Read-only inspection (safe; changes nothing)

In Supabase > SQL Editor of the **live** project, run each file, one at a time, and keep the results:

1. `supabase/checks/live_migration_check.sql` – the migration history Supabase recorded (empty if `db push` was never used).
2. `supabase/checks/live_migration_check_part2.sql` – which of migrations 01–33 are really present (detects SQL pasted by hand).
3. `supabase/checks/production_preflight.sql` – counts of users, profiles by role, applications, enrolments, records,
   curriculum; tables without row-level security; whether the security gap fixed by migration 33 is present.
   Numbers only, no personal data. **Run it again after the deployment** and compare: every count must be equal or higher.

Send the results. The plan below is then fixed to the exact missing migrations.

## 1. Migration plan

Apply **only** the missing migrations, in number order. Never `db reset`; no table is dropped or recreated.

| Migration | What it does | Data it touches when applied | Risk |
|---|---|---|---|
| 01–22 | base system (V8 and earlier) | – | expected to be live already: confirm with step 0 |
| 23 v8 audit fixes | three logic fixes | none | low |
| 24 safeguarding officers | officers, confidential records, access grants | replaces one check constraint on `safeguarding_records` | low |
| 25 connect phase 4 | attachments, legal holds, retention | replaces conversation check constraints | low |
| 26 minimum age | refuses applications under 18 | none (existing applications are not changed) | low; run `supabase/checks/under_18_check.sql` first |
| 27 learner performance | metrics, feedback, snapshots | none | low |
| 28 cohort intelligence | reports | adds `submissions.graded_at` (filled for graded rows) | low |
| 29 attachment scanning | no download until a virus scan says clean | existing `not_scanned` attachments become `pending` (not downloadable until scanned) | **intended behaviour change**; needs the scanner (`docs/ATTACHMENT_SECURITY.md`) |
| 30 curriculum V13 | Digital Marketing replaces Digital Skills (same track id); lesson plans and staff-only teaching notes | renames the `digital` track; refreshes **draft** session texts it recognises (old values saved for rollback); never an approved record, duration, date or schedule | low; reports every outcome |
| 31, 32 curriculum V13.1, V13.2 | reviewed lesson plan text | updates only drafts still exactly at the previous text | low |
| **33 security null-role fix** | closes a gap that let signed-out visitors approve curriculum sessions; signed-out visitors may call only `verify_certificate` | function definitions and execute rights only | **apply in every case** – the gap exists since migration 05 |
| **34 account status enforcement** | deactivated, pending or reassigned accounts lose all access at their next request, even with an open session (API pre-request check `check_request()`, a restrictive rule on every table and on Storage, helpers re-check role and status); deactivate/reactivate only with a reason (`admin_set_account_status`, history in `account_status_events`) | function definitions, policies, one API setting (`pgrst.db_pre_request` on role `authenticator`); **no rows are changed** | **intended behaviour change**: accounts that are already `deactivated` or `pending` stop working at once (the preflight lists how many). If the API setting cannot be made by the migration, it says so and continues; then run the two lines it prints in the SQL Editor. It stops without changing anything if another pre-request function is already configured |
| **35 file scanning** | every uploaded file (application documents, submissions, project evidence, course materials, learning resources) opens only after a clean virus scan; trainers open only their own cohorts' learner files; application documents only programme staff; learning resources limited to document/image/video types | adds two tables; changes storage policies; **existing files are not touched** but become "waiting for virus check" | **intended behaviour change**: until a scanner is configured, nobody but the uploader can open these files (the preflight counts them). Text answers in submissions are unaffected |

Migrations 14, 16 and 23–35 have a rollback in `supabase/rollback/` (one transaction each; rollbacks 33–35 re-open the security
gaps they close and are for emergencies only). All 35 migrations, the 873 database test assertions and the rollbacks pass on a
local PostgreSQL copy (rollback 34 also removes the API setting); that copy is not the live data.
**Order matters:** 34 before 35 (35 uses `account_is_active()` from 34).

### How to apply (after approval)
1. **Backup.** Supabase > Database > Backups: confirm today's daily backup exists (point-in-time recovery is a paid add-on –
   not needed, do not buy without approval). Also keep your own copy:
   `npx supabase db dump --remote -f prod-schema-<date>.sql` and `npx supabase db dump --remote --data-only -f prod-data-<date>.sql`
   (needs the database password; the data file contains personal data – store it encrypted, never in the repository).
2. **Link** (in the production package): `npx supabase login`, then `npx supabase link --project-ref <project-ref>`.
3. **If step 0 shows an empty or incomplete history but the objects exist** (SQL pasted by hand), do **not** run `db push`
   yet: it would try to re-run old migrations. The history must first be marked with `npx supabase migration repair <version>
   --status applied --remote` for exactly the migrations that are present. Do this together with the developer.
4. **Dry run:** `npx supabase db push --remote --dry-run` – it must list only the missing migrations.
5. **Apply:** `npx supabase db push --remote` (CLI v3 asks for confirmation; answer only after reading the list).
6. Run `production_preflight.sql` again and compare with step 0. Run **Security Advisor** (Database > Advisors).

## 2. Authentication settings (Dashboard > Authentication)

| Setting | Value |
|---|---|
| URL configuration > Site URL | `https://<production domain>` (e.g. `https://learn.<dira-domain>`) |
| Redirect URLs | `https://<production domain>/login`, `https://<production domain>/set-password`; for a preview that must sign in, its exact `https://<branch>.<project>.pages.dev/**` |
| Email provider | enabled; **Confirm email ON** |
| Email OTP length / expiry | 6 digits / 900 seconds (15 minutes) – the password reset code |
| Password | minimum length 10; required characters: letters and digits (same as the app) |
| Rate limits | emails per hour to suit the SMTP plan; token verifications 30 per 5 minutes (code guessing) |
| Leaked password protection | turn on if your plan offers it |
| SMTP (Authentication > Emails > SMTP) | **required for production**: Supabase's default sender only reaches the project team. Planned provider: Resend (`docs/EMAIL_SETUP.md`): host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key, sender on DIRA's verified domain. Resend's free plan (100 emails/day) needs no payment; creating the account and verifying the domain (DNS) needs your approval |
| Templates > Reset password | subject `Your DIRA LEARN password reset code`; body = `supabase/templates/recovery.html` (keeps `{{ .Token }}`, no link) |

The password reset works for every role through Supabase Auth itself; no role needs special setup. Test it with a real
staff and a real learner address after SMTP is configured (security report, section 4).

## 3. Edge Functions and secrets

Deploy: `npx supabase functions deploy claim-first-admin convert-application import-learners invite-user scan-attachments send-emails set-account-status --project-ref <project-ref>`
and `npx supabase functions deploy email-webhook --no-verify-jwt --project-ref <project-ref>` (Resend's webhook has no Supabase JWT; it is checked by its signature).

Secrets (`npx supabase secrets set NAME=value --project-ref <project-ref>`; never in Cloudflare or the repository):

| Secret | Used by | Value |
|---|---|---|
| `APP_URL` | invite-user, import-learners, emails; also the address allowed to call functions from the browser (CORS) | `https://<production domain>` |
| `ALLOWED_ORIGINS` | all browser-called functions (CORS) | optional, comma-separated exact addresses of previews that may call functions, e.g. `https://release-v13-2.<project>.pages.dev`; no wildcard |
| `RESEND_API_KEY`, `EMAIL_FROM` | send-emails | from Resend; `DIRA Learn <learn@<dira-domain>>` |
| `RESEND_WEBHOOK_SECRET` | email-webhook | from the Resend webhook |
| `CRON_SECRET` | send-emails, scan-attachments | a long random string; also used by the scheduler that calls them |
| `SETUP_CODE` | claim-first-admin | only if no active super administrator exists yet |
| `SCANNER_PROVIDER`, `SCANNER_URL`, `SCANNER_TOKEN` | scan-attachments | when the virus scanner is chosen (`docs/ATTACHMENT_SECURITY.md`); until then DIRA Connect attachments and (migration 35) all other uploaded files stay unavailable by design |

**Accounts that were deactivated before migration 34:** the database blocks all their access at once, but Supabase Auth still
lets them sign in (they then see "This account is not active"). To block the sign-in too, ban each one in Supabase >
Authentication > Users. Accounts deactivated from now on with Deactivate on the Users page are banned automatically.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase automatically.
Supabase is replacing the anon and service_role keys with publishable and secret keys during 2026: use the publishable key in
Cloudflare; Edge Functions keep using what Supabase injects.

## 4. Platform security (Supabase production checklist)

- Security Advisor: no errors. One expected warning: view `v_session_topics` runs with its owner's rights on purpose (it shows
  only approved topic titles and lists already visible to signed-in users).
- Database > Settings: **SSL enforcement on**; **network restrictions** for direct database connections if your plan allows.
- Organisation: **MFA** for every member; MFA enforcement if available; at least two owners.
- Storage: all six buckets are private (checked locally); confirm in Storage after migrations.
- Realtime: only `connect_messages` and `connect_attachments` are published (set by migrations).

## 5. Data protection during this deployment

No user, password, role, profile, applicant or record is reset, deleted or re-created. Passwords are untouched (they live in
Supabase Auth). The old DIRA Foundation registration platform and its 49 applicants are **not** part of this deployment; their
migration is a separate task (to be done without duplicate accounts or re-submission).
