# DIRA LEARN – installation guide for the new deployment (release of 21 Nov 2026)

This is the only guide you need for the **new** deployment: a new private GitHub repository, a new Supabase project and a new
Cloudflare Worker. Everything is done in the browser (plus GitHub Desktop to upload the files). You do not need PostgreSQL,
CMD or PowerShell.

**The old deployment stays untouched.** Nothing here uses the old GitHub repository, the old Supabase project
(`odfiawrvmaafdskbkptv`) or the old Cloudflare Worker. The new Worker has a different name (`dira-learn-v2`), so it can never
replace the old site. Keep the old one running until the new one has been tested and you approve the switch.

**Secrets.** Keep the database password, the setup code and every key in a password manager. Never paste them into a chat,
an email, a file in the repository or a Cloudflare build variable. The only values that belong in the website build are the
Project URL and the anon (or publishable) key, which are public by design.

| Part | What | Time |
|---|---|---|
| A | New private GitHub repository | 10 min |
| B | New Supabase project and database installation (SQL Editor, STEP-0 to STEP-5) | 20 min |
| C | Edge Functions and their secrets | 15 min |
| D | New Cloudflare Worker (the website) | 15 min |
| E | First Super Administrator (`/setup`), then switch setup off | 5 min |
| F | Final checks | 10 min |
| G | Troubleshooting and recovery | when needed |

---

## A. New private GitHub repository

1. On github.com: **New repository** → name e.g. `dira-learn-v2` → **Private** → do not add a README → **Create repository**.
2. Install **GitHub Desktop** (desktop.github.com) and sign in. **File → Clone repository** → choose `dira-learn-v2` → pick a folder.
3. Unzip the release ZIP. Copy everything **inside** the folder `DIRA-LEARN-RELEASE` (including the hidden `.github` folder and the
   `.gitignore`, `.gitattributes`, `.nvmrc` files) into the cloned folder.
4. In GitHub Desktop: write a summary such as `DIRA LEARN release 21 Nov 2026` → **Commit to main** → **Push origin**.
5. On github.com, open **Actions**. The workflows `release-check` and `database-pg17` start by themselves. They change nothing
   and need no secrets. Both should end green; if not, download the report and send it to Claude.
6. **Settings → Environments → New environment** `production` → tick **Required reviewers** and add yourself. Every deployment
   from GitHub then waits for your approval.

## B. New Supabase project and database installation

1. On supabase.com/dashboard: **New project**. Name e.g. `dira-learn-v2`, a region close to Kenya (e.g. *Frankfurt* or
   *Cape Town*, whichever is offered), generate a strong database password and store it in your password manager.
2. When the project is ready, **Authentication → URL Configuration**: *Site URL* = the website address from part D
   (you can fill it in after part D); add the same address under *Redirect URLs*.
3. **Authentication → Providers → Email**: email provider on, *Confirm email* on. **Authentication → Policies / Password**:
   minimum length **10**, require *letters and digits* (the same rules as the app).
4. **Before learners register:** set up your own email sending (**Authentication → Emails → SMTP Settings**, e.g. with Resend;
   see `docs/EMAIL_SETUP.md`). Supabase's built-in email is only for testing and sends very few messages. The first Super
   Administrator does not need email.
5. **Install the database** – open **SQL Editor**. For each file in the folder `supabase/install`, in this order:
   open the file in Notepad → **Ctrl+A**, **Ctrl+C** → in the SQL Editor click **+ New query** → **Ctrl+V** → **Run**.

   | File | What it does | You should see |
   |---|---|---|
   | `STEP-0_precheck_read-only.sql` | looks at the project, changes nothing | verdict `EMPTY: run STEP-1` |
   | `STEP-1_schema-part-1-of-2.sql` | first half of the database structure | `STEP-1 installed` |
   | `STEP-2_schema-part-2-of-2.sql` | second half | `STEP-2 installed` |
   | `STEP-3_platform-and-data-part-1.sql` | sign-up trigger, 6 private storage buckets, realtime, the account check, curriculum data | `STEP-3 installed` |
   | `STEP-4_data-part-2.sql` | teaching notes; records the installation as complete | `STEP-4 installed` |
   | `STEP-5_verify_read-only.sql` | 16 checks, changes nothing | 16 rows `ok`, last row `READY` |

   - The SQL Editor may warn that a query contains "destructive operations" or asks to confirm: choose **Run this query**.
     (The steps only create; STEP-1 refuses to run if the project is not empty.)
   - Each step is one transaction: if it shows an error, nothing of that step was kept. Run **STEP-0** – it always tells
     you which step comes next. Never skip a step; the steps refuse to run out of order.
   - Windows line breaks from Notepad are handled automatically.
