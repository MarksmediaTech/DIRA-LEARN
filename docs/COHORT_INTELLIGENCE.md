# Phase 7 – Cohort Intelligence (migration 28)

Status: built and tested locally (44 database checks, two of them confirmed by deliberately breaking the rule they guard). Not deployed.

## What it does (page `/intelligence`)
- **Intake:** each cohort's intake and season, recruitment window, places, enrolment and fill rate, withdrawals, track mix, and the applications submitted inside the recruitment window (with accepted and rejected). Applications are programme-wide, so they are counted by submission date.
- **Cohorts and tracks:** for each cohort, and optionally each track:
  - active and withdrawn learners;
  - average attendance;
  - submission rate and overdue work;
  - average task, final-project and draft overall results, with how many learners have a result;
  - requirements met, certified and completion rate;
  - learners who may need support.

  A chart compares attendance, submission and completion across cohorts, and each cohort is described against the average.
- **Facilitators:** per facilitator and cohort:
  - sessions scheduled, completed and cancelled;
  - delivery reports filed;
  - learners and average attendance;
  - work waiting for a grade and average grading turnaround;
  - feedback notes written.

  You can filter by facilitator.
- **Learners:** every learner across the chosen cohorts, filterable by name, completion status and "may need support".
- **Support and interventions:** per cohort:
  - support flags by reason;
  - learning access (scheduled, expired, suspended);
  - DIRA Connect reports (open, with safeguarding, closed);
  - active mutes;
  - support messages from learners whose access is closed;
  - feedback notes.
- **Safeguarding totals** (open, in hand, resolved, urgent, past target, legal holds) appear **only for the Safeguarding Lead and Deputy**, with no names or details.
- Season and intake filters apply to every tab. Every table downloads as CSV, with formula-safe cells.

## How the figures are calculated
- Everything is built on the Phase 6 learner calculation, so cohort figures always agree with each learner's own figures.
- **Averages leave out learners with nothing recorded:** a missing figure is never counted as zero.
- **Withdrawn learners** are left out of averages and the completion rate, but counted in withdrawals.
- **Grading turnaround** uses a new `graded_at` time that the database records whenever work is graded or returned. It cannot be backdated. Work graded before Phase 7 has no time and is not counted.

## Who sees what (enforced in the database)
| Report | Staff and executives | M&E officer | Facilitator | Others |
|---|---|---|---|---|
| Intake | yes | yes, without application counts | no | no |
| Cohorts and tracks, Support | yes | yes | no | no |
| Facilitators | yes | no | own rows only | no |
| Learners (individuals) | yes | no | no | no |
| Safeguarding totals | officers only | no | no | no |

## Decisions for management
- Whether M&E officers should see facilitator figures (currently no).
- Whether small numbers should be hidden in reports for M&E (for example fewer than 5 learners). No suppression is applied now.

## Rollback
`supabase/rollback/20260101000028_cohort_intelligence_down.sql` (verified exact). It removes only the reports and the `graded_at` times.
