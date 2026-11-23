# DIRA LEARN on Cloudflare Pages

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


**Status (20 Nov 2026, updated after the post-audit fixes): prepared, not deployed.** No Cloudflare, GitHub, Supabase or domain access was available to the
developer, so nothing below has been run. Every value in angle brackets (`<...>`) must come from you; none is invented here.

Architecture: Cloudflare Pages serves the React/Vite frontend only. Supabase stays the database, sign-in, storage, Realtime
and Edge Functions. Nothing is moved to Cloudflare storage or a Cloudflare database.

## 0. Cloudflare Workers (the project type DIRA LEARN was imported as, 20 Nov 2026)

The Cloudflare project builds with `npm run build` and deploys with `npx wrangler deploy` (Workers Builds). DIRA LEARN is
deployed as **static assets only** (no Worker script), configured by `wrangler.jsonc` in the repository:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |
| Node.js | 22 (`.nvmrc`) |
| `wrangler.jsonc` | `name` = the Worker's name in the dashboard (**must match**, default `dira-learn`); `assets.directory` `./dist`; `assets.not_found_handling` `single-page-application` |
| Build variables (Settings > Build > Variables and secrets) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key), optional `VITE_PUBLIC_SITE_URL` – **build** variables, because Vite builds them into the site; never the service-role/secret key |

Why the file is needed: without a Wrangler configuration, `wrangler deploy` runs its automatic framework configuration, which
for a Vite project installs the Cloudflare Vite plugin (Vite 6 or newer) and rewrites `vite.config.ts` and `package.json` during
the build. With Vite 5.4 it stops with "The version of Vite used in the project (5.4.21) cannot be automatically configured".
The explicit file deploys the `dist/` folder exactly as built: `dist/_headers` (security headers and the Content-Security-Policy)
is applied to every response, app routes such as `/cohorts/123` get `index.html`, and nothing in the project is changed by the
deployment. `scripts/release-check.mjs` checks this file (static assets from `dist`, SPA routing, no Worker script, no secrets).
If you later move to Cloudflare Pages instead, Pages ignores this file and uses the settings in §1.

## 1. Build settings (Pages project > Settings > Build)

| Setting | Value | Why |
|---|---|---|
| Framework preset | React (Vite), or None | either works with the values below |
| Build command | `npm run build` | `package.json`: `tsc -b && vite build && node scripts/write-headers.mjs` (type check, build, then write the Content-Security-Policy for the Supabase project the site is built for; the build **fails** if `VITE_SUPABASE_URL` is missing or not https) |
| Build output directory | `dist` | Vite's default; `vite.config.ts` does not change it |
| Root directory | `/` (the repository root) | |
| Node.js | 22 | pinned by `.nvmrc` (Pages build image v3 also defaults to Node 22) |
| Package install | automatic (`npm`) | **commit `package-lock.json`**: `node scripts/release-check.mjs` (your computer) or the GitHub release-check workflow creates it with `npm install`; commit it. With it Cloudflare runs `npm ci`; without it every build may pick newer package versions |

Routing: Pages serves `index.html` for any path that is not a file when the output has no top-level `404.html`. DIRA LEARN has
none, so `/login`, `/curriculum/manage` or `/sessions/<id>` load the app. No redirect rule is needed.

Headers: `public/_headers` (copied into `dist`) adds `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, long caching for `/assets/` and a week for `/photos/`, and a **Content-Security-Policy** that
`scripts/write-headers.mjs` fills in at build time: scripts only from the site itself (no inline scripts, no `eval`); network
connections only to the site and to the one Supabase project (`https://` and `wss://` for Realtime); images from the site,
that Supabase project's Storage and - only while the DIRA photos are not yet stored in `public/photos` - the DIRA Foundation
website; fonts and their stylesheet from Google Fonts; no frames, no plug-ins, and the site cannot be framed by other sites.
Check after the preview: browser console shows no "Refused to ..." messages.

## 2. Environment variables (Pages project > Settings > Variables and secrets)

Only these three. They are **public by design** (they end up in the browser), so never put anything secret here.

| Name | Production | Preview | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | the same, or a staging project (recommended) | Supabase > Project Settings > API |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (`sb_publishable_...`) or the legacy **anon** key | same as Production, or staging | never the service-role or secret key |
| `VITE_PUBLIC_SITE_URL` | `https://<public DIRA Foundation website>` | same | optional; default `https://dirafoundationken.netlify.app` |

`VITE_` variables are baked in at build time (the Content-Security-Policy too): change them, then **retry the deployment**
to rebuild. A preview that uses a staging Supabase project gets a policy for that project automatically. A production build that is
missing them, or points at `localhost`/`http://`, shows "DIRA LEARN is not available right now" instead of contacting the
wrong system (added in this release, `src/lib/supabaseConfig.ts`).

