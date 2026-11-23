# Putting DIRA LEARN online (Supabase + Netlify)

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


Status: written, **never deployed**. Netlify serves the pages only. The database, sign-in, file storage and email functions run on Supabase, so set that up first. The public website (dirafoundationken.netlify.app) is a separate Netlify site; this app gets its own site and address, for example `learn.<your-domain>` or `dira-learn.netlify.app`.

## 1. Create the Supabase project
Create a project at supabase.com. From Project Settings > API note the Project URL and the **anon** key. Never use the service-role key in Netlify or in any code.

## 2. Load the database and functions
In the project folder, with the Supabase CLI installed:
```
supabase login
supabase link --project-ref <your-project-ref>
supabase db push            # applies the 13 migrations
supabase functions deploy   # the 6 Edge Functions
```
`db push` does not run the seed. Open the Supabase SQL Editor, paste `supabase/seed.sql` and run it once (roles, programme, 4 tracks, curriculum, draft settings).

## 3. Put the code on GitHub
`.env.local` (included, with placeholders) is only for running checks on your own computer. Fill it in, but it is never pushed to GitHub and Netlify never sees it, so you must still enter the same two values in Netlify in step 4.
Create a private repository and push this folder. `.gitignore` already keeps `node_modules`, `dist` and `.env*` out.

## 4. Create the Netlify site
1. Netlify > Add new site > Import an existing project > pick the repository.
2. Build command and publish folder come from `netlify.toml` (`npm run build`, `dist`). Its redirect rule makes every route (`/login`, `/courses/...`) load the app.
3. Site settings > Environment variables:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from step 1)
   - optional `VITE_PUBLIC_SITE_URL` (defaults to https://dirafoundationken.netlify.app)
4. Deploy. Optional custom domain: Domain management > add `learn.<your-domain>` and follow the DNS steps.

## 5. Tell Supabase the app's address
- Authentication > URL configuration: Site URL = the app address; Redirect URLs: add `<app>/login` and `<app>/set-password`.
- `supabase secrets set APP_URL=https://<app address>` (used by `import-learners`, `invite-user` and the email layout).
- Choose a long secret **setup code** and set it: `supabase secrets set SETUP_CODE=<at least 20 characters>`. On Windows PowerShell you can generate one with `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`. Keep it private; it is used once, in step 6.
- Authentication > SMTP: configure a real sender (docs/EMAIL_SETUP.md).

## 6. Create the first administrator (inside the app, no SQL)
1. Open `<app>/signup`, create your own account and confirm the email. Keep Supabase's "Confirm email" setting ON.
2. Sign in, then open `<app>/setup` and enter the setup code from step 5. You become the first super administrator.
3. From then on, approve everyone else on the **Users** page: change roles and status, or invite staff by email.
4. Optional tidy-up: `supabase secrets unset SETUP_CODE`. The setup page refuses to work once an administrator exists, and re-opens only if every active super administrator is removed (the setup code is then needed again).

The migration `20260101000013_first_admin_setup.sql` and the function `claim-first-admin` (deploy it with `supabase functions deploy`) provide this. They have not been run yet.

## 7. Link the website and the app
On the public website (a different project) point "Join the cohort" and "Save your place" at `https://<app address>/signup`, and add a "Learner sign in" link to `https://<app address>/login`. See also `website-four-areas-update.md` if you have it.

## 8. Cover photos
The sign-in, create-account and dashboard pages load six photos straight from the website's `/assets/photos/` folder. If the website is offline or renames them, the pages fall back to the plain purple background. To make the app self-contained, download `story-1.jpg` to `story-5.jpg` and `intake.jpg` into `public/photos/` and change `src` in `src/lib/site.ts` to `/photos/<file>`.

## 9. Checks after the first deploy
Open `/login`, `/signup` and a deep link such as `/courses` (should load the app or the sign-in page, not a Netlify 404). Sign up with a test address and confirm the confirmation and invitation emails link back to the app address.

## 10. Curriculum still shows old tracks?
`seed.sql` never overwrites existing rows. If the database was seeded before the four-track change, run `supabase/reset_curriculum.sql` once in the SQL Editor. It stops without changing anything if learners or cohorts already use the old tracks.

## 11. Applicant approval module
Migration `20260101000014_applicant_approval.sql` adds in-app Approve / Reject. It is additive and applies with the normal `supabase db push` (step 2). Read `docs/APPLICANT_APPROVAL.md` ("Safe rollout") first: back up, test on a copy, and only then apply to production.

## 12. Curriculum Approval Centre
Migrations `20260101000015` and `20260101000016` add the Founder and Co-Founder roles and the approval tables (applied by `supabase db push`, in order). Also run `supabase functions deploy invite-user`. See `docs/CURRICULUM_APPROVAL_CENTRE.md` ("Safe rollout"): back up, test on a copy first.
