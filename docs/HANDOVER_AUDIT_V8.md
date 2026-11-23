# DIRA LEARN – V8 handover audit (19 November 2026)

Audited: `dira-learn-v8-dira-connect.zip` (216 files). Checkpoint produced: `dira-learn-v8.1-audit-fixes.zip`.

## 1. Summary
- **All V3–V8 work is present and integrated** in the V8 ZIP. Nothing from earlier checkpoints is missing.
- **First ever execution of the database.** All 22 migrations and the seed were applied to a real PostgreSQL 16 server (with a local stand-in for Supabase's `auth`, `storage`, roles, default grants and Realtime publication). They all applied without error.
- **Database tests:** 368 checks in 19 files were run. 357 passed first time. The 11 failures were traced to **3 real bugs** (now fixed in new migration 23) and **6 outdated or mis-written tests** (now corrected). After the fixes: **387 of 387 checks pass** (19 new or adjusted checks).
- **DIRA Connect (Phase 4) database layer works and its isolation holds**, including 14 extra attack probes. Two policy gaps need management decisions (section 6).
- **Not possible here:** `npm install` (no internet), so the real TypeScript check, ESLint, the 5 React component tests and the production build could not be run. They must be run on your computer (section 8).

## 2. What is present (verified from source)
| Checkpoint | Database | Screens / code | Tests |
|---|---|---|---|
| V3 Founder & Co-Founder executive permissions | migration 17 (`is_executive()`) | `permissions.ts` `EXECUTIVE_ROLES`, read-only Users page | `executive_roles.test.sql` |
| V4/V5 Cohort access windows and rules | migrations 18, 19 | `AccessPanel`, `AccessBanner`, `useProgrammeTimezone` | `cohort_access`, `access_rules_v2` |
| V6 Assignments and individual assignments | migration 20 | `MyAssignmentsCard`, grouped assignments | `assignment_recipients` |
| V7 Daily Briefs | migration 21 | `BriefsPage`, `DailyBrief` on dashboard | `daily_briefs` (25 checks) |
| V8 DIRA Connect | migration 22 | `ConnectPage`, `ModerationPage`, `/connect`, `/connect/moderation` | `dira_connect` (58 checks) |

Also present: 6 Edge Functions (`claim-first-admin`, `convert-application`, `email-webhook`, `import-learners`, `invite-user`, `send-emails`; `send-emails` calls `publish_due_briefs` and `queue_access_reminders`), 140 TypeScript files (all parse without syntax errors), every local import resolves, every database function the Connect screens call exists.

**Missing or incomplete (not bugs, gaps):**
- Rollback scripts exist only for migrations 14 and 16 (and now 23). Migrations 17–22 have rollback *instructions* in docs but no scripts.
- No "unmute" button (the database function `connect_unmute` exists; mutes expire on their own).
- "Escalate to safeguarding" only marks the report; it does not create a safeguarding record or notify anyone (waiting on decision 1).
- No component or end-to-end tests for the Connect and Briefs screens.

## 3. Secrets and environment variables (values not shown)
- `.env.local` is in the ZIP but contains **placeholders only** (no real keys). `.gitignore` already excludes it.
- **No service-role key anywhere** in the source or frontend.
- Frontend (Netlify): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_PUBLIC_SITE_URL`.
- Server (Supabase secrets): `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `APP_URL`, `RESEND_WEBHOOK_SECRET`. Phase 4 adds none.

## 4. Bugs found and fixed (migration 23)
| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | Low (privacy) | `learner_access_state()`: a NULL-logic slip let any signed-in non-learner (e.g. an applicant or mentor) look up any learner's access status. | Guard now treats "unknown" as "no". Trusted server jobs still get answers. |
| 2 | Low (defence in depth) | Application decision, application review and curriculum-topic review switched a transaction-wide "workflow" flag on and never off. A later direct update in the same transaction could skip the guards. Not reachable from the app (each request is its own transaction). | Each function switches its flag off again. |
| 3 | Medium (Phase 4) | DIRA Connect: posting a message "as someone else" was silently re-labelled as the sender and **posted** instead of refused. No impersonation was possible, but the message went out. This also broke 4 later report/moderation checks. | Such messages are now refused: "You can only send messages as yourself". |

Each fix was confirmed both ways: the corrected tests **fail** on the V8 code and **pass** with migration 23. The rollback script restores the five functions exactly (checked by fingerprint) and migration 23 re-applies cleanly afterwards.

## 5. Tests corrected (test files only, no weakening)
- `applications_cohorts`: plan said 13 checks, file has 12.
- `assignments_grading`: used `UPDATE`/`DELETE` inside a sub-query, which PostgreSQL does not allow; replaced by a helper that counts changed rows.
- `cohort_access`: expected expired learners to see no assignments, but migration 19 (accepted DIRA decision 5) deliberately lets them read their own results; also added the check for bug 1.
- `executive_roles`: expected an error when a Founder changes a role; the database correctly refuses by changing nothing. The test now checks the role is unchanged.
- `src/lib/permissions.test.ts`: two checks still used pre-V3 rules (audit/settings/users/safeguarding for super admin only).

## 6. DIRA Connect – security position
**Holds (tested):** private messages readable only by the learner and their assigned facilitator; learners cannot see other cohorts or other learners' messages; trainers only their assigned cohorts; executives and programme staff read **no** private messages by default; executives cannot post; anonymous users get nothing; nobody can delete messages; learners cannot grant themselves oversight; every private oversight read needs a 10+ character reason and is logged; reports carry only the reported message; moderation (reports, hide, lock, mute) is a separate permission from private oversight.

**Gaps needing a decision (not fixed, policy):**
- **A. Self-granting.** A Super Admin, Founder or Co-Founder can grant *themselves* private-conversation access (it is audited, but not prevented).
- **B. Scope of private access.** A holder can read **any** private conversation, not only reported ones, although the screen says "Read reported private conversations".
- **C. Hidden messages** are shown to oversight readers as "removed by a moderator", not the original.
- **D. Safeguarding records** (migration 9) are readable and editable by all three executives (V3 decision 2, never confirmed).

## 7. Test results
| Check | Result |
|---|---|
| Apply migrations 1–23 + seed on PostgreSQL 16 | **Passed** |
| Database tests (19 files) | **Passed 387/387** |
| Extra DIRA Connect attack probes | **Passed 14/14** (2 confirm gaps A and B) |
| Rollback of migration 23 | **Passed** (exact restore, re-apply OK) |
| Unit tests, pure logic (26 files) | **Passed 25 files**; `site.test.ts` not run (needs Vite) |
| Unit tests needing `zod` (3 files) / React components (5 files) | **Not run** (packages not installable here) |
| Syntax parse of all 140 TS/TSX files | **Passed** |
| `npm run typecheck`, `npm run lint`, `npm run build` | **Not run** (no `npm install`) |
| Supabase CLI `db reset` / `test db`; real Auth, Storage, Realtime server | **Not run** (stand-in used; needs Docker + Supabase CLI) |
| Screens in a browser, Realtime delivery, multi-account testing | **Manual verification required** |

Stand-in differences to be aware of: tables are owned by a true superuser locally (in Supabase, `postgres` owns them, with the same effect on row security); Realtime's own permission check was not run.

## 8. Running the checks on Windows
1. Install Node.js 20 LTS, then in the project folder: `npm install`, then `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Send me any errors exactly as shown.
2. For the full Supabase check: install Docker Desktop and the Supabase CLI, then `supabase start`, `supabase db reset`, `supabase test db`.

## 9. Rollback
- Migration 23: run `supabase/rollback/20260101000023_v8_audit_fixes_down.sql` in the SQL editor. No data changes either way.
- To return to V8 exactly, use the original `dira-learn-v8-dira-connect.zip`.
