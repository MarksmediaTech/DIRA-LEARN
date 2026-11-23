# DIRA LEARN updated release: repair and test report (21 Nov 2026)

> **Superseded for the new deployment (21 Nov 2026 rebuild).** This document describes the OLD Supabase project / deployment. For the new GitHub repository, Supabase project and Cloudflare Worker use **`docs/deployment/INSTALL_GUIDE.md`**.


Statuses: **PASS** = tested and verified · **FAIL** = tested and failed · **NOT TESTED** = not executed · **BLOCKED** = could not be executed because a dependency or access was unavailable.

Where the tests ran:
- **Local PostgreSQL 16 stand-in for Supabase.** It now mirrors Supabase's current default: no automatic grants on new tables or functions.
- **Real Chrome**, running the app's screens against a simulated Supabase.
- **Node 22.**

Not available in this workspace:
- the npm package registry (HTTP proxy refused), so no `npm ci`, real build, real ESLint, `npm audit` or Playwright;
- Cloudflare;
- any Supabase project;
- Windows.

The production database was not touched.

## 1. Baseline

- **Authoritative source:** the development tree `dira-learn`. It is the source of the repair branch, whose last commit is `f0ca539` (migration 37). The branch history is preserved in the archive `dira-learn-old-project-archive-2026-11-21.zip`, which is verified and was not deleted.
- **Lockfile:** `package-lock.json` from that branch: 457 packages, the same file your GitHub release check used on 20 Nov 2026.
- **Not mixed in:** files from older versions (V8 and the rebuild notes) were read for the investigation only.

## 2. Errors found, and their causes

| # | Error | Root cause | Status |
|---|---|---|---|
| A | 403 on `/rest/v1/profiles`, stuck on "Loading your account" (profile `super_admin`/`active`) | **Confirmed.** Migrations 01–37 never granted table privileges to the API roles; they relied on Supabase's automatic grants. Supabase stopped those for new projects on 30 May 2026 and for all projects on 30 Oct 2026. Reproduced: `permission denied for table profiles`, and only 5 of 106 tables readable by signed-in users. The old test stand-in granted everything itself, which hid it. | **Fixed** (migration 38). PASS locally; production needs section 0/6b of the database guide. |
| A2 | The schema fingerprint and live inspection did not record signed-in users' table grants | Oversight; it would not have caught A. | **Fixed.** |
| A3 | The old automatic defaults also gave signed-in users TRUNCATE, REFERENCES and TRIGGER on every table (275 grants) | Supabase's former defaults. | **Removed** in migration 38. |
| B | Seed: `relation "customers" does not exist` | **Not from DIRA LEARN.** No migration, seed or function in any version refers to a `customers` table. Checked: 223 files across every version, the complete git history and all briefs; only lesson wording such as "into customers" matches. The exact source is unconfirmed without the production query history. See the database guide, section 0, for how to look it up. | Investigated. The seed completes on an empty test database and is idempotent. PASS. |
| B2 | Production partly initialized (01–37 applied, no data) | A failed seed went undetected. | **Fixed:** guarded continuation `01b_continue_after_37.sql` with its own pre-check. PASS in rehearsal. |
| B3 | The curriculum upgrade test's "pre-V13" database silently contained migrations 33+ | Test setup error. | **Fixed:** now exactly 1–29, as documented. |
| C | Cloudflare: Vite 5.4.21 not auto-configurable; `VITE_SUPABASE_URL` missing | No Wrangler configuration (fixed on 20 Nov with `wrangler.jsonc`, static assets, SPA routing); build variables set as runtime variables. | Configuration validated (PASS). Real build and preview: BLOCKED. |
| D | 20 vulnerabilities (2 critical, 2 high) | Outdated major versions, from the real audit of 20 Nov 2026 on this lockfile. Production dependencies: **zod (high)**, react-router and react-router-dom (moderate). Development only: **vitest and tinypool (critical)**, **vite (high)**, and @vitest/mocker, esbuild, vite-node (moderate). Every fix is a major upgrade: Zod 4, React Router 7, Vite 8, Vitest 5. | **BLOCKED** (needs the registry). See section 9. |
| E | Endless "Loading your account" and unclear errors | Every failure was treated as "loading" (fixed on 20 Nov). Today a 403 was still described as "check your internet connection". | **Fixed:** separate messages and actions for permission refusal (403/42501), an expired sign-in (401/PGRST301 → "Sign in again"), an uninitialized database (PGRST205), connection problems, timeout and a missing profile. PASS in Chrome. |
| F | `.gitattributes` forced LF on Windows batch launchers after a clone from GitHub | Overly broad rule. | **Fixed** (CRLF for `.bat`/`.cmd`). PASS with a real git round trip. |
| G | The launcher used `npm install`, which can rewrite the lockfile | Not reproducible. | **Fixed:** `npm ci` when the lockfile exists. |
| H | **SQL Editor installation stopped at part 2:** `Migration 20: expected text not found in function guard_submission()` (project `odfiawrvmaafdskbkptv`) | **Confirmed.** Notepad-to-browser copying stores Windows line breaks. Migrations 17, 19, 20, 23, 33, 34 and 36 search stored function text for phrases with plain line breaks. My earlier validation (30/30) did not catch it, because the test runner read files in text mode and silently removed the Windows line breaks. | **Fixed:** the SQL Editor parts normalise function line breaks before those migrations; the runner sends bytes unchanged. Tested with real Windows line endings: identical schema, function sources and row counts, and no stray characters in data. PASS (44/44). |
| I | Step 7 told you to deploy `claim-first-admin` and set `SETUP_CODE`, contradicting step 8 | Stale message. | **Fixed:** it now points to the first-Super-Admin step of the installation guide. |
| J | **Safeguarding (owner decision 21 Nov 2026):** "Super Admins can read safeguarding records until a Safeguarding Lead or Deputy is appointed" | Changes the 19 Nov rule. | **Implemented:** migration 39 and rollback. Active Super Administrators only; ends at the appointment; urgent and overdue alerts. PASS: 24 new database tests, and the existing 87 safeguarding tests unchanged. |

