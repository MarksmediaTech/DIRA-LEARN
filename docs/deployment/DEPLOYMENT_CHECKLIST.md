# DIRA LEARN – first production deployment checklist

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


Tick each line in order. **Stop** at any line that fails and send the result. Nothing here has been done yet.
Who: **You** = needs your computer or an outside account; nothing on this list can be done from the development session.

## A. Source and build (before anything goes live)
- [ ] **You:** create a **private** GitHub repository and upload the contents of `dira-learn-production` (the folder is ready:
      `git init -b main`, `git add -A`, `git commit -m "DIRA LEARN production source"`, `git remote add origin <url>`, `git push -u origin main`).
- [ ] The **release-check** workflow runs on GitHub automatically (Actions tab). Download its `release-check` artifact.
      Or on your computer with Node 22 and internet, in the folder: `node scripts/release-check.mjs`.
- [ ] If the report says *package-lock.json was created*: commit that file (from the artifact or your folder) and push.
- [ ] Release check: **all steps PASS** – npm ci, TypeScript, ESLint, build, dist checks, npm audit (no high/critical in
      production dependencies). Send me `release-check-report.md` if anything fails; never run `npm audit fix --force`.

## B. Supabase (read-only first)
- [ ] **You:** run `supabase/checks/live_migration_check.sql`, `live_migration_check_part2.sql`, `production_preflight.sql`
      and `live_full_inspection.sql` in the live SQL Editor; send the results. They change nothing.
- [ ] Decide with the results which migrations are missing (expected at least 33, 34, 35).
- [ ] **You:** take the backup (`SUPABASE_PRODUCTION.md` §1 step 1). Approve the migrations in writing.
- [ ] Apply: `npx supabase db push --remote --dry-run`, check the list, then `npx supabase db push --remote`.
- [ ] Re-run `production_preflight.sql`: all counts equal or higher; "API pre-request check" shows `public.check_request`.
- [ ] Auth settings, SMTP and the recovery template (`SUPABASE_PRODUCTION.md` §2).
- [ ] Edge Functions deployed incl. `set-account-status`; secrets `APP_URL`, `ALLOWED_ORIGINS` (preview address), `CRON_SECRET`,
      e-mail and scanner secrets (§3). Virus scanner chosen and running, or accept that uploaded files stay unavailable.

## C. Cloudflare (Workers project with static assets – `CLOUDFLARE_PAGES.md` §0)
- [ ] **You:** in the Cloudflare project check: build command `npm run build`, deploy command `npx wrangler deploy`, the
      Worker name equals `"name"` in `wrangler.jsonc`, and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are **build** variables.

## C2. Cloudflare Pages (only if you use a Pages project instead)
- [ ] **You:** Pages project from the GitHub repository: build `npm run build`, output `dist`, Node 22, variables
      `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable key) – `CLOUDFLARE_PAGES.md`.
- [ ] Preview deployment from a `release-…` branch builds without errors.
- [ ] Preview checks (`SECURITY_CORRECTIONS_REPORT_2026-11-20.md` §8, `SECURITY_AND_TESTING_REPORT.md` §4): pages and deep links
      load; sign-in; password reset code arrives; invite and import work (no CORS error); no Content-Security-Policy errors in
      the console; a deactivated test account is shut out at once; an upload waits for its virus scan.
- [ ] Merge to `main` → production deployment. Repeat the checks on the production URL.

## D. Domain and SSL
- [ ] **You:** custom domain `learn.<dira-domain>` in Pages; CNAME at the DNS provider if DNS is not on Cloudflare.
- [ ] Domain **Active**, padlock shown, `http://` redirects to `https://`; then Supabase Site URL and redirect URLs set to it.

## E. After launch
- [ ] Photos: send the six approved originals; they are prepared with `tools/photos/prepare.py` (until then the site loads
      them from the DIRA website).
- [ ] Accounts deactivated before migration 34: ban them in Supabase Authentication.
- [ ] Curriculum: 26 lesson plans are Draft and wait for approval in the app by the authorised approvers.
