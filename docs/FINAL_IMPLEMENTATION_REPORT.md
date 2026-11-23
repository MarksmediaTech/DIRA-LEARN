# DIRA LEARN – Phase-by-phase implementation report (V13, 19 November 2026)

**Nothing has been deployed. The live Supabase project has not been touched.** All work and testing ran in an isolated local environment (PostgreSQL 16 with a Supabase stand-in). Final checkpoint: `dira-learn-v13-final-review.zip`.

> **Update – V13 curriculum revision (19 Nov 2026):** Digital Marketing replaces Digital Skills, and all 26 sessions have detailed draft lesson plans (migration 30), with the timetable unchanged. See `CURRICULUM_V13_CHANGE_REPORT.md` and `docs/curriculum/`. Checkpoint: `dira-learn-v13-curriculum.zip`. **V13.1 review refinements** (migration 31): `CURRICULUM_V13_1_CHANGE_REPORT.md`; checkpoint `dira-learn-v13.1-curriculum.zip`.

## 1. Summary
| Phase | Scope | Result |
|---|---|---|
| Audit (V8.1) | Handover audit; 3 bugs fixed (migration 23) | Done |
| 4 | DIRA Connect and safeguarding (migrations 24–26) | Done; approved decisions applied |
| 5 | Cohort intakes and learning-access windows | **Already built in V4/V5** (migrations 18–19); verified, no changes needed |
| 6 | Individual learner performance (migration 27) | Done |
| 7 | Cohort intelligence (migration 28) | Done |
| Attachment security | Virus-check pipeline; downloads blocked until clean (migration 29) | Done; **no scanner chosen yet** |
| 9 | Interface and branding polish | Done; **needs visual review** |

Roadmap source: each migration names its "master instruction" phase (2 assignments, 3 Daily Briefs, 4 Connect, 5 access windows, 8 executive roles). There are no Phase 1 references in the project.

## 2. Test results (all executed; nothing below is reported as passed without being run)
**Passed**
- **Database (pgTAP), 25 files, 697/697 checks:**

  | Test file | Checks |
  |---|---|
  | access_rules_v2 | 17 |
  | applicant_approval | 42 |
  | applications_cohorts | 12 |
  | assignment_components | 5 |
  | assignment_recipients | 16 |
  | assignments_grading | 23 |
  | attachment_scanning | 31 |
  | cohort_access | 23 |
  | cohort_intelligence | 44 |
  | connect_phase4 | 75 |
  | courses | 15 |
  | curriculum_approval | 46 |
  | daily_briefs | 25 |
  | dira_connect | 61 |
  | email_system | 13 |
  | executive_roles | 20 |
  | first_admin | 11 |
  | learner_import | 5 |
  | learner_performance | 60 |
  | minimum_age | 10 |
  | remaining_modules | 24 |
  | resources | 12 |
  | rls | 9 |
  | safeguarding | 87 |
  | sessions_curriculum | 11 |
- **End-to-end workflows, 30/30:** run with the 14 local test accounts. Each step runs as the real person:
  - assignment, then submission, grading, feedback and the learner's performance;
  - a Daily Brief seen only by its cohort;
  - closed-access support messaging;
  - a safety report going straight to the Lead;
  - the totals appearing in Cohort Intelligence.
- **Database results equal browser results:** 44/44 figures compared between the new database calculation and the existing Results-page code.
- **Frontend contract:** every one of the 63 database functions, 63 tables or views and 5 storage buckets that the screens use exists and is reachable by signed-in users (0 problems).
- **Virus-scanner adapter, 8/8,** against a local fake scanner: clean, infected (EICAR test signature), error, timeout, unreachable, token and file sent correctly.
- **Unit tests,** pure logic: 32 of 33 files, 318/318 cases (including the `zod` form tests); the remaining file, `site.test.ts`, needs Vite and could not run.
- **Type check of every screen and module** with strict settings, against hand-written library definitions: **0 new errors.** 21 known gaps in those definitions are listed in `tools/typecheck-stubs/baseline.txt`.
- **Syntax parse:** all 152 TypeScript files, including the Edge Functions.
- **Rollbacks 23 to 29:** each returns the database **exactly** to the structure before its migration (compared with `pg_dump`), and each migration re-applies afterwards.
- **Mutation checks:** deliberately weakening two Phase 7 security rules made the right tests fail. The same was done for the Phase 4 fixes.

**Failed:** none outstanding. Every failure found during development was fixed (see section 4) and re-run.

**Not run (need `npm install`, Docker or a browser, which this workspace cannot do):**
- `npm run typecheck` with the real packages
- `npm run lint` (React hook rules were checked by reading only)
- the 5 React component tests and `site.test.ts`
- `npm run build`
- `supabase db reset` / `supabase test db` with the real CLI
- the Edge Functions under Deno
- sign-in through real Supabase Auth
- real Storage uploads and downloads
- Realtime delivery between browsers
- email sending
- every screen in a browser and on a phone

## 3. Security test results
- Each role was tested against the permission boundaries: learners (active, scheduled, suspended, expired, withdrawn), facilitators of different cohorts, mentors, M&E officers, coordinators, directors, Super Admin, Founder, Co-Founder, the Safeguarding Lead and Deputy, applicants and anonymous visitors.
- **Holds:**
  - Learners see only their own records, messages and feedback.
  - There is no cross-cohort access.
  - Facilitators are limited to their assigned cohorts, and mentors to their mentees.
  - M&E officers get aggregates only.
  - Executives cannot read private messages or safeguarding records.
  - Nobody can grant themselves oversight, an officer position or exceptional access.
  - Every private or safeguarding read needs a reason and is logged.
  - Notifications carry no safeguarding details.
  - No attachment can be downloaded before a clean scan.
  - Users cannot set scan results, back-date grading times, edit or delete feedback, or delete messages or safeguarding records.
  - Internal calculations cannot be called directly.
  - CSV exports are formula-safe.
