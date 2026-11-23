# DIRA LEARN – clean rebuild and new production release: audit and test report (21 Nov 2026)

Statuses: **PASS** = executed here and verified · **FAIL** = executed and failed · **NOT TESTED** = not executed ·
**BLOCKED** = could not be executed because access or a dependency was unavailable. Nothing is reported as PASS that was not
executed.

**Where the tests ran:** a local PostgreSQL **16** stand-in for Supabase (strict: no automatic grants on new tables or functions,
as Supabase now behaves; `auth`, `storage`, realtime and the API roles simulated), real **Chrome** for screens and Edge
Functions (Supabase simulated), Node 22. **Not available:** the npm registry, PostgreSQL 17, GitHub, any Supabase project,
Cloudflare, Windows. No live system was read or changed. The old deployment was not touched.

## 1. Decisions applied

- **Safeguarding (owner, 21 Nov 2026):** Super Administrators only, until an active Safeguarding Lead or Deputy is appointed
  (migration 39). Founder and Co-Founder access unchanged.
- **Curriculum (owner, 21 Nov 2026, option A):** the 11 Digital Marketing topics approved by DIRA on 8 Nov 2026 sit on their
  sessions as **pending** proposals with the approval noted; session records 3–8 Draft with notes; the Entrepreneurship 4
  proposals untouched; programme not approved. No approval, weight or threshold was invented.
- **New deployment:** new private repository, new Supabase project, new Worker `dira-learn-v2`. No old credential is reused.

## 2. Causes found and fixed

| # | Problem | Cause | Fix | Status |
|---|---|---|---|---|
| 1 | Live site: PGRST205 ("could not find the table … in the schema cache") | The database of the live project was incomplete: the six-part SQL Editor installation stopped at Part 2 (row 2), so the tables of the later migrations did not exist; the website asked the API for them. Established from the reported failure and the reproduction of row 2; the live project itself was not inspected. | New installation package for a **new** project (`supabase/install`) with a pre-check that names the next step, guarded steps and a 16-point verification. The app explains a not-installed database instead of a generic error (`profileLoad.ts`). | PASS (local) |
| 2 | Part 2: `Migration 20: expected text not found in function guard_submission()` | **Reproduced.** Notepad→browser stores Windows line breaks (CR LF) in function bodies; migrations 17, 19, 20, 23, 33, 34, 36 changed functions by searching their stored text for LF-only phrases. | New projects no longer run text-patching migrations at all: **`supabase/baseline`** is the final state written once (pg_dump of the result of 01–39 + seed), proved identical. CR LF is removed from stored function bodies after each step. (The legacy package for the old project also got a normalisation step.) | PASS, LF and CR LF |
| 3 | The six-part installation gave too little assurance | Long parts, guards based only on history, no state report, no recovery. | `supabase/install`: STEP-0 pre-check (says exactly what to run next), 4 install steps (each one transaction, each refusing unless exactly the previous steps are installed), STEP-5 verification (16 checks, unknown = FAIL), RECOVERY script (only on a project without sign-in accounts, needs an explicit edit). | PASS (44 checks) |
| 4 | Step 7 contradicted Step 8 about `claim-first-admin` / `SETUP_CODE` | Two different first-admin mechanisms described at once. | One mechanism: STEP-5 → `/setup` (`bootstrap-first-admin`). The Edge Function `claim-first-admin` is **retired** and not shipped. | PASS |
| 5 | First Super Administrator depended on a signed-in claim or a manual SQL step | Design of 8 Nov. | `bootstrap-first-admin`: protected one-time setup with `SETUP_CODE` + `FIRST_ADMIN_EMAIL`, Supabase Auth Admin API, refusals listed in §4. New Change password page. | PASS (simulated Supabase) |
| 6 | 403 on loading the account (earlier today) | No explicit API grants; Supabase stopped automatic grants. | Migration 38 (explicit grants with self-check), included in the baseline. | PASS |
| 7 | An account created in the Auth dashboard before installation would have no profile | The baseline lacked migration 36's backfill. | Backfill added to the platform file (STEP-3). | PASS |
| 9 | STEP-3 on the real project: `permission denied to set parameter "session_replication_role"` (reported 21 Nov 2026, 19:07) | The data load paused triggers with `session_replication_role`, which needs superuser rights. The Supabase SQL Editor's role is not a superuser; the local tests ran as one, so they missed it. | Each table's own triggers are paused with `ALTER TABLE … DISABLE TRIGGER USER` (allowed for the table owner; foreign keys stay enforced; tables loaded parents first) and re-enabled on the same line. The install checks now run every file as a **non-superuser** role with the rights of Supabase's SQL Editor role (`tools/db-standin/sql_editor_role.sql`); the exact error was reproduced with the old STEP-3, which left nothing behind. STEP-1 and STEP-2 are byte-for-byte unchanged. | PASS (local, non-superuser) |
| 10 | STEP-5 check 16 on the real project: signed-in 577 privileges on 107 tables/views, signed-out 321 (reported 21 Nov 2026, 19:23) | Supabase applies default privileges to tables the SQL Editor's role creates in `public`. The numbers show exactly TRUNCATE, REFERENCES and TRIGGER for the API roles on all 107 tables and views (256 intended + 321 = 577; 321 = 107 × 3). The schema file only adds the intended grants, so these stayed. Local tests had no such defaults. | `REPAIR_api-grants.sql` for the installed project: removes every privilege of anon/authenticated/service_role/PUBLIC on the tables, views and sequences of `public` and re-grants exactly migration 38's set, with a self-check (one transaction, repeatable). The same block now runs in STEP-3 of new installations. The emulated SQL Editor role now carries these default privileges; the reported 577/321 is reproduced exactly, and REPAIR gives READY and a database identical to the reference. | PASS (local, non-superuser) |
| 8 | Webhook function would be deployed with JWT verification | Only documented as a CLI flag. | `supabase/config.toml` sets `verify_jwt = false` for `email-webhook` and `bootstrap-first-admin` only. | Config only (NOT TESTED on Supabase) |