6. **Project Settings → API**: note the *Project URL* and the *anon* (or *publishable*) key – for part D. Do **not** copy the
   *service_role* / *secret* key anywhere.

What the installation contains: the final state of migrations 01–39 and the approved curriculum seed – 4 weeks, 8 sessions
(2 per week, at most 2 hours each), 2 core sessions plus the specialist tracks Digital Marketing, AI Tools, Content Creation and
Entrepreneurship & Business (26 session records), DIRA Connect, Daily Briefs, safeguarding (read by Super Administrators only
until a Safeguarding Lead or Deputy is appointed), the Digital Marketing topics approved by DIRA on 8 Nov 2026 recorded as
pending proposals, lesson plans in Draft, programme not approved. No approval was added.

## C. Edge Functions and their secrets

1. **Secrets first** – Supabase **Edge Functions → Secrets** (Manage secrets). Add:

   | Name | Value |
   |---|---|
   | `SETUP_CODE` | a new random code of **at least 20 characters** (generate it in your password manager and keep it there) |
   | `FIRST_ADMIN_EMAIL` | `marksmedia.studios@gmail.com` |
   | `APP_URL` | the website address from part D, e.g. `https://dira-learn-v2.<your-subdomain>.workers.dev` (no `/` at the end) |
   | `ALLOWED_ORIGINS` | optional: further website addresses, comma-separated (e.g. a custom domain later) |

   Email and file-scanning secrets (`CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `SCANNER_PROVIDER`,
   `SCANNER_URL`) are optional and can be added later (`docs/EMAIL_SETUP.md`, `docs/ATTACHMENT_SECURITY.md`).
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically – do not add them.

2. **Deploy the functions** – two ways; use one.

   **Recommended: from GitHub (all 8 functions).** On supabase.com create an access token (**Account → Access Tokens**).
   In GitHub: **Settings → Secrets and variables → Actions → New repository secret**: `SUPABASE_ACCESS_TOKEN` (the token) and
   `SUPABASE_PROJECT_REF` (the new project's reference id, Project Settings → General). Then **Actions →
   deploy-supabase-functions → Run workflow**, type the project reference id again, and approve the run. It deploys only the
   functions, never the database. JWT verification is switched off only for `bootstrap-first-admin` and `email-webhook`
   (they check their own secret instead); all other functions keep it on.

   **Minimum, only in the browser: just the setup function.** **Edge Functions → Deploy a new function → Via Editor**, name
   `bootstrap-first-admin`, replace the example with the whole content of
   `supabase/functions/bootstrap-first-admin/index.ts` (it is self-contained on purpose) → **Deploy**. Then open the function's
   details and switch **Verify JWT** (JWT verification) **off** – the page `/setup` is used before anyone can sign in; the
   function protects itself with `SETUP_CODE`. The other functions (inviting staff, importing learners, account status,
   emails, file scanning) are needed later and are deployed from GitHub as above.

## D. New Cloudflare Worker (the website)

Connecting the repository makes Cloudflare build and publish the site **every time `main` changes**. Do this when you are
ready to approve the new deployment.

1. Cloudflare dashboard → **Workers & Pages → Create application → Import a repository** → connect GitHub and choose
   `dira-learn-v2`.
2. Project name: **`dira-learn-v2`** (must equal `"name"` in `wrangler.jsonc`). Build command: **`npm ci && npm run build`**.
   Deploy command: **`npx wrangler deploy`** (the default).
3. **Build variables** (Settings → Build → Variables and secrets): `VITE_SUPABASE_URL` = the Project URL,
   `VITE_SUPABASE_ANON_KEY` = the anon/publishable key from part B.6. Nothing else – no service-role key, no setup code.
4. **Save and Deploy.** Note the address (`https://dira-learn-v2.<your-subdomain>.workers.dev`). Put it into Supabase:
   Authentication → URL Configuration (part B.2) and the `APP_URL` secret (part C.1).
5. The site carries the security headers from `dist/_headers` (Content-Security-Policy etc.); browser routes such as `/login`
   or `/setup` are answered by the app (`single-page-application`).

## E. First Super Administrator

1. Open **`https://<your website>/setup`**. It shows *First-time setup*. (If it says *Setup is switched off*, `SETUP_CODE` or
   `FIRST_ADMIN_EMAIL` is missing – part C.1.)
2. Enter the **setup code**, choose the **administrator password** (at least 12 characters, letters and numbers) and confirm it.
   Click **Create the Super Administrator**.
3. The function creates the account **marksmedia.studios@gmail.com** (email already confirmed) through the Supabase Auth
   Admin API, or – if that address already signed up – sets its password, and makes it the only Super Administrator. You are
   signed in. Nobody can choose another address: it always uses `FIRST_ADMIN_EMAIL`.
4. **Switch setup off:** Supabase → Edge Functions → Secrets → **delete `SETUP_CODE`**. Reload `/setup`: it now says *Setup is
   already complete* (or *switched off*). Setup also refuses on its own once a Super Administrator exists.
5. **Passwords later:** signed in, use **Change password** at the bottom of the menu (asks for the current password).
   Forgotten password: on the sign-in page, **Forgot password?** (a 6-digit code by email – needs the email setup of B.4).
6. Further staff are invited by the Super Administrator inside the app (**Users**). No database record is ever edited by hand.

## F. Final checks

1. SQL Editor: run `STEP-5_verify_read-only.sql` again. Every row `ok` except **7 and 8**, which now report that an
   administrator exists – by design.
2. Sign out, sign in again as marksmedia.studios@gmail.com. The dashboard and the menu for a Super Administrator appear.
3. Open Curriculum, Curriculum Approval, Users, Safeguarding, DIRA Connect and Daily Briefs once each; none may show an error.
4. In a private browser window, register a test learner account; the confirmation email must arrive (needs B.4) and, after
   confirming, the account appears as an applicant under Users.
5. Only when all of this works: tell Claude/your team that the new deployment is approved. The old deployment can then be
   retired by you – this release never changes it.

## G. Troubleshooting and recovery

| What you see | Cause | What to do |
|---|---|---|
| A STEP shows `STOP: this is STEP-n …` | steps out of order or repeated | nothing was changed; run STEP-0 and do what its verdict says |
| `STOP: the public schema already has …` / `public.profiles already exists` | not a new, empty project | use a new project (part B.1); never install over another database |
| A STEP shows another error | e.g. a cut-off paste | nothing of that step was kept; paste the whole file again and run it. If it fails again, send the message to Claude |
| STEP-0 says `STOP: unexpected state` | a mixed or older installation | do not run more steps; send the STEP-0 result to Claude. If asked, run `RECOVERY_remove-incomplete-install.sql` (it only works on a project with no sign-in accounts and needs a one-line edit), or delete the project and start part B again |
| Website: "Could not find the table … in the schema cache" (PGRST205) | database not installed in this project, or the website points to another project | run STEP-0 in the project whose URL is in `VITE_SUPABASE_URL`; check the Cloudflare build variables |
| STEP-5 check 16 fails (e.g. "signed-out table privileges: 321") | Supabase added default privileges to the new tables (installations made with the STEP-3 of 21 Nov 2026 before 19:30) | run `REPAIR_api-grants.sql` once, then STEP-5 again; it changes only API privileges |
| Website: "permission denied" / HTTP 403 when loading the account | API permissions missing | STEP-5 check 16 shows it; run `REPAIR_api-grants.sql`, then STEP-5 |
| `/setup`: "That setup code is not right." | typo | re-enter the code exactly as stored (after each wrong try the function waits 1 second) |
| `/setup`: "Could not check the setup state" | function not deployed, or Verify JWT still on | part C.2; switch JWT verification off for `bootstrap-first-admin` only |
| `/setup` or any function: "This website address is not allowed" | `APP_URL` does not match the site address | correct `APP_URL` (exact address, `https://`, no trailing `/`) |
| `/setup`: "already has another role or is not active" | the address signed up earlier and was given a role | nothing was changed; send this to Claude |
| Sign-up email does not arrive | built-in Supabase email limits | set up SMTP (B.4) |

Database design, verification and tests: `docs/deployment/RELEASE_AUDIT_AND_TEST_REPORT_2026-11-21.md`.
The older documents (`RELEASE_GUIDE_2026-11-21.md`, `SQL_EDITOR_INITIALIZATION.md`, `PRODUCTION_DB_INITIALIZATION.md`,
`SUPABASE_PRODUCTION.md`, `CLOUDFLARE_PAGES.md`) describe the old project and are superseded for the new deployment.
