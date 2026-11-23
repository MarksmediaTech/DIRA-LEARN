# Change report – direct learner enrolment (CSV import and Add learner form), and the "j.json is not a function" fix (22 Nov 2026)

Status: implemented and tested locally. **Nothing has been applied to Supabase and nothing has been deployed.** One database
change is prepared and waits for the owner's approval (§5).

## 1. "j.json is not a function" – root cause and fix

**Where:** `src/features/import/ImportPage.tsx` (the *Send invitations* handler) and, with the identical code,
`src/features/emails/EmailsPage.tsx` (*Send now*). Both did this when `supabase.functions.invoke(...)` returned an error:

```ts
const ctx = (e as { context?: Response }).context;
const detail = ctx ? await ctx.json().catch(() => null) : null;
```

**Why it fails:** the Supabase client returns three kinds of function errors. For `FunctionsHttpError` (the function answered
with a non-2xx status) and `FunctionsRelayError`, `context` is the HTTP `Response`. For **`FunctionsFetchError`** – the request
got no readable answer – `context` is the underlying error object (e.g. `TypeError: Failed to fetch`), which has no `.json()`.
`ctx.json` was therefore `undefined`, calling it threw a TypeError *before* `.catch` could apply, and the page showed that
TypeError's text. In the production build the variable `ctx` is minified to `j`: **"j.json is not a function"**.

**What triggers a FunctionsFetchError in practice:** the function `import-learners` is not deployed (Supabase answers 404 without
CORS headers, which browsers report as a network/CORS failure), the website address is not in the function's allowed origins
(`APP_URL` / `ALLOWED_ORIGINS`), or the connection drops. So the message hid the real problem. If you saw it on the live site,
check in Supabase that `import-learners` is deployed and that `APP_URL` is exactly the website address.

**Fix (no error is suppressed):**
- New `src/lib/functionError.ts` – `describeFunctionError()` handles every error type: reads the function's own `{"error": …}`
  text from a clone of the response when there is one, gives a fixed plain message when the response is not JSON (with the HTTP
  status), and an explicit "no answer was received" message for a network failure. It never calls a method that may not exist.
- The import page uses it and states the consequence honestly: for a refusal, *"The import did not run: …"*; for a network
  failure, *"… It is not known whether any invitation was sent: check Earlier imports below before importing this file again."*
  A failed call is never shown as successful; an unexpected success answer is also treated as unknown, not as success; the rows
  stay on screen so nothing is lost; the import history is refreshed.
- The email page uses the same helper (one line).
- `import-learners` still answers every refusal with a JSON `{"error": …}` and an HTTP status (unchanged), and no longer passes raw
  Supabase Auth error texts to the browser (fixed messages; a sending-limit message is kept because it tells staff what to do).

**Verified (Chrome, real page code, simulated Supabase – `tools/recovery/browser/enrolment_flow.mjs`):** the page *as released on
21 Nov* shows "ctx.json is not a function" when the function is unreachable (the reported error, reproduced); the fixed page shows
the explanation instead, for the unreachable case, a 403 with a JSON error, a 502 HTML page and an unexpected answer – none is
shown as success. Unit tests: `src/lib/functionError.test.ts` (6 cases).

## 2. What happened before, and what happens now

| | Before | Now |
|---|---|---|
| CSV columns | `first_name, last_name, email` | **exactly `name, email, programme_track`** |
| After the invitation | learner set a password and stayed an **applicant**, then had to apply and be approved | learner sets the first password and is **immediately an active participant** |
| Programme track | not captured | checked against the configured tracks, saved on the participant record |
| Cohort | – | **none**; staff assign it later as before |
| Public applicants | apply → review → conversion | **unchanged** |
| Staff invitations | Users page → invite-user → set password | **unchanged** |

## 3. How the new workflow works

1. **Upload and preview** (`Import learners`, same roles as before: super admin, founder, co-founder, programme director,
   programme coordinator). The page loads the tracks configured in DIRA LEARN and checks the file:
   - the header must contain exactly `name`, `email`, `programme_track`, in any order; capitals and spaces in the header are
     tolerated, and empty trailing columns are ignored;
   - each row needs a name, a valid email and a track;
   - a track matches a configured track name when you ignore capitals and extra spaces; nothing else is guessed, and no track is
     created;
   - duplicate emails, invalid rows, missing or extra columns, and more than 200 rows are reported with clear messages.

   The preview shows name, email, track and the result of the check for every row. Invalid rows are never sent.
2. **Confirm** → `import-learners` checks the caller's role and every row again (including the track, against the database).
   For each valid row it:
   - sends the Supabase invitation (link to `/set-password`), using the same mechanism as before;
   - records the track in the account's `app_metadata.dira_enrolment` (only the server can write `app_metadata`, so no user can
     mark their own account as imported);
   - fills in the profile name: first word / rest, because profiles keep first and last name apart.

   Accounts that already exist are reported as "already registered" and are not changed. Each import is recorded in
   `import_batches` / `import_rows`, as before.
