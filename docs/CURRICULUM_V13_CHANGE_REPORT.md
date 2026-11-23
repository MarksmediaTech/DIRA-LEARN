# DIRA LEARN V13 – curriculum change report

> **Updated by V13.1 (review refinements, migration 31):** see `CURRICULUM_V13_1_CHANGE_REPORT.md`. Track sessions now include a 5-minute stretch break inside the session (no duration changed); the statements below about breaks, Entrepreneurship session 5 terms and test totals refer to V13.

Revised 19 Nov 2026. **Digital Marketing now replaces Digital Skills, and all 26 sessions have a detailed lesson plan.** The timetable is unchanged: 4 weeks, 8 sessions, 2 a week, 110, 115 and then 120 minutes. Every lesson plan is a **draft** until programme management approves it. Nothing has been deployed, and the live Supabase project has not been touched.

## 1. Timetable check (before = the seed and database before V13)

| Week | Session | Before (min) | After (min) | Segments add up to |
|---|---|---|---|---|
| 1 | 1 – core | 110 | 110 | 110 |
| 1 | 2 – core | 115 | 115 | 115 |
| 2 | 3 – each track | 120 | 120 | 120 (all four tracks) |
| 2 | 4 – each track | 120 | 120 | 120 |
| 3 | 5 – each track | 120 | 120 | 120 |
| 3 | 6 – each track | 120 | 120 | 120 |
| 4 | 7 – each track | 120 | 120 | 120 |
| 4 | 8 – each track | 120 | 120 | 120 |

There are no breaks, because the approved timetable has none. Session dates, times, venues and trainers live in `session_schedules`; V13 does not touch that table. The database now refuses any lesson plan whose segments do not add up to the session duration. It also refuses a later duration change that would break this.

## 2. Tracks

| Position | Before | After | Internal code |
|---|---|---|---|
| 1 | Digital Skills | **Digital Marketing** | `digital` (kept, so enrolments, applications and schedules still point at it) |
| 2 | AI Tools | AI Tools | `ai` |
| 3 | Content Creation | Content Creation | `content` |
| 4 | Entrepreneurship & Business | Entrepreneurship & Business | `entrepreneurship` |

The track focus texts were rewritten for V13. The old name has been removed from:
- the seed;
- the session records;
- the track-selection screen, learner dashboards and admin and report screens (all of these read the name from the database);
- the test fixtures.

It remains only in historical notes, such as the decisions log, and in the pre-V13 seed fixture used by the upgrade test.

## 3. Session map (old title → V13 title)

| Track | Session | Before | V13 |
|---|---|---|---|
| Core | 1 | Self-leadership, confidence and wellbeing | same title, full lesson plan |
| Core | 2 | Digital foundations, AI awareness and communication | same title, full lesson plan |
| Digital Marketing | 3 | Digital productivity and file management | Digital marketing foundations, online presence and reputation |
| Digital Marketing | 4 | Documents, spreadsheets and presentations | Target audiences, social media marketing and WhatsApp Business |
| Digital Marketing | 5 | Online presence and introduction to digital marketing | Branding, content planning and marketing graphics |
| Digital Marketing | 6 | Marketing graphics, copywriting and WhatsApp Business | Copywriting, customer engagement and search engine optimisation |
| Digital Marketing | 7 | Digital project build: advertising, search and measuring results | Online advertising, campaign budgeting, analytics and campaign build |
| Digital Marketing | 8 | Digital skills showcase | Digital marketing campaign showcase |
| AI Tools | 3 | AI tools: what they can and cannot do | Understanding AI, AI tools and responsible use |
| AI Tools | 4 | AI tools and responsible prompting | Prompt engineering, AI for research and learning, and fact-checking |
| AI Tools | 5 | AI for content and images | AI-assisted writing, images, creative work and presentations |
| AI Tools | 6 | AI for everyday tasks and simple automation | AI for productivity, business and automation, with privacy, bias and limits |
| AI Tools | 7–8 | AI project build and testing; AI tools showcase | same titles, full lesson plans |
| Content Creation | 3 | Content ideas and storytelling | Content strategy, storytelling and platform formats |
| Content Creation | 4 | Photography and mobile video basics | Smartphone photography, lighting, composition and mobile video |
| Content Creation | 5 | Editing photos and video | Video editing, audio and sound, captions and creative writing |
| Content Creation | 6 | Design for content | Graphic design, visual storytelling, branding and responsible content |
| Content Creation | 7 | Portfolio project build | Portfolio development and creative project build |
| Content Creation | 8 | Content showcase | same title, full lesson plan |
| Entrepreneurship & Business | 3–8 | Opportunity spotting · **Value proposition and business model (approved)** · Basic venture finance · Marketing and customer experience · Test and pitch · Business pitch showcase | same titles, full lesson plans |

