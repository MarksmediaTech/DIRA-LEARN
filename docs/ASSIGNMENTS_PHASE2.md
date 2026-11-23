# Learner assignments, Phase 2 (migration 20)

Status: written, **not run** (no Postgres, Node packages or network were available). Follow "Safe rollout" before relying on it.

## What already existed (kept, not duplicated)
Creating assignments for a cohort or a track, instructions, deadlines, text and file submissions (PDF, Word, PowerPoint, Excel, JPG, PNG, up to 10 MB), late flagging, resubmission when work is returned, grading with scores and individual feedback, trainer and staff review, results and certificate calculations, 48-hour deadline reminder emails, and notifications when work is graded or returned. Learners only ever see their own submissions, feedback and grades.

## What this adds
- **My Assignments on the learner dashboard**: counts for Overdue, Upcoming, Submitted and Graded, plus the next pieces of work due.
- **My Assignments page** now groups work under those four headings, shows each deadline, the submission date and the score once graded. Work returned for revision sits under Upcoming, because it is the learner's job again.
- **Individual assignments**: when creating an assignment, staff or the cohort's trainer can choose "Selected learners only". Only those learners see it, can submit it, are expected to submit it, and are reminded about it. Existing assignments are unaffected.
- Results, certificate eligibility and the staff progress counts no longer count an individual assignment against learners it was not given to.
- Learners see "My Assignments" in the menu; staff keep "Assignments".

## How it is enforced (not only on screen)
- New table `assignment_recipients` with row level security: staff and the cohort's trainer manage it, a learner can read only their own rows.
- A restrictive policy on `assignments` hides an individual assignment from learners who were not chosen.
- `guard_submission()` refuses a submission from a learner who was not chosen. A chosen learner who has already submitted cannot be removed. A chosen learner must be enrolled in the cohort (and on the track, if set).
- Access windows from migrations 18 and 19 still apply: a learner whose access is not Active cannot submit.
- Existing function text is rewritten in place, and the migration aborts if the expected text is not found.

## Not changed, on purpose
- **Permitted file formats** stay one programme-wide list (shown beside the upload box). Per-assignment format rules are a business decision.
- **Late work** is still accepted and flagged late; no hard cut-off has been approved.
- **Grading weights**: unchanged. Only assignments with a maximum score count, as before. Nothing was approved or invented.
- **No "new assignment" notification**: it would reveal an assignment's title to a learner whose access is not open yet. Deadline reminders and grading notifications already exist.

## Decisions needed from DIRA management
1. Should an individual assignment ever be allowed to count towards the weighted result for the chosen learners only? Today it does, for them only.
2. Should staff be able to add a learner to an assignment after it has been created? Today recipients are chosen at creation (the database already allows adding later).
3. Do you want a "new assignment" notification once access is open?
4. Do you want per-assignment file-format limits (for example "PDF only")?

## Safe rollout
1. Back up the Supabase database.
2. Local: `supabase start && supabase db reset && supabase test db`. `supabase/tests/assignment_recipients.test.sql` (16 checks) must pass, with the existing assignment tests.
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. Staging, then production after approval: `supabase db push` (applies 17 to 20). No new Edge Functions or environment variables. The next scheduled `send-emails` run picks up the new reminder rule.
5. Rollback: drop the `assignments_recipient_scope` policy, the `assignment_recipients` table and its functions and triggers, then restore `guard_submission()` and `queue_reminders()` from migrations 6 and 10. Individual assignments would then show to the whole cohort, so remove them first.

## Known limits
- The learner pages were checked only by a syntax scan and by running the grouping and recipient rules in Node.
- A learner whose access is Scheduled sees "No assignments yet" on the dashboard, with the access notice above it.
