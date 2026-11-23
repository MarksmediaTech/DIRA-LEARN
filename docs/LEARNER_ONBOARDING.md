# How learners get into DIRA Learn

Status: written and tested locally, **not deployed**. Two separate routes (22 Nov 2026): **Route 1, public applicants**, unchanged: they apply and staff review and convert accepted applications. **Route 2, CSV import**: direct enrolment, imported learners become active participants as soon as they set their first password, with no application and no approval.

## Route 1: learners create their own account (`/signup`)
1. The learner opens the login page and chooses **Create an account**, enters an email and a password (10+ characters, letters and numbers) and ticks the agreement box.
2. Supabase Auth sends a confirmation email; the learner confirms, signs in, and fills in the application form.
3. The same message is shown whether or not the address already had an account, so the page does not reveal who is registered.

Set up in Supabase before using it:
- Authentication > Providers > Email: allow sign-ups, **keep "Confirm email" on**.
- Authentication > SMTP: use a real sender (for example Resend SMTP, see docs/EMAIL_SETUP.md). The built-in sender allows only a few emails per hour and will block a busy intake.
- Authentication > URL configuration: set the Site URL and add `<APP_URL>/login` and `<APP_URL>/set-password` to the allowed redirect URLs.
- Authentication > Attack protection: turn on CAPTCHA (hCaptcha or Turnstile) before opening sign-up to the public, otherwise bots can create accounts. The sign-up page does not include a CAPTCHA widget yet.

## Route 2: staff add learners (`Add learners`) - direct enrolment (22 Nov 2026)
Two ways on the same page, with the same checks, invitation and activation (both go through the Edge Function `import-learners`
and are activated by `complete-enrolment`):

| | Add one learner (form) | CSV import |
|---|---|---|
| Learner details | form: full name, email, programme track (all required) | CSV file: name, email, programme_track |
| Programme track | dropdown of the configured tracks | must match a configured track |
| Confirmation | asked before the invitation is sent | asked before the invitations are sent |
| Invitation email, first password, automatic participant activation | yes | yes |
| Application / approval | none | none |
| Cohort | left empty | left empty |
| Existing account | reported, not changed or enrolled | reported, not changed or enrolled |
| Invited earlier, not yet activated | invitation sent again, reported as such | invitation sent again, reported as such |
| Import history | recorded as "Added on the dashboard" | recorded with the file name |

**Add one learner:** enter full name, email and programme track, click *Add learner and send invitation*, confirm. Then the same steps 3-6 below apply.

### CSV import
1. A coordinator, director, co-founder, founder or super administrator (unchanged permission) uploads a CSV with **exactly** the columns `name,email,programme_track` (any order, up to 200 rows; in Excel use Save As > CSV). A template can be downloaded on the page.

   ```csv
   name,email,programme_track
   Mary Wanjiku,mary@example.com,AI Tools
   John Otieno,john@example.com,Content Creation
   ```
2. `programme_track` must be one of the tracks configured in DIRA LEARN (today: Digital Marketing, AI Tools, Content Creation, Entrepreneurship & Business). Capital letters and extra spaces do not matter; nothing else is guessed (e.g. "Digital Skills" or "Entrepreneurship and Business" are refused). The page shows name, email and track for every row, marks invalid rows (missing or unused columns, missing name, bad or duplicate email, unknown or missing track) and never sends them. The server checks every row again.
3. Each valid learner gets an invitation email from Supabase Auth (the same mechanism as before). The track is stored with the account in `app_metadata` - which only the server can write - until activation.
4. The link opens `/set-password`. After the password is saved, the page signs in with it and calls the Edge Function `complete-enrolment`, which creates the participant record (participant number, `programme_track_id`, **no cohort**, no application), makes the account an active participant and opens the portfolio. The learner lands on the participant dashboard. If activation is interrupted, the page offers *Try again*, and it also completes automatically the next time the learner signs in with the password.
5. Staff assign a cohort later, as before (Cohorts > cohort > add participant). No cohort is created or assigned automatically.
6. People who already have an account are reported as "Already has an account" and are **not** changed or enrolled. Every import is recorded (who, when, counts and each row's outcome), readable only by programme management. An expired invitation: import the learner again to send a new link (Supabase re-sends invitations to accounts that have not been activated).

Needs (in this order, each only after approval): the database change `supabase/pending/20261122000001_participant_programme_track.sql`, then the Edge Functions `import-learners` and `complete-enrolment` (secret `APP_URL`), then the website. See `docs/deployment/CHANGE_REPORT_2026-11-22_DIRECT_CSV_ENROLMENT.md`.

## What these routes deliberately do not do
- Public applicants are never enrolled directly; their review and conversion stay manual.
- Imported learners are not added to a cohort or a course; staff do that.
- No password is ever sent by email or shown to staff.
- Self-service "forgot password" is still not available (the login page tells people to contact the team). The new `/set-password` page could back a real reset flow if you want one.
- Bulk import from `.xlsx` is not supported, only `.csv`.
