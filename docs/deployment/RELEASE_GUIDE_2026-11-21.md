# DIRA LEARN updated release (21 Nov 2026): GitHub, Cloudflare and database, step by step

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


Written for a non-developer. Do the parts in order. Never paste a password, key or connection string into chat, email or a file in the repository.

**What has been checked:** the database, permissions, screens in Chrome and the release package were tested here (see `RELEASE_REPORT_2026-11-21.md`). **What has not been checked yet:** a real `npm ci`, the real Vite build, ESLint, `npm audit`, Playwright and a Cloudflare preview. The package registry and Cloudflare were not reachable. GitHub's own check (part B, step 5) runs the first four the moment you upload.

## A. Before you start (once)

- A GitHub account.
- Your Cloudflare account, with the Worker `dira-learn`.
- Your Supabase production project `kzbgfofklkqahfffwyzz`.
- On your Windows computer, only for the local test: **Node.js 22 LTS** (nodejs.org) and **Docker Desktop**.

## B. Put the code on GitHub (new private repository)

1. Extract `DIRA-LEARN-UPDATED-RELEASE.zip`. You get a folder `DIRA-LEARN-UPDATED-RELEASE`.
2. On github.com click **New repository**. Name it, for example, `DIRA-LEARN`, choose **Private**, and tick **nothing** (no README, no .gitignore, no licence). Click **Create repository**.
3. **Easiest way, in the browser:** on the new repository page click **uploading an existing file**. Open the extracted folder, select **everything inside it** (Ctrl+A), including the `.github` folder and the files that start with a dot, and drag it onto the page. Click **Commit changes**.
   - Windows hides files that start with a dot by default. In File Explorer choose **View → Show → Hidden items** first, so `.github`, `.gitignore`, `.gitattributes`, `.nvmrc` and `.env.example` are uploaded too. They are required.
   - The browser upload has a limit of about 100 files per upload. If it refuses, upload the folders one at a time (`src`, `supabase`, `docs`, `tools`, …), then the remaining files.
4. **Alternative, with GitHub Desktop** (recommended if the browser upload is fiddly): *File → Add local repository →* choose the extracted folder → *create a repository here* → **Publish repository** (keep *private* ticked).
5. On GitHub open the **Actions** tab. The workflow **Release check** starts by itself. It runs `npm ci`, TypeScript, ESLint, the production build, bundle checks and `npm audit`. A green tick means all passed. If it is red, open it, download the **release-check** file under *Artifacts* at the bottom (it contains `release-check-report.md`), and send it to Claude. The report contains no secrets.

## C. Cloudflare (production Worker `dira-learn`)

1. Cloudflare dashboard → **Workers & Pages** → `dira-learn` → **Settings → Build** → **Git repository**: connect the new GitHub repository, branch `main`.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | `/` |

3. **Settings → Build → Variables and secrets** (these must be **build** variables; "runtime" variables are invisible to the build, which is what caused "VITE_SUPABASE_URL is missing or not a web address"):
   - `VITE_SUPABASE_URL`: `https://kzbgfofklkqahfffwyzz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: the **publishable / anon** key, from Supabase → Project Settings → API. Never the service-role or secret key.
   - `VITE_PUBLIC_SITE_URL`: `https://dira-learn.marksmedia-studios.workers.dev`, or your own domain later.
4. **Do not deploy production yet.** First do part D (database) and a staging test (part E).

## D0. A new, empty Supabase project: install in the browser

For a new project such as `odfiawrvmaafdskbkptv` (empty, with an existing account to keep), follow **`docs/deployment/SQL_EDITOR_INITIALIZATION.md`**. It needs only the Supabase Dashboard's SQL Editor and Notepad: nine files run one after another, with the first Super Administrator set for your existing account in the last step. Use the Cloudflare build variable `VITE_SUPABASE_URL = https://odfiawrvmaafdskbkptv.supabase.co` for that project. Part D below is only for the older, partly initialized project.

## D. Fix the production database (403 on "Loading your account")

Follow `docs/deployment/PRODUCTION_DB_INITIALIZATION.md`, **section 0, then 6b**. In short:

1. **Back up** (section 6.1).
2. SQL Editor → run `supabase/production_init/00b_precheck_partial_readonly.sql`. It reads only. It must say `CONTINUE`.
3. Run `supabase/production_init/01b_continue_after_37.sql` with psql. It adds migration 38 (the permissions) and the seed (programme, tracks, sessions, settings). It changes no account, password, role or status, and approves nothing.
4. SQL Editor → run `supabase/production_init/02_verify_readonly.sql`. Every row must say `ok` except 7 and 8. Those two say `FAIL` because your Super Administrator already exists, which is correct.
5. Sign in on the live site. The dashboard should open instead of "Loading your account…".

Your Super Administrator already exists, so **the first-admin setup (section 7 of that guide) is not needed.**

## E. Safe preview before production (recommended)

Use a separate Supabase project for testing, never production data:

1. In Supabase create a new project, for example `dira-learn-staging`. Initialize it with `01_initialize_production.sql` (section 6 of the database guide, empty-database path).
2. In Cloudflare create a second Worker from the same GitHub repository, named `dira-learn-staging`:
   - deploy command `npx wrangler deploy --name dira-learn-staging`;
   - build variables pointing at the **staging** Supabase project.
3. Open the staging address it shows (`https://dira-learn-staging.<your-subdomain>.workers.dev`) and check:
   - sign-up and verification email;
   - sign-in;
   - dashboard;
   - curriculum;
   - direct opening of an inner page, for example `/curriculum`, and **refreshing it** (it must not show 404);
   - the same on a phone.
4. Only when that works, deploy the production Worker (part C) and repeat the checks on the production address.

## F. Test on your Windows computer (optional)

Double-click `START-DIRA-LEARN.bat`. It checks Node.js and Docker, installs the packages, starts a local database and the website, and opens `http://localhost:5173`. To stop, close the window or press Ctrl+C. If something fails, double-click `CHECK-DIRA-LEARN.bat` and send its message. For test accounts, double-click `CREATE-DIRA-TEST-ACCOUNTS.bat` (local only; it refuses a database with real users). The launchers were checked on Linux, but not yet run on Windows.