The old Digital Skills sessions 3 and 4 (files, documents, spreadsheets and presentations) were general office skills, not marketing. They are no longer part of a specialist track. The useful parts are covered elsewhere:
- digital foundations in core session 2;
- presentations in AI Tools session 5;
- spreadsheet trackers and budgets in Digital Marketing session 7, AI Tools session 6 and Entrepreneurship & Business session 5.

All the digital marketing lessons that the old track had (online presence, channels, social media, graphics, copywriting, WhatsApp Business, advertising, SEO, analytics, strategy) were kept, expanded and reordered into the new track.

## 4. What every lesson plan contains

The 16 parts you asked for are, in order:
1. title
2. purpose
3. objectives
4. topics
5. subtopics
6. step-by-step teaching content for every segment
7. demonstrations
8. guided exercises
9. individual activities
10. group activities
11. Kenyan examples
12. tools and resources
13. assessment questions, with marking guidance
14. expected outputs
15. facilitator instructions (before, during and after the session, plus inclusion and safeguarding)
16. homework

Each track session also has a note on how it differs from the other tracks. Altogether this is 26 sessions and about 42,800 words. An automated check confirms:
- every required subject in the brief is taught;
- every session has at least 3 Kenyan references (places, KES, M-Pesa, local businesses and organisations);
- no long sentence is repeated between sessions.

**Final projects:**
- **Digital Marketing:** a basic campaign for a real brief, presented in session 8.
- **AI Tools:** an AI-assisted solution or demonstration, with a verification note.
- **Content Creation:** a creative project and a portfolio.
- **Entrepreneurship & Business:** a business concept and pitch.

**Shared topics, and how they differ between tracks:**
- Branding is a brand mini-kit for a campaign in Digital Marketing. In Content Creation it is visual consistency across content. In Entrepreneurship & Business it is a small-business brand decision.
- Pitching is campaign results in Digital Marketing, an investor-style business pitch in Entrepreneurship & Business, and a self-pitch in every track's session 8.
- The digital marketing topics already approved for Entrepreneurship & Business session 4 are taught there only at business-model level (which channels, what message, how to measure). The Digital Marketing track teaches them in depth.

**Personal branding and professional confidence** were added inside existing sessions, with no new session:
- core session 1: strengths map and personal brand statement; confidence at work practice;
- core session 2: professional online presence and self-pitch;
- every track's session 8: a 15-minute "Pitching yourself and workplace readiness" segment.

## 5. Changes in DIRA LEARN

- **Migration `20260101000030_curriculum_v13.sql`**, with rollback `supabase/rollback/20260101000030_curriculum_v13_down.sql`.
- **`curriculum_lesson_plans`** is the part learners see:
  - learning purpose, objectives, topics and subtopics;
  - the timed session plan;
  - activities, examples, tools, assessment questions, expected outputs and homework;
  - the track project.
  
  Every signed-in user can read it, as with `curriculum_sessions`.
- **`curriculum_teaching_notes`** holds the step-by-step teaching content, demonstrations, marking guidance and facilitator instructions. Only these people can read it:
  - Super Administrator, Founder, Co-Founder;
  - Programme Director, Programme Coordinator;
  - trainers and facilitators.
  
  Learners, applicants, mentors and M&E officers cannot.
- **Who edits and who approves:**
  - Editing is open to the same people who edit curriculum sessions today (executives and the coordinator).
  - Approving is open to the same people who approve sessions today (Super Administrator, Founder, Co-Founder, Programme Director). The director approves through a database function.
  - Any edit to an approved plan, or to its teaching notes, sends it back to draft.
  - Approval fields cannot be forged, and every change is written to the audit log.
- **Screens:**
  - **Curriculum page:** each session has "Show detailed lesson plan".
  - **Session page:** the full lesson plan appears under the session plan. Facilitators and staff get a "Show facilitator notes" switch, which adds the teaching steps for each segment, the demonstrations, marking guidance and facilitator instructions.
  - **Manage curriculum:** each session shows its lesson plan status, and approvers get "Approve lesson plan" and "Withdraw lesson plan approval".
  - **Editing a session's minutes:** the admin page explains that a session with a lesson plan cannot change duration.
