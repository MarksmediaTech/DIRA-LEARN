# DIRA LEARN – independent pre-production audit

**Date:** 20 Nov 2026. **Scope:** the production package `dira-learn-production.zip` (33 migrations), re-tested from scratch
in this audit. **Overall readiness rating: READY AFTER CRITICAL FIXES** (not ready for production; a preview build can be
made once H2 and H3 are addressed, see §12).

## 0. What could and could not be inspected

| Service | Access in this session | Consequence |
|---|---|---|
| Live Supabase project | **None.** No Supabase connector is installed for your account (connector list is empty) | Phase 2 (live database) **was not performed**. No live table, policy, migration history, user or record was read. Nothing live was changed |
| Cloudflare, GitHub, domain registrar | None | No deployment, no URL, no SSL check |
| Package installs (npm) | Blocked (no network for packages) | No real `npm run build`, ESLint, `npm audit`, bundle analysis or React component tests |
| Browser rendering of the app | Not possible without the packages | No screenshot-level UI or image audit (§7) |

**What was used instead:** a disposable local PostgreSQL 16 database built **only from the production package's
migrations and seed**, with Supabase's roles and `auth.uid()` behaviour simulated (`request.jwt.claims` set the way the
Supabase API sets it). Into a second disposable copy I loaded the local test accounts (one per role, two cohorts) and planted
records — attendance, submissions, private and cohort messages, a safeguarding record and conversation, staff feedback, a
certificate, notifications — then queried and attacked them as each role. Nothing in this audit touched a live system.

**To complete Phase 2:** connect the Supabase connector in claude.ai (Settings → Connectors) with read access to the DIRA
LEARN project, or run `supabase/checks/live_full_inspection.sql` (new, SELECT-only) in the live SQL Editor and send the
output. Its part A is a 2,093-line schema fingerprint to compare line by line with
`supabase/checks/expected_schema_fingerprint.txt` (generated from this package; reproduced identically on a rebuild); part B
counts orphaned, duplicate and inconsistent records (counts only, no personal data).

## 1. Overall system health

The database security model is largely sound when tested adversarially: 44 unauthorised actions by active accounts in 8 roles
(signed-out visitor, learner, applicant, two trainers, coordinator, founder, super administrator) were attempted and all
were refused, and the row-visibility matrix (§3.1) shows no cross-learner, cross-cohort, private-message
or safeguarding leak among active accounts. Migration 33 closes the critical signed-out-approval gap as intended. However,
the audit found **two new high-severity problems** – former staff keep access to cohort data, and every Edge Function
called from the browser would fail on CORS – and the frontend has **never been built** with its real packages.

## 2. Live database findings

**Not inspected – no access** (see §0). In particular it is unknown whether the live project has migrations 23–33, whether the
critical gap below is open there, and what its users, roles and records look like. No missing-migration list can be stated
for the live project until the inspection is run.

## 3. Security

### 3.1 Verified as correct (executed in the disposable database)

Row visibility per role (P10 = learner 1 etc.; cohort A: L1–L3 with TA; cohort B: L4 with TB):

| Data | Learner | Trainer | Executives / director / coordinator | Signed out |
|---|---|---|---|---|
| Attendance, submissions | own only | own cohort only | all | none |
| Private learner–facilitator messages | own conversation only | own learners only | **none** (only through logged safeguarding oversight) | none |
| Safeguarding conversation and records | learner sees own conversation | none | only appointed safeguarding officers | none |
| Cohort discussion | own cohort only | own cohort only | overseers see both | none |
| Staff feedback on a learner | only items shared with them | own cohort | staff | none |
| Teaching notes | **none** | read | read (edit: executives, coordinator) | denied |
| Audit log | none | none | executives read; nobody can edit or delete | none |

Refused, as expected: learner/applicant self-promotion to any role; applicant accepting own application; learner changing
own score, feedback or attendance; trainer recording attendance or grading outside own cohort; certificate issue/revoke by
learner, trainer or signed-out visitor; inserting certificate rows directly; curriculum and lesson-plan approval by signed-out
visitor, trainer or coordinator (founder allowed); sending as another user; posting into another learner's private
conversation or another cohort; editing or deleting messages; founder opening a private conversation without a safeguarding
grant; learner suspending a learner; trainer appointing safeguarding officers; super administrator editing/deleting audit
logs or reading the migration-33 backup; coordinator or founder changing roles; uploading into another learner's storage
folder. After migration 33 a signed-out visitor can execute only `verify_certificate`. New users always start as `applicant`.
All 6 storage buckets are private. No `dangerouslySetInnerHTML`/`innerHTML`; message links are limited to http(s); e-mail
HTML escapes all content; the password-reset screens do not reveal whether an account exists. No service-role key, password
or token in the frontend or package (scan clean).

### 3.2 Findings

