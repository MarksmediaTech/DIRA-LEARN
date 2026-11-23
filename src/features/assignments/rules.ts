import type { SubmissionStatus } from '@/types/database';

// Mirrors guard_submission() and guard_assignment() in supabase/migrations/20260101000006_assignments_grading.sql.
// The database is the authority; these rules give instant feedback.

export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
// Same allow-list as the `submissions` storage bucket.
export const SUBMISSION_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export interface AttemptLike { attempt: number; status: SubmissionStatus }
export interface AssignmentLike { dueAt: string | null; allowResubmission: boolean }

export function latestAttempt<T extends AttemptLike>(attempts: readonly T[]): T | null {
  return attempts.reduce<T | null>((best, a) => (best === null || a.attempt > best.attempt ? a : best), null);
}

/** Late work is accepted but flagged: no hard cut-off has been approved. */
export function onTimeStatus(dueAt: string | null, now: Date = new Date()): 'submitted' | 'late' {
  return dueAt !== null && now > new Date(dueAt) ? 'late' : 'submitted';
}

/** Why the participant cannot submit right now, or null if they can. */
export function submissionBlocker(assignment: AssignmentLike, attempts: readonly AttemptLike[]): string | null {
  const last = latestAttempt(attempts);
  if (last === null) return null;
  if (!assignment.allowResubmission) return 'You have already submitted this assignment';
  if (last.status === 'returned') return null;
  if (last.status === 'graded') return 'This work has been graded';
  return 'Your work is with your trainer. You can submit again only if it is returned to you';
}

export function validateSubmission(input: { body: string; file: { size: number; type: string } | null }): string | null {
  if (!input.body.trim() && !input.file) return 'Add your answer or attach a file';
  if (input.file) {
    if (input.file.size === 0) return 'The file is empty';
    if (input.file.size > MAX_SUBMISSION_BYTES) return 'Files must be 10 MB or smaller';
    if (!(SUBMISSION_MIME_TYPES as readonly string[]).includes(input.file.type)) return 'Use a PDF, Word, PowerPoint, Excel, JPG or PNG file';
  }
  return null;
}

export type LearnerState = 'to_do' | 'overdue' | 'submitted' | 'late' | 'returned' | 'graded';

export function learnerState(assignment: AssignmentLike, attempts: readonly AttemptLike[], now: Date = new Date()): LearnerState {
  const last = latestAttempt(attempts);
  if (last === null) return assignment.dueAt !== null && now > new Date(assignment.dueAt) ? 'overdue' : 'to_do';
  return last.status;
}

export const STATE_LABEL: Record<LearnerState, string> = {
  to_do: 'To do', overdue: 'Overdue', submitted: 'Submitted', late: 'Submitted late', returned: 'Returned for revision', graded: 'Graded',
};

export function validateAssignment(input: { cohortId: string; title: string; dueAt: string; maxScore: string }): string | null {
  if (!input.cohortId) return 'Choose a cohort';
  if (input.title.trim().length < 3) return 'Give the assignment a title';
  if (input.dueAt && Number.isNaN(new Date(input.dueAt).getTime())) return 'The due date is not valid';
  if (input.maxScore.trim()) {
    const n = Number(input.maxScore);
    if (!Number.isFinite(n) || n <= 0) return 'Maximum score must be a number above 0';
    if (n > 9999.99) return 'Maximum score is too large';
  }
  return null;
}

export type GradeAction = 'grade' | 'return';

export function validateGrade(input: { action: GradeAction; score: string; maxScore: number | null; feedback: string; allowResubmission: boolean }): string | null {
  if (input.action === 'return') {
    if (!input.allowResubmission) return 'This assignment does not allow resubmission';
    if (!input.feedback.trim()) return 'Say what needs to change before returning the work';
    return null;
  }
  if (input.maxScore === null) return null;   // feedback-only assignment
  if (!input.score.trim()) return 'Enter a score';
  const n = Number(input.score);
  if (!Number.isFinite(n)) return 'The score must be a number';
  if (n < 0 || n > input.maxScore) return `Score must be between 0 and ${input.maxScore}`;
  return null;
}

export function percentOf(score: number | null, max: number | null): number | null {
  if (score === null || max === null || max <= 0) return null;
  return Math.round((score / max) * 1000) / 10;
}