3. **Set the first password** (`/set-password`, the existing page). After `updateUser({ password })` succeeds, the page signs in
   with that password and calls the new Edge Function `complete-enrolment`. The function changes something only if all of these
   hold:
   - the account carries the import record;
   - the session was opened **with a password** (`amr` = password), which proves the password is set;
   - the profile is an active applicant;
   - the track still exists.

   It then:
   - creates the participant record: participant number, `programme_track_id`, no application, **no cohort**;
   - sets the role to participant, through the existing database guards (as the service role, as `convert-application` does);
   - opens the portfolio and sends a welcome notification;
   - marks the enrolment complete.

   Running it again creates nothing new (`participants.profile_id` is unique).
4. The learner reaches the participant dashboard. If activation is interrupted, the page keeps the password, shows the reason and
   offers *Try again*. Activation also completes automatically the next time the learner signs in with their password.
5. Expired, invalid or already-used links show the existing "This link has expired" page. Importing the learner again sends a new
   invitation to an account that has not been activated (Supabase behaviour; not tested against a real project).

## 3b. Adding one learner on the dashboard (owner request, 22 Nov 2026, 21:16)

The page (menu entry renamed **Add learners**, same address `/import`, same roles) now has an **Add one learner** form above the CSV
import:
- **Fields:** full name, email and programme track. All three are required. The track is chosen from a dropdown of the tracks
  configured in DIRA LEARN.
- **Validation:** the same rules as a CSV row (`checkSingleLearner`), with clear messages. The administrator is asked to confirm
  before the invitation is sent.
- **Backend:** no separate code path. The form sends one row to the same `import-learners` function, which repeats every check,
  sends the same Supabase invitation and records the track. The learner is then activated by the same `complete-enrolment` step:
  active participant, track saved, no cohort, no application or approval.
