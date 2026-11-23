# Assumptions and decisions

## Source
Only the curriculum docx was supplied. The "DIRA LEARN Management Presentation" referenced in the master instruction was **not** provided.

## Items needing management approval (stored with is_approved = false)
- Assessment weights 20/30/40/10 (docx marks them as recommendations, not policy)
- Attendance threshold (6 of 8 including both core sessions), make-up rules, certificate eligibility, pass marks (none invented)
- Track-selection rule: shared core sessions must be completed first (`track_selection_requires_core_complete`)
- Curriculum itself: `programmes.is_approved = false`
- SUPERSEDED on 8 Nov 2026 (see "Curriculum aligned to the websites" below): the old five tracks and their proposed topics were replaced.

## Decisions
- Single role per user (simpler RLS); can be extended to a user_roles table if multi-role is needed.
- Safeguarding access: super admin only until a designated safeguarding role is named by DIRA Foundation.
- Session length capped at 120 minutes by constraint; schedules enforce <= 2 hours.
- Meeting links are optional free text; never generated.
- Known gaps: storage bucket policies, email/SMS provider, notification triggers, report views/RPCs not written yet.

## Module 2 (application review and cohort scheduling) - needs approval
- **Application status workflow is my proposal**: submitted -> under review -> shortlisted / waitlisted / accepted / rejected; rejected can be reopened to under review; accepted is final. Rejecting or reopening requires a written note. Selection criteria and scoring were not specified, so there is no automatic scoring.
- Converting an accepted application to a participant is limited to super admin and programme coordinator (as the Edge Function already did). Programme directors cannot convert. Confirm whether that is intended.
- A participant can be in one non-archived cohort at a time.
- Within a cohort, sessions for different tracks may run in parallel (with different trainers); core sessions cannot overlap anything. A trainer cannot be in two sessions at once, and must be assigned to the cohort (and the track, if the assignment is track-specific) before being put on a session.
- Session dates must fall inside the cohort dates, judged in the programme time zone. Setting `programme_timezone` is seeded as **Africa/Nairobi, unapproved** - please confirm.
- Fixed existing bug: the application form inserts status `submitted` but the insert policy only allowed `draft`; migration 4 allows both.
- Direct status updates on applications are blocked at database level; only the review function, the service role, and an applicant submitting their own draft can change status.
- Not built yet: waitlist auto-promotion, email/SMS notification to applicants on decision (only the in-app notification at conversion exists), bulk actions, rescheduling UI, un-enrolling a participant.

## Module 3 (trainer session flow and curriculum admin) - needs approval
- **Completing a session** requires: it has started, attendance is recorded for everyone expected (whole cohort for core sessions; only participants who chose that track for track sessions). Trainers and staff can complete; completion is what unlocks track selection, so this rule matters. Confirm that "attendance for everyone" is the right bar.
- Late counts as attended and excused is excluded from the rate: still the DRAFT attendance rules, unchanged.
- **Curriculum approval**: only super admin and programme director can approve; coordinators and super admins edit content. Editing approved content automatically sends it back to draft. This is my proposal; the SRS excerpt I have does not define content governance.
- Once a session has been scheduled for any cohort, its week, number and track are locked (title and content can still change).
- Proposed extra topics (from the master instruction) stay flagged as awaiting approval to trainers; they are not removed or auto-approved.
- Delivery reports are visible to staff, the trainer of that cohort, and the M&E officer. The page warns trainers not to put personal or safeguarding details in them; there is no automatic check.
- Resource uploads go to the existing `learning-resources` bucket (50 MB limit, any type). A type allow-list is not set; confirm whether one is wanted.
- Not built: deleting or retiring curriculum sessions, assignments and grading tied to sessions, participant-facing resource view (participants can already read resources by RLS but there is no page yet), session reschedule.

