# DIRA LEARN – Phase 4 (DIRA Connect and safeguarding): implementation for review

Date: 19 November 2026. Checkpoint: `dira-learn-v9-phase4-safeguarding.zip` (builds on V8.1).
**Nothing has been deployed, pushed to Supabase or run against production.** All work and testing was done in an isolated local environment.

## 1. Where Phase 4 stands
- **Database: implemented and tested.** All 26 migrations apply cleanly to PostgreSQL 16; all 22 database test files pass (**560 of 560 checks**), including 170 new checks for the approved decisions.
- **Screens: implemented, not yet seen in a browser.** All files parse, the pure logic is strictly type-checked and unit-tested (296 of 296 cases), but the full TypeScript check, ESLint, the build and real use in a browser can only run on your computer (this workspace cannot install packages).
- **Phase 4 is therefore ready for your local testing, not yet "complete".** It becomes complete after the checks in section 7 pass and the manual tests are done.

## 2. Summary of changes
| Decision (19 Nov 2026) | What was built |
|---|---|
| 1, 7 Safeguarding process, restricted records | Configurable **Safeguarding Lead and Deputy** (nobody assigned automatically; no self-appointment); confidential records readable **only by the officers**; escalation creates a record; urgent concerns alert both officers at once, others the acting officer; 60-minute / 24-hour acknowledgement targets with overdue alerts; full history of dates, actions, responsible officer, resolution, legal hold; exceptional, time-limited, logged access granted by someone else; no names in notifications or emails. |
| 2, 3 Facilitator messaging | Facilitators (trainers assigned to the learner's cohort) can **start** private conversations. |
| 4 Private oversight | **No self-granting**; "private" access limited to **reported or escalated** conversations; the acting Lead may open another conversation only for a documented, open safeguarding record with a reason; every access logged; executives have no automatic access. |
| 5 Closed access | Learners with closed access keep **support messaging** with their facilitator and the safeguarding team; discussions and materials stay closed. |
| 6 Retention | Ordinary messages deleted **12 months after the cohort ends**, only once an executive switches retention on; reported, safeguarding-linked, safeguarding-team and legally held conversations are never deleted. |
| 7 (original) Attachments and links | Private file attachments (documents and images, 10 MB, 3 per message) with database checks; safe link display. |
| Age policy | Applications from people **under 18 cannot be submitted or accepted**; no participant record can be created for someone under 18. |
| Live migrations | Read-only check scripts and instructions (`docs/CHECK_LIVE_MIGRATIONS.md`). |

Also: moderators can now unmute; Realtime covers attachments; the `send-emails` schedule runs the safeguarding overdue check and retention (even when email is not configured).

## 3. Database migrations
| Migration | Purpose | Data changed? |
|---|---|---|
| 23 `v8_audit_fixes` | 3 bug fixes from the audit | No |
| 24 `safeguarding_officers` | Officers, confidential records and history, exceptional access, access log, escalation, oversight rules | Adds columns to `safeguarding_records` (existing rows keep their content); **removes executives' read access to safeguarding records**; adds one email template |
| 25 `connect_phase4_completion` | Facilitator start, closed-access support, safeguarding-team conversations, attachments, retention, legal holds | Adds a private storage bucket `connect-attachments`; retention is **off** |
| 26 `minimum_age` | Under-18 refusal | No (existing records untouched) |

Edge Function changed: `send-emails` (needs `supabase functions deploy send-emails` when you approve deployment). No new environment variables or secrets.

## 4. Test results
**Passed**
- Migrations 1–26 + seed applied on PostgreSQL 16 (Supabase stand-in for auth, storage, roles and Realtime publication).
- Database tests: 22 files, **560/560** checks. New: `safeguarding` (87), `connect_phase4` (73), `minimum_age` (10); updated: `dira_connect` (61), `rls`, `executive_roles`.
- Tested with separate accounts in the database: learners (active, scheduled, suspended, expired), facilitators of different cohorts, a mentor, a coordinator, a programme director, Super Admin, Founder, Co-Founder, Safeguarding Lead and Deputy.
- Rollbacks 26 → 25 → 24: the database returns **exactly** to the migration-23 structure (compared with `pg_dump`); a record with a new status is kept and mapped back; re-applying afterwards works; rollback 25 refuses to run while safeguarding conversations exist.
- Read-only check scripts give correct results on databases at the 16, 23 and 26 levels.
- Unit tests (pure logic): 29 of 30 files, 296/296 cases, including the form tests that need `zod`.
- Strict TypeScript check of the 31 logic modules that do not need React; syntax parse of all 142 TypeScript files; no unused imports in the three changed screens.

**Failed:** none.

**Not run (need your computer):** `npm install`, `npm run typecheck`, `npm run lint`, the 5 React component tests and `site.test.ts`, `npm run build`, `supabase db reset` / `supabase test db` with the real Supabase CLI, the Edge Functions.

**Manual verification required:** the Connect, Moderation and Safeguarding screens in a browser; Realtime delivery between two browsers; uploading and downloading attachments through real Supabase Storage; notification emails; the scheduled job.

## 5. Security findings
- Private messages, cohort isolation, facilitator scope, learner-to-learner privacy, executive non-access and moderation/oversight separation all **hold under test**, including direct API-style attempts (14 probes from the audit plus the new tests).
- Safeguarding records are no longer visible to executives. They are kept out of the general audit log, which executives can read.
- Self-granting of oversight, self-appointment as an officer and self-granted exceptional access are all refused by the database.
- **Residual risks:** (a) no virus scanning of attachments (declared file type and size are checked, contents are not); (b) the database is only as safe as the people appointed; two-person rules prevent self-grants but not collusion between two executives; every access is logged for review; (c) urgent alerts are in-app and email only (no SMS or phone).
- No secrets or service-role keys in the code; none added.

## 6. Decisions still needed (details in `docs/SAFEGUARDING.md` and `docs/DIRA_CONNECT.md`)
1. Formally appoint the Safeguarding Lead and Deputy.
2. Confirm the 60-minute urgent acknowledgement target and out-of-hours arrangements.
3. Retention period for safeguarding records and safeguarding-team conversations (legal advice).
4. Who may be appointed officer (currently executives and programme staff).
5. Exceptional access rules (officer or different executive, up to 7 days).
6. Automatic routing of "safety concern" reports to safeguarding.
7. Officers reading reported conversations without a separate grant.
8. Upper age limit 25 in the database, or form only.
9. Virus scanning for attachments.
10. When to switch on message retention (after legal review).
11. Carried over and still open: Daily Briefs decisions 1–5 (`docs/DAILY_BRIEFS.md`) and executive-role decisions 1 and 3 (`docs/EXECUTIVE_ROLES.md`). Executive decision 2 (safeguarding access) is now settled.

## 7. Testing on your Windows computer
1. Install **Node.js 20 LTS** from nodejs.org (accept the defaults).
2. Unzip the checkpoint, for example to `C:\dira-learn`. Open the `dira-learn` folder, click the address bar, type `powershell` and press Enter.
3. Run, one at a time: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Send me any red error text exactly as shown.
4. For the database tests: install **Docker Desktop** and start it, then run `npx supabase start`, `npx supabase db reset`, `npx supabase test db`.
5. To try the screens: `npx supabase status` shows an API URL and an anon key; put them in `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, run `npm run dev` and open http://localhost:5173. (Next step offered: a local-only script that creates the test accounts for you.)

## 8. Rollback
- Back up first. Run in the Supabase SQL editor, **newest first**: `supabase/rollback/20260101000026_minimum_age_down.sql`, then `..._25_connect_phase4_completion_down.sql`, then `..._24_safeguarding_officers_down.sql`; then (if needed) `..._23_v8_audit_fixes_down.sql`. After each one, delete that version from `supabase_migrations.schema_migrations`.
- Rollback 25 stops if safeguarding conversations or attachments exist (they may be evidence): export them first.
- Rollback 24 removes officer positions, record history, grants and logs, and gives executives back read access to records: **export those tables first**.
- Redeploy the previous `send-emails` function from the V8.1 ZIP if you roll back 24 or 25.
- To return to the previous code, use `dira-learn-v8.1-audit-fixes.zip`.
