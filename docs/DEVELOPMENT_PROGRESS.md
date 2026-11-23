# Development progress

| Area | Status |
|---|---|
| Architecture, assumptions register | Done |
| Database schema, RLS, views, storage policies, seed | Written, not executed |
| Project config (Vite, TS strict, Tailwind tokens, ESLint, Vitest, Playwright) | Written, never installed or built |
| Auth (login, session, protected routes, role nav) | Written, untested against Supabase |
| Applicant: application form with Zod validation | Written (document upload UI not built) |
| Curriculum viewer (database-driven, flags draft content) | Written (admin editing not built) |
| Track selection (via select_track function) | Written |
| Attendance recording | Written (history, reports, export not built) |
| Participant dashboard (four-week arc), staff funnel | Written; other role dashboards are placeholders |
| **Module 2: application review** (queue, filters, detail, documents via signed URLs, status workflow RPC, reviewer notes, history, convert to participant) | Written, not run |
| **Module 2: cohorts** (create, capacity, archive, enrol participants, trainer assignment, session scheduling with conflict checks, cancel) | Written, not run |
| **Module 3: trainer session flow** (Sessions list by today/upcoming/past, session page with plan, attendance with progress and completion, resources link/upload, delivery report) | Written, not run |
| **Module 3: curriculum admin** (add/edit sessions per track, draft/approved status, approval by director or super admin) | Written, not run |
| Migration 5 (session reports, complete_session, curriculum approval and edit guards, audit) | Written, not executed |
| Migration 4 (workflow guards, capacity lock, schedule/trainer conflict triggers, audit) | Written, not executed |
| **Module 4: assignments and grading** (create per cohort/track with optional max score, participant submit with text or file, late flagging, resubmission when returned, trainer/staff grading queue, grade or return with feedback, progress counts) | Written, not run |
| Migration 6 (assignment max score, submission guard: enrolment, attempt number, late status and grading fields set by the database; grading guard: score range, latest attempt only, immutable submitted work; trainer policies narrowed to read and grade; audit) | Written, not executed |
| **Module 4b: participant resources page** (search, type filter, grouped by week and session, link or signed-file open; trainers choose per resource whether participants can see it) | Written, not run |
| Migration 7 (resources hidden from participants unless shared, applicants and withdrawn participants blocked, file access follows row access, http(s)-only links, uploader recorded, audit) | Written, not executed |
| **Module 5: results and completion** (assignments tagged as session task / final project / reflection; weighted draft result from attendance and graded work; completion checks; results page for participants, trainers and staff) | Written, not run |
| Migration 8 (assignment component column, locked once work is submitted) | Written, not executed |
| Edge Functions: convert-application, issue-certificate | Written, not deployed; certificate PDF not built |

| **Mentorship** (assign one mentor per participant; mentor logs sessions with action points and chooses whether to share; mentee sees shared sessions) | Written, not run |
| **M&E** (live figures from views, indicators and records with data quality, CSV export) | Written, not run |
| **Certificates and graduation** (approved rules required, issue and withdraw through database functions, printable certificate, public verify page, move to alumni) | Written, not run |
| **Alumni** (staff list; alumni update their own follow-up) | Written, not run |
| **Notifications and announcements** (inbox with unread badge, cohort or programme-wide announcements, database-created notifications) | Written, not run |
| **Projects and portfolio** (participant projects, milestones, evidence upload, trainer feedback and review) | Written, not run |
| **Admin** (users and invitations, settings and graduation-rule approval, audit log viewer, safeguarding records) | Written, not run |
| Migration 9 (profile guards, mentorship, M&E, certificates, notifications, projects, settings, safeguarding, audit) | Written, not executed |
| Edge Function `invite-user` (replaces `issue-certificate`) | Written, not deployed |

| **Email** (templates, outbox, bulk and scheduled sends, reminders, event emails, delivery tracking via webhook, admin page) | Written, not run |
| **Calendar** (day, week, month; join links; .ics download) | Written, not run |
| **Analytics** (live KPIs, charts, filters, CSV and print-to-PDF) | Written, not run |
| Migration 10 (email system) | Written, not executed |
| Edge Functions `send-emails`, `email-webhook` | Written, not deployed |

| **Courses** (courses, modules, lessons with file upload, formats, publish and archive, trainer assignment, enrolment, lesson progress) | Written, not run |
| Migration 11 (courses) | Written, not executed |

| **Learner sign-up** (`/signup` with email confirmation) and **set-password page** for invitation links | Written, not run |
| **Bulk learner import** (CSV check and preview, invitations, batch log) and Edge Function `import-learners` | Written, not deployed |
| Migration 12 (import log) | Written, not executed |

| **Website alignment** (theme colour, values, photos on a dashboard banner, policy and contact links, website link, sidebar logo) and **Netlify hosting config** | Written, not run |

| **Curriculum aligned to the websites** (4 tracks, 2 core + 6 track sessions each; all draft except the approved Entrepreneurship session 4) and **animated website photos** on sign-in, create-account and set-password pages (shared with the dashboard banner) | Written, not run |

| **In-app first administrator** (`/setup` page, Edge Function `claim-first-admin`, migration 13, pgTAP and Vitest tests); replaces the manual SQL step | Written, not run |

| **Applicant approval module**: Applications management tabs (Pending / Approved / Rejected), server-side `decide_application`, audit trail, emails, tests, rollback script | Written, not run |

| **Curriculum Approval Centre** (Founder / Co-Founder roles, topic proposals, server-side review, history, tests, rollback) | Written, not run |

## Not started
Competency frameworks and assessments (no approved competency list exists), deleting or retiring curriculum sessions, rescheduling UI, removing an enrolment, cohort calendar view, editing or deleting an assignment, linking assignments to curriculum sessions, waitlist promotion, email and SMS delivery, bulk actions, reports beyond the M&E page and CSV, stored final results, server-generated certificate PDF, role dashboards for trainer, mentor and M&E (they use the menu), reading the stored settings in the screens, self-service sign-up page.


| Windows one-click launcher | Removed (8 Nov 2026): the system is hosted online; see docs/NETLIFY_DEPLOYMENT.md |

| **V8 handover audit**: migrations 1–22 executed for the first time; migration 23 fixes 3 bugs; 6 outdated tests corrected; 387/387 database checks pass | Done 19 Nov 2026 (frontend build still to run) |
| **Phase 4 completion** (migrations 24–26): safeguarding officers and confidential records, escalation, stricter oversight, facilitator-started and closed-access support messaging, safeguarding-team conversations, attachments and links, retention with legal holds, minimum age 18; 560/560 database checks | Built and tested locally 19 Nov 2026; screens need browser testing; not deployed |
| **Phase 5** cohort intakes and access windows | Already built (V4/V5, migrations 18–19); verified 19 Nov 2026 |
| **Phase 6** individual learner performance (migration 27) | Built and tested locally 19 Nov 2026 |
| **Phase 7** cohort intelligence (migration 28) | Built and tested locally 19 Nov 2026 |
| **Attachment virus checks** (migration 29) | Built and tested locally; scanner not chosen |
| **Phase 9** interface and branding polish | Built; logic tested; needs visual review |
