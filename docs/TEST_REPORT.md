# Test report

## Release readiness (20 Nov 2026, 04:00)
All available checks re-run: 873/873 database, rollbacks 30–35, 36/36 workflows, 343/343 unit, 32/32 Edge Functions in Chrome, 20/20 CSP, 12/12 recovery under CSP, 21/21 photo tool, 13/13 release-check self-test, routes 0 problems, audit scripts 52/52 + 10/10. Production folder verified on its own (schema fingerprint identical, rollbacks 34/35, browser suites). **Not run:** npm install/ci, lock file, ESLint, real typecheck, build, npm audit, bundle size — no npm registry in this session; `scripts/release-check.mjs` and the GitHub workflow run them. See `docs/deployment/RELEASE_READINESS_REPORT_2026-11-20.md`.

## Post-audit security corrections (20 Nov 2026)
`tools/check-all.sh`: **35 migrations**; database **873/873** (new `account_status.test.sql` 50, `file_scanning.test.sql` 31; three earlier assertions updated for intended changes); rollbacks 30–35 schema-identical (34 also removes the API pre-request setting); end-to-end 36/36; unit **343/343**; Edge Functions in Chrome with the real function code and a simulated Supabase **32/32**; Content-Security-Policy in Chrome **20/20**; recovery screens under the production policy 12/12; photo tool 21/21 (synthetic images); audit attack scripts (`tools/audit`): active accounts 51/51 as expected, deactivated accounts 10/10 blocked. **Not run:** npm ci / lock file / ESLint / real build / npm audit / bundle size (no registry), real Supabase, Windows. See `docs/deployment/SECURITY_CORRECTIONS_REPORT_2026-11-20.md`.

## Production preparation for Cloudflare Pages + security fix (20 Nov 2026)
`tools/check-all.sh`: **33 migrations**; database **792/792** assertions (new `security_null_role.test.sql`, 14 tests – 8 fail without migration 33); rollback 33 schema-identical and re-applies; end-to-end **36/36**; unit **336/336** (4 new for the production build guard); curriculum 41/41, generator refuses to rewrite frozen migrations 30–32; type check 0 new errors. Production package built from this tree: migrations, rollbacks, functions, templates, checks and curriculum byte-identical; a fresh database from the production package alone applies 33 migrations + seed (26 lesson plans Draft, 11 Digital Marketing topics pending); no Windows or test files; secrets scan clean. **Not run:** `npm install`/`npm run build` with real packages, real Supabase services, any live system. See `docs/deployment/SECURITY_AND_TESTING_REPORT.md`.

## Windows package: Supabase CLI v3 compatibility correction (20 Nov 2026)
`config.toml` checked against the CLI v3 migration guide: `[inbucket]` → `[local_smtp]` (already in the password-recovery ZIP; still present in the earlier curriculum ZIP), `[auth.email] enable_signup` → `enabled`; CLI v3 pinned in package.json; launchers require v3 and check database, Auth, Studio and Mailpit after start. Checks here: launcher logic **65/65**, 4 batch files 0 problems, full `check-all.sh` passes, curriculum files byte-identical to `dira-learn-v13.2-curriculum.zip` (21 files, migrations 30–32 included). **Not run:** Supabase CLI v3, `supabase start` and the .bat files on Windows (no Windows here; Docker images and npm packages cannot be downloaded in this environment).

## Self-service password recovery and CLI v3 launcher (19 Nov 2026)
`tools/check-all.sh`: database **778/778** (new `password_recovery.test.sql` 12); recovery screens in Chrome against a simulated Supabase Auth **12/12**; dry run of the real-Supabase recovery test against a mock **27/27**, no codes printed; unit **332/332** (7 new); end-to-end **36/36**; curriculum checks unchanged (26 V13.2 plans, 41/41 upgrade checks, rollbacks 30–32 identical); launcher logic **51/51**; 4 batch files 0 problems; type check 0 new errors. **Not run here:** `TEST-PASSWORD-RECOVERY.bat` against real local Supabase (no Docker daemon), Windows, styling. See `PASSWORD_RECOVERY.md`.

## V13.2 final refinements (19 Nov 2026)
`tools/check-all.sh`: database **766/766**; upgrade V13 → V13.1 → V13.2 and rollbacks **41/41**; rollbacks 30–32 schema identical; content check **0 problems**; end-to-end **36/36**; unit **325/325**; type check **0 new errors**.

## V13.1 review refinements (19 Nov 2026)
`tools/check-all.sh`: database **762/762** (11 new); upgrade pre-V13 → V13 → V13.1 → rollbacks **37/37**; rollbacks 30 and 31 schema identical; curriculum content check **0 problems** (refinement checks catch 80 problems on the pre-review source); end-to-end **36/36**; unit **325/325**; type check **0 new errors**. See `CURRICULUM_V13_1_CHANGE_REPORT.md`.

