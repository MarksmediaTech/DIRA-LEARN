# Chat and the notification bell (22 Nov 2026)

**Chat** is one page that replaces the separate *Announcements*, *Notifications* and *DIRA Connect* pages.
The old addresses still work: they forward to the right place. **Connect moderation** stays as before.
Notifications now live in the **bell** at the top right of every signed-in page.

> **Status:** prepared and tested locally. It needs the database change `supabase/pending/20261122000002_chat_notifications_calendar.sql` (not applied) and a new website deployment (not deployed).

## Sections

| Section | What it holds |
|---|---|
| Announcements | Staff news and learning materials. Learners read, download and react. |
| Direct messages | One-to-one conversations. This includes the existing learner–trainer and safeguarding conversations. |
| Group conversations | Cohort discussions (created automatically, as before) and groups that staff create. |
| Shared learning materials | Documents and images from announcements and from the user's own conversations. |
| Audio and video messages | Voice messages, audio lessons and videos from the same places. |

The conversation screen shows:
- search, unread counts, initials avatars, an online/offline dot, timestamps;
- *Sent* / *Seen* ticks in one-to-one conversations and groups;
- search inside a conversation, replies and emoji reactions with a picker;
- attachments: drag and drop or the paperclip, with in-browser voice recording;
- *Report* on other people's messages.

It works on phones: the list and the conversation take turns on the screen. It follows the device's light or dark setting.

**Profile pictures:** DIRA LEARN has no stored profile photos yet, so coloured initials are shown. Adding photos would be a separate change.

## Who can message whom

The database decides this (`chat_can_dm`). The screen only lists people the user may message.

| From \ to | Learner | Trainer | Programme staff* | Mentor | M&E officer |
|---|---|---|---|---|---|
| Learner | only learners sharing a cohort | only their assigned trainer | yes | only their own mentor | no |
| Staff of any kind | as in the learner row | yes | yes | yes | yes |

\* Programme director/coordinator, founders and Super Admins.

Other rules:
- Applicants and inactive accounts cannot use Chat.
- **Groups:** only staff create them, and they may only add people they are allowed to message. The creator is the owner: they can add members and rename the group. Members can leave.
- Cohort discussions keep their existing rules: trainers of the cohort and its learners.
- Safeguarding conversations are unchanged: readable only by safeguarding officers.

## Announcements

- **Who publishes.** Every staff role publishes, within its access:
  - programme staff and M&E officers: everyone, any track or cohort;
  - trainers: their cohorts or their assigned tracks;
  - mentors: cohorts of their mentees.
- **Authors** can edit, pin/unpin and delete their own announcements. Executives (Super Admin, Founder, Co-Founder) can do this for all announcements.
- **Audience:** everyone, one programme track, or one cohort.
- **Materials:** up to 10 files per announcement, plus an audio recording of up to 15 minutes. Files stay attached to their announcement, in the private bucket `announcement-files`.
- **Learners** see only announcements meant for them. They can open and download the materials and react with emoji. They cannot create, edit, delete or reply.

## Supported files and limits

These limits are enforced on the server. The table `chat_file_rules` is checked by the database before an attachment is saved, and the storage buckets accept the same types.

| Kind | Types | Limit per file |
|---|---|---|
| Documents | PDF, Word (.doc, .docx), Excel (.xls, .xlsx), OpenDocument text/spreadsheet | 10 MB |
| Presentations | PowerPoint (.ppt, .pptx), OpenDocument presentation | 25 MB |
| Text | .txt, .csv | 2 MB |
| Images | JPEG, PNG, WebP, GIF (SVG is refused: it can carry scripts) | 10 MB |
| Audio | WebM (browser recordings), Ogg, MP3, M4A/AAC, WAV | 20 MB |
| Video | MP4, WebM, MOV | 50 MB |

Other limits:
- Up to 3 files per message. Voice messages last up to 5 minutes.
- **Changing a limit:** an executive (Super Admin, Founder, Co-Founder) can lower `max_bytes` for a type in `chat_file_rules` (SQL Editor). The bucket ceiling is 50 MB.
- The website has the same list in `src/features/chat/rules.ts`, so it can explain a refusal before uploading. If you change a limit, change both.
- **Virus check:** conversation files open only after a clean scan. Until then they show "waiting for a virus check". This is the existing DIRA Connect rule and needs the scanner (`scan-attachments`, see `ATTACHMENT_SECURITY.md`) to be running.
- Announcement files follow the existing rule for staff-published materials (migration 35).

## Privacy

- Every list and file is read with the user's own session, so Row Level Security filters it.
- Files are opened only through short-lived signed links (10 minutes). There are no public links.
- Realtime delivers changes only to users who are allowed to read them. A user never gets a notification or preview of a conversation they are not in.

## The notification bell

- **Where:** at the top right of the header on computers and tablets, next to the profile menu. On phones it is in the top bar, next to *Menu*.
- **Live updates** (Supabase Realtime): the unread badge updates and the bell swings briefly; it does not move if the device asks for reduced motion.
  - A pop-up appears without leaving the page. It closes after 6 seconds or with ✕. The same notification never pops up twice, and at most 3 are shown at once.
- **Dropdown:**
  - title, short text and time; unread items are highlighted;
  - mark one or all as read; **Show older notifications** loads 20 more at a time;
  - clicking an item opens the announcement, conversation (at the message), group or learning page.
  - On phones the dropdown fits inside the screen.
- **Counts:** the unread count comes from the database, so it is the same on every device. A conversation's notifications are marked read when it is opened.
- **No repeats:** one unread notification per conversation, however many messages arrive, and one per announcement.
- **Kinds:**
  - new announcement and announcement updated;
  - new direct message and new group message;
  - added to a group, reply, reaction;
  - plus the existing ones (assignments, certificates, courses, applications…).