## 3. Files changed (since `f0ca539`)

| Area | Files |
|---|---|
| Database (new) | `supabase/migrations/20260101000038_explicit_api_grants.sql`, `supabase/rollback/20260101000038_explicit_api_grants_down.sql` |
| Production initialization | **`sql_editor/` (new: browser-only installation, generated by `build_sql_editor.py`)**, `00b_precheck_partial_readonly.sql` (new), `01b_continue_after_37.sql` (new, generated), `01_initialize_production.sql` (regenerated, 38 migrations), `02_verify_readonly.sql` (01–38, 100 tables, **check 16: grants**), `build_bundle.py` |
| Checks | `supabase/checks/live_full_inspection.sql` (records every table grant), `expected_schema_fingerprint.txt` (2,398 lines), `live_migration_check_part2.sql` (marker 38) |
| Database tests | `assignments_grading`, `attachment_scanning`, `dira_connect`, `learner_performance` and `remaining_modules` (`.test.sql`): forbidden edits and deletes are now refused outright (42501) instead of affecting 0 rows. Stricter; nothing was weakened. |
| App | `src/features/auth/profileLoad.ts`, `src/features/auth/ProtectedRoute.tsx`, and their tests |
| Test tooling | `tools/db-standin/supabase_shim.sql` (no automatic grants), `db_reset.sh`, `frontend_contract_check.py` (checks the operation each screen performs, and RLS), `tools/release/grants_check.sh`, `generate_grants_38.py`, `migration_register.py`, `scan_release.mjs`, `make_release.py`, `run_as_sql_editor.py`, `sql_editor_check.sh` (new), `production_init_check.sh` (partial-state rehearsal), `references_check.py`, `tools/curriculum/upgrade_check.py`, `tools/check-all.sh`, Chrome harness (`fake-supabase.ts`, `auth_flow.mjs`) |
| Windows and GitHub | `START-DIRA-LEARN.bat`, `.gitattributes` |
| Package | `package.json`: `@playwright/test` removed so it matches the verified lockfile (section 9); `preview` script |
| Docs | `README.md`, `docs/deployment/PRODUCTION_DB_INITIALIZATION.md`, `RELEASE_GUIDE_2026-11-21.md`, `RELEASE_REPORT_2026-11-21.md`, `SQL_EDITOR_INITIALIZATION.md`, `MIGRATION_REGISTER.md` (generated) |

## 4. Database changes

