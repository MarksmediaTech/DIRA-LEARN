# DIRA LEARN – release readiness for the first Cloudflare deployment

**Date:** 20 Nov 2026 (04:00 Nairobi). **Source:** development project with migrations 01–35 and every approved fix.
**Deliverable:** `dira-learn-production` (GitHub-ready folder, 248 files) and `dira-learn-production.zip`; the development
archive is kept separately. **Not done (by instruction):** no live migration, no deployment, no DNS change, no curriculum
approval, no production account change, nothing purchased.

## 1. The npm steps – could not run in this environment

This session cannot reach the npm registry: `npm view react version` → network error; a request through the session's proxy
→ HTTP 403. The local npm cache (30 MB) holds only unrelated tool packages (no React, Vite, typescript-eslint, Supabase
client). A `package-lock.json` can therefore **not** be generated here, and one was **not** written by hand.

| Step you asked for | Result here | How it is completed |
|---|---|---|
| package-lock.json from the real dependencies | **NOT RUN** (no registry) | `scripts/release-check.mjs` runs `npm install` when the lock file is missing and tells you to commit it |
| npm install, npm ci | **NOT RUN** | same script, then `npm ci` |
| TypeScript with the real packages | **NOT RUN**; substitute: strict check with stub type definitions – **0 new errors** (20 known stub limitations) | `npm run typecheck` in the script |
| ESLint | **NOT RUN** (ESLint and its TypeScript/React plugins not available) | `npm run lint` in the script |
| production build, Node 22, Cloudflare settings | **NOT RUN** | `npm run build` in the script, with the real CSP step; then dist checks: SPA routing (no 404.html), `_headers` filled in, no secret key, no localhost, no eval |
| npm audit | **NOT RUN** | production and all dependencies, severity counts, which fixes would be breaking majors (reported, never forced) |
| bundle-size analysis | **NOT RUN** | every asset with gzip and brotli size, initial JavaScript total, warnings above 400 KB initial / 300 KB per file |

Two ways to run them, both need only Node 22 and internet:
1. **GitHub (no Windows needed):** push the folder to a private repository; the workflow `.github/workflows/release-check.yml`
   runs the script on every push (read-only, no secrets, no deployment) and keeps `release-check-report.md` and the generated
   `package-lock.json` as a downloadable artifact.
2. **Your Windows computer:** in the folder, `node scripts/release-check.mjs` (Node 22 from nodejs.org).

The script itself was tested here: **13/13** on synthetic builds and audit outputs (finds a 404.html, an unfilled or weakened
policy, a service-role key, eval, large bundles; counts severities; marks breaking fixes), and run end-to-end here it stops at
the install step and records it as FAIL/NOT RUN – it does not report success it did not get.
**If you enable package installs for this account (network settings) and start a new chat, I can run all of these here.**

## 2. Everything else – executed here on 20 Nov 2026

| Area | Check | Result |
|---|---|---|
| Database migrations | fresh database, migrations 01–35 + seed, from the **production folder alone** | applied |
| | schema of the production folder = `expected_schema_fingerprint.txt` (2,269 lines) | identical |
| | rollbacks 30–35 (each: schema identical to before, re-apply OK); rollback 34 also removes the API setting; 34 and 35 re-verified on the production folder | **pass** |
| Role permissions | database tests (pgTAP), incl. 50 account-status and 31 file-scanning assertions | **873 / 873** |
| | audit attack scripts, active accounts in 8 roles, two cohorts | **52 / 52** as expected |
| | deactivated trainer and learner (existing session) | **10 / 10** blocked |
| Workflows | end-to-end workflows across phases | **36 / 36** |
| | database results = TypeScript results | 44 figures, 0 differences |
| | every function, table and bucket the screens use exists | 0 problems |
| Routes | 6 public pages, 37 role-guarded routes, 34 menu entries, catch-all page | **0 problems** |
| Authentication, password recovery | recovery screens in Chrome (simulated Supabase Auth) | **12 / 12**, and **12 / 12 under the production Content-Security-Policy** |
| | dry run of the real-Supabase recovery test (mock server); no code or password in any log | 27 / 27 |
| Edge Functions | real function code in Chrome, simulated Supabase: invitations, learner import, applicant conversion, first-admin setup, e-mail, deactivate/reactivate with ban, refusals, other-website preflight refused, scheduler, scanner | **32 / 32** (run on the production folder) |
| File uploads | scan-before-download across all buckets, cohort-limited trainer access, re-upload needs new scan (in the 873) ; scanner adapter | pass; 8 / 8 |
| Security policies | Content-Security-Policy in Chrome (Supabase API, Auth, Storage, Realtime allowed; other sites, inline script, eval, framing blocked; build stops without https address) | **20 / 20** (on the production folder) |
| | secrets scan of the production folder | clean |
| Logic | unit tests (pure logic) | **343 / 343**; 1 file (`site.test.ts`) needs Vite's environment and runs only with the real packages |
| Code | syntax of all 169 TypeScript files | 0 errors |
| Curriculum | 26 lesson plans, all **Draft**; 11 Digital Marketing topics **pending**; only the Value Proposition session approved; durations 110, 115, 24 × 120; source and documents unchanged | confirmed |
| Photos | preparation tool on synthetic test images (no crop, no stretch, no upscale, metadata/GPS removed, small originals refused) | 21 / 21. **The six original DIRA photographs have NOT been processed** – the files are not available here; the site still loads them from the DIRA website |
| Windows launchers (development archive only) | static batch-file check; launcher decision logic | 4 files / 0 problems; 65 / 65 – **not run on Windows** |

## 3. Production folder contents
- **Excluded (138 files, listed in `REMOVED_FILES.md`):** all `.bat` launchers, `README-LOCAL-TESTING.txt`, end-to-end and unit
  tests, pgTAP tests, local test accounts, local curriculum reset, all test and check tools, development history, Netlify config,
  `.env.local`. Verified: no Windows or local-test file left.
- **Included:** source, migrations 01–35 (34 and 35 present), 15 rollback scripts (14, 16, 23–35), 8 Edge Functions,
  e-mail template, read-only live checks, curriculum and its generator, photo tool, `scripts/write-headers.mjs`,
  `scripts/release-check.mjs`, `.github/workflows/release-check.yml`, `.nvmrc` (22), `.gitattributes` (LF endings, so Windows
  Git does not alter SQL or `_headers`), `.gitignore`, `.env.example`, `docs/deployment/DEPLOYMENT_CHECKLIST.md`.
- **Git check (scratch copy):** 248 of 248 files tracked, none ignored by mistake, all text files LF, largest file 417 KB.
- No lock file yet (see §1).

## 4. What genuinely needs your computer or an outside account
1. **Internet + Node 22** (GitHub Actions or your Windows computer): lock file, npm ci, TypeScript, ESLint, build, npm audit,
   bundle sizes – `node scripts/release-check.mjs`. Send me the report; I will fix whatever it finds.
2. **GitHub:** a private repository and the first push (the folder is ready).
3. **Supabase:** read-only checks on the live project, backup, your approval, then migrations 33–35 (and any missing), Auth/SMTP
   settings, Edge Function deployment and secrets (`APP_URL`, `ALLOWED_ORIGINS`), a virus scanner (or accept that uploads stay
   unavailable).
4. **Cloudflare:** the Pages project, variables, preview and production deployments.
5. **Domain registrar / DNS:** the `learn.<domain>` CNAME and SSL.
6. **Windows:** only for the local launchers in the development archive (never run on Windows so far).
7. **Photos:** the six original files and confirmation of consent.

Follow `DEPLOYMENT_CHECKLIST.md`, top to bottom.
