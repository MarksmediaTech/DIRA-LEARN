# Safeguarding in DIRA LEARN (migrations 24, 26 and 39)

Status: built and tested locally on PostgreSQL 16 (87 + 10 database checks). **Not applied to any Supabase project.**
Implements the DIRA management decisions of 19 November 2026, with the owner's change of 21 November 2026 (interim access, migration 39). It does not replace DIRA Foundation's safeguarding policy or any legal duty to report.

## Designated officers
- Two positions: **Safeguarding Lead** and **Safeguarding Deputy**. **Nobody holds them** until an executive appoints them.
- Only a Super Administrator, Founder or Co-Founder can appoint or remove an officer, always with a written reason. **Nobody can appoint themselves**; another executive must do it. Lead and Deputy must be different people.
- Who can be appointed: active executives and programme staff (programme director, coordinator). See decision 4 below.
- The appointee is notified. If concerns are already waiting, the new officer is told at once.
- **The Deputy acts when the Lead is unavailable or not appointed.** The Lead (or an executive) marks the Lead unavailable until a date; the Deputy is notified.
- Every appointment, removal and availability change is kept in an append-only history.

## Interim access until a Lead or Deputy is appointed (migration 39, owner decision 21 Nov 2026)
- The decision: *"Super Admins can read safeguarding records until a Safeguarding Lead or Deputy is appointed."*
- While **no active Lead or Deputy** exists, every **active Super Administrator** holds interim safeguarding access. They can read and update records, add notes and referrals, see the access log and see open concerns on their dashboard. They also receive the **urgent-concern** and **overdue** alerts.
- **Founder and Co-Founder are not included.** The decision names Super Admins. Deactivated accounts are never included.
- It **ends automatically** the moment a Lead or Deputy is appointed. It **resumes** if no active officer remains, for example after a removal or deactivation. An officer who is only marked "unavailable" still counts as appointed.
- **Unchanged until an appointment:**
  - A *standard* (non-urgent) concern sends no immediate alert. It appears on the interim holder's dashboard, and alerts them when it passes its acknowledgement target.
  - Learners still cannot start a conversation with the safeguarding team ("not set up yet; speak to your facilitator").
- On the Safeguarding page an interim holder sees an orange notice explaining this.

## Records are confidential
- **Only the current Lead and Deputy can read or change safeguarding records** or, before either is appointed, the active Super Administrators (interim access, above). Other executives and all other staff cannot read them.
- Records cannot be deleted, and their history cannot be changed, by anyone (not even in the SQL editor).
- Records are **not** copied into the general audit log, because executives can read that log.
- Executives can see only *that* concerns are waiting while nobody is appointed (a count, no details).
- **Exceptional access:** a safeguarding officer, or a *different* executive, can give a named executive or programme staff member access for 1 to 7 days, with a written reason (20+ characters). Each record they open needs its own reason, is logged, appears in the record's history, and the acting officer is notified. It can be revoked at any time.

## Raising and escalating concerns
- **Staff, facilitators, mentors and M&E officers** raise a concern on the Safeguarding page (urgent or standard). They cannot read it back afterwards.
- **Learners** use Report on a DIRA Connect message, or message the safeguarding team privately (see DIRA_CONNECT.md).
- **A moderator escalating a DIRA Connect report** chooses Urgent or Standard; a confidential record is created with a copy of the reported message, the conversation and the learner. The moderator cannot read the record.
- **A report with the reason "I am worried about someone's safety" goes to safeguarding automatically** (decision 6 below).

## Response targets
- **Urgent:** both the Lead and the Deputy are notified **immediately**; acknowledgement target **60 minutes** (approved 19 Nov 2026; editable by executives).
- **Standard:** the acting officer is notified; acknowledgement target **24 hours**.
- If a target is missed, **both** officers are alerted once (checked every time the `send-emails` schedule runs, every 5–10 minutes when scheduled).
- In-app notifications always; email too when automatic email is approved. **Notifications and emails contain no names or details**, only "open Safeguarding in DIRA LEARN".

## What a record holds
Urgency, source, learner, summary, copy of the reported message, linked conversation, escalation date, acknowledgement target, who acknowledged and when, responsible officer, status (open → acknowledged → in progress → referred → resolved / closed), actions and notes (including referrals), resolution and resolution date, legal hold with reason, and a retention-review date (unused until decision 3).

## Reading private conversations for safeguarding
- The **acting** Safeguarding Lead may open a private conversation that was **not** reported only by naming an open safeguarding record and giving a written reason. The read is logged and added to the record's history.
- Both officers may open conversations that were reported or escalated, with a reason, logged.
- Hidden messages are shown to these authorised readers with their original text, marked as hidden.

## Minimum age (migration 26)
- An applicant cannot submit an application without a date of birth showing they are **at least 18**.
- Nobody (staff, server functions, the SQL editor) can **accept** an application, or create a participant record, for someone whose recorded date of birth is under 18.
- **No under-18 procedure has been invented.** A future programme for minors needs its own approved policy.
- Existing records were not changed. To look for any existing participants under 18, run `supabase/checks/under_18_check.sql` (read-only).

## Decisions still needed from DIRA management
1. **Formally appoint** the Safeguarding Lead and Deputy (board decision), then an executive records it in the app.
2. ~~Urgent acknowledgement time~~ **Approved (19 Nov 2026): 60 minutes.** Still open: what happens out of hours (the system alerts, but cannot phone anyone).
3. **Retention of safeguarding records and safeguarding-team conversations.** Currently kept indefinitely and never deleted automatically. A period needs legal advice (for example under Kenya's Data Protection Act 2019).
4. **Who may be appointed.** Currently executives and programme staff. Should a trainer or an outside professional be eligible?
5. **Exceptional access.** Currently granted by an officer or a different executive, at most 7 days. Confirm.
6. ~~Automatic routing of "safety concern" reports~~ **Approved (19 Nov 2026):** safety-related reports escalate directly to safeguarding.
7. **Officers reading reported conversations without a separate grant.** Appointment as an officer is treated as the explicit grant for reported/escalated conversations. Confirm.
8. **Upper age limit 25.** Checked by the application form only. Should the database also refuse applicants over 25?