## 3. The database for new projects

- `supabase/baseline/` – three plain migrations: schema (every object of `public` once, in final form), platform objects
  (sign-up trigger, 6 private buckets, 13 storage policies, realtime publication, API account check, profile backfill), data
  (organisation, programme, 4 tracks, 26 session records, 26 Draft lesson plans, 24 pending topic proposals, teaching notes,
  roles, settings, email templates – one-line JSON per table, so line endings cannot alter it). The audit log and the legacy
  staging/backup tables start empty.
- **Equivalence (PASS, `tools/baseline/baseline_check.sh`, 15/15):** schema fingerprint equal to the 39 migrations; every table's
  content equal (ids and timestamps excluded where they are random); relationships equal by natural keys; no orphan foreign keys;
  approval state 1 approved record / 26 Draft plans / 24 pending proposals / programme not approved; full pgTAP suite passes on
  the baseline; guards refuse wrong order and repeats.
- `supabase/install/` – the same three files cut at statement boundaries into STEP-1…4 (310, 309, 267, 219 KB), plus STEP-0,
  STEP-5 and RECOVERY, generated by `tools/baseline/build_install.py`.

## 4. First Super Administrator

`/setup` (no sign-in needed) → setup code + chosen password → Edge Function `bootstrap-first-admin`:
- account address only from `FIRST_ADMIN_EMAIL` (marksmedia.studios@gmail.com); a different address sent by the caller is ignored;
- refuses with 503 when `SETUP_CODE` is missing or shorter than 20 characters, or `FIRST_ADMIN_EMAIL` is missing; 409 once an
  active Super Administrator exists; 403 after a 1-second delay for a wrong code (constant-time comparison); 400 for a password
  under 12 characters or without letters and digits; 409 when the existing account already has another role (nothing changed);
- creates the account through `auth.admin.createUser` with the email confirmed, or sets the password of an existing applicant
  account with `auth.admin.updateUserById`; then `claim_first_admin()` (service role only, under a lock) makes it Super Admin;
- the password is never logged, stored or returned; the page clears the fields and signs in;
- afterwards the operator deletes `SETUP_CODE`. Change password (current password checked first) and Forgot password (emailed code)
  cover later changes.

## 5. Tests executed

