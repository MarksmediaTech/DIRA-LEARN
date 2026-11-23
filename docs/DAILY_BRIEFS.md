# Daily Briefs, Phase 3 (migration 21)

Status: written, **not run** (no Postgres, Node packages or network were available). Follow "Safe rollout" before relying on it.

## What learners see
On the learner dashboard, a Daily Brief section with: a greeting using their first name (morning, afternoon or evening in the programme time zone), today's date, the day's motivational reflection, learning objectives and reflection question, their next three upcoming sessions, assignment deadline reminders (overdue, or due in the next 7 days), and the latest programme announcements. The reflection, objectives and question appear only when a brief has been published for that day. **Nothing is generated or invented**: if there is no brief, the section says so and still shows sessions, deadlines and announcements. A brief written for the learner's own cohort wins over the all-cohorts brief for the same day.

## What staff do (Daily Briefs page)
Create and edit briefs, save drafts, publish now, schedule for a future time (entered in the programme time zone), withdraw, return to draft, delete drafts, filter by status, and open each brief's publication history. Each brief is for one cohort or for all cohorts. There can be only one live (scheduled or published) brief per day per audience; withdraw one to replace it.

## Who may publish
- **Always:** Super Administrator, Founder, Co-Founder.
- **Authorised staff** (programme director, programme coordinator): any cohort or all cohorts.
- **Authorised facilitators** (trainers): their own cohorts only, never "all cohorts".
- **Authorised** means an executive has switched the person on in the "Who can publish briefs" panel. Only executives can do this. Learners, applicants, mentors and M&E officers can never be authorised.
- Learners can read published briefs for their own cohort (or all cohorts) while their learning access is Active, and nothing else. They cannot create or publish briefs, and cannot read the history.

## How it is enforced (not only on screen)
- `daily_briefs`, `brief_publishers` and `daily_brief_events` have row level security; a database trigger refuses writes from anyone not authorised, and keeps facilitators to their own cohorts. A learner's read is also narrowed by their access window (migration 18).
- Publication history is append-only: created, edited, scheduled, published, published on schedule, withdrawn, returned to draft, with who and when.
- Scheduling: a scheduled brief becomes visible at its time through the read rule itself, so it does not depend on a timer. `publish_due_briefs()` (called by the `send-emails` schedule) then marks it Published and records "published on schedule". If the schedule is not running, learners still see the brief on time; only the label and history lag.

## Decisions needed from DIRA management
1. **Authorisation.** Is an explicit grant by an executive the right meaning of "authorised"? The alternative is to authorise whole roles automatically (for example every programme director).
2. **Facilitators and all-cohort briefs.** Currently facilitators cannot publish to all cohorts.
3. **Editing after publication.** Currently allowed and recorded in the history. Say if published briefs should be locked.
4. **Past briefs.** Learners currently see only today's brief on the dashboard. Say if they should also have an archive of earlier briefs.
5. **Notification.** No notification is sent when a brief is published. Say if you want one.

## Safe rollout
1. Back up the Supabase database.
2. Local: `supabase start && supabase db reset && supabase test db`. `supabase/tests/daily_briefs.test.sql` (25 checks) must pass, with the existing tests.
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. Staging, then production after approval: `supabase db push` (applies 17 to 21), then `supabase functions deploy send-emails`.
5. After deploying, a super administrator, Founder or Co-Founder opens Daily Briefs, authorises the people who should publish, and publishes a test brief for one cohort.
6. Rollback: drop the three tables, the `brief_status` type, `publish_due_briefs`, `can_publish_briefs`, `brief_is_live`, `guard_*`, `log_daily_brief` and `block_brief_event_change`. Export `daily_briefs` and `daily_brief_events` first if you want to keep the briefs and their history.

## Known limits
- The screens were checked by a syntax scan, and the rules (who may publish, validation, choosing the brief, greeting, deadline reminders, today in the programme zone) were run in Node. The pages themselves have not been rendered.
- Announcements on the dashboard follow the existing announcement rules and are not tied to the learning-access window.
