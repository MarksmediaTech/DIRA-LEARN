# DIRA Connect, Phase 4 (migrations 22, 24, 25)

> **22 Nov 2026:** the DIRA Connect, Announcements and Notifications pages are replaced by **Chat** and the notification bell (`docs/CHAT_AND_NOTIFICATIONS.md`). The conversation rules below still apply to learner–trainer, cohort and safeguarding conversations; *Connect moderation* is unchanged.

Status: the database layer is **built and tested locally on PostgreSQL 16** (dira_connect 61, connect_phase4 73 and safeguarding 87 checks, all passing). The screens were syntax-checked and their rules unit-tested; they have not yet been opened in a browser. **Not applied to any Supabase project.** Safeguarding is described in `docs/SAFEGUARDING.md`.

## What it does
- **Cohort discussions**: one per cohort. Enrolled learners whose access to *that* cohort is Active, and the cohort's assigned trainers, can read and post. No one sees another cohort's discussion.
- **Private conversations** between one learner and one facilitator (a trainer formally assigned to the learner's cohort). **Either side may start one** (decision of 19 Nov 2026).
- **Support when learning access is closed**: a learner whose access is scheduled, expired, suspended or withdrawn keeps their private conversations with assigned facilitators and can message the safeguarding team. Cohort discussions and learning materials stay closed.
- **Safeguarding-team conversation**: a learner can message the designated Lead and Deputy privately. Only those three people can read it: no moderator, executive or oversight grant can, and it cannot be reported to moderators. It is offered only once an officer is appointed.
- **Attachments**: PDF, Word, Excel, PowerPoint, JPG, PNG; up to 10 MB; at most 3 per message; private storage bucket; access follows the conversation. Hidden messages' files are closed to members.
- **Links**: only `http`/`https` addresses become links; they open in a new tab without access to DIRA LEARN (`noopener noreferrer nofollow`). Everything else stays plain text.
- **Live updates** through Supabase Realtime (messages and attachments), with a 15-second refresh as a fallback.
- **Reporting and moderation** as before (dismiss, hide, escalate, lock, mute, and now **unmute**). Escalation goes to safeguarding with an urgency level.
- Plain text up to 2000 characters, no editing or deleting of sent messages, at most 15 messages per minute.

## Who can see what (enforced by the database)
| | Private conversation | Cohort discussion | Safeguarding-team conversation |
|---|---|---|---|
| The learner | read and write (any access status) | read and write only while access to that cohort is Active | read and write |
| The assigned facilitator | read and write; may start it | read and write | no |
| Safeguarding Lead and Deputy | only reported or escalated ones, with a reason, logged; the **acting** Lead also others for an open safeguarding record | no | read and write |
| Executives | **no** | read only | **no** |
| A person granted "private" oversight (by a *different* executive) | only reported or escalated ones, with a reason, logged | | **no** |
| Moderators | only the reported message, copied into the report | hide, lock, mute | **no** |

## Oversight rules
- **Nobody can grant themselves** any oversight permission; a different executive must.
- A "private" grant opens only conversations that were **reported or escalated**. Each read needs a written reason and is logged (who, when, why, on what basis). Executives can review the log.
- Hidden messages are shown to authorised readers with their original text, marked as hidden.

## Retention and legal holds
- Ordinary messages are deleted **12 months after the learner's last cohort ends** (cohort discussions: 12 months after that cohort ends), together with their files.
- **Retention is OFF until an executive switches it on** (Connect moderation page), after seeing how many conversations would be deleted. The scheduled `send-emails` job does the deleting and removes the files from Storage. Each run is logged (counts only).
- **Never deleted automatically:** safeguarding-team conversations; conversations containing any report; conversations linked to a safeguarding record, or of a learner who has one; anything under a **legal hold** (placed by an executive or a safeguarding officer on a cohort, a learner or a conversation, with a reason, released with a reason).
- Users still cannot delete messages at all.

## Known limits
- **Virus checks (migration 29):** no attachment can be downloaded until a scanner marks it clean. No scanner is configured yet, so files can be shared but not opened. See `docs/ATTACHMENT_SECURITY.md` for options and costs.
- No per-message notification for cohort discussions (unread counts only).
- A facilitator removed from a cohort immediately loses access to private conversations with that cohort's learners.
- Rate limit counts all messages a person sent in the last minute, across conversations.

## Decisions still needed
1. **Virus scanning service**: choose one (costs in `docs/ATTACHMENT_SECURITY.md`). Until then attachments cannot be opened.
2. **When to switch retention on**, after legal review of the 12-month period.
3. Earlier V8 points now settled by the 19 Nov decisions: facilitator start (yes), facilitator definition (assigned trainer), executive reading (no, explicit grant only), closed access (support only), retention (12 months), attachments (yes, with safeguards).

## Safe rollout
1. Back up the Supabase database. Run `supabase/checks/live_migration_check*.sql` (read-only) and confirm which migrations the project has.
2. Local: `supabase start && supabase db reset && supabase test db` (22 test files, 560 checks).
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. Staging, then production **only after approval**: `supabase db push`, then `supabase functions deploy send-emails`.
5. In Supabase, check Realtime is enabled for `connect_messages` and `connect_attachments`, and that the `connect-attachments` bucket exists and is private.
6. Test with accounts: two learners in different cohorts (one with closed access), a trainer for each, a coordinator, two executives, and a Lead and Deputy appointed by an executive other than themselves.
7. Rollback: `supabase/rollback/2026010100002{6,5,4}_*_down.sql`, newest first (see `docs/PHASE4_COMPLETION_REPORT.md`).