| Area | Result |
|---|---|
| Migrations 01–39 + seed on an empty strict database | PASS |
| pgTAP database suite (RLS, roles, curriculum, safeguarding interim access, grants, first admin incl. the service-role path) | PASS – 920 assertions, 0 failed |
| Baseline equals migrations (`baseline_check.sh`) | PASS – 15/15 |
| Browser installation `supabase/install`, every file executed exactly as the SQL Editor executes it (whole text as one query): order guards, repeats, non-empty project, older installation recognised, LF and **CR LF** produce an identical database, a step failing at its last statement leaves nothing behind and can be rerun, pre-existing account gets a profile, first-admin claim afterwards, verification READY and 7/8 changing after setup, RECOVERY refusals and complete removal (`install_check.sh`) | PASS – 58/58, every file executed as a non-superuser with Supabase's default privileges; REPAIR included |
| Legacy SQL Editor package for the old project (`sql_editor_check.sh`) | PASS – 44/44 |
| Production-initialization rehearsal incl. the partial state 01–37 | PASS – 28/28 |
| Migration 37 (Digital Marketing topics, nothing approved) | PASS – 28/28 |
| Data API grants / RLS per role with real signed-in sessions; production 403 reproduced without migration 38 | PASS – 24/24 |
| Migration 36 profile repair on a drifted database | PASS – 12/12 |
| Curriculum generation, coverage, upgrade and rollback; rollbacks 30–39 verified schema-identical | PASS – 41/41 + 10 rollbacks |
| End-to-end workflows with test accounts | PASS – 36/36 |
| Frontend contract (every function, table and bucket the screens use exists and is permitted) | PASS – 0 problems |
| Edge Functions in Chrome (real code, simulated Supabase): CORS, roles, `bootstrap-first-admin` 9 cases | PASS – 38/38 |
| `/setup` and Change password screens in Chrome, also under the production Content-Security-Policy | PASS – 11/11, 11/11 |
| Registration → verification → account loading; password recovery; CSP | PASS – 13/13 ×2, 12/12 ×2, 20/20 |
| Unit tests (pure logic) | PASS – 355/355 cases (`site.test.ts` needs Vite and cannot run here) |
| Type check (stub definitions, strict) and syntax parse of 172 TypeScript files | PASS – 0 new errors, 0 syntax errors |
| Windows launchers: static check and decision logic | PASS – 65/65 (Windows itself NOT TESTED) |
| Routes, references, migration register, release-check self-test, photo tool, workflow YAML | PASS |
| Release ZIP rebuilt, extracted to a clean folder, full suite run from the extracted copy, secret scan | see §7 |

## 6. Not tested / blocked

| Item | Status | How it gets done |
|---|---|---|
| `npm ci`, real TypeScript build, Vite build, ESLint, Vitest component tests, `npm audit`, bundle size | BLOCKED (no registry) | GitHub `release-check` workflow on upload |
| PostgreSQL 17 | BLOCKED | GitHub `database-pg17` workflow (baseline, install package, pgTAP) on upload |
| Real Supabase: Dashboard SQL Editor size limits and confirmations, Auth Admin API, Edge Function runtime, `verify_jwt` settings | BLOCKED | INSTALL_GUIDE parts B, C, E, F |
| Cloudflare Worker build and preview | BLOCKED | INSTALL_GUIDE part D |
| Playwright end-to-end tests | BLOCKED (`@playwright/test` not in the verified lockfile) | after a lockfile refresh |
| Dependency upgrades (Zod 4, React Router 7, Vite, Vitest; pin Wrangler) – the audit of 20 Nov listed 20 vulnerabilities | NOT DONE (needs the registry) | separate change, after `npm audit` runs |
| Windows double-click of the `.bat` launchers | NOT TESTED | on a Windows PC |
| Email delivery (SMTP/Resend), file scanner | NOT TESTED | optional configuration |

## 7. Release package

Built by `tools/release/make_release.py` (files selected, never-ship files refused, `package.json` matched to the verified
lockfile, CRLF for `.bat`, `MANIFEST.txt` with the SHA-256 of every file). The ZIP's own SHA-256 is in `SHA256SUMS.txt` next to
the ZIP. The extracted copy is checked with the same full suite and a secret scan before delivery.

## 8. Open points for the owner

1. Confirm the administrator password rule (12+ characters, letters and digits; sign-up stays 10+).
2. Set up SMTP before learners register (Supabase's built-in email is for testing only).
3. Decide when to retire the old deployment, after the new one is approved. This release never changes it.
4. Approve the dependency upgrades once GitHub's `npm audit` report is available.