## V13 curriculum revision (19 Nov 2026)
Run with `tools/check-all.sh`: database 26 files **751/751** (new `curriculum_v13.test.sql` 54, which caught 3 of 3 deliberate faults); end-to-end workflows **36/36** (6 new curriculum steps); upgrade of a pre-V13 database with activity, then rollback **25/25**; rollback 30 schema identical, re-apply OK; curriculum content check **0 problems**; generated files in sync; unit tests **325/325** (7 new); type check **0 new errors**; frontend contract **0 problems**. Not run: browser, `npm run build`, real Supabase CLI, Windows. See `CURRICULUM_V13_CHANGE_REPORT.md`.

## Final review build (V13, 19 Nov 2026)
Run with `tools/check-all.sh` (local PostgreSQL 16 stand-in): database 25 files **697/697**; end-to-end workflows **30/30**; database = browser results **44/44**; frontend contract **0 problems**; scanner adapter **8/8**; unit tests **318/318**; type check **0 new errors**; rollbacks 23–29 verified exact. **Not run:** real typecheck, lint, component tests, build, Supabase CLI, browser. Full details: `docs/FINAL_IMPLEMENTATION_REPORT.md`.


## Phase 4 completion (19 Nov 2026)
Migrations 1–26 applied on PostgreSQL 16 (stand-in in `tools/db-standin/`). **Database tests: 22 files, 560/560 pass** (new: safeguarding 87, connect_phase4 73, minimum_age 10). Rollbacks 26→24 return the schema exactly to the migration-23 state. Unit tests: 29 of 30 runnable files, 296/296 cases. **Not run:** typecheck, lint, build, React component tests, `site.test.ts`, real Supabase CLI. Full report: `docs/PHASE4_COMPLETION_REPORT.md`.


## V8 handover audit (19 Nov 2026) – FIRST REAL EXECUTION
Migrations 1–23 and the seed were applied on PostgreSQL 16 (Supabase stand-in in `tools/db-standin/`). **Database tests: 387/387 pass** (19 files). Unit tests (pure logic): 25 of 26 runnable files pass; `site.test.ts`, the 3 `zod` tests, the 5 React component tests, typecheck, lint and build were **not run** (no `npm install`). Details, bugs fixed and gaps: `docs/HANDOVER_AUDIT_V8.md`. Older entries below describe the earlier, unexecuted state.


## Executed
- Ad-hoc Node script (not part of the repo suite) exercising `attendance/stats.ts` and `grading/scoring.ts`: 11 assertions, all passed. These mirror cases in the Vitest files.

- Module 2: same ad-hoc approach for `applications/workflow.ts` and `cohorts/rules.ts` (17 assertions from workflow.test.ts and the rules part of rules.test.ts, all passed). The zod form-schema tests could not be run (no zod available).

- Module 3: ad-hoc run of `sessions/rules.ts` (10 test cases) and `curriculum/adminRules.ts` (5 test cases), all passed.

- Module 4: `assignments/rules.ts` compiled with tsc and its 15 test cases run through a small describe/it/expect shim, all passed. Syntax-only TypeScript check of the new .tsx files and App.tsx found no syntax errors (type checking was not possible without installed packages).

- Resources: `resources/rules.ts` compiled and its 6 test cases run through the same shim, all passed. Syntax-only check of the new page and the edited session page found no syntax errors.

- Module 5: `results/rules.ts` and its test file compiled with `tsc --strict` (clean) and the 16 test cases run through the same shim, all passed. Syntax-only check of the results page, edited assignments page and App.tsx found no syntax errors.

- Remaining modules: `rules.ts` of mentorship, M&E, certificates, projects and admin compiled with `tsc --strict` (clean, with unused-code checks) and their 39 test cases run through the shim, all passed. `permissions.test.ts` (14 cases, including the new roles and navigation) also passed through the shim. All 27 new or changed .ts/.tsx files pass a syntax-only parse. React type checking was not possible (no packages).

- Email, calendar and analytics: rules modules compiled with `tsc --strict` and their 29 cases passed through the shim; the shared email layout and webhook-signature helpers (8 cases, including tampered body, wrong secret and replayed timestamp) passed under Node; navigation tests passed (15). New screens parse without syntax errors; React type checking was not possible.

- Courses: `rules.ts` compiled with `tsc --strict` and its 11 cases passed through the shim; navigation tests passed (16); both new screens parse without syntax errors.

- Sign-up and import: `signupRules.ts` and `import/rules.ts` compiled with `tsc --strict` and their 13 cases passed through the shim (CSV quoting, semicolons, byte-order mark, bad rows, duplicates, row limit); navigation tests passed; the new pages parse without syntax errors.

- Website alignment: photo-rotation logic checked by hand (4 cases); all changed files parse without syntax errors.

