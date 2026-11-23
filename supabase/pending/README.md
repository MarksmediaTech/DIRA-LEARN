# Pending database changes (not applied)

Changes here are prepared and tested locally but **not applied** to any Supabase project. Each needs the owner's approval.

| File | For | Status |
|---|---|---|
| `20261122000001_participant_programme_track.sql` | Direct CSV enrolment: keeps the imported programme track on the participant while no cohort is assigned | awaiting approval |
| `20261122000001_participant_programme_track_rollback.sql` | Undo of the above | – |
| `20261122000002_chat_notifications_calendar.sql` | Chat dashboard, notification bell and Google Calendar sync queue (needs change 1 first; refuses a second run). Tests: `supabase/tests-pending/chat_notifications_calendar.test.sql`, `tools/chat/chat_db_check.sh` | awaiting approval |
| `20261122000002_chat_notifications_calendar_rollback.sql` | Undo of the above (refuses while Chat data exists unless confirmed) | – |
| `20261123000001_verify_certificate_full_name.sql` | Public certificate check shows the learner's complete name (no extra initial or full stop). Independent of changes 1 and 2. Test: `supabase/tests-pending/verify_certificate_full_name.test.sql` | awaiting approval |
| `20261123000001_verify_certificate_full_name_rollback.sql` | Undo of the above | – |

They are deliberately **not** in `supabase/migrations`, so no tool applies them by accident. After approval they are run once
in the SQL Editor, in number order (each is safe to run twice: changes 1 and 3 change nothing the second time, change 2 refuses) and later folded into the baseline.