## Module 4 (assignments, submissions and grading) - needs approval
- **Late work is accepted and flagged**, not blocked. No hard cut-off has been approved. The database sets late/on-time from the due date; the browser cannot choose it.
- **Resubmission** is off by default. When a trainer turns it on for an assignment, a participant can submit again only after the trainer has returned the work for revision (with written feedback). Graded work is final for the participant. Trainers and staff can still correct a grade.
- **Marks are optional per assignment.** An assignment has an optional maximum score. Without one it is feedback only and no score can be stored. Scores must be between 0 and the maximum. No pass mark exists, so none is applied.
- Attempt number, status and grading fields on a new submission are set by the database and cannot be spoofed. Submitted text and files cannot be edited by anyone afterwards.
- Only the latest attempt can be graded. Cohort, track and maximum score are locked once any submission exists, and an assignment with submissions cannot be deleted.
- Trainers can read and grade submissions only for participants in their cohorts, and can no longer insert or delete submissions (the earlier policy allowed both). Staff can read and grade.
- Submission files go to the existing private `submissions` bucket (10 MB, PDF/Word/PowerPoint/Excel/JPG/PNG). Existing storage policy lets any trainer or staff member read files in that bucket, not only their own cohort's. Tightening this needs a path convention that includes the cohort; flagged for a decision.
- Grades are not yet rolled into the weighted overall result: the weights in `scoring.ts` are still the unapproved draft (20/30/40/10).
- Not built: editing or deleting an assignment in the UI, linking an assignment to a curriculum session, notifications when work is graded or returned, CSV export of grades, plagiarism or AI-use checks.

## Participant resources page - needs approval
- **Resources are trainers-only until shared.** The earlier policy let every participant read every resource, including trainer prep material. Migration 7 adds `visible_to_participants` (default off). Trainers tick "Share with participants" when adding, or toggle it on the session page. Anything already uploaded before this migration becomes trainers-only until shared.
- Participants see shared resources for the core sessions and for the track they chose. They do not see other tracks. Applicants no longer see any resources (the old policy allowed core resources to applicants).
- **Withdrawn participants lose access** to resources. Completed, graduated and alumni keep it. Confirm whether alumni should keep access to course material.
- Files follow the same rule as rows: a stored file can be read only if the reader can read its resource row. Trainers, staff and M&E can read all.
- Links open only if they are plain http or https. The database now rejects other schemes (the check is NOT VALID, so it covers new and changed rows; the page also refuses unsafe links already stored).
- Resources are not restricted by cohort: core material is the same for every cohort. A resource that should be cohort-specific cannot be expressed yet.
- Not built: tracking which resources a participant opened, resource ordering within a session, editing or deleting a resource (only add and share/unshare exist), a trainer or staff preview of the participant view.

## Module 5 (results and completion) - needs approval
- **Everything here is provisional.** It uses the draft weights (attendance 20, session tasks 30, final project 40, reflection 10) and the draft completion rules (6 of 8 sessions including both core, final project and reflection submitted). The page says so. No pass mark is applied.
- **Each assignment now says what it counts towards** (session task, final project or reflection; default session task). Only assignments with a maximum score feed the result. The component locks once work is submitted so results cannot change silently. Existing assignments become session tasks: a trainer must create or re-tag the final project and reflection assignments.
- **Missing is not zero.** A component with nothing graded shows "–" and there is no overall until all four have a figure. If some scored work is still ungraded, the overall is shown with an asterisk (may change). Work that is never submitted is NOT counted as 0; decide whether it should be.
- Within a component, graded assignments are averaged equally as percentages (a 10-mark and a 50-mark task weigh the same). Confirm or choose mark-weighted.
- Attendance uses the existing draft rules (late counts, excused excluded from the rate). For completion, "attended" means present or late; **excused does not count** and no make-up activity is modelled yet.
- The core goal card from Session 1 is not checked: nothing identifies it as an assignment.
- The results page computes in the browser from data each role can already read (row-level security applies), so a participant sees only their own row. Nothing is stored, so there is no frozen record at the end of a cohort.
- Not built: storing final results, management approval of weights and rules in the UI (the `system_settings` and `graduation_rules` rows are not read yet; the values are in code), CSV export, certificate eligibility and issuing.