| ID | Severity | Finding | Where | Affects production? | Fix | Verified? |
|---|---|---|---|---|---|---|
| C1 | **Critical** (live state unknown) | Signed-out visitors can approve curriculum sessions and issue/revoke certificates (NULL role check) | migrations 05–32 | Yes, if live lacks migration 33 | Apply migration 33 (already in the package) | Fixed and tested locally: all three refused after 33. Live: **not verified** |
| H1 | **High** | **Deactivated or reassigned staff keep cohort access.** `my_trainer_cohorts()` checks only `trainer_assignments`, not that the account is active or still a trainer. A deactivated trainer could still read cohort A's submissions (2 rows) and enrolments (3), **edit** an assignment and **create** a new one. `mentor_has_mentee()` and `is_course_trainer()` have the same pattern | migrations 02, 06, 11 (helpers); policies `asg_write`, `enrol_ro`, `sub_*`, `cohorts_read`, `ann_read`, … | Yes – as soon as a trainer is deactivated or changes role | New migration 34: add `and exists (select 1 from profiles where id = auth.uid() and status = 'active' and role = 'trainer')` to `my_trainer_cohorts()` (same idea for mentor/course helpers), with rollback and tests | **Yes, reproduced locally** |
| H2 | **High** | **No Edge Function answers the browser's CORS preflight** (no `OPTIONS` handling, no `Access-Control-Allow-*` headers). Browser calls to invite-user, import-learners, convert-application, claim-first-admin and send-emails (status / Send now) will be blocked by the browser, so inviting staff, importing learners, converting accepted applicants and first-admin setup would not work | `supabase/functions/*/index.ts`; callers in UsersPage, ImportPage, ApplicationsReviewPage, SetupPage, EmailsPage | Yes | Add a shared `_shared/cors.ts` (allow the DIRA LEARN origin, the headers supabase-js sends), answer `OPTIONS`, add the headers to every response | Code inspection + Supabase documentation (below); not executed (functions not run here) |
| H3 | **High** (readiness) | The frontend has never been built with its real packages; there is no `package-lock.json`, so the first build will pick whatever versions are current | package.json | Yes – a build failure, or untested versions | `npm install` once, commit the lock file, `npm run build`, then a Cloudflare **preview** before production | Fact (no packages available in any session so far) |
| M1 | Medium | Deactivating an account (Users page) only changes `profiles.status`; Supabase Auth still lets the person sign in, and existing sessions keep working. Combined with H1 this is what makes H1 reachable. Deactivated learners can still read their own submissions and certificates | UsersPage.tsx; no ban in any Edge Function | Yes | On deactivation, call an Edge Function that bans the auth user (Supabase admin API) and signs out sessions; plus H1 | Reads verified locally; sign-in behaviour is Supabase's (not executed) |
| M2 | Medium | Virus scanning covers DIRA Connect attachments only. Learner submissions, application documents, project evidence, course materials and learning resources are stored and downloaded without a scan; `learning-resources` accepts any file type (50 MB). Your rule was not to enable unrestricted production downloads without scanning | storage buckets (migrations 03, 07, 11) | Yes | Extend the scan-before-download design to the other buckets (or at least submissions and application documents) before launch; add a MIME list to `learning-resources` | Configuration verified locally |
| M3 | Medium | No Content-Security-Policy; the Supabase session is kept in browser storage, so any future script injection could take over an account | `public/_headers`, supabase-js default | Yes | Add a CSP after the first preview (script-src 'self'; connect-src the Supabase URL; img-src self + photo host) | Verified (file inspection) |
| M4 | Medium | No production e-mail: without custom SMTP, password reset codes, invitations and reminders do not reach users | Supabase Auth / Resend | Yes | Approve Resend free plan and verify the DIRA domain (`SUPABASE_PRODUCTION.md` §2) | Configuration fact |
| L1 | Low | `session_schedules.meeting_url` is not validated – a staff member could store a `javascript:` link that learners click (React 18 still renders it) | migration 04 (no check), cohorts/schema.ts | Staff-only input | Check constraint `meeting_url ~* '^https://'` + zod `.url()` with https | Code inspection |
| L2 | Low | `guard_application_status` still trusts `auth.uid() is null` (the pattern fixed in 33). Not reachable through the API (no anon update policy) | function guard_application_status | Defence in depth | Use `is_trusted_session()` | Code inspection |
| L3 | Low | `is_trusted_session()` treats empty JWT claims as a server session. Correct for the Supabase API (it always sets claims), but fragile | migration 22+ | Defence in depth | Also require `session_user`/`current_user` not in (`anon`,`authenticated`) where possible | Code inspection |
| L4 | Low | Some messages are inaccurate or too revealing: approval error says "Only a super administrator or programme director" though founders may approve; convert-application and scan-attachments return raw database error text | set_curriculum_approval, Edge Functions | Cosmetic / minor info leak | Correct text; return generic errors and log details server-side | Executed / inspected |
| L5 | Low | Supabase default grants give `anon`/`authenticated` TRUNCATE etc. on tables; TRUNCATE ignores RLS but cannot be sent through the Supabase API | all public tables | Not reachable via API | Optional hardening: revoke TRUNCATE, TRIGGER, REFERENCES from anon and authenticated | Verified locally |
| I1 | Info | Programme directors can approve lesson plans but cannot edit teaching notes (coordinators can). Confirm this is intended | can_edit_curriculum | – | Decision for you | Verified |