## Written but NOT executed
- Website alignment: `site.test.ts`, `CoverHero.test.tsx`, updated `LoginPage.test.tsx` (values, website link); the dashboard and shell changes; Netlify build and redirects.
- Sign-up and import: pgTAP `learner_import.test.sql` (5 assertions); the three new screens; the `import-learners` function (needs a real Supabase project and working Auth SMTP); the login-link test.
- Courses: pgTAP `courses.test.sql` (15 assertions: trainer create and publish limits, auto-assignment, unassigned trainer, lesson folder rule, publish needs a lesson, cohort rule on enrolment, participant visibility and progress); the two screens; storage policies for `course-materials`.
- Email: pgTAP `email_system.test.sql` (13 assertions); the screens; both Edge Functions; the Resend integration (needs a real account).
- Remaining modules: Vitest files for the five new rules modules (real runner); pgTAP `remaining_modules.test.sql` (24 assertions covering mentor rules, mentee visibility, profile guards, user listing, direct certificate writes, approved-rule requirement, attendance requirement, issuing, duplicates, graduated status, notification)
- Older pgTAP files still change `profiles.role` directly. That now works because direct database sessions are trusted by the profile guards (before migration 9 it would have been refused by the guard).
- Module 5: Vitest `results/rules.test.ts` (real runner), extra case in `permissions.test.ts` (participant navigation now ends with Results); pgTAP `assignment_components.test.sql` (5 assertions)
- Resources: Vitest `resources/rules.test.ts` (real runner), extra case in `permissions.test.ts`; pgTAP `resources.test.sql` (12 assertions, including storage object access, which needs the local Supabase storage schema to run)
- Module 4: Vitest `assignments/rules.test.ts` (real runner), extra case in `permissions.test.ts` (and the participant navigation expectation now includes Assignments); pgTAP `assignments_grading.test.sql` (23 assertions)
- Module 3: Vitest `sessions/rules.test.ts`, `curriculum/adminRules.test.ts`, extra case in `permissions.test.ts`; pgTAP `sessions_curriculum.test.sql` (11 assertions)
- Module 2: Vitest `workflow.test.ts`, `rules.test.ts` (schema cases), extra case in `permissions.test.ts`; pgTAP `applications_cohorts.test.sql` (13 assertions)
- Vitest: 34 cases in 6 files (permissions, application schema, attendance rate, scoring, ProtectedRoute, ProgrammeArc)
- pgTAP RLS tests: 9 assertions (`supabase/tests/rls.test.sql`)
- Playwright: 2 specs (`e2e/login.spec.ts`, no backend needed)

## Not run at all
TypeScript check, ESLint, production build, migrations, seed, Edge Functions. The authoring environment has no package registry, PostgreSQL, Docker or Supabase CLI. Expect type errors and SQL errors on first run.

## Not yet covered by any test
The screens for every remaining module; the announcement fan-out, grading, application and notification triggers; project and evidence guards; settings and graduation-rule approval triggers; safeguarding policies; `invite-user`.
Earlier:
Application review, cohort, session, curriculum admin and assignment screens (no component or e2e tests), attendance page, track selection function, storage policies, Edge Functions, capacity trigger, reporting views.

The Windows launcher and its tests were removed on 8 Nov 2026 (the system is hosted online).

## Applicant approval module (8 Nov 2026)
**Run in the build environment:** the pure logic of the new `workflow.ts` helpers and the applicant-access permission rules (a Node script with the same assertions as the new unit tests): passed.
**Written but NOT run** (no Postgres, `node_modules` or network available): `supabase/tests/applicant_approval.test.sql` (42 pgTAP checks: pending applicant has no access and cannot approve or change role; coordinator cannot decide; director/super admin approve and reject; own application refused; repeat decision refused; profile, participant, portfolio, history, audit, notification and email records; rejected applicant gets no access; no duplicate notification; reason not emailed), the new cases in `src/features/applications/workflow.test.ts` and `src/lib/permissions.test.ts`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and the migration itself.
**Reviewed by reading only:** the migration was checked by hand for name clashes and signatures. Treat it as untested SQL until `supabase db reset` and `supabase test db` pass.

## Curriculum Approval Centre (8 Nov 2026)
**Run in the build environment:** the pure logic of `approvalRules.ts` (summary counts, filters, grouping by the four tracks including an empty one, actions per status and role, comment rules) and the role/navigation rules in `permissions.ts` (only super_admin, founder and co_founder reach the Approval Centre; founders get no staff pages; all earlier permission expectations still hold with the new roles), as Node scripts with the same assertions as the new unit tests: passed.
**Written but NOT run** (no Postgres, `node_modules` or network available): `supabase/tests/curriculum_approval.test.sql` (46 pgTAP checks covering Founder, Co-Founder and Super Administrator approving and rejecting; Programme Director, Coordinator, Trainer, Participant and Applicant refused; direct update and delete refused; history immutable; rejected topics hidden; approved topics official in the right session; duplicate and cross-track behaviour; reconsidering), the new cases in `approvalRules.test.ts`, `permissions.test.ts` and `admin/rules.test.ts`, the migrations themselves, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
**Not tested:** login, registration and staff invitations after the change (they were only checked by reading: no auth code changed, and the invite function gained two allowed roles).
