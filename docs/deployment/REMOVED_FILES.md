# Files left out of the production package

The production package is built from the development project with `tools/make-production-package.sh` (development archive).
All files below are kept unchanged in `dira-learn-v13.2-dev-archive.zip`. No application source, migration, rollback, Edge
Function, e-mail template, security policy, database function, Supabase configuration or build dependency was removed.
The local settings file `.env.local` is never packaged.

**138 files removed.**

## Windows and local launcher files (5) – local Windows testing only

- `CHECK-DIRA-LEARN.bat`
- `CREATE-DIRA-TEST-ACCOUNTS.bat`
- `README-LOCAL-TESTING.txt`
- `START-DIRA-LEARN.bat`
- `TEST-PASSWORD-RECOVERY.bat`

## Old hosting configuration (1) – Netlify replaced by Cloudflare Pages

- `netlify.toml`

## Browser end-to-end tests (3) – tests stay in the archive

- `e2e/login.spec.ts`
- `e2e/password-recovery.spec.ts`
- `playwright.config.ts`

## Unit and component tests (45) – tests stay in the archive

- `src/components/ui/PhotoStage.test.tsx`
- `src/features/admin/rules.test.ts`
- `src/features/admin/safeguardingRules.test.ts`
- `src/features/analytics/rules.test.ts`
- `src/features/applications/schema.test.ts`
- `src/features/applications/workflow.test.ts`
- `src/features/assignments/rules.test.ts`
- `src/features/attendance/stats.test.ts`
- `src/features/auth/LoginPage.test.tsx`
- `src/features/auth/ProtectedRoute.test.tsx`
- `src/features/auth/SetupPage.test.tsx`
- `src/features/auth/accountStatus.test.ts`
- `src/features/auth/recoveryRules.test.ts`
- `src/features/auth/signupRules.test.ts`
- `src/features/briefs/rules.test.ts`
- `src/features/calendar/rules.test.ts`
- `src/features/certificates/rules.test.ts`
- `src/features/cohorts/accessRules.test.ts`
- `src/features/cohorts/rules.test.ts`
- `src/features/connect/rules.test.ts`
- `src/features/courses/rules.test.ts`
- `src/features/curriculum/adminRules.test.ts`
- `src/features/curriculum/approvalRules.test.ts`
- `src/features/curriculum/lessonPlan.test.ts`
- `src/features/dashboard/CoverHero.test.tsx`
- `src/features/dashboard/ProgrammeArc.test.tsx`
- `src/features/dashboard/attention.test.ts`
- `src/features/emails/rules.test.ts`
- `src/features/grading/scoring.test.ts`
- `src/features/import/rules.test.ts`
- `src/features/intelligence/rules.test.ts`
- `src/features/me/rules.test.ts`
- `src/features/mentorship/rules.test.ts`
- `src/features/performance/rules.test.ts`
- `src/features/projects/rules.test.ts`
- `src/features/resources/rules.test.ts`
- `src/features/results/rules.test.ts`
- `src/features/sessions/rules.test.ts`
- `src/lib/emailShared.test.ts`
- `src/lib/permissions.test.ts`
- `src/lib/photoSources.test.ts`
- `src/lib/site.test.ts`
- `src/lib/supabaseConfig.test.ts`
- `src/lib/timezone.test.ts`
- `src/test/setup.ts`

## Database tests and local-only SQL (32) – pgTAP tests; local test accounts; local curriculum reset (must never run on production)

- `supabase/local_test_accounts.sql`
- `supabase/reset_curriculum.sql`
- `supabase/tests/access_rules_v2.test.sql`
- `supabase/tests/account_status.test.sql`
- `supabase/tests/applicant_approval.test.sql`
- `supabase/tests/applications_cohorts.test.sql`
- `supabase/tests/assignment_components.test.sql`
- `supabase/tests/assignment_recipients.test.sql`
- `supabase/tests/assignments_grading.test.sql`
- `supabase/tests/attachment_scanning.test.sql`
- `supabase/tests/cohort_access.test.sql`
- `supabase/tests/cohort_intelligence.test.sql`
- `supabase/tests/connect_phase4.test.sql`
- `supabase/tests/courses.test.sql`
- `supabase/tests/curriculum_approval.test.sql`
- `supabase/tests/curriculum_v13.test.sql`
- `supabase/tests/daily_briefs.test.sql`
- `supabase/tests/dira_connect.test.sql`
- `supabase/tests/email_system.test.sql`
- `supabase/tests/executive_roles.test.sql`
- `supabase/tests/file_scanning.test.sql`
- `supabase/tests/first_admin.test.sql`
- `supabase/tests/learner_import.test.sql`
- `supabase/tests/learner_performance.test.sql`
- `supabase/tests/minimum_age.test.sql`
- `supabase/tests/password_recovery.test.sql`
- `supabase/tests/remaining_modules.test.sql`
- `supabase/tests/resources.test.sql`
- `supabase/tests/rls.test.sql`
- `supabase/tests/safeguarding.test.sql`
- `supabase/tests/security_null_role.test.sql`
- `supabase/tests/sessions_curriculum.test.sql`

