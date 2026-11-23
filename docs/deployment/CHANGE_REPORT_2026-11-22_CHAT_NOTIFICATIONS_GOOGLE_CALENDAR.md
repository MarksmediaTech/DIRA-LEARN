# Change report – Chat dashboard, notification bell and Google Calendar sync (22–23 Nov 2026)

**Status:** implemented and tested on this machine only.
- No migration has been applied.
- No Edge Function and no website has been deployed.
- No Google or Supabase setting has been changed.

All earlier changes in this release are included and unchanged: direct CSV and Add-learner enrolment, the j.json fix, and the install files.

Guides:
- `docs/CHAT_AND_NOTIFICATIONS.md` – what users get, permissions, supported files.
- `docs/GOOGLE_CALENDAR_SETUP.md` – the Google steps for you.

## 1. What changed for users

- **Chat** (menu: *Home → Chat*) replaces the *Announcements*, *Notifications* and *DIRA Connect* menu items. It has five sections:
  1. Announcements
  2. Direct messages
  3. Group conversations
  4. Shared learning materials
  5. Audio and video messages
- **Old addresses forward:**
  - `/announcements` → Chat › Announcements
  - `/connect` → Chat › Direct messages
  - `/notifications` → the dashboard
  - There is no Notifications page any more. *Connect moderation* is unchanged.
- **Notification bell** at the extreme top right of the header, beside the profile menu; on phones in the top bar beside *Menu*:
  - live unread badge, pop-ups that close after 6 s or with ✕, never repeated;
  - a dropdown with history, mark one or all read, *Show older*;
  - each item opens the announcement, conversation or page it is about.
- **Announcements:**
  - All staff roles can publish to the audiences they may address. They can attach files, record audio, pin, edit and delete their own, and get a confirmation.
  - Learners read, download and react with emoji only.
- **Direct and group messages:**
  - replies, emoji reactions, files, voice recording (record → preview/play → delete or use → send) and video playback;
  - read ticks, unread counts, search, online/offline.
  - Staff create groups. Cohort discussions continue.
- **Calendar:** staff and trainers see a *Google Calendar sync* panel with:
  - the status (not set up / waiting / failed / up to date) and the last errors;
  - *Sync now*, *Retry failed*, and *Send all upcoming sessions again* (programme staff).
- **Profile menu:** a profile/avatar menu (initials, Change password, Sign out) now sits at the top right on computers.

## 2. Decisions that need your approval

1. **Learner-to-learner private messages (safeguarding policy change).**
   - Until now, learners could message only their trainer and the safeguarding team. The brief asks for learner↔learner messaging.
   - I limited it to learners **who share a cohort**, and every message keeps *Report*.
   - Please confirm, or tell me to restrict it further (for example group conversations only).
2. **Who may publish announcements.**
   - The brief says "all staff except learners, within their access". I implemented:
     - programme staff and **M&E officers**: everyone;
     - trainers: their cohorts and assigned tracks;
     - **mentors**: their mentees' cohorts.
   - Confirm M&E officers and mentors, or remove them.
3. **Virus checking of conversation files.**
   - Files in conversations open only after a clean scan (the existing rule). This needs the scanner function to run (`docs/ATTACHMENT_SECURITY.md`); otherwise files show "waiting for a virus check".
   - Decide: run the scanner, or approve a separate change that exempts some types. I have not weakened the rule.
4. **Microphone permission.** `public/_headers` now allows the microphone for DIRA LEARN's own pages only (`microphone=(self)`), which voice recording needs. The camera stays off.
5. **Applying the two pending database changes** (section 4) and **deploying** the functions and website (section 6).
6. **Google:** creating the Google Cloud project, service account and shared calendar, and storing the secrets (`docs/GOOGLE_CALENDAR_SETUP.md`). This is free; no paid service is introduced.
   - **Storage use:** videos and audio count against your Supabase Storage allowance. Check your plan's usage page. The size limits (section 5) keep single files at 50 MB or less.
