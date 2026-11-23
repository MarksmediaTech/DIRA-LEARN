# Curriculum Approval Centre

Status: written, **not run** (no Postgres, Node packages or network were available when it was built). Follow "Safe rollout" before relying on it.

## What it is
Administration > **Curriculum Approval Centre** (`/curriculum/approval`). Founder, Co-Founder and Super Administrator review the topics proposed for each learning track and approve or reject them. **Approved topics become the official topics of their session.** Pending and rejected topics never count as official teaching content.

## Who can do what
| Role | Open the Approval Centre | Approve / reject / reconsider | See approved topics in Curriculum |
|---|---|---|---|
| Founder, Co-Founder, Super Administrator | yes | yes (same rights) | yes |
| Programme Director, Coordinator, Trainer, M&E, Mentor, Participant, Applicant | no | no | per their existing access |

Enforced in the database, not only on screen: `can_approve_curriculum()`, `review_curriculum_topic()`, and row level security. The Programme Director keeps their **existing** right to approve whole sessions (`set_curriculum_approval`); that is a different, older control and is unchanged.
Update (migration 17): Founder and Co-Founder now have administrative access equivalent to the Super Administrator. See `EXECUTIVE_ROLES.md`.

## Step-by-step: using it
1. Sign in as a Founder, Co-Founder or Super Administrator. The dashboard shows "N curriculum topics are waiting for approval". Click **Review**, or open **Curriculum Approval Centre** in the menu.
2. The four cards show Total, Pending, Approved and Rejected topics. Topics are grouped by track (Digital Marketing (called Digital Skills before V13), AI Tools, Content Creation, Entrepreneurship & Business), then by session, with its week.
3. Narrow the list with the status tabs, the **Learning track** and **Session** filters, or **Search by topic title**.
4. **Approve:** click Approve, add an optional comment, confirm. **Reject:** click Reject, write the required reason, confirm. **View details** shows the session, the reviewer and the full history.
5. A rejected topic stays in the list. Use **Reconsider** to return it to pending.
6. After approval the topic appears under "Approved topics" for that session in Curriculum and in the trainer's session plan. Topics still pending appear as "awaiting approval"; rejected topics do not appear.

## The starting queue (24 topics, all pending; nothing is auto-approved)
Digital Marketing: session 3 (2 topics), session 4 (2), session 5 (2), session 6 (2), session 7 (3). **DIRA approved these 11 topics on 8 Nov 2026** as part of Digital Marketing Sessions 5, 6 and 7. Migration 37 (21 Nov 2026) moved each to the V13.2 session that teaches it, with titles unchanged, and wrote the approval into its description. They are pending until approved here; a suggested comment is "Approved by DIRA on 8 Nov 2026". Content Creation: session 6 (3). Entrepreneurship & Business: session 4 (10). AI Tools: none (nothing was supplied; its sessions are untouched). The same title in two tracks is two separate proposals.
Note: earlier you approved the topics of Entrepreneurship session 4 in chat. Because this brief says to start every proposed topic as pending, those 10 are pending too; approve them here in a few clicks.

## How it is built
- `20260101000015_founder_roles.sql`: adds the `founder` and `co_founder` roles (its own file because a new enum value cannot be used in the same transaction).
- `20260101000037_digital_marketing_topic_sessions.sql`: places the 11 Digital Marketing proposals on their V13.2 sessions (3–7) and redefines `seed_initial_topic_proposals()` accordingly. It refuses if any of them has already been reviewed, and approves nothing. Rollback: `supabase/rollback/20260101000037_digital_marketing_topic_sessions_down.sql`.
- `20260101000016_curriculum_approval_centre.sql`: tables `curriculum_topic_proposals` and `curriculum_topic_events` (history), the review and read functions, the `v_session_topics` view, the starting queue.
- Existing `curriculum_sessions.topics` is **not edited**; the view splits it into approved and awaiting, so existing sessions and their approval state stay intact.
- Rules: only a pending topic can be approved or rejected; rejecting needs a reason; only a rejected topic can be reconsidered; topics and history are never deleted or edited; no one can update status directly (no write policy for anyone, plus a trigger); every decision is written to the history and the audit log.

## Safe rollout (never test on production first)
1. **Back up** the Supabase database.
2. **Local:** `supabase start && supabase db reset && supabase test db` (Docker). `curriculum_approval.test.sql` (46 checks) and the existing tests must pass. Then `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
3. **Staging:** apply to a copy of the database and try it with a Founder, a Co-Founder, a Super Administrator and a Programme Director account.
4. **Production, after you approve:** `supabase db push` (applies 15 then 16). If you use the SQL Editor instead, run file 15, then file 16, as two separate runs. Redeploy the one changed function: `supabase functions deploy invite-user`. Netlify: push to GitHub and redeploy; no new environment variables.
5. **Give the roles:** in **Users**, a Super Administrator sets a person's role to Founder or Co-Founder, or invites them with that role. Nothing about existing accounts or passwords changes.
6. **Rollback:** `supabase/rollback/20260101000016_curriculum_approval_centre_down.sql` (it deletes the approval queue and history, so export them first). The two enum values cannot be removed, but are harmless.

## Important for existing databases
- Run the earlier `reset_curriculum.sql` (old tracks cleanup) **before** this migration. It now refuses to run afterwards, because proposals point at sessions and are never deleted.
- The starting queue is matched to the current four-track curriculum by track code and session number. If your database still has the old tracks, the migration adds nothing until the curriculum is current; run `select seed_initial_topic_proposals();` afterwards.
- `supabase db reset` (local only) rebuilds everything, including the queue.

## Known limits
- Proposals are loaded by the migration; there is no screen yet to propose a new topic (the table and `submitted_by` are ready for it).
- A topic that is already approved cannot be un-approved in the app.
- Approval changes what the Curriculum and session-plan screens show. It does not rewrite `curriculum_sessions.topics`, so anyone reading that raw column still sees the original proposed list.