Never in Cloudflare variables, the repository or frontend code: the Supabase service-role/secret key, the database password,
SMTP passwords, Resend/scanner API keys, `CRON_SECRET`, `SETUP_CODE`, Cloudflare API tokens. Supabase Edge Function secrets are
set in Supabase (see `SUPABASE_PRODUCTION.md`).

## 3. Connecting the code (preferred: GitHub)

1. Create a **private** GitHub repository and push the contents of the production package (`dira-learn-production`), with
   `package-lock.json` added. `.gitignore` already keeps `node_modules`, `dist` and every `.env*` file (except the example) out.
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git > choose the repository.
   Production branch: `main`. Enter the settings from sections 1 and 2.
3. **Preview first:** push to a branch such as `release-v13.2`. Cloudflare builds a preview at
   `https://<hash>.<project>.pages.dev`. Check it (section 5). Then merge into `main` to deploy production.

Alternative without GitHub (Direct Upload): build on a computer with `npm ci && npm run build`, then
`npx wrangler pages deploy dist --project-name=<project> --branch=<branch>` (needs a Cloudflare API token in the
`CLOUDFLARE_API_TOKEN` environment variable of that computer only). Direct Upload projects cannot later be switched to Git.

### Edge Functions must know the site's address (CORS)

The browser-called Edge Functions (invite-user, import-learners, convert-application, claim-first-admin, send-emails,
set-account-status) answer only pages from allowed addresses (no wildcard). In Supabase set the function secrets:
`APP_URL=https://<production domain>` and, for previews that must call functions,
`ALLOWED_ORIGINS=https://<branch>.<project>.pages.dev` (comma-separated, exact addresses). A page from any other address is
refused before the function runs. CORS is not the access check: each function still checks who is signing in and their role.

## 4. Domain and SSL

1. Pages project > Custom domains > Set up a custom domain > `learn.<dira-domain>` (or the name you choose).
2. If the domain's DNS is on Cloudflare, the DNS record and certificate are created for you. If DNS is at another registrar,
   add the `CNAME learn -> <project>.pages.dev` record that Cloudflare shows.
3. Wait until the domain shows **Active** (certificate issued). Then SSL/TLS > Edge Certificates: turn on **Always Use HTTPS**;
   turn on **HSTS** only after the site works on HTTPS.
4. In Supabase, set the Site URL and redirect URLs to this domain (`SUPABASE_PRODUCTION.md`, section 2).

## 5. Checks on the preview, then on production

Run `docs/deployment/SECURITY_AND_TESTING_REPORT.md` section 4 and `docs/deployment/SECURITY_CORRECTIONS_REPORT_2026-11-20.md`
section 8. Minimum before going live: the app loads at `/`, `/login`,
a deep link and a page refresh; the browser console has no errors; the network tab shows requests only to
`https://<project-ref>.supabase.co` (not `localhost`); sign-in works; a password reset email arrives from the real SMTP sender
with a 6-digit code; Users page: invite a staff member (no CORS error); the console shows no Content-Security-Policy refusal.

## 5a. DIRA photographs

The site still loads the six cover photos from the DIRA Foundation website until the approved originals are added:
put the original files in a folder, mark each `approved: true` in `tools/photos/photos.yaml` (development archive) with a
focal point that keeps faces in view, run `python3 tools/photos/prepare.py <folder> .`, and commit `public/photos/*.webp` and
`src/lib/photos.generated.ts`. The next build then serves them from the site itself and drops the outside image host from the
policy. The tool never crops, stretches or enlarges, and removes camera and location data.

## 6. Future updates

- **Frontend:** change code in the development project, run its tests (`tools/check-all.sh`, `npm test`, `npm run build`),
  copy the changes into the production repository on a branch, check the preview, merge.
- **Database:** add a new migration file (never edit an applied one), test it locally with its rollback, run the read-only
  checks on production, back up, then `npx supabase db push --remote` (CLI v3 asks for confirmation).
- **Edge Functions:** `npx supabase functions deploy <name> --project-ref <project-ref>`. A new browser-called function must
  wrap its handler in `withCors` from `_shared/cors.ts`.
- **New tables:** every new table with row-level security needs the `dira_active_account` restrictive policy (migration 34);
  `account_status.test.sql` fails until it has one.
- **Curriculum text:** the source is `curriculum/v13/*.yaml`. Migrations 30-32 are frozen, so after any edit
  `python3 tools/curriculum/build_v13.py .` stops without writing anything until a developer adds the next curriculum
  migration (copy of the 32 template with the next number). That keeps applied migrations unchanged. Approvals stay in Manage curriculum.
- **Variables:** change in Cloudflare, then retry the deployment.