- **How the content is applied:** `load_curriculum_v13()` runs inside the migration on an existing database, and at the end of `seed.sql` on a fresh one.
  - It never changes a duration and never approves anything.
  - It never edits an approved session record, or a session or track text edited since the seed.
  - It never replaces an existing lesson plan.
  - It reports an outcome for every track and session.

### What was preserved

- **Entrepreneurship & Business session 4**, Value proposition and business model, approved on 8 Nov 2026: the session record is unchanged byte for byte. Its approved content (the value proposition statement, the business model canvas, and the approved digital marketing topics at business-model level) is kept and expanded in its new draft lesson plan.
- **Unchanged:**
  - every session's `topics` list and the whole Curriculum Approval Centre (24 pending proposals and their history);
  - schedules, enrolments, attendance, assignments, grading, results and learner performance;
  - safeguarding, DIRA Connect, permissions and every existing RLS policy.

## 6. Testing (all local; Windows, a browser and the real Supabase were not used)

| Check | Result |
|---|---|
| Database tests (pgTAP), including 54 new V13 tests | 751 passed, 0 failed |
| The V13 tests catch three deliberate faults: learners able to read notes, no timing check, the coordinator able to approve | all caught |
| Upgrade of an existing pre-V13 database with real activity, then rollback | 25/25 checks |
| Schema after rollback equals schema before migration 30; re-apply after rollback | identical; OK |
| End-to-end workflows as the local test accounts, including 6 new curriculum steps | 36/36 |
| Content check: required subjects, Kenyan context, 16 parts, repetition, segment totals | 0 problems |
| Generated files (migration, seed, docs) in sync with the source | 0 out of date |
| Unit tests: 7 new lesson-plan tests, plus all earlier ones | 325 cases passed; `site.test.ts` cannot run here (as before) |
| Type check (stub definitions), frontend contract, syntax parse, Windows launcher checks | 0 new errors; 0 problems |

The upgrade test starts from the pre-V13 seed plus test accounts. It adds a scheduled Digital session, an approved topic, a session title edited by the coordinator and an edited track focus. It then confirms all of the following:
- the track is renamed with the same id;
- the edited texts are kept and reported;
- no duration, week, schedule, enrolment, application or proposal changed;
- the approved record is unchanged and nothing was approved;
- a second run changes nothing;
- the rollback restores every track and session record exactly.

## 7. Decisions and open items

1. **Approve the 26 lesson plans** (Manage curriculum). Until then, learners and facilitators see them marked as drafts.
2. **Curriculum Approval Centre:** the 11 pending Digital topics were proposed against the old session numbers. For example, "Digital footprint and online safety" is on session 5, while V13 teaches it in session 3. The approvers should decide them as usual. V13 does not move or decide proposals.
3. **Teaching notes for mentors and M&E officers:** they are currently excluded. Say if M&E should read the notes for delivery-quality checks.
4. **Editing lesson plans:** the screens show and approve lesson plans but do not yet have an editor. Changes are made in `curriculum/v13/*.yaml` and rebuilt with `tools/curriculum/build_v13.py`. They reach an existing database only through a new migration, which is reviewed first.
5. **Live Supabase:** migration 30 has not been applied. Before applying, run `supabase/checks/live_migration_check.sql` (read-only) and confirm migrations 1–29 are applied. Apply only with your approval.
6. **Not verified:** the screens in a real browser, `npm run build`, real React rendering and the real Supabase CLI.

## 8. Files

- `curriculum/v13/*.yaml` – the curriculum source (edit here)
- `docs/curriculum/` – the full curriculum, lesson plans, time allocations, facilitator guides and assessment, generated from the source
- `supabase/migrations/20260101000030_curriculum_v13.sql`, `supabase/rollback/20260101000030_curriculum_v13_down.sql`, `supabase/seed.sql`
- `supabase/tests/curriculum_v13.test.sql`, `tools/curriculum/` (build, content check, upgrade check, migration template, pre-V13 seed fixture)
- `src/features/curriculum/lessonPlan.ts` (+ tests), `LessonPlanView.tsx`, `CurriculumPage.tsx`, `CurriculumAdminPage.tsx`, `src/features/sessions/SessionDetailPage.tsx`