export interface SubmissionLike { participantId: string; attempt: number; status: SubmissionStatus }
export interface Progress { expected: number; notSubmitted: number; toGrade: number; returned: number; graded: number }

/** Counts each expected participant once, by their latest attempt. */
export function assignmentProgress(roster: readonly string[], submissions: readonly SubmissionLike[]): Progress {
  const out: Progress = { expected: roster.length, notSubmitted: 0, toGrade: 0, returned: 0, graded: 0 };
  for (const pid of roster) {
    const last = latestAttempt(submissions.filter((s) => s.participantId === pid));
    if (last === null) out.notSubmitted += 1;
    else if (last.status === 'graded') out.graded += 1;
    else if (last.status === 'returned') out.returned += 1;
    else out.toGrade += 1;
  }
  return out;
}

// ---------- individual assignments (migration 20) ----------
export type RecipientMap = ReadonlyMap<string, ReadonlySet<string>>;

/** Builds assignment id -> chosen participant ids. An assignment with no entry is for its whole cohort or track. */
export function recipientMap(rows: readonly { assignment_id: string; participant_id: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = m.get(r.assignment_id) ?? new Set<string>();
    set.add(r.participant_id);
    m.set(r.assignment_id, set);
  }
  return m;
}

/** True when this learner is expected to do the assignment (mirrors guard_submission()). Track rules are checked by the caller. */
export function isAssignedTo(assignmentId: string, participantId: string, recipients: RecipientMap): boolean {
  const chosen = recipients.get(assignmentId);
  return !chosen || chosen.size === 0 || chosen.has(participantId);
}

/** The participants expected to submit: the cohort (or its track), narrowed to the chosen learners when there are any. */
export function eligibleParticipants(
  assignment: { id: string; trackId: string | null },
  enrolments: readonly { participantId: string; trackId: string | null }[],
  recipients: RecipientMap,
): string[] {
  return enrolments
    .filter((e) => assignment.trackId === null || e.trackId === assignment.trackId)
    .filter((e) => isAssignedTo(assignment.id, e.participantId, recipients))
    .map((e) => e.participantId);
}

// ---------- learner grouping for My Assignments ----------
export type AssignmentGroup = 'overdue' | 'upcoming' | 'submitted' | 'graded';
export const GROUP_ORDER: readonly AssignmentGroup[] = ['overdue', 'upcoming', 'submitted', 'graded'];
export const GROUP_LABEL: Record<AssignmentGroup, string> = { overdue: 'Overdue', upcoming: 'Upcoming', submitted: 'Submitted', graded: 'Graded' };

/** Work returned for revision is still the learner's job, so it sits with Upcoming. */
export function assignmentGroup(state: LearnerState): AssignmentGroup {
  switch (state) {
    case 'overdue': return 'overdue';
    case 'to_do': case 'returned': return 'upcoming';
    case 'submitted': case 'late': return 'submitted';
    default: return 'graded';
  }
}

export interface GroupableItem { state: LearnerState; dueAt: string | null; submittedAt: string | null }

const dueTime = (x: GroupableItem) => (x.dueAt === null ? Number.POSITIVE_INFINITY : new Date(x.dueAt).getTime());
const subTime = (x: GroupableItem) => (x.submittedAt === null ? 0 : new Date(x.submittedAt).getTime());

/** Overdue and upcoming: soonest deadline first (no deadline last). Submitted and graded: most recent first. */
export function groupAssignments<T extends GroupableItem>(items: readonly T[]): Record<AssignmentGroup, T[]> {
  const out: Record<AssignmentGroup, T[]> = { overdue: [], upcoming: [], submitted: [], graded: [] };
  for (const it of items) out[assignmentGroup(it.state)].push(it);
  out.overdue.sort((a, b) => dueTime(a) - dueTime(b));
  out.upcoming.sort((a, b) => dueTime(a) - dueTime(b));
  out.submitted.sort((a, b) => subTime(b) - subTime(a));
  out.graded.sort((a, b) => subTime(b) - subTime(a));
  return out;
}

export function countGroups<T extends GroupableItem>(items: readonly T[]): Record<AssignmentGroup, number> {
  const g = groupAssignments(items);
  return { overdue: g.overdue.length, upcoming: g.upcoming.length, submitted: g.submitted.length, graded: g.graded.length };
}
