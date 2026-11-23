# Applicant approval (Applications management)

Status: written, **not run** (no Postgres, Node packages or network were available when it was built). Follow "Safe rollout" before trusting it.

## What the administrator sees
Administrator dashboard > **Applications**. Tabs: **All, Pending, Approved, Rejected**, each with a count, plus search by name, email, phone or location. Opening an applicant shows the full application (details, documents, history). Super administrators and programme directors also see **Approve** and **Reject** buttons, each with a confirmation step. Reject has an optional reason. The dashboard shows "N applications are waiting for a decision".

| Group | Database statuses |
|---|---|
| Pending | submitted, under_review, shortlisted, waitlisted |
| Approved | accepted (the applicant becomes a participant) |
| Rejected | rejected (the applicant stays an applicant) |

Coordinators can still review (mark under review, shortlisted, waitlisted, add notes, reconsider a rejection) but cannot approve or reject.

## What happens on a decision (one database transaction: `decide_application`)
**Approve:** application becomes accepted; the applicant's profile role changes from applicant to participant (names and phone are filled from the form if empty); one participant record and portfolio are created (no duplicates); history, audit log, in-app notification and a queued email are written.
**Reject:** application becomes rejected; the profile is not changed (no participant access); the same history, audit, notification and email records are written.
Nothing is half-done: if any step fails, the whole decision rolls back.

## Rules enforced in the database (not just the screen)
- Only an active `super_admin` or `programme_director` can call `decide_application`.
- Nobody can decide their own application.
- Only pending applications can be decided; a decision cannot be repeated or reversed (a rejected application can be reconsidered by staff, which returns it to under review).
- The old status route (`transition_application`) can no longer move an application to accepted or rejected.
- Applicants cannot change their own role or status, or any application status (existing triggers, retested).
- Approval can only turn an **active applicant** into a participant. The profile guard gained one narrow, transaction-local exception for exactly that and nothing else. It cannot be set through the API.
- The service-role key is never in the browser. No new Edge Function was needed; the existing `send-emails` function sends the queued emails.

## Audit trail
Each decision writes (1) an `application_events` row (from/to status, reason, administrator), (2) an `audit_logs` row with action `application_approved` or `application_rejected` holding administrator id, decision, reason, applicant, participant and timestamp, and (3) the existing row-level audit entries. Super administrators read these in Audit log.

## Emails
Templates `application_approved` and `application_rejected` (editable in Email > Templates). They are transactional: queued even when event automation is off or the applicant opted out of marketing. They are sent by the existing `send-emails` function once email is set up (docs/EMAIL_SETUP.md). The rejection reason is **never** included in the email.

## Safe rollout (do these in order; never test on production first)
1. **Back up** the Supabase database (Dashboard > Database > Backups), and note which account is the Super Admin. The migration does not change any profile.
2. **Local test:** `supabase start && supabase db reset && supabase test db` (needs Docker). All files in `supabase/tests` must pass, especially `applicant_approval.test.sql` (42 checks).
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. **Staging:** apply the migration to a separate Supabase project (a copy) and walk through: sign up a test applicant, submit an application, approve one and reject one as the super admin, check the emails arrive and the applicant's access.
5. **Production, only after you approve:** `supabase db push` (applies `20260101000014_applicant_approval.sql`, additive only), then `supabase functions deploy` is not needed for this change. Deploy the front end from GitHub in Netlify.
6. **Rollback if needed:** `supabase/rollback/20260101000014_applicant_approval_down.sql` restores the old functions and removes the new ones without touching data.

## Known limits
- The old "Convert to participant" button remains only for applications accepted before this change that have no participant record.
- A person already approved cannot be un-approved in the app; withdraw them as a participant instead.
- Approving does not choose a cohort or track; enrol them afterwards from Cohorts.
