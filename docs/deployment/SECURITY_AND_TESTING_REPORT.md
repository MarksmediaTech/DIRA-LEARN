# DIRA LEARN – production-readiness, security and testing report

**Date:** 20 Nov 2026. **Deployment status: NOT DEPLOYED.** No production URL, custom domain or SSL certificate exists yet,
because no access to GitHub, Cloudflare, the live Supabase project or the DIRA domain's DNS was available in this session.
Nothing below claims a live test.

## 1. Critical finding fixed: migration 33 (security null-role fix)

**Problem (present since migration 05).** Several database functions refused callers with a check of the form
`if app_role() not in ('director', …) then raise …`. For a signed-out visitor (or a deactivated account) `app_role()` is
empty (NULL), and in SQL `NULL not in (…)` is not *true*, so the refusal never fired. Tested on the local copy:

- a signed-out visitor, using only the public anon key that every website visitor has, could call `set_curriculum_approval`
  and **approve a curriculum session**;
- `issue_certificate` and `revoke_certificate` had the same gap;
- the curriculum-session guard trigger treated "no signed-in user" as a trusted system call;
- `sg_is_acting_lead()` returned NULL (not false) when no safeguarding lead was appointed, so one safeguarding oversight
  check could be passed by an unappointed caller;
- signed-out visitors could execute every public database function by default.

**Fix.** Migration `20260101000033_security_null_role.sql`: the checks now treat "no role" as "refused"; the guard trusts only
real system sessions; `sg_is_acting_lead()` returns true or false; signed-out visitors may execute only `verify_certificate`
(public certificate check). The old definitions and execute rights are saved in a backup table, and
`supabase/rollback/20260101000033_security_null_role_down.sql` restores them exactly (verified: schema identical, re-apply OK).

**Tests.** 14 new database tests (in the development archive): signed-out visitors refused for approval and certificate
functions; the session stays unapproved; deactivated director refused; acting-lead check is false; active director still
works and the approval is recorded. Without migration 33, 8 of the 14 fail.

**Live system.** Whether the live project has this gap is unknown. `supabase/checks/production_preflight.sql` (read-only)
reports it. Migration 33 should be applied in every case, after your approval.

## 2. Audit results (local copy with all 33 migrations)

| Area | Result |
|---|---|
| Row-level security | enabled on 92 of 92 public tables; no policy grants anything to signed-out visitors or PUBLIC; curriculum source tables and the e-mail reminder log are deny-all (system use only) |
| Database functions | every SECURITY DEFINER function has a fixed `search_path`; after migration 33 signed-out visitors can execute only `verify_certificate` |
| Views | one intentional security-definer view, `v_session_topics` (approved topic titles for signed-in users only); Supabase Security Advisor will show it as a warning |
| Storage | 6 buckets, all private; files are reached through access-checked functions; attachments are downloadable only after a virus scan reports clean |
| Realtime | only `connect_messages` and `connect_attachments`, both protected by row-level security |
| Secrets in the code | none: scan of all files found only fake test values (in the archive's tests); `.env.local` is excluded from the production package |
| Frontend variables | only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design) and optional `VITE_PUBLIC_SITE_URL` |
| Service-role key | used only inside Edge Functions, where Supabase injects it; never in the frontend |
| Production build guard | a production build without database settings, or pointed at a local or non-HTTPS address, shows a "not available" page instead of a broken site (new, with 4 unit tests) |
| Data safety of migrations | no migration drops or truncates a table or deletes rows; migration-time data changes are listed in `SUPABASE_PRODUCTION.md` §1 |
| Curriculum | 26 V13.2 lesson plans, all **Draft**; 4 tracks; durations 110, 115 and 24 × 120 minutes; the 11 pending Digital Marketing topics stay pending; the generator now refuses to rewrite applied curriculum migrations |
| Response headers | `public/_headers`: no MIME sniffing, no framing, strict referrer policy, camera and location off; microphone only for DIRA LEARN itself (voice messages in Chat, 22 Nov 2026), long caching only for fingerprinted assets |

## 3. What was verified, and what was not

**Verified here (Linux, local PostgreSQL 16 stand-in for Supabase's database):** fresh build of all 33 migrations and seed;
792 database test assertions, 0 failures; 36 end-to-end workflow checks across modules; database results equal TypeScript
results (44 figures); virus-scanner adapter (8/8); every database function, table and bucket the screens use exists (0
problems); curriculum upgrade and rollback (41/41) and rollbacks 30–33 schema-identical; 336/336 unit tests of pure logic;
type check with stub definitions (0 new errors); syntax of all 161 TypeScript files; password-recovery screens in Chrome with
simulated Supabase Auth (12/12). Production package: same migrations, functions, templates and curriculum byte-for-byte; a
fresh database built from the production package alone.

**Not verified (needs internet, your accounts or your computer):**
- `npm install` and `npm run build` with the real packages – the session has no package access. The **first real build will
  be Cloudflare's** (preview deployment), which is why a preview comes before production.
- There is no `package-lock.json`; generate it once (`npm install`) and commit it, so every build uses the same versions.
- Real Supabase services (Auth, Storage, Realtime, Edge Functions) – only the database was run locally.
- The live database: its migration state, data counts and the migration-33 gap are unknown until step 0 of
  `SUPABASE_PRODUCTION.md` is run.
- E-mail delivery (no SMTP configured), the virus scanner (none chosen), and the custom domain and SSL.
- No Content-Security-Policy yet: it must be written against the real Supabase and photo addresses after the first preview,
  or it could break sign-in.

## 4. Post-deployment test plan (preview first, then production)

Run in a private browser window. Use real staff accounts you control; **do not create test accounts in production**.

1. Site loads over HTTPS, no "not available" page; refreshing a deep link (e.g. `/login`, `/verify`) shows the page, not 404.
2. Response headers present (browser developer tools > Network > the page > Headers).
3. Sign in as a super administrator; dashboard and navigation load; sign out.
4. Forgot password with a real staff address: e-mail with a 6-digit code arrives (needs SMTP), wrong code refused, new password
   works, old one no longer works.
5. Curriculum: 26 session records shown (2 core + 6 in each of 4 tracks); all 26 lesson plans Draft and 25 of 26 session records Draft (Entrepreneurship Session 4, approved 8 Nov 2026, stays approved); durations unchanged; 11 Digital Marketing topics still pending; no approval done.
6. Public certificate check (`/verify`) works signed out; signed out, only the sign-in, sign-up, password and certificate pages
   open – any other address returns to sign-in.
7. The preflight file (`SUPABASE_PRODUCTION.md` §0) reports the migration-33 gap as closed.
8. After production: run `production_preflight.sql` again – all counts equal or higher than before.
9. Custom domain shows the padlock; `http://` redirects to `https://`.

Send the results; the deployment is confirmed only after these pass on the real URL.