7. **Do not run `REPAIR_api-grants.sql` after the Chat change.** It was written for the 100-table state. STEP-5 already understands both states (100 or 106 tables).

## 3. Files

**New:**
- `src/features/chat/`: `ChatPage.tsx`, `ThreadView.tsx`, `Announcements.tsx`, `PeoplePicker.tsx`, `parts.tsx`, `usePresence.ts`, `api.ts`, `rules.ts`, `rules.test.ts`
- `src/components/ui/NotificationBell.tsx`
- `src/features/calendar/GoogleSyncPanel.tsx`, `googleSync.ts`, `googleSync.test.ts`
- `supabase/functions/google-calendar-sync/index.ts`
- `supabase/pending/20261122000002_chat_notifications_calendar.sql` and `…_rollback.sql`
- `supabase/tests-pending/chat_notifications_calendar.test.sql` (118 pgTAP assertions)
- `tools/chat/chat_db_check.sh`
- Screen tests: `tools/recovery/browser/chat_flow.mjs`, `fake-chat-supabase.ts`, `harness-chat.tsx`, `build-css.mjs`, `missing-shim.tsx`
- `docs/CHAT_AND_NOTIFICATIONS.md`, `docs/GOOGLE_CALENDAR_SETUP.md`, this report

**Changed:**
- App and menu: `src/App.tsx` (Chat route and forwards), `src/components/ui/AppShell.tsx` (header with bell and profile menu; one bell per screen size), `src/lib/permissions.ts` and its test (menu), `src/features/dashboard/DashboardPage.tsx` (shortcut list), `src/features/calendar/CalendarPage.tsx` (sync panel), `tailwind.config.ts` (bell and pop-up animations, emoji font)
- Config and headers: `public/_headers` (microphone for self), `supabase/config.toml` (google-calendar-sync checks its own secret or sign-in), `.github/workflows/deploy-supabase-functions.yml` (adds google-calendar-sync; still manual)
- Verification SQL: `supabase/production_init/02_verify_readonly.sql` and the STEP-5/STEP-7 verify files generated from it (100 tables, or 106 once Chat is applied)
- Test tools: `tools/check-all.sh`, `tools/db-standin/frontend_contract_check.py`, `tools/release/routes_check.py`, `tools/edge-browser/*`, `tools/recovery/browser/{build.mjs,router-shim.tsx,react-query-shim.tsx,icons-shim.tsx}`, `tools/typecheck-stubs/stubs.d.ts`
- `docs/deployment/SECURITY_AND_TESTING_REPORT.md` (headers line)

**Removed:**
- The Notifications, Announcements and DIRA Connect pages (replaced by Chat). The exact paths are listed in `docs/deployment/REMOVED_FILES.md`.
- `ModerationPage.tsx` and the `connect` rules are kept.

## 4. Database changes (prepared, NOT applied)

Run in the Supabase SQL Editor, **in this order**, only after approval:

1. `supabase/pending/20261122000001_participant_programme_track.sql` (from the enrolment change, if not yet applied).
2. `supabase/pending/20261122000002_chat_notifications_calendar.sql`.
   - It refuses to run without change 1, and refuses a second run.
   - Expected final message: *Chat, notification bell and Google Calendar sync are ready*.
3. `supabase/install/STEP-5_verify_read-only.sql`: expect **READY**, check 2 = 106 tables, all 16 checks ok.

What change 2 adds. Existing data is not modified, except that old notifications get no link, which the bell handles:

| Area | Additions |
|---|---|
| Files | Table `chat_file_rules` (the 24 allowed types and limits), checked by a trigger on every attachment. Private bucket `announcement-files`. The `connect-attachments` bucket accepts the same types. |
| Conversations | New kinds `dm` and `group`; `connect_members`; replies (`reply_to`); `connect_reactions` (16 emoji). Functions `chat_inbox`, `chat_messages`, `chat_search`, `chat_contacts`, `chat_start_dm`, `chat_create_group`, `chat_add_members`, `chat_remove_member`, `chat_rename_group`, `chat_read_state`, `chat_react`; permission rule `chat_can_dm`. |
| Announcements | `track` audience, pinning, edit time, attachments and reactions. Policies for author edit/delete. `ann_feed`. Notifications on publish and update. |
| Notifications | `link`, `actor_id`, `dedupe_key`. One unread notification per conversation or announcement, and never to the person who acted. |
| Google sync | Queue `gcal_events` filled by a trigger on `session_schedules`; the trigger cannot block a calendar change. `gcal_claim` / `gcal_record` (server only), `gcal_retry_failed`, `gcal_queue_all_future`. |
| Realtime | Adds `notifications`, `connect_reactions`, `announcements`, `announcement_reactions`, `connect_members`. |

Grants and security:
- Grants are explicit on every new table, as in migration 38. Supabase's default TRUNCATE/REFERENCES/TRIGGER privileges are removed.
- Row Level Security is on for all 6 new tables.
- No existing access is loosened, with one intended exception: publishing announcements is now open to the staff roles listed in section 2 item 2. Reading rules for the existing audiences (everyone, cohort) are unchanged.

**Rollback:** `…_chat_notifications_calendar_rollback.sql`.
- It refuses while Chat data exists, unless you set `v_confirm := 'DELETE CHAT DATA'`. It also refuses while announcement files are stored.
- Tested: it returns schema, storage policies, buckets and Realtime exactly to the state before.

## 5. Supported files and limits

The full table is in `docs/CHAT_AND_NOTIFICATIONS.md`. In short:
- documents 10 MB, presentations 25 MB, text/CSV 2 MB, images 10 MB (no SVG), audio 20 MB, video 50 MB;
- 3 files per message, 10 per announcement;
- voice messages up to 5 min, recorded announcements up to 15 min.

Limits can be lowered in `chat_file_rules`.

## 6. Deployment (after approval)

**Order:** database → Edge Functions → website. The new website needs the new database functions; the old website keeps working with the new database.

1. **Supabase:** run the SQL files in section 4.
2. **Edge Functions:** run GitHub *Actions → Deploy Supabase Edge Functions*. It now includes `google-calendar-sync`.
   - The function runs with gateway *Verify JWT* off. It checks `x-cron-secret` or a staff/trainer sign-in itself, as `config.toml` records.
   - The other functions are unchanged by this feature.
3. **Google** (optional, any time later): follow `docs/GOOGLE_CALENDAR_SETUP.md` (secrets, Supabase Cron job every 5 min). Until then the panel says *Not set up* and nothing else is affected.
4. **Cloudflare (website):**
   - Work in your existing repository, on a branch `feature/chat-notifications-calendar`. Copy the release contents over it and open a pull request into `main`. The `release-check` and `database-pg17` workflows must be green.
   - Test the branch preview, if your Worker builds previews, with test accounts only. A preview talks to your real Supabase project, so do this only after step 1.
   - Merge. Workers Builds deploys `main` with your existing settings and variables. No new website variable is needed.
   - `public/_headers` changes one header (microphone for self).
5. **Check in production:**
   - sign in as a learner and as staff;
   - publish a test announcement to a test cohort;
   - send a test message between two test accounts;
   - watch the bell on the second device.
6. **Undo:**
   - revert the pull request (the old pages come back);
   - redeploy the previous functions;
   - run the rollback SQL only if you want the database part removed (see section 4).

## 7. Tests

### Run here (Linux)

The local stand-ins:
- a database: PostgreSQL 16, run as the SQL Editor's non-superuser role with Supabase's default privileges;
- Chrome with a fake microphone;
- a simulated Supabase client for the screens;
- simulated Google endpoints for the function.

