# DIRA LEARN – post-audit security corrections (local development project only)

**Date:** 20 Nov 2026. **Scope:** the corrections you authorised after the audit of the same day
(`AUDIT_REPORT_2026-11-20.md`). **Nothing was applied to the live Supabase project, nothing was deployed, no production
account or record was touched, no curriculum plan was approved, nothing was purchased.** All tests ran on a disposable local
PostgreSQL 16 database (with Supabase's roles simulated), in headless Chrome, and with simulated Supabase services where
stated. The live system was not inspected (no access).

## 1. Summary

| Priority | Finding | Correction | Status |
|---|---|---|---|
| 1 | H1/M1 former staff keep access; deactivation does not stop sign-in | **Migration 34** + `set-account-status` Edge Function + Users page | done, tested |
| 2 | H2 Edge Functions refuse browser calls (no CORS) | `_shared/cors.ts` on all six browser-called functions | done, tested in Chrome (simulated Supabase) |
| 3 | M2 only Connect attachments were virus-scanned | **Migration 35**: scan-before-download for every bucket; scanner function extended | done, tested |
| 3 | **new, found while testing:** any trainer and the M&E officer could open every learner's submission files and every applicant's documents, in every cohort | fixed in migration 35 (cohort-limited) | done, tested |
| 4 | H3 never built; no lock file | **not possible here**: no access to the npm registry | open – see §6 |
| 5 | M3 no Content-Security-Policy | policy written at build time for the actual Supabase project | done, tested in Chrome |
| 6 | photos hot-linked from the website | photo pipeline (no crop, no upscale, metadata removed), responsive `srcset`, focal points | tool done and tested; **original photos not supplied** – see §6 |
| – | L4 raw error texts | convert-application and scan-attachments now return generic errors | done |

## 2. Priority 1 – account deactivation (migration 34)

File `supabase/migrations/20260101000034_account_status_enforcement.sql`, rollback
`supabase/rollback/20260101000034_account_status_enforcement_down.sql`.

| Requirement | How it is met |
|---|---|
| 1 Deactivated accounts cannot sign in | `set-account-status` bans the Supabase Auth user (`ban_duration 876000h`); reactivation lifts it (`'none'`). Login shows "This account is not active" instead of Supabase's "User is banned" |
| 2 Existing sessions stop working | `check_request()` runs before every Data API request (PostgREST pre-request, registered on role `authenticator`) and refuses inactive accounts with `42501 DIRA_ACCOUNT_INACTIVE`, whatever the session token says. Supabase documents that the pre-request hook does not cover Storage and Realtime, so in addition: |
| 3 RLS rejects deactivated accounts | a **restrictive** policy `dira_active_account` on every one of the 98 tables with row-level security and on `storage.objects` (Storage and Realtime use these). A test fails if a future table lacks it |
| 4 Functions check status themselves | the access helpers `my_trainer_cohorts`, `mentor_has_mentee`, `is_course_trainer`, `my_participant_id`, `my_learning_access`, `connect_facilitator_assigned` now require an active profile and the right current role; role checks elsewhere already use `app_role()`, which is empty for inactive accounts |
| 5 Role changes take effect at once | access is computed from the profile on every request; a trainer changed to mentor loses cohort access on the next request (tested) |
| 6 Removing a trainer from a cohort revokes it | tested (no submissions, no enrolments afterwards) |
| 7 No access to submissions, enrolments, attendance, assignments, private data | tested: 0 rows of each, cannot edit or create assignments, no messages, no files, not even their own profile |
| 8 History preserved | nothing is deleted; tested that submissions, messages, profile, sign-in account and cohort assignment remain |
| 9 Accounts not deleted | the workflow only changes `profiles.status` and the Auth ban |
| 10 Safe reactivation | `admin_set_account_status(profile, status, reason)`: active super administrator only; reason 10–500 characters; never one's own account; never the last active super administrator; recorded in `account_status_events` (append-only, readable by executives, copied into the audit log). Direct status changes without a reason are refused |

Users page: the status drop-down is replaced by **Deactivate / Reactivate** with a reason form. A deactivated person who is
still on a page sees "This account is not active" and a Sign out button.

## 3. Priority 2 – Edge Function CORS

`supabase/functions/_shared/cors.ts` wraps invite-user, import-learners, convert-application, claim-first-admin, send-emails
and the new set-account-status. Allowed origins: the origin of `APP_URL` plus the exact addresses in the `ALLOWED_ORIGINS`
secret – no wildcard; http only for localhost. Methods `POST, OPTIONS`; headers those supabase-js sends. A preflight from any
other site gets 403 and the function code never runs. Calls without an Origin header (the scheduler) are unaffected.
email-webhook and scan-attachments are server-to-server and deliberately have no CORS. Authentication and role checks are
unchanged and independent of CORS (tested: 401 signed out, 403 wrong role, 403 deactivated administrator).

## 4. Priority 3 – virus scan before download (migration 35)

File `supabase/migrations/20260101000035_file_scanning.sql`, rollback `..._file_scanning_down.sql`.
- Buckets application-documents, submissions, project-evidence, course-materials and learning-resources: a file opens
  (download or signed link) only when the scan of **that exact version** said clean. A replaced file needs a new scan; a late
  result for an old version is ignored. Pending, failed (after 3 scanner errors) and infected files cannot be opened. The
  uploader may still open their own file while it waits, never when infected; they are notified when a file is blocked.
- DIRA Connect keeps its own rules (migration 29).
- `scan-attachments` now also claims and scans these files (`claim_file_scans`, `record_file_scan`, service role only).
- Staff see scan status and queue counts (`file_scan_queue()`); the app shows "This file cannot be opened yet … virus check".
- Learning resources now accept only PDF, Word, PowerPoint, Excel, JPG, PNG and MP4 (previously any type).
- **Found and fixed while testing:** trainers could open every learner's files and every applicant's documents. Now:
  application documents – programme staff only; submissions and project evidence – programme staff, the M&E officer, and
  trainers only for learners in their own cohorts.
- **Consequence you need to know:** until a virus scanner is configured, nobody except the uploader can open any uploaded
  file (submissions, application documents, resources). Text answers are unaffected. Existing files are kept, not deleted.

## 5. Priority 5 – Content-Security-Policy

`public/_headers` carries a placeholder; `scripts/write-headers.mjs` (run by `npm run build`) fills it with a policy for the
Supabase project the site is built for: `script-src 'self'` (no inline scripts, no eval), `connect-src` only the site and that
project (`https` and `wss`), images from the site, that project's Storage and – only while the photos are not stored with the
site – the DIRA website; Google Fonts for fonts; `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, `upgrade-insecure-requests`. No `unsafe-inline`, `unsafe-eval` or wildcard. The build stops if
`VITE_SUPABASE_URL` is missing or not https.

## 6. Not done here, and why

| Item | Why | What is needed |
|---|---|---|
| `package-lock.json`, `npm ci`, ESLint, real TypeScript check, React component tests, production build, `npm audit`, bundle size | this environment cannot reach the npm registry (`npm view react` → network error). Generating a lock file without the registry would be inventing it | on a computer with internet in the production folder: `npm install`, commit `package-lock.json`, then `npm ci && npm run typecheck && npm run lint && npm test && npm audit --omit=dev && VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<publishable key> npm run build`. Send me the output; do not run `npm audit fix --force` |
| DIRA photographs | the originals are not in this session and the website copies could not be fetched (address not allowed) | send the six original files (and confirm consent for the people shown); I mark them approved, set focal points and run `tools/photos/prepare.py` |
| Edge Functions against real Supabase | no Supabase access; Deno is not installed | tested with the real function code and a simulated Supabase client; repeat on a staging project after deployment |
| Live database | no access | run the read-only checks (`supabase/checks/`) – they now also report the pre-request setting, inactive accounts and files that will wait for scanning |

## 7. Test results (all executed on 20 Nov 2026, `tools/check-all.sh`)

| Suite | Result |
|---|---|
| Fresh database: all 35 migrations + seed | applied |
| Database tests (pgTAP) | **873 / 873** (new: account_status 50, file_scanning 31; 3 earlier assertions updated for the intended change – direct status edits now go through the reasoned workflow, `check_request` is the one extra function signed-out requests must run) |
| Without migration 34, the new account tests | fail (83 failures/errors) – they test the fix |
| Rollbacks 30–35 | schema identical to before, re-apply OK; rollback 34 also removes the API setting |
| Original audit attacks (active accounts) | 45 + 6 checks, all as expected (unauthorised actions refused, authorised ones allowed) |
| Original audit attacks (deactivated trainer and learner) | **10 / 10 blocked** (5 were allowed before) |
| Row-visibility matrix for 15 roles, two cohorts | unchanged for active accounts (no regression) |
| End-to-end workflows | 36 / 36 |
| DB = TypeScript results | 44 figures, 0 differences |
| Frontend contract (functions, tables, buckets the screens use) | 0 problems |
| Unit tests (pure logic) | 343 / 343 (new: account status, reason rule, photo sources) |
| Type check (stub definitions) | 0 new errors |
| Edge Functions in Chrome (real code, simulated Supabase) | **32 / 32**: invitations, learner import, applicant conversion, first-admin setup, email status/send, deactivate/reactivate with ban, role refusals, other-site preflight refused, scheduler path, scanner over all buckets |
| Content-Security-Policy in Chrome | **20 / 20**: Data API, Auth incl. all three recovery calls, Edge Functions, Storage upload and images, Realtime WebSocket, own photos allowed; other sites, inline script, eval and framing blocked; build fails without https Supabase address |
| Password-recovery screens in Chrome | 12 / 12, and 12 / 12 again **under the production policy** (no violations) |
| Photo preparation (synthetic test images) | 21 / 21: proportions kept, no crop, no upscaling, metadata/GPS removed, orientation, small originals refused, unapproved skipped |
| Curriculum | 26 lesson plans, all Draft; 11 Digital Marketing topics pending; only the Value Proposition session approved, unchanged; durations 110, 115, 24 × 120; curriculum source and documents byte-identical; migrations 01–33 byte-identical (migration 33 intact) |

## 8. Checks to repeat after a (preview) deployment
1. Deactivate a test staff account created for this purpose on a staging project while it is signed in elsewhere: its next
   click shows "not active"; it cannot sign in again; Reactivate restores it.
2. Users page: invite; Import page: import a two-line file; Applications: convert an accepted applicant – no CORS errors.
3. Browser console on every main page: no "Refused to … Content Security Policy" messages.
4. Upload a file: it shows "waiting for virus check" until the scanner runs; after a clean scan it opens.

## 9. Needs your approval or outside configuration
1. Applying migrations 33, 34, 35 (and any missing earlier ones) to the live project, after the read-only checks and a backup.
   Note the two behaviour changes: inactive accounts stop working at once (34); uploaded files wait for a scan (35).
2. A virus scanner. The code supports a self-hosted ClamAV REST service (no licence fee, but it needs hosting); a paid
   provider needs your approval. Without one, uploaded files stay unavailable.
3. Supabase function secrets `APP_URL` and, for previews, `ALLOWED_ORIGINS`; deploying the new `set-account-status` function.
4. If the migration cannot set the API pre-request hook itself (permission), running the two SQL lines it prints.
5. Banning, in Supabase Authentication, any account that was already deactivated before migration 34.
6. The lock file and the real build/audit run (§6), the original photos and consent, SMTP (Resend free plan) and the domain.
