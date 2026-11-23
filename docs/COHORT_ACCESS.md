# Cohort intakes and learning-access windows (migration 18, Phase 5)

Status: written, **not run** (no Postgres, Node packages or network were available). Follow "Safe rollout" before relying on it.

## What it does
- A cohort now has an intake name, a programme season, a recruitment period (opens/closes) and **learning-portal access times** (opens/closes). Programme start and end dates are the existing cohort dates.
- Every enrolled learner has a learning-access status per cohort: **Pending** (no opening time set, or not enrolled), **Scheduled** (before opening), **Active**, **Expired** (after closing), **Suspended**.
- This is separate from the account status (Users page: active / pending / deactivated). A learner can register in November, hold an active account, and have access scheduled for January.
- Staff can extend, shorten or remove one learner's dates, or suspend and reinstate them, always with a written reason. Every change is kept in an append-only history. Changing one learner never changes the cohort or any other learner.

## How it is enforced (not only on screen)
- `learner_access_state()` decides the status from the database clock. A caller can only ask about themselves, or as staff, or as the trainer of that learner.
- Restrictive row level security policies (`*_access_window`) let a participant read or write **learning resources, assignments, submissions, assessment results, course modules, course lessons and lesson progress**, and the **submissions and learning-resources storage files**, only while at least one of their enrolments is Active. Restrictive policies can only narrow existing access, so nothing becomes visible to anyone new, and other cohorts stay hidden.
- Staff, trainers, mentors, M&E officers, applicants and executives are never affected by access windows.
- Not covered by the window (still visible to a participant who is not Active): their own profile, notifications, certificates, the curriculum outline, the calendar and attendance, mentorship, projects, announcements. Say if any of these should also close.

## Existing data
Migration 18 back-fills existing cohorts so nobody loses access they have today: access opens at the earlier of the cohort start date and its creation time, with no closing time. **Please set closing times on current cohorts.** Cohorts created afterwards have no opening time and give no access until you set one.

## Decisions (accepted by DIRA, implemented in migration 19)
1. **One programme time zone.** `programmes.timezone`, default `Africa/Nairobi` (the existing session and assignment reminders already use it). Access times are stored as exact moments; the zone decides how they are typed, shown and written in emails. A super administrator, Founder or Co-Founder can change it on the cohort page. Existing reminder emails still write Nairobi time directly.
2. **Withdrawal closes access automatically.** A withdrawn learner shows as Suspended. Their record, profile and certificates stay.
3. **Only a super administrator, Founder, Co-Founder or programme director** can extend, shorten or suspend access, and set a cohort's access times (enforced by the database). The coordinator still creates cohorts (without access times) and can see the access roster.
4. **Reminders.** 3 days before access opens and 7 days before it closes (one email per learner per date), plus an in-app note and email when one learner's access is changed. The staff reason is never included. Emails send only when automatic email is approved (existing `email_automation` setting) and the `send-emails` function is deployed and scheduled.
5. **Results stay readable after expiry, read-only.** An expired learner can still read their own submissions (scores and feedback), assessment results, and the assignment titles and marks they belong to, plus certificates. They cannot submit. Learning resources, course content and stored files stay closed. Scheduled, pending and suspended learners get none of this.

## Safe rollout
1. Back up the Supabase database.
2. Local: `supabase start && supabase db reset && supabase test db`. `cohort_access.test.sql` (22 checks) and `access_rules_v2.test.sql` (17 checks) must pass. Seven older test files were adjusted so their cohort fixtures have an opening time; they should still pass.
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. Staging copy, then production after approval: `supabase db push` (applies 17, 18, 19), then `supabase functions deploy send-emails` (it now also calls `queue_access_reminders`). No new environment variables.
5. After deploying, open each current cohort, set its closing time, and check a participant account sees the dashboard notice only when access is not open.
6. Rollback of migration 19 first (drop the `*_access_read/_ins/_upd/_del` policies, triggers `trg_notify_access_change`, `trg_cohort_access_times`, `trg_programme_timezone`, functions `queue_access_reminders`, `notify_access_change`, `participant_access_expired`, `can_manage_learner_access`, the three `access_*` email templates and the `programmes.timezone` column; restore migration 18's function text). Then, if needed, rollback of migration 18: drop the `*_access_window` policies and `storage_access_window`, the functions `learner_access_state`, `participant_access_active`, `my_learning_access`, `set_learner_access_override`, `set_learner_suspension`, `cohort_access_roster`, `learner_access_history`, then the two new tables and the six new cohort columns. Export the access history first.

## Known limits
- No screen yet for a learner to see their full access history (staff only).
- After expiry a learner can read assignment titles and instructions, because their results are built from them.
- Reminder timing (3 and 7 days) is fixed in the function; changing it needs a new migration.
- Cohort capacity, enrolment and scheduling rules are unchanged; the enrolment screens already existed.