**Supabase source for H2:**
Supabase's CORS guide (supabase.com/docs/guides/functions/cors) states that functions invoked from the browser must handle
CORS preflight requests, and its troubleshooting page (supabase.com/docs/guides/troubleshooting/unable-to-call-edge-function) lists missing `Access-Control-Allow-Origin` headers and unhandled OPTIONS preflight requests as
common causes of failed Edge Function calls.

## 4. Functional findings

Verified: internal navigation – every in-app link resolves to one of the 44 defined routes, and unknown routes fall back.
The database side of each workflow passed in the full suite (36 end-to-end workflow checks, 792 database assertions in the
development archive). Broken in production: the five functions in H2 (invite, import, convert application, first-admin setup,
e-mail send/status). Not verified: button-by-button behaviour on screen (needs a built app – §7).

## 5. Missing or incomplete features

Competency frameworks (known, not built). Virus scanning beyond Connect (M2). Account ban on deactivation (M1). Production
e-mail (M4). A virus-scanning provider has not been chosen, so Connect attachments stay unavailable by design until it is.

## 6. Performance

Small scale (tens to hundreds of learners) is not a concern. For growth: 122 of 185 foreign keys have no index, including
`assignments(cohort_id)`, `learner_feedback(cohort_id)`, `lesson_progress(participant_id)` and `email_outbox(to_user_id)`
used by access rules; 20 policies call `auth.uid()` per row instead of `(select auth.uid())` (Supabase's performance
advisor flags this). Low priority; add indexes in a later migration. Bundle size: not measurable without a build.

## 7. Image and interface

**Not verified in a browser** (no build possible). Static review: photos are shown with `object-cover` (no stretching), the
first photo loads eagerly, later ones lazily, failed photos are skipped, and motion stops for users who prefer reduced
motion. The six cover photos are **hot-linked from the DIRA Foundation Netlify website**; I could not fetch them to check
dimensions or quality (the address is outside this session's allowed list). If that site moves or renames files, the
images disappear – copy them into `public/photos/`. One stale comment in `src/lib/site.ts` points to a document removed from
the production package. Accessibility: all images have `alt`; 231 of 237 form controls have labels; six inputs on the
Safeguarding page rely on placeholder text only (Low).

## 8. Cloudflare deployment readiness

Build `npm run build` → `dist`; Node 22 via `.nvmrc`; no `404.html`, so SPA routing works; `public/_headers` sets nosniff,
frame-deny, referrer and permissions policies and immutable caching for `/assets/*`; only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (public) are needed; a build without them shows a safe "not available" page. No Windows launcher or
local test file is in the package or needed to run it. Missing: lock file (H3), CSP (M3), HSTS (set in Cloudflare after the
domain works), Supabase Auth redirect URLs for the final domain and previews.

## 9. Missing configuration

Supabase: Site URL, redirect URLs, custom SMTP, OTP expiry 900 s, password rule, rate limits, Edge Function secrets
(`APP_URL`, `CRON_SECRET`, `RESEND_*`, `EMAIL_FROM`, `SETUP_CODE` if needed, scanner settings), a scheduler for
send-emails and scan-attachments, SSL enforcement, MFA for the organisation. Cloudflare: the project, variables, custom
domain. All listed in `SUPABASE_PRODUCTION.md` and `CLOUDFLARE_PAGES.md`.

## 10. Dependency vulnerabilities

**Not checked** – `npm audit` needs the registry. All ten runtime dependencies are imported by the code (none unused). Run
`npm audit --omit=dev` after `npm install`; do not use `npm audit fix --force`.

## 11. Migrations needed

For the live project: **unknown until the inspection runs.** The package expects migrations 01–33. Recommended new work
before production: **migration 34** for H1 (plus L1, L2 and optionally L5), with a rollback script and tests.

## 12. Corrections, in priority order

1. Run the read-only live inspection (or connect Supabase) – decides C1 and the migration list.
2. H1: migration 34 (active-trainer/mentor check) + tests, then apply 33 and 34 after a backup and your approval.
3. H2: CORS in all browser-called Edge Functions.
4. H3: `npm install`, commit the lock file, `npm run build`; then a Cloudflare **preview** and the UI/image review on it.
5. M1: ban the Auth user on deactivation. M2: scanning or restriction for the other upload buckets. M4: SMTP.
6. M3: CSP after the preview. Then L1–L5 and the performance indexes.

I can prepare items 2, 3 and 5 as local changes with tests (nothing deployed or applied) on your instruction.