## Remaining modules (migration 9) - all need approval
Everything below is my proposal unless stated. Nothing has been run.

**Profile guards (bug fix).** The old guard blocked the service role (auth.uid() is null there), so `convert-application` could not have set a participant's role. A "trusted session" (service role, or a direct database connection with no JWT such as the SQL editor and tests) now passes the guards; API requests never do. Also new: nobody can change their own role or status, the last active super administrator cannot be demoted or deactivated, `participant` can only exist through an application conversion, and a participant cannot be given another role (mark them withdrawn instead).

**Mentorship.** One mentor per participant. Only active accounts with the mentor role can be assigned. A mentor logs sessions (date not in the future, summary, action points, feedback). Sessions are private to the mentor (and readable by staff through the database) unless the mentor ticks "share with mentee". The staff screen shows only the last session date, but that is a screen choice: staff can read the notes through the database. Confirm whether staff should be able to read mentor notes at all. Not built: mentor goals, attendance of mentoring sessions, mentor reports.

**M&E.** No indicators or targets are pre-filled; the M&E officer (or staff) enters them. Records have a quality flag (measured, estimated, missing); missing stores no value and is never shown as zero. Live figures (enrolment, attendance rate, track choices, applications) are computed from existing views under the viewer's own access, so the M&E officer sees 0 applications because the role cannot read them (the page shows a dash instead). CSV export neutralises spreadsheet formulas. Not built: disaggregation (gender, age, disability) because those fields are not collected, charts, PDF reports.

**Graduation and certificates.** A certificate can be issued only by a super administrator or programme director, only while the programme's graduation rules are **approved** by a super administrator, and only if the database re-check passes (minimum sessions, all core sessions, final project submitted, reflection submitted, as set in the rule). Editing an approved rule sends it back to draft. A pass mark on overall results is refused until assessment weights are approved. Certificates cannot be inserted, edited or deleted directly: only `issue_certificate` and `revoke_certificate` (revoking needs a written reason). Issuing marks the participant as graduated and notifies them. The earlier `issue-certificate` Edge Function was removed because it was a second, weaker path. The certificate is a printable page (browser print or save as PDF), not a server-generated PDF. Certificate numbers are sequential, so the public verify page (`/verify`, no sign-in) lets anyone confirm a number is real; it shows only first name, surname initial and issue date. Confirm that is acceptable, and the certificate wording and design.
- The SQL completion count mirrors the results page but excludes cancelled sessions from the core total, and `system_settings.attendance_threshold` is not read by anything: `graduation_rules` is the single source for certificates.

**Alumni.** Staff move a graduate to the alumni list (button on Certificates). Alumni then keep their own employment, education, enterprise and achievements notes. Staff and the M&E officer can read them. Nothing is collected beyond those four free-text fields.