**Migration 38** (explicit Data API grants), derived from the authored intent of migrations 01–37 and reviewed:
- **Signed-in users** get SELECT/INSERT/UPDATE/DELETE only where a permissive RLS policy allows it and earlier migrations did not withhold it: 94 tables and views, 256 privileges. RLS stays on and still decides which rows. They get no TRUNCATE, REFERENCES or TRIGGER.
- **Signed-out visitors** get no table at all; they can call only `check_request()` and `verify_certificate()`.
- **The server role** gets everything in `public`.
- **Functions:** execute as authored: 122 for signed-in users; the 26 internal functions stay server-only.
- **Self-check:** a built-in self-check aborts the migration if any rule is broken.
- **Rollback:** restores the recorded privileges exactly.

No data, row, policy or function body changed. No curriculum approval changed: Draft stays Draft, Pending stays Pending, the programme is not approved, and nothing is approved automatically.

## 5. Security improvements

- Explicit least-privilege grants, replacing reliance on automatic defaults.
- TRUNCATE, REFERENCES and TRIGGER removed from the API roles.
- Signed-out table access removed.
- Automated detection of missing grants. It reports 128 problems on a database without migration 38 and 0 with it.
- The release safety scan never prints secret values.
- `.env.local` and `netlify.toml` excluded from the release.

## 6–7. Tests executed and results