- **No Row Level Security was weakened.** Three existing rules were tightened deliberately:
  - executives lost automatic access to safeguarding records;
  - unscanned files can no longer be downloaded;
  - oversight is limited to reported or escalated conversations.
- No secrets or service-role keys are in the code; none were added.

## 4. Issues found and fixed during development
- **Phase 4 audit:** three database bugs (migration 23) and six outdated tests.
- **Pre-existing:** `AssignmentsPage` read data in a way the real TypeScript check would reject; fixed.
- **My own errors caught by the checks:**
  - a missing conversation kind in the Connect screen type;
  - a hide action overwriting an escalated report's status;
  - test-data mistakes (casts, enum values, the real submission workflow);
  - an arithmetic slip in an expected value;
  - missing harness settings.

  All were fixed and re-run.
- **A flaw in my own checking harness**, found while verifying the final ZIP: the type check counted errors only when run from the project folder. Run from elsewhere, it reported zero errors. All phase results above came from runs inside the project folder, where it worked (they show the 21 known gaps). It now runs from the project folder itself, and treats any error it cannot classify as a failure; this was proven with a deliberately injected error.

## 5. Build results
The production build (`npm run build`) **could not be run here.** It is the first thing to run on your computer (section 8). If it reports type errors, they are most likely in places where my library definitions were simplified (the baseline list); send me the output.

## 6. Unresolved issues (nothing hidden)
1. **Not verified in a browser:** all screens, mobile layout, Realtime and file uploads (section 2). This is independent of the database work, which is fully tested. The screens are type-checked against the database contract.
2. **No virus scanner chosen:** attachments can be shared but not opened until one is configured.
3. **Live Supabase state unknown:** please run the read-only check (`docs/CHECK_LIVE_MIGRATIONS.md`) before any deployment is planned.
4. Hosted-scanner adapters are not written until a provider is chosen (only self-hosted ClamAV REST is supported).
5. Cohort Intelligence recalculates every time it opens. That is fine for DIRA's scale, but could need caching past roughly 50 large cohorts.
6. Phase 5 known limit, unchanged: learners cannot see their own access history.

## 7. Management decisions still needed
- **Safeguarding:**
  - formally appoint the Lead and Deputy;
  - decide what happens out of hours;
  - set a retention period for safeguarding records and safeguarding-team conversations (legal advice);
  - decide who may be appointed as an officer;
  - confirm the exceptional-access rules;
  - confirm officers may read reported conversations without a separate grant;
  - decide whether the database should also enforce the upper age limit of 25.
- **Attachments:** choose a scanning service (options and costs in `docs/ATTACHMENT_SECURITY.md`).
- **Retention:** when to switch on 12-month message retention (after legal review).
- **Performance (Phase 6):** approve the weights, the completion rules and the "may need support" thresholds (all drafts), and confirm that M&E officers see no individual learners.
- **Cohort Intelligence (Phase 7):** whether M&E officers may see facilitator figures, and whether to hide small numbers.
- **Carried over:** Daily Briefs decisions 1–5, and executive-role decisions 1 and 3.

## 8. Windows local testing
**Easiest way:** double-click `START-DIRA-LEARN.bat` in the project folder (see `README-LOCAL-TESTING.txt`), then `CREATE-DIRA-TEST-ACCOUNTS.bat` once. The manual steps below do the same by hand.

1. Install **Node.js 20 LTS** and **Docker Desktop** (start it).
2. Unzip `dira-learn-v13-final-review.zip`, open the `dira-learn` folder, type `powershell` in the address bar and press Enter.
3. Run `npm install`, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Send any errors exactly as shown.
4. Run `npx supabase start`, `npx supabase db reset` and `npx supabase test db`. All 25 test files should pass.
5. Create the test accounts: double-click `CREATE-DIRA-TEST-ACCOUNTS.bat`, or paste the file into the local Studio at http://localhost:54323. It refuses to run on a database with real users.
6. Put the values from `npx supabase status` into `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), run `npm run dev` (the launcher does this for you without editing `.env.local`) and open http://localhost:5173.
7. Sign in as each test account (password `DiraTest!2026`) and follow the visual checks in `docs/INTERFACE_POLISH.md`.

## 9. Checkpoints (to recover an earlier version)
| ZIP | Contents |
|---|---|
| `dira-learn-v8-dira-connect.zip` | the original handover |
| `dira-learn-v8.1-audit-fixes.zip` | audit and migration 23 |
| `dira-learn-v9-phase4-safeguarding.zip` | Phase 4 (migrations 24–26) |
| `dira-learn-v10-phase6-performance.zip` | Phase 6 (27) |
| `dira-learn-v11-phase7-intelligence.zip` | Phase 7 (28) |
| `dira-learn-v12-attachment-scanning.zip` | attachment security (29) |
| `dira-learn-v13-final-review.zip` | Phase 9 polish, test accounts, final documentation |

Each database change has a verified rollback script in `supabase/rollback/`. Run them newest first.

## 10. Phase documents
`docs/HANDOVER_AUDIT_V8.md`, `docs/PHASE4_COMPLETION_REPORT.md`, `docs/SAFEGUARDING.md`, `docs/DIRA_CONNECT.md`, `docs/COHORT_ACCESS.md` (Phase 5), `docs/LEARNER_PERFORMANCE.md`, `docs/COHORT_INTELLIGENCE.md`, `docs/ATTACHMENT_SECURITY.md`, `docs/INTERFACE_POLISH.md`, `docs/CHECK_LIVE_MIGRATIONS.md`, `docs/TEST_REPORT.md`.