- **Existing accounts** are reported and not changed or enrolled.
- **A learner invited earlier but not yet activated** gets the invitation again and is reported as such ("Already invited earlier,
  not yet activated"). It is not a second enrolment: activation creates at most one participant.
- **Import history:** the form's entries appear as "Added on the dashboard".
- **Errors:** handled by the same safe helper (§1). Nothing is shown as sent unless the server confirms it.

## 4. Files

**Changed**
- `src/features/import/rules.ts`: new CSV rules (columns, tracks), `checkSingleLearner` (form), `splitName`, template.
- `src/features/import/rules.test.ts`: tests for the new rules.
- `src/features/import/ImportPage.tsx`: tracks, preview with a track column, safe error handling, texts; the **Add one learner** form.
- `src/lib/permissions.ts`: menu label "Import learners" → "Add learners" (same address and roles).
- `src/features/auth/SetPasswordPage.tsx`: activation after the password for imported learners only; *Try again*.
- `src/features/auth/AuthProvider.tsx`: completes an interrupted activation at sign-in (imported learners only).
- `src/features/emails/EmailsPage.tsx`: same unsafe error handling fixed (one line).
- `supabase/functions/import-learners/index.ts`: new row format, track check, `app_metadata`, fixed error texts.
- `.github/workflows/deploy-supabase-functions.yml`: adds `complete-enrolment` to the manual deployment list.
- `docs/LEARNER_ONBOARDING.md`: route 2 rewritten.

**New**
- `src/lib/functionError.ts` and `src/lib/functionError.test.ts`.
- `src/features/auth/enrolment.ts`.
- `supabase/functions/complete-enrolment/index.ts`.
- `supabase/pending/20261122000001_participant_programme_track.sql`, the matching `…_rollback.sql`, and `README.md`.
- Tests:
  - `tools/enrolment/enrolment_db_check.sh`;
  - `tools/recovery/browser/enrolment_flow.mjs`, with its harness additions: `harness-before-22nov.tsx`, `before-22nov/` (the
    released page, kept only as a reproduction fixture) and `react-query-shim.tsx`;
  - updates to `tools/recovery/browser/{harness.tsx,fake-supabase.ts,build.mjs}`, `tools/edge-browser/{run.mjs,fake-supabase.mjs,build.mjs}`,
    `tools/check-all.sh` and `tools/release/{references_check.py,make_release.py}`.

**Unchanged (checked):** database schema, RLS policies, grants, triggers and functions (apart from the pending column), Supabase
Auth and SMTP settings, redirect URLs, staff invitation (`invite-user`), public sign-up and application review
(`convert-application`, `decide_application`), roles and permissions, cohort management, track selection, Cloudflare
configuration, environment variables.

## 5. Database change needed (prepared, NOT applied – needs approval)

`supabase/pending/20261122000001_participant_programme_track.sql`
- **Why:** the track of a learner without a cohort must be stored somewhere. Today a participant's track exists only in
  `cohort_enrolments.track_id`, and a cohort enrolment requires a cohort (`cohort_id NOT NULL`). `participants` has no track
  column. No existing table can hold it without inventing an application or a cohort.
- **What:** `participants.programme_track_id uuid NULL REFERENCES tracks(id)`, plus an index. Nothing else.
- **Impact:**
  - existing participants keep NULL;
  - the public path is unaffected;
  - the column falls under the existing participants permissions and RLS: staff manage it, learners read their own row and
    cannot change it;
  - STEP-5 still reports READY;
  - a referenced track cannot be deleted.
- **Safety:** one transaction, safe to run twice. Rollback file included; it refuses while tracks are saved unless explicitly
  confirmed.
- **Tested** (`tools/enrolment/enrolment_db_check.sh`, 22/22) on a new project installed as Supabase's non-superuser SQL Editor
  role:
  - the change applies, and a second run is harmless;
  - STEP-5 is READY, with all 16 checks ok;
  - the function's writes pass the guards: participant + track, no cohort, a duplicate refused;
  - the learner cannot change their track, a public applicant cannot enrol themselves, and the conversion rule is unchanged;
  - the full pgTAP suite passes with the column;
  - the rollback works.
- **Open question:** when staff later add an imported learner to a cohort, should the saved track be pre-selected on the cohort
  enrolment? Today learners choose their track after the core sessions (`select_track`). This was left unchanged.

## 6. Tests run here

| Test | Result |
|---|---|
| Edge Functions (real code, simulated Supabase, Chrome CORS): 13 new cases for `import-learners` and `complete-enrolment` (valid import, per-row refusals, existing accounts and send failures, one learner from the form, re-invitation reported, form refused for a learner, no activation before the password, activation with track and no cohort, repeat-safe, a public applicant refused, a deactivated or other-role account refused, not signed in) | PASS – 51/51 |
| Screens (Chrome, real pages, simulated Supabase), also under the production CSP: the j.json reproduction and fix, the error types, CSV checks, template; **Add one learner**: track list = configured tracks, confirmation then one row to the same function, cancel sends nothing, required fields and email validation, existing account, re-invitation, unreachable and 403 errors, form learner activated with track and no cohort; invitation link → password → participant → dashboard, sign in again, failed activation + *Try again*, automatic completion at sign-in, expired link, staff invitation unchanged, public applicant untouched, no password in the console | PASS – 26/26 and 26/26 |
| Database side (pending change) | PASS – 22/22 |
| Unit tests (CSV and form rules 18, error helper 6), type check (0 new errors), full regression suite | see the release run |
| Real Supabase (invitation email, Auth Admin API, `amr` claim), real build/ESLint/Vitest components | **BLOCKED here** – no Supabase, no package registry. No real invitation was sent. |

## 7. Your GitHub repository and Cloudflare Worker

The project in the ZIP is the complete project. Do this in your **existing** repository, never a new one:

1. **Review:** this report lists every changed file. In GitHub Desktop, after copying the files in (step 2), the *Changes* tab shows
   each file's differences before anything is committed.
2. **Feature branch:** in GitHub Desktop choose *Current branch → New branch*, name it `feature/direct-csv-enrolment`, based on your
   production branch (`main`). Unzip the release and copy the contents of `DIRA-LEARN-RELEASE/` over your local repository folder
   (same file layout). Commit with a summary such as *Direct CSV enrolment + j.json fix*, then *Publish branch*.
3. **Pull request:** on github.com open *Pull requests → New* (`feature/direct-csv-enrolment` → `main`). The `release-check` and
   `database-pg17` workflows run automatically and must be green. They deploy nothing.
4. **Test before merging:**
   - If *Builds for non-production branches* is turned on in your Worker's build settings, Cloudflare builds the branch as a preview
     version with its own address. Otherwise nothing is deployed until you merge.
   - Use test accounts only. A preview of the website still talks to your real Supabase project, so test the import only after
     steps 5a–5b and with addresses you control.
5. **After you approve – in this order:**
   1. Supabase SQL Editor: run `supabase/pending/20261122000001_participant_programme_track.sql` (expect *participants.programme_track_id is ready*).
      Then run `STEP-5_verify_read-only.sql`: expect READY.
   2. Deploy the Edge Functions `import-learners` and the new `complete-enrolment`. Use GitHub *Actions → deploy-supabase-functions →
      Run workflow*, as set up in INSTALL_GUIDE part C, or the Supabase Dashboard. Keep *Verify JWT* **on** for both. `APP_URL` must be
      the website address.
   3. Merge the pull request into `main`. If your Worker is connected to GitHub (Workers Builds), Cloudflare builds and deploys the
      merged `main` automatically, using your existing build settings and variables. If it is deployed some other way, redeploy it
      the way you always do.
6. **Mixing old and new versions:** an old website with the new function, or the reverse, makes the import refuse every row
   ("Invalid name"). Nothing wrong is created, but deploy the functions and merge close together.
7. **Undo:**
   - revert the pull request (Cloudflare redeploys the previous `main`);
   - redeploy the previous functions;
   - only if no imported learner has been activated, run the rollback SQL.
