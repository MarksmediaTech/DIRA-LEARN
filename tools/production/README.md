# DIRA LEARN – production package (DIRA Foundation)

Learning management system for DIRA Foundation programmes. **Frontend:** React + Vite, hosted on Cloudflare Pages.
**Backend:** Supabase (PostgreSQL database with row-level security, Auth, Storage, Realtime, Edge Functions).

This package contains only what is needed to build, deploy, operate and maintain DIRA LEARN. Local Windows launchers,
test suites and development history are in the separate development archive (`dira-learn-v13.2-dev-archive.zip`).
`docs/deployment/REMOVED_FILES.md` lists what was left out.

**Status (20 Nov 2026): not deployed yet. Includes the post-audit security fixes (migrations 34 and 35, Edge Function CORS,
Content-Security-Policy, photo pipeline), tested locally only.** Start here:

1. `docs/deployment/SUPABASE_PRODUCTION.md` – read-only checks of the live project, backup, migration plan, Auth, SMTP,
   Edge Functions, secrets and the production checklist.
2. `docs/deployment/CLOUDFLARE_PAGES.md` – Cloudflare Pages build settings, environment variables, GitHub connection,
   preview and production deployments, custom domain and SSL, future updates.
3. `docs/deployment/SECURITY_CORRECTIONS_REPORT_2026-11-20.md` – what the post-audit fixes changed, test results, open items.
4. `docs/deployment/RELEASE_CHECK_FIXES_2026-11-20.md` – corrections after the first GitHub release check, open dependency findings and the upgrade plan.
5. `docs/deployment/DEPLOYMENT_CHECKLIST.md` – the step-by-step list for the first deployment, and
   `docs/deployment/RELEASE_READINESS_REPORT_2026-11-20.md` – every check that passed, failed or could not run.
6. `docs/deployment/AUDIT_REPORT_2026-11-20.md` – the independent pre-production audit the fixes answer.
7. `docs/deployment/SECURITY_AND_TESTING_REPORT.md` – audit results (including the migration 33 security fix), what was and
   was not verified, and the post-deployment test plan.

## Build
- Node.js 22 (`.nvmrc`); `npm install` (commit the generated `package-lock.json`), then `npm run build` → `dist/`.
  The build writes the Content-Security-Policy into `dist/_headers` (`scripts/write-headers.mjs`) and stops if
  `VITE_SUPABASE_URL` is missing or not https.
- Build-time variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_PUBLIC_SITE_URL` (`.env.example`).
  A production build without them shows a "not available" page rather than a broken site.
- `public/_headers` sets security headers (and the policy placeholder) on Cloudflare Pages. No `404.html`, so Cloudflare serves
  the app for every route.

## Release check (run before every deployment)
`node scripts/release-check.mjs` (Node 22, internet): creates `package-lock.json` if missing, then npm ci, TypeScript, ESLint,
a verification build, dist/security-header checks, bundle sizes and npm audit; writes `release-check-report.md`. The same check
runs on GitHub on every push (`.github/workflows/release-check.yml`, no deployment, no secrets).

## Contents
- `src/` – application (feature modules under `src/features/`)
- `supabase/migrations/` – database migrations 01–35, applied in order with `npx supabase db push --remote` (never `db reset` on production)
- `supabase/rollback/` – rollback scripts for migrations 14, 16 and 23–35
- `supabase/functions/` – Edge Functions (browser-called ones use `_shared/cors.ts`); `supabase/templates/recovery.html` – password-reset e-mail
- `supabase/checks/` – read-only SQL checks for the live project; `supabase/seed.sql` – reference data for new projects only
- `curriculum/v13/` and `tools/curriculum/` – V13.2 curriculum source and its generator; `docs/curriculum/` – lesson plans
- `tools/photos/` – prepares the approved original DIRA photographs for `public/photos` (needs Python with Pillow and PyYAML)
- `docs/` – module guides (applications, curriculum approval, safeguarding, DIRA Connect, attachments, e-mail, password recovery …)

## Curriculum
26 V13.2 lesson plans across the core sessions and four tracks (Digital Marketing, AI Tools, Content Creation,
Entrepreneurship & Business); session durations 110, 115 and 120 minutes. All plans are **Draft** and the 11 Digital
Marketing topics are pending: approval is done in the app (Manage curriculum / Curriculum Approval Centre) by the Founder,
Co-Founder or Super Administrator.

## Security rules for operators
Never put the service-role or secret key, database password, SMTP/Resend keys or any other secret in Cloudflare variables,
the frontend or the repository. Never run `supabase db reset` against production. Take a backup before every migration. Deactivate people with
Deactivate on the Users page (never by deleting the account): it keeps their records and blocks access and sign-in at once.