## Development and test tools (45) – check runners, database stand-in, audit scripts, Edge Function / CSP / recovery browser tests, release-check and route self-tests, photo-tool self-test, package builder

- `tools/audit/README.md`
- `tools/audit/attacks.sh`
- `tools/audit/attacks2.sh`
- `tools/audit/attacks3.sh`
- `tools/audit/matrix.sh`
- `tools/audit/seed_audit.sql`
- `tools/check-all.sh`
- `tools/check_bat_files.py`
- `tools/csp/run.mjs`
- `tools/curriculum/fixtures/seed_before_v13.sql`
- `tools/curriculum/upgrade_check.py`
- `tools/db-standin/README.md`
- `tools/db-standin/crosscheck_results.ts`
- `tools/db-standin/db_reset.sh`
- `tools/db-standin/db_test.sh`
- `tools/db-standin/frontend_contract_check.py`
- `tools/db-standin/pgtap_shim.sql`
- `tools/db-standin/run_unit.sh`
- `tools/db-standin/scanner_adapter_check.ts`
- `tools/db-standin/supabase_shim.sql`
- `tools/db-standin/verify_rollback.sh`
- `tools/db-standin/vitest_shim.mjs`
- `tools/db-standin/workflow_check.sql`
- `tools/edge-browser/build.mjs`
- `tools/edge-browser/fake-supabase.mjs`
- `tools/edge-browser/run.mjs`
- `tools/launcher_logic_check.py`
- `tools/make-production-package.sh`
- `tools/photos/check_prepare.py`
- `tools/production/README.md`
- `tools/production/env.example`
- `tools/recovery/browser/build.mjs`
- `tools/recovery/browser/fake-supabase.ts`
- `tools/recovery/browser/harness.tsx`
- `tools/recovery/browser/icons-shim.tsx`
- `tools/recovery/browser/router-shim.tsx`
- `tools/recovery/browser/run.mjs`
- `tools/recovery/dryrun/dryrun.sh`
- `tools/recovery/dryrun/mock_supabase.mjs`
- `tools/recovery/recovery_check.mjs`
- `tools/release/check_release_check.mjs`
- `tools/release/routes_check.py`
- `tools/typecheck-stubs/baseline.txt`
- `tools/typecheck-stubs/run.sh`
- `tools/typecheck-stubs/stubs.d.ts`

## Development history documents (7) – progress logs and earlier reports; superseded by docs/deployment/

- `docs/DEVELOPMENT_PROGRESS.md`
- `docs/FINAL_IMPLEMENTATION_REPORT.md`
- `docs/HANDOVER_AUDIT_V8.md`
- `docs/INTERFACE_POLISH.md`
- `docs/NETLIFY_DEPLOYMENT.md`
- `docs/PHASE4_COMPLETION_REPORT.md`
- `docs/TEST_REPORT.md`

## Replaced by Chat and the notification bell (22 Nov 2026)

- `src/features/notifications/NotificationsPage.tsx` – notifications are in the bell (`src/components/ui/NotificationBell.tsx`).
- `src/features/notifications/AnnouncementsPage.tsx` – announcements are a section of Chat (`src/features/chat/Announcements.tsx`).
- `src/features/connect/ConnectPage.tsx` – conversations are in Chat (`src/features/chat/ChatPage.tsx`). `ModerationPage.tsx` stays.

## Changed in the production package (not removed)

- `package.json`: test scripts (`test`, `test:watch`, `test:e2e`) and local database scripts (`db:reset`, `db:test`, `db:types`)
  and the `@playwright/test` dev dependency removed; `preview` and `engines` added. The `supabase` CLI (v3) stays (migrations and
  Edge Functions are deployed with it); `vitest` and the testing-library types stay because `tsconfig.json` references their types.
- `README.md`, `.env.example`: production versions (from `tools/production/` in the archive).
- `docs/PASSWORD_RECOVERY.md`: the sections on tests, local Windows testing and the launcher are replaced by a pointer to the archive.

## Kept tools

- `tools/curriculum/` (curriculum generator) and `tools/photos/prepare.py` + `photos.yaml` (photo preparation).
- `scripts/release-check.mjs` and `.github/workflows/release-check.yml` (release check), `.gitattributes` (LF line endings on Windows too).