| Brief test | What was run | Result |
|---|---|---|
| 1 Staff publish | pgTAP (policies, audiences per role); Chrome: director publishes to a cohort with PDF + video, pinned, gets a confirmation; trainer edits, unpins, deletes | pass |
| 2 Learners view & react | pgTAP (visibility by audience; reactions); Chrome: learner opens and downloads a file through a short-lived link, reacts; another cohort's learner does not see it | pass |
| 3 Learners cannot publish | pgTAP: insert/update/delete refused for learners; Chrome: no composer, no edit/delete/reply | pass |
| 4 Learner ↔ learner | pgTAP (`chat_can_dm`: same cohort only); Chrome: only same-cohort learners listed; message, reply, reaction, notification | pass |
| 5–6 Learner ↔ trainer | pgTAP; Chrome: learner messages trainer, trainer answers, *Seen* ticks | pass |
| 7 Group permissions | pgTAP (members only; staff create; only DM-able people added; owner adds); Chrome: learner cannot create; trainer creates; members notified | pass |
| 8 Audio record & playback | Chrome with fake microphone: record, stop, preview play, delete, record again, use, send; plays after the scan | pass |
| 9 Video & documents | Chrome: MP4 + DOCX uploaded; SVG and a 51 MB video refused with a message; pgTAP: server refuses wrong types and sizes | pass |
| 10 Private attachments | pgTAP: storage policies (members only, clean scan only; announcement files by audience); Chrome: no link before the scan | pass |
| 11 Bell top right | Chrome: computer (bell right next to the profile menu at the right edge) and phone (top bar) | pass |
| 12 No Notifications dashboard | Chrome: no menu item; `/notifications`, `/announcements`, `/connect` forward; routes check | pass |
| 13 Real-time pop-ups | Chrome: pop-up once even if delivered twice; bell swings; closes after 6 s; ✕ works | pass |
| 14–16 Dropdown, counts, mark read | Chrome: 25 items, pages of 20 + *Show older*, mark one, mark all, badge updates; pgTAP: one unread per conversation | pass |
| 17 Opens the right item | Chrome: announcement notification opens and highlights it; message notification opens the conversation at the message | pass |
| 18 No unauthorised previews | pgTAP: notifications only to members/audience, never to the actor; Chrome: an outsider gets no badge, pop-up or text and cannot open the conversation | pass |
| 19 Google create/update/cancel, no duplicates | Edge tests (real function code, simulated Google): one event with fixed id; edit = PATCH after 409; cancel/delete, 410 = done; pgTAP: queue trigger | pass |
| 20 Google failures | Edge tests: Google down / bad key recorded for retry, nothing else breaks; Chrome: calendar keeps working, panel shows the error, *Retry failed* | pass |
| 21 Existing functionality | Full local suite `tools/check-all.sh`: existing pgTAP (920 assertions); the Chat change on top passes except 2 assertions that check old attachment error texts (intended); unit tests; type check; existing screen tests (recovery, registration, setup, enrolment); Edge tests; CSP; install checks | pass (see the release log) |

Unit tests: chat rules 13, permissions 35, calendar sync panel 3. Database check: 16/16, including 118 pgTAP assertions. Edge Functions: 61/61. Chat screens: 24/24.

### Needs your real Supabase project or Google account (not done)

- Applying the pending SQL in the real SQL Editor and STEP-5 READY there.
- Real Supabase Realtime delivery across two devices; Presence; real Storage uploads and signed links; the scanner on real files.
- Real browsers' microphone prompts (Chrome, Safari, Firefox, Android, iPhone), and playback of each audio/video format on them. iPhone Safari records `audio/mp4`, which is accepted.
- Google: the real service-account sign-in, events appearing in the shared calendar, and the Supabase Cron schedule.
- `npm ci`, ESLint, the real Vite build and React component tests: they need the npm registry, which is blocked here. The GitHub `release-check` workflow runs them on the pull request.
- Real mobile devices and tablets. Phone layout was tested in Chrome at 375×740.