**Notifications and announcements.** In-app only; email and SMS are not set up. An announcement goes to everyone in a cohort (participants not withdrawn, plus the cohort's trainers) or, if no cohort is chosen, to all active participants, trainers, mentors and M&E officers. Announcements can be posted by staff but not edited or deleted. Notifications are created by the database when work is graded or returned, a certificate is issued or withdrawn, and an application is shortlisted, waitlisted or rejected (neutral wording; acceptance is announced by the conversion function). People can only change the read time of their own notifications.

**Projects and portfolio.** Participants create projects with milestones and upload evidence (PDF, JPG, PNG, MP4, 10 MB). The database stops participants writing feedback or status beyond "in progress / submit"; once submitted a project is locked until a trainer returns it; evidence can be added only while it is open. Trainers and staff give feedback and mark returned or reviewed. Existing storage policy still lets any trainer read any evidence file (same open point as submissions). Mentors cannot see projects. **Competency frameworks are not built**: no competency list was supplied and I will not invent one. The `portfolios` table is unused; the portfolio is the participant's list of projects.

**Settings.** Super administrators can edit and approve stored settings; approval records who and when, and editing an approved setting returns it to draft. Most settings are not yet read by any screen (the code still uses the draft weights).

**Safeguarding.** Super administrator only, as before. Records can be added and their status changed (open, under review, closed) but never deleted, and they are deliberately not copied into the audit log. Access to read a record is not logged. A designated safeguarding role is still needed.

**User management.** Super administrators can change roles and statuses, and invite staff by email through a new `invite-user` Edge Function (written, not deployed or tested). Account emails come from a super-administrator-only function.

**Audit log.** Viewer for super administrators with table filter and paging; rows cannot be updated or deleted by any API role. Audit triggers were added for mentorship pairs, M&E, graduation rules, announcements and projects.

## Login redesign
Only `LoginPage.tsx` was restyled; the sign-in call, session redirect and error text still come from `useAuth()` unchanged. New file: `LoginPage.test.tsx`. The drawn compass was later removed at the owner's request and replaced by four floating cards (Direction, Purpose, Discovery, Personal growth) whose wording is draft copy. `tailwind.config.ts` gained a `dira` colour set (#241034, #452064, #61358A, #E9DDF3, #D6B66F) and two animations (float, rise-in), used only by the login page. The existing fonts (Bricolage Grotesque, Figtree) were kept instead of adding Inter or Poppins.
- **Forgot password:** no password-reset flow exists anywhere in the project, so there was nothing to preserve. The link opens a note telling people to contact the programme team. A real reset needs a "set new password" page and Supabase redirect settings, which is new authentication work you asked me not to do without approval.
- **Remember me:** left out. Supabase already keeps the session in the browser; there is no existing option to wire it to.
- Not run: no browser or packages were available, so layouts on desktop, tablet and phone and the real sign-in were not checked.

## Email, calendar and analytics (migration 10) - all need approval
Decisions made because the owner said "just start anywhere": **Resend** as the email provider; meeting links are **pasted by hand** (no Zoom, Meet or Teams API); no new "course" layer (see below). All of it is untested.

**Email.** Templates (plain text with `{{placeholders}}`, wrapped in a DIRA-branded layout when sent), an outbox that only the management roles can read (it holds addresses and message text), bulk sends to a cohort, all participants or all staff with optional scheduling, automatic reminders and email copies of in-app notifications. Draft wording is seeded for four templates; management must review it. Automation is off until approved. Not built: multi-step "sequences" (reminders and event emails cover the common cases), attachments, open and click tracking, a self-service opt-out screen, an unsubscribe link. Sign-up and password-reset emails belong to Supabase Auth (see docs/EMAIL_SETUP.md). Reminder timing (24 h for sessions, 48 h for assignments) is my proposal.

**Calendar.** Day, week and month views of the sessions, assignment deadlines and cohort start and end dates each role can already see. Join link only for online or hybrid sessions with a pasted link that are not cancelled or over. `.ics` download for Google Calendar or Outlook. No automatic two-way calendar sync and no automatic meeting creation: those need provider apps and credentials.

**Analytics.** Figures come from live records with period (7 days, 30 days, 12 months), programme and cohort filters, bar and line charts, CSV export and print-to-PDF. "No data" is shown instead of zero when there is nothing to calculate. Attendance rate follows the same draft rule as the existing views (present and late count, excused is left out). Excel is served as CSV (opens in Excel); a native .xlsx export and a server-generated PDF were not built. The M&E role cannot read applications, so those two cards say "Not visible" for it. Not built: trainer performance (no agreed measure), pre/post assessments and learning outcomes (no data collected).

**Deliberately not started.** The brief's courses, modules, quizzes, discussion forums, competency tracking, document management, help centre, global search, bulk participant import, dark mode and Zoom/Meet/Teams APIs. The approved design is a fixed four-week programme of tracks and curriculum sessions; "courses and modules" would be a new learning model that changes it, and quizzes and competencies need approved content that does not exist. They need your decision before I build them.

## Courses (migration 11) - owner decided: courses are a new layer on top of tracks and curriculum
Everything below is my proposal for the details; nothing has been run.

**Model.** A course belongs to a programme and can optionally be limited to one track and/or one cohort. It has modules, which have lessons. It does not change the curriculum, sessions, attendance, results or certificate rules. Formats: online, physical classroom, hybrid, self-paced. Lessons are a reading (text), a PDF, a presentation, a video (MP4 upload or a link) or a web link. Files go in a new private bucket `course-materials` (50 MB, PDF, PowerPoint, MP4, JPG, PNG) under a folder named after the course id.

**Who can do what.** Programme management creates, edits, publishes, archives, assigns trainers and enrols participants. A trainer can create a course (always a draft, and they are assigned to it automatically) and edit the content of courses they are assigned to, but **cannot publish or archive**, change the programme, track or cohort, assign trainers or enrol participants. That publishing rule is mine: say if trainers should be allowed to publish. Participants see a course only while it is published and they are enrolled, and can tick lessons as done. The M&E officer can read courses and progress. Mentors have no access.

**Rules enforced by the database.** Every course starts as a draft; a course needs at least one lesson before it can be published; the track and cohort must belong to the course's programme; an archived course takes no enrolments; withdrawn participants cannot be enrolled; for a cohort-limited course the participant must be in that cohort, and for a track-limited course they must have chosen that track. Enrolling a participant creates an in-app notification (and an email copy once automation is approved). Progress is the share of lessons ticked done (view `v_course_progress`). There is no course completion certificate: certificates stay tied to the programme rules.

**Not built yet (still pending your go-ahead on content):** quizzes and automatic grading, course assignments (existing assignments stay cohort-based), discussion forums, course reports in Analytics, self-enrolment, per-course attendance, a course calendar. Trainers see names only for participants in their own cohorts, so other enrolled participants may show as "Unnamed" to them.

## Learner sign-up and bulk import (migration 12) - needs approval
Details in docs/LEARNER_ONBOARDING.md. Decisions that are mine: the password rule (10+ characters with letters and numbers); the wording of the agreement checkbox ("DIRA Foundation may store and use my details to process my application and run the programme": please have it checked against your privacy notice, and add a link to the notice if you have one); imported learners are invited as **applicants** and still go through review (the import does not skip review; say if vetted learners should be allowed to skip it, which would need a change to how participants are created); a limit of 200 rows per file; the sign-up page shows the same message whether or not an address is already registered. The sign-up page has no CAPTCHA, so turn on Supabase's attack protection before publicising it. The import log stores names and emails, readable only by programme management; decide how long to keep it.

## Website alignment (read from dirafoundationken.netlify.app on 8 Nov 2026)
Taken from the public site: tagline "Your voice. Your direction.", theme colour #1E0B3D (now the app's deep purple, replacing #241034), the four values with their North, East, South, West tags (now the login page cards, replacing my draft wording), the six photos (now a pausable cross-fading banner on every dashboard, loaded from the website), the Privacy and Terms links (sign-up agreement), the contact phones and email (the "Forgot password?" note), and a link back to the website. The sidebar now shows the white DIRA logo on the deep purple. **Not exact:** I could read only the page text, not the website's stylesheet, so its fonts, spacing and any other colours were not copied. Send the CSS (or the font names and hex values) for an exact match. The ages-18-and-up rule on the website is not enforced anywhere in the app; say if the application form should check it. The photos show real people and a community; they are used because they are on the foundation's own site, but confirm the foundation holds the rights and consents for use in the app. The dashboard's old placeholder for roles without widgets is replaced by quick-link cards for every role. The Netlify setup is in docs/NETLIFY_DEPLOYMENT.md.


## Curriculum aligned to the websites (8 Nov 2026), updated: four tracks
**Sources read:** the public site (dirafoundationken.netlify.app) and the team hub (dirafoundationhub.netlify.app). Their sub-pages (programmes, FAQ, join) could not be opened, so only the two home pages were used.
**What both sites say:** Cohort 1 is 8 live sessions over 4 weeks, free and online, with a portfolio project at the end. The sites name Content Creation, Digital Marketing and AI Tools.
**Owner decision:** Digital Skills, AI Tools and Content Creation are each their own track. Digital Marketing is kept as a fourth track because both sites list it (assumption: confirm).
**What changed:** `seed.sql` now has 4 tracks (codes `digital`, `ai`, `content`, `marketing`) instead of the old 5 (digital, entrepreneurship, employability, creative, leadership). The two shared core sessions (week 1) are unchanged. Each track has 6 sessions (numbers 3 to 8; session 7 builds the portfolio project, session 8 is the showcase). All of it is a draft (`is_approved = false`, `source = 'website_alignment'`) and needs trainer and director approval. Digital Skills reuses the earlier Digital Skills & AI productivity, online presence and workflow sessions; AI Tools reuses its prompting and AI sessions; the marketing topic list is the one already proposed from the master instruction; Content Creation is new.
**Open conflicts:** (1) The public site lists three areas and the LMS now has four, so update the website or merge tracks. (2) The public site says each trainee picks one track; the hub's 18 Oct notes say "up to two". The database allows one track per enrolment.
**Existing databases:** this is a seed change only. A database already seeded with the old tracks needs `supabase db reset`; do not run it on live data without moving enrolments first.

**Approved content (owner, 8 Nov 2026):** "Value proposition and business model" (Entrepreneurship & Business, session 4) and its topics (including the digital marketing topic list) are approved. It is seeded with `is_approved = true`. To keep it, the Entrepreneurship & Business track is restored as a fifth track (position 5) with its six original curriculum-docx sessions; the other five of those are still drafts. Digital Marketing (track 4) repeats the same marketing topics in its own sessions. Assumption: confirm whether to keep the whole Entrepreneurship track or only this session (a session needs a track to belong to).

**Digital marketing merged into Digital Skills (owner, 8 Nov 2026):** there is no separate Digital Marketing track. The Digital Skills track (sessions 3 to 8) now carries the digital marketing topics: session 5 (online presence, intro to digital marketing, social media, content planning), session 6 (graphics, copywriting, WhatsApp Business), session 7 (advertising, SEO, analytics, strategy; the portfolio project). The old workflow/tracker session was folded into session 4 as activities. The programme stays at 8 sessions over 4 weeks (the database allows at most 8 per track), so marketing replaced material rather than adding sessions. Tracks are now: Digital Skills (1), AI Tools (2), Content Creation (3), Entrepreneurship & Business (4). The public website lists Digital Marketing as its own area; align the wording there.

**Approved by DIRA (owner, 8 Nov 2026): Digital Marketing Sessions 5, 6 and 7, their topics and practical outputs.** The owner's written approval: "I approve Sessions 5, 6 and 7 as proposed for the DIRA LEARN four-week curriculum. The topics and practical outputs are approved for implementation." It was given in the owner's own planning conversation, outside this repository, and was reported here by the owner on 21 Nov 2026. The sessions approved are the three records in the paragraph above, preserved in `curriculum/v13/previous_seed.json`:

| Session | Approved title | Approved topics | Approved practical output |
|---|---|---|---|
| 5 (week 3) | Online presence and introduction to digital marketing | Digital footprint and online safety; Introduction to digital marketing; Social media marketing (Facebook, Instagram, TikTok, LinkedIn); Content planning and creation | Improved online profile and a two-week content calendar |
| 6 (week 3) | Marketing graphics, copywriting and WhatsApp Business | Canva for marketing graphics; Marketing copywriting, captions and calls to action; WhatsApp Business | Three posts with captions and a WhatsApp Business profile plan |
| 7 (week 4) | Digital project build: advertising, search and measuring results | Digital advertising fundamentals; SEO fundamentals; Marketing analytics and measuring campaign performance; Developing a practical digital marketing strategy | Digital marketing portfolio project and three-minute walk-through |

Scope: this approval covers the **topics and practical outputs** of these three Digital Marketing sessions. It does not approve the detailed V13.2 lesson plans written later (19 Nov 2026), which stay Draft until approved in the app (briefs of 19–20 Nov 2026). It does not approve any session of AI Tools, Content Creation or Entrepreneurship & Business, or Digital Marketing Sessions 3, 4 and 8. Until 21 Nov 2026 this approval was missing from the repository. The Curriculum Approval Centre therefore queued these 11 topics as pending, and V13 rewrote the three session records as drafts. **Represented since 21 Nov 2026 (owner's decisions):** migration 37 places the 11 topic proposals on the V13.2 sessions that teach them (3–7), with titles unchanged and the approval written into each description. All 11 stay pending until formally approved in the Curriculum Approval Centre. Digital Marketing records 3–8 stay draft, each with a note on the approved topics and outputs it carries. The 26 lesson plans stay Draft. The 10 Entrepreneurship Session 4 proposals stay pending. Details: `docs/curriculum/DIGITAL_MARKETING_DIRA_APPROVAL_2026-11-08.md` and `docs/deployment/PRODUCTION_DB_INITIALIZATION.md`, section 4a.

**Owner decision (21 Nov 2026): interim safeguarding access for Super Administrators.** In the owner's words: "Super Admins can read safeguarding records until a Safeguarding Lead or Deputy is appointed." This changes the rule of the 19 Nov 2026 management decision, under which nobody could read records before an appointment. Implemented in migration 39 for active Super Administrators only; Founder and Co-Founder are not included. It ends automatically when a Lead or Deputy is appointed. Details: `docs/SAFEGUARDING.md`.

## First Super Administrator created by a protected server-side setup (21 Nov 2026 rebuild; replaces the 8 Nov 2026 design below)
**Decision (owner brief of 21 Nov 2026):** the first Super Administrator is created automatically for **marksmedia.studios@gmail.com** through the Supabase Auth Admin API, by the Edge Function `bootstrap-first-admin`, which `/setup` calls before anyone can sign in. The operator enters the one-time `SETUP_CODE` and chooses the password; the address always comes from the `FIRST_ADMIN_EMAIL` secret (the caller cannot choose it). The account is created with its email confirmed (or, if that address already signed up as an applicant, its password is set), then the database function `claim_first_admin()` (service role only) makes it Super Administrator.
**Safety:** refuses when `SETUP_CODE` (< 20 characters) or `FIRST_ADMIN_EMAIL` is missing, once an active Super Administrator exists, on a wrong code (constant-time comparison, 1 s delay), for a password under 12 characters or without letters and digits, and when the existing account already has another role. JWT verification is off for this one function (it is used signed out); its own checks replace it. Remove `SETUP_CODE` afterwards. The function never logs, stores or returns the password.
**Retired:** the Edge Function `claim-first-admin` (signed-in applicant claims with the code). The legacy SQL Editor STEP-8 remains only in the superseded package for the old project.
**Passwords:** a Change password page for every signed-in account (checks the current password first); Forgot password stays self-service by emailed code.
**Assumption:** the administrator password rule (12+ characters, letters and digits) is stricter than the sign-up rule (10+); confirm.

## First administrator is claimed in the app (8 Nov 2026) – superseded by the entry above
**Decision:** no manual SQL. A signed-in applicant opens `/setup` and enters a secret `SETUP_CODE` (a Supabase function secret). The Edge Function `claim-first-admin` checks the code (constant-time, 1 second delay on a wrong guess) and that no active super administrator exists, then calls `claim_first_admin()`, which promotes the account under an advisory lock so two simultaneous claims cannot both win.
**Why a code:** the public sign-up page lets anyone create an account, so "the first person to sign up becomes admin" would let a stranger win the race after deployment.
**Safety:** the function refuses if `SETUP_CODE` is unset or shorter than 20 characters. `first_admin_needed()` is callable only by signed-in users; `claim_first_admin()` only by the service role. Setup closes as soon as an active super administrator exists and reopens only if none is left (recovery path, still needs the code).
**Known limits:** no per-IP attempt limiting beyond Supabase's own limits and the delay, so use a long random code. Not deployed or tested.

## Applicant approval (8 Nov 2026), assumptions to confirm
- **Who may decide:** super administrator and programme director (not coordinators). Change `can_decide_applications()` to widen or narrow it.
- **Mapping:** Pending = submitted, under_review, shortlisted, waitlisted; Approved = accepted; Rejected = rejected. The existing status workflow was reused, not replaced.
- **Approve = convert:** approving creates the participant record in the same step (it replaces the separate "Convert" click). The `convert-application` function remains for older accepted applications.
- **Rejection reason:** optional, internal (history and audit log); not included in the email to the applicant.
- **Decision emails** ignore the marketing opt-out and the event-automation switch because they are the applicant's outcome. They still need email to be set up.
- **Rejected applicants** keep an active applicant account and can read their application; they cannot reapply for the same programme (one application per programme, existing rule).

## Curriculum Approval Centre (8 Nov 2026), assumptions to confirm
- **New roles:** `founder` and `co_founder` did not exist and were added. They are not general staff (no applications, users, settings, audit or safeguarding access); they get Dashboard, Curriculum, the Approval Centre and Notifications. Widen this if wanted.
- **Two approval layers:** topic-level approval (new: Founder, Co-Founder, Super Administrator) sits beside the existing session-level approval (super administrator and programme director). Approving a topic does not touch the session's approval flag.
- **Entrepreneurship session 4:** you approved its topics earlier; this brief says start every proposal as pending, so they are pending.
- **Proposals:** loaded from the brief's list; none invented for AI Tools. No screen yet for proposing a new topic.

## V13 curriculum revision (19 Nov 2026)
- **Owner decision:** Digital Marketing replaces Digital Skills as a full specialist track (internal code `digital` kept). This supersedes "Digital marketing merged into Digital Skills" above. Details: `CURRICULUM_V13_CHANGE_REPORT.md`.
- **Timetable kept exactly:** 110, 115 and 6 × 120 minutes; no breaks (none in the approved timetable). The database refuses lesson plans whose segments do not add up.
- **Assumption – approvers:** lesson plans are approved by the same roles that approve curriculum sessions (Super Administrator, Founder, Co-Founder, Programme Director). Confirm.
- **Assumption – teaching notes:** readable by programme staff and trainers only; not by learners, applicants, mentors or M&E officers. Confirm whether M&E should read them.
- **Approved Entrepreneurship session 4:** session record left unchanged; its detailed lesson plan is a new draft.
- **Old Digital Skills sessions 3–4 (files, documents, spreadsheets):** not marketing, so removed from the specialist track; covered in core session 2, AI Tools sessions 5–6 and Entrepreneurship & Business session 5.


## New deployment (21 Nov 2026 rebuild)
- **New Cloudflare Worker name `dira-learn-v2`** (in `wrangler.jsonc`), so a deployment of this release can never replace the old Worker. Change it only if you choose another name in the dashboard.
- **Database for new projects = `supabase/baseline`** (final state of migrations 01–39 + seed, three plain files, no text patching), installed in the browser from `supabase/install`. The 39 migrations stay the source the baseline is generated from and the record of the old project's history.
- **Empty at installation:** the audit log and the legacy staging/backup tables of migrations 29–38 (never read by the app). Accounts created in the Auth dashboard before the installation get an applicant profile.

## Direct enrolment of learners imported from CSV (owner brief, 22 Nov 2026)
- **Decision:** CSV-imported learners become active participants immediately after setting their first password; no application, no approval. Public applicants keep the application → review → conversion path unchanged.
- **CSV:** exactly `name, email, programme_track`. Tracks must match a configured track name (case and extra spaces ignored); nothing is guessed or created.
- **Name split (assumption):** profiles keep first and last name apart, so `name` is stored as first word / the rest (a single word becomes the first name, last name empty). Confirm.
- **Track storage:** new optional column `participants.programme_track_id` (pending, `supabase/pending/20261122000001_participant_programme_track.sql`, awaiting approval). No cohort is assigned; staff assign one later.
- **Open:** whether the imported track should pre-select the track when staff add the learner to a cohort (today learners choose after the core sessions). Left unchanged.
- **Existing accounts** found in an import are reported and never changed or enrolled.
