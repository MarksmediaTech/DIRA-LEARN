# Phase 6 – Individual Learner Performance (migration 27)

Status: built and tested locally (60 database checks, a 44-figure database-versus-browser cross-check, unit tests). Not deployed.

## What it does
- **Performance page** (`/performance`).
  - Learners see their own attendance, sessions (including core sessions), work submitted / graded / overdue / returned, session-task, final-project and reflection results, the draft weighted overall result, the completion checklist, feedback shared with them, and their history.
  - Facilitators, mentors and staff see a cohort table, filterable by name, track, completion status and "may need support", with a detail view for each learner.
- **One calculation** in the database (`learner_metrics`), identical to the existing Results page. A cross-check test proves both give the same figures, so learner views and management reports cannot drift apart.
- **Completion status:** In progress, Requirements met (draft rules), Certificate issued, Withdrawn.
- **Facilitator feedback** on overall progress: shared with the learner (who is notified) or a staff-only note. Feedback cannot be edited or deleted; add a new note to correct it.
- **Performance history:** one snapshot per learner per day while the cohort runs (and for 14 days after), taken by the `send-emails` schedule. It shows the change since the first snapshot.
- **Management reporting:** CSV download for staff and facilitators. Cells that a spreadsheet could run as formulas are neutralised.

## Who sees what (enforced in the database)
| Person | Records | Feedback |
|---|---|---|
| Learner | own only, while access to that cohort is Active or Expired (read-only results, as decided in migration 19) | shared feedback only |
| Facilitator | learners of cohorts they are assigned to | all, and can write |
| Mentor | own mentees only | shared feedback only, cannot write |
| Programme staff and executives | everyone | all, and can write |
| M&E officer, applicant, anyone else | none (cohort figures come in Phase 7) | none |

## Draft rules (management decisions pending)
- Weights 20 / 30 / 40 / 10, the completion requirements (6 of 8 sessions including both core sessions, final project and reflection submitted) and "late counts as attended, excused is excluded" are unchanged drafts from the curriculum. **No pass mark is applied.**
- **"May need support" thresholds** are drafts, editable by executives (`performance_settings`): attendance below 75%, 2 or more overdue pieces of work, any work returned, and an optional result threshold (off). Please approve or change them.
- M&E officers do not see individual learners. Confirm.

## Rollback
`supabase/rollback/20260101000027_learner_performance_down.sql` (verified: the schema returns exactly to its previous state). It deletes feedback and history: export them first.
