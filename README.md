# DIRA LEARN Management System (DIRA Foundation)

## Start here (clean rebuild and new production release, 21 Nov 2026)

1. **`docs/deployment/INSTALL_GUIDE.md`** – the new deployment, browser only: new private GitHub repository, new Supabase project
   (database from `supabase/install`, STEP-0 to STEP-5 in the SQL Editor), Edge Functions, new Cloudflare Worker `dira-learn-v2`,
   first Super Administrator through `/setup`, troubleshooting and recovery.
2. **`docs/deployment/RELEASE_AUDIT_AND_TEST_REPORT_2026-11-21.md`** – causes found and fixed, what was tested
   (PASS / NOT TESTED / BLOCKED), open items.
3. `supabase/baseline/` – the database as three plain migrations (the final state of migrations 01–39 + seed, no text patching),
   proved identical by `tools/baseline/baseline_check.sh`. `supabase/install/` is the same, cut into pasteable steps.
4. `docs/deployment/MIGRATION_REGISTER.md` – the 39 historical migrations (still the source the baseline is generated from).

The old deployment (old repository, Supabase project `odfiawrvmaafdskbkptv`, old Worker) is not changed by this release.
Documents written for it are marked *Superseded*.

**Not tested here** (no package registry, PostgreSQL 17, GitHub, Supabase or Cloudflare access while building): a real `npm ci`,
Vite build, ESLint, Vitest component tests, `npm audit`, Playwright, PostgreSQL 17, the real Supabase Dashboard and Auth Admin API,
Cloudflare. GitHub runs the first ones and PostgreSQL 17 automatically on upload (`release-check`, `database-pg17`).

## Try it on your own Windows computer
Forgot password is self-service for every role (emailed 6-digit code; see `docs/PASSWORD_RECOVERY.md`); test it locally with `TEST-PASSWORD-RECOVERY.bat`.
Double-click `START-DIRA-LEARN.bat` (needs Node.js 22 LTS and Docker Desktop). It starts a local database and the website and opens http://localhost:5173. Run `CREATE-DIRA-TEST-ACCOUNTS.bat` once for test sign-ins, and `CHECK-DIRA-LEARN.bat` if something fails. Everything stays on your computer. See `README-LOCAL-TESTING.txt`. The launchers have been checked on Linux but not yet run on Windows.

## Contents
- `supabase/config.toml` – settings for the local Supabase (`npx supabase start`); added in V13
- `supabase/migrations/20260101000001_schema.sql` – PostgreSQL schema (about 50 tables, enums, audit triggers, indexes)
- `supabase/migrations/20260101000002_rls.sql` – role helpers, signup/role-escalation guards, Row Level Security, `select_track()`, `verify_certificate()`
- `supabase/seed.sql` – roles, programme, 4 tracks (Digital Marketing, AI Tools, Content Creation, Entrepreneurship & Business), 2 core + 6 track sessions each (8 sessions over 4 weeks), draft settings. No participant data.
- `supabase/migrations/20260101000004_applications_cohorts.sql` – application workflow function, capacity/one-cohort rules, scheduling conflict triggers
- `supabase/migrations/20260101000005_sessions_curriculum_admin.sql` – session reports, complete_session, curriculum approval guards
- `supabase/migrations/20260101000006_assignments_grading.sql` – assignment max score, submission and grading guards, narrowed trainer policies
- `supabase/migrations/20260101000007_resources_visibility.sql` – resource sharing flag, tightened resource and file access, http(s)-only links
- `supabase/migrations/20260101000009_remaining_modules.sql` – profile guards, mentorship, M&E, certificate functions, notifications, projects, settings approval, safeguarding, append-only audit
- `docs/` – architecture, assumptions register, progress, test report

## Applicant approval
Administrators approve or reject applicants inside the app (Applications). See `docs/APPLICANT_APPROVAL.md`.

## Curriculum Approval Centre
Founder, Co-Founder and Super Administrator approve or reject proposed curriculum topics inside the app. See `docs/CURRICULUM_APPROVAL_CENTRE.md`.

## Founder and Co-Founder access
Super Administrator, Founder and Co-Founder have equivalent administrative access; only the Super Administrator assigns roles. See `docs/EXECUTIVE_ROLES.md` (migration 17, decisions needed).

## Cohort intakes and learning access
Cohorts have recruitment periods and learning-portal access windows, enforced in the database. See `docs/COHORT_ACCESS.md` (migration 18, decisions needed).

## Learner assignments
A My Assignments dashboard section, grouped assignment list and individual assignments. See `docs/ASSIGNMENTS_PHASE2.md` (migration 20, decisions needed).

## Daily Briefs
A learner Daily Brief on the dashboard and a staff page to write, schedule and publish briefs. See `docs/DAILY_BRIEFS.md` (migration 21, decisions needed).

## DIRA Connect
Private messaging with facilitators (either side can start), cohort discussions, support messaging when learning access is closed, a confidential safeguarding-team conversation, attachments, retention and moderation. See `docs/DIRA_CONNECT.md` (migrations 22, 24, 25).

## Safeguarding
Designated Safeguarding Lead and Deputy, confidential records only they can read, escalation with response targets, logged access, minimum age 18. See `docs/SAFEGUARDING.md` (migrations 24, 26). To check the live project's migrations read-only: `docs/CHECK_LIVE_MIGRATIONS.md`.

## Learner performance, Cohort Intelligence, attachments, interface (Phases 6, 7, 9)
See `docs/LEARNER_PERFORMANCE.md` (migration 27), `docs/COHORT_INTELLIGENCE.md` (28), `docs/ATTACHMENT_SECURITY.md` (29) and `docs/INTERFACE_POLISH.md`.
Local test accounts for every role: `supabase/local_test_accounts.sql` (your own computer only).

## Put it online
Follow `docs/NETLIFY_DEPLOYMENT.md` (the first administrator is created on the app's `/setup` page, no SQL): a hosted Supabase project (database, sign-in, functions) plus a Netlify site for the pages. Nothing in this project is Windows-specific.

## Checks before the first deploy (any computer with Node 22)
```
npm install
npm run typecheck && npm run lint && npm test && npm run build
```
Fix whatever fails; none of this has been run yet. To try the database locally you also need Docker and the Supabase CLI: `supabase start && supabase db reset` (applies the migrations, then `seed.sql`), then `npm run db:test`.

## Stack
React + TypeScript + Vite + Tailwind + shadcn/ui, TanStack Query, React Hook Form + Zod, Recharts; Supabase (Postgres, Auth, Storage, Edge Functions); Vitest, Testing Library, Playwright.