| Stage | Test | Result |
|---|---|---|
| 1 Installation | `npm ci` from the lockfile | **BLOCKED** (registry unreachable; offline cache lacks the packages) |
| 1 | package.json ↔ lockfile agreement (all direct dependencies present, identical ranges) | PASS |
| 1 | Environment validation (`write-headers.mjs` refuses a missing or invalid `VITE_SUPABASE_URL`) | PASS (release-check self-test) |
| 1 | Windows launchers: static check of 4 batch files; 65 decision-logic cases | PASS; **on Windows itself: NOT TESTED** |
| 2 Code quality | TypeScript, strict, with stub type definitions | PASS (0 new errors). With real packages: **BLOCKED** |
| 2 | ESLint: core rules (ESLint 10.1.0 from cache, types stripped) | PASS (0 problems). Full project configuration with plugins: **BLOCKED** |
| 2 | Formatting check | **NOT TESTED** (no formatter configured in the project) |
| 2 | Production build (Vite) | **BLOCKED** |
| 2 | `npm audit` | **BLOCKED** today. The last real audit (20 Nov, same lockfile) found 9 advisory groups: 2 critical, 2 high (FAIL, see section 9) |
| 2 | Secret scan of every release file (project rules) | PASS (0 secrets, 0 forbidden files) |
| 3 Database | Empty database: 38 migrations + seed | PASS |
| 3 | 890 pgTAP assertions in 37 files (constraints, triggers, functions, RLS, roles, account status, curriculum, Connect, safeguarding …) as real signed-in roles | PASS (0 failed) |
| 3 | Seed twice: no change; repeated initialization refused safely | PASS |
| 3 | Rollbacks 30–38 restore the schema exactly (full `pg_dump`, grants included) | PASS |
| 3 | Grants and RLS: 24 checks, including the 403 reproduced without 38, per-role own-profile reads, cross-user isolation, escalation refused, inactive refused, no TRUNCATE, no signed-out access, self-check catching 5 kinds of tampering | PASS |
| 3 | Frontend contract: 64 functions, 65 tables/views, 132 table operations used by the screens, all granted with RLS | PASS |
| 3 | Production initialization rehearsal: empty database **and** the partial production state with a hand-promoted Super Administrator (403 reproduced → continuation → profile readable, accounts and roles unchanged) | PASS (28/28) |
| 3 | Migration register: numbering, rollbacks, bundles and documents agree | PASS |
| 3 | **Browser-only installation (Supabase SQL Editor)**, now including a full installation with **Windows line endings**: 6 parts + pre-check, verification and first-Super-Admin step; byte-identical to the release; each file executed exactly as the SQL Editor does (one query, one transaction) on a stand-in with one existing confirmed account. Same database as the psql bundle; account unchanged; refuses wrong order, re-runs, an unedited or wrong email and an unconfirmed account; rolls back completely on failure | PASS (44/44; the earlier 30/30 missed the line-ending failure, see H). In the real Supabase Dashboard: **NOT TESTED** (no access) |
| 3 | Migration 37 data checks; migration 36 drift repair; curriculum upgrade | PASS (28/28; 12/12; 41/41) |
| 3 | 36 cross-phase workflow checks with the local test accounts; cross-check of 44 learner figures | PASS |
| 4 Authentication | Real Supabase Auth sign-in for Super Admin, staff, facilitator, participant | **BLOCKED** (no Supabase project). Database side, as each role: PASS |
| 4 | Chrome, simulated Auth: registration, verification, sign-in, invalid and unverified sign-in, missing profile, 403, expired sign-in, inactive account, timeout, network failure, token refresh, sign-out, no duplicate accounts | PASS (13/13; also 13/13 under the production Content-Security-Policy) |
| 4 | Password reset screens; dry run of the real-Supabase reset test against a mock server | PASS (12/12 ×2; 27/27) |
| 5 Functional | Module logic (unit): 355 cases | PASS. React component tests (`.tsx`) and `site.test.ts`: **BLOCKED** (packages) |
| 5 | Edge Functions (real code, simulated Supabase): CORS, sign-in and roles | PASS (32/32) |
| 5 | Routes: 6 public pages, 37 protected routes, 34 menu entries | PASS |
| 6 Browser | Playwright desktop and mobile suite (`e2e/`) | **BLOCKED** (Playwright not installable) |
| 7 Deployment | `wrangler.jsonc` validation (static assets from `dist`, SPA routing, no Worker script, no secrets) | PASS |
| 7 | Cloudflare preview deployment, real URLs, SPA refresh, live authentication and database | **BLOCKED** (no Cloudflare access; needs the build) |
| 8 Regression | Full suite (`tools/check-all.sh`) after every fix, and again on the **extracted ZIP** | PASS (the delivery message has the extraction result) |
| Release | ZIP extracted into a clean folder: manifest (all files' SHA-256), safety scan, register, package ↔ lock, line endings, a real git upload/clone round trip, the full suite | PASS |

## 8. Outstanding

1. **Dependency upgrades** (BLOCKED, registry). Upgrading Zod 4, React Router 7, Vite 8 and Vitest 5, and regenerating the lockfile, needs package access. Simplest action: turn on network access for package installs in your Claude settings, start a new chat and upload this ZIP. Until then:
   - Zod (high, production): a memory-exhaustion issue when validating oversized collections. DIRA LEARN validates small form inputs in the browser, so the realistic risk is low; still, upgrade it.
   - React Router (moderate): an open redirect via a backslash in links, and an SSR-only issue (DIRA LEARN does not use SSR).
   - Vitest, Tinypool and Vite (critical and high): development and test tools only. They are not part of the website that is deployed.
2. **Playwright end-to-end tests** (BLOCKED). The specs are in `e2e/`, but `@playwright/test` is not in the lockfile.
3. **Wrangler is not pinned** in the lockfile. Cloudflare uses the version in its build image for `npx wrangler deploy`. Pin it with the upgrades.
4. **Real build, ESLint and audit**. GitHub's **Release check** workflow runs them on upload (guide, part B step 5).
5. **Cloudflare preview and production smoke tests**, by you (guide, part E). They need the build.
6. **Windows launchers** not yet run on Windows.
7. **Safeguarding:** decided by the owner on 21 Nov 2026 and implemented (migration 39, finding J). Previously recorded as: *decision needed.* Your brief says safeguarding access stays with Super Administrators until a safeguarding role is appointed. The system follows DIRA's recorded management decision of 19 Nov 2026 (migration 24): only an appointed Safeguarding Lead or Deputy can read records. Executives (Super Administrator, Founder, Co-Founder) appoint them, but have no automatic access, only audited, time-limited exceptional grants. Until someone is appointed, nobody, Super Administrators included, can read records. Not changed; please confirm which rule applies.
8. **The `customers` script:** please check the production SQL Editor history (database guide, section 0).

## 9. Dependency audit (last real run: GitHub release check, 20 Nov 2026, this lockfile)

| Package | Severity | Direct | In the deployed site? | Fix |
|---|---|---|---|---|
| zod | high | yes | yes | zod 4 (major) |
| react-router, react-router-dom | moderate | yes | yes | 7.x (major) |
| vitest, tinypool | critical | yes / no | no (tests) | vitest 5 (major) |
| vite | high | yes | no (build tool; the advisory concerns the development server) | vite 8 (major) |
| @vitest/mocker, vite-node, esbuild | moderate | no | no | with vitest / vite |

## 10. Cloudflare preview

**BLOCKED.** No Cloudflare access from here, and the build needs the registry. The configuration (`wrangler.jsonc`) validates (PASS). The preview procedure is part E of the release guide.
