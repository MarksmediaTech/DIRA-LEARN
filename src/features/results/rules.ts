import type { AttendanceStatus, SubmissionStatus } from '@/types/database';
import { attendanceRate } from '@/features/attendance/stats';
import { DRAFT_WEIGHTS, overallPercent, type WeightedComponent } from '@/features/grading/scoring';
import { latestAttempt, percentOf } from '@/features/assignments/rules';

// DRAFT rules from the curriculum docx ("recommendations for management approval, not approved policy").
// Nothing here applies a pass mark: none has been approved. Results are provisional until management approves.

export type AssessmentComponent = 'task' | 'final_project' | 'reflection';
export const COMPONENT_LABEL: Record<AssessmentComponent, string> = {
  task: 'Session task', final_project: 'Final project', reflection: 'Reflection and 30-day plan',
};

export interface CompletionRules { minSessions: number; of: number; requireCore: boolean }
export const DRAFT_COMPLETION_RULES: CompletionRules = { minSessions: 6, of: 8, requireCore: true };

export interface AssignmentInput { id: string; component: AssessmentComponent; maxScore: number | null }
export interface SubmissionInput { assignmentId: string; attempt: number; status: SubmissionStatus; score: number | null }

export interface ComponentResult {
  /** Mean percentage of graded, scored work, or null when nothing has been graded yet. */
  percent: number | null;
  /** Scored assignments that are graded / all scored assignments for this component. */
  graded: number;
  total: number;
  /** True when some scored work has not been graded yet, so the figure may still move. */
  partial: boolean;
}

/** Only assignments with a maximum score count: feedback-only assignments carry no mark. */
export function componentResult(component: AssessmentComponent, assignments: readonly AssignmentInput[], subs: readonly SubmissionInput[]): ComponentResult {
  const scored = assignments.filter((a) => a.component === component && a.maxScore !== null);
  const percents: number[] = [];
  for (const a of scored) {
    const last = latestAttempt(subs.filter((s) => s.assignmentId === a.id));
    if (last && last.status === 'graded') {
      const p = percentOf(last.score, a.maxScore);
      if (p !== null) percents.push(p);
    }
  }
  const percent = percents.length ? Math.round((percents.reduce((x, y) => x + y, 0) / percents.length) * 10) / 10 : null;
  return { percent, graded: percents.length, total: scored.length, partial: percents.length < scored.length };
}

export interface ResultSummary {
  engagement: number | null;
  tasks: ComponentResult;
  finalProject: ComponentResult;
  reflection: ComponentResult;
  /** Weighted overall percentage, or null while any component has nothing scored. Never shown as 0 for missing data. */
  overall: number | null;
  /** True when the overall exists but some scored work is still ungraded. */
  provisional: boolean;
  /** Human-readable reasons there is no overall yet. */
  missing: string[];
}

export function summariseResult(input: { attendance: readonly AttendanceStatus[]; assignments: readonly AssignmentInput[]; submissions: readonly SubmissionInput[] }): ResultSummary {
  const engagement = attendanceRate(input.attendance);
  const tasks = componentResult('task', input.assignments, input.submissions);
  const finalProject = componentResult('final_project', input.assignments, input.submissions);
  const reflection = componentResult('reflection', input.assignments, input.submissions);

  const missing: string[] = [];
  if (engagement === null) missing.push('No attendance recorded yet');
  if (tasks.percent === null) missing.push(tasks.total ? 'No session task graded yet' : 'No scored session task set up');
  if (finalProject.percent === null) missing.push(finalProject.total ? 'Final project not graded yet' : 'No scored final project set up');
  if (reflection.percent === null) missing.push(reflection.total ? 'Reflection not graded yet' : 'No scored reflection set up');

  const components: WeightedComponent[] = [
    { key: 'engagement', weight: DRAFT_WEIGHTS.engagement, score: engagement, max: 100 },
    { key: 'tasks_portfolio', weight: DRAFT_WEIGHTS.tasks_portfolio, score: tasks.percent, max: 100 },
    { key: 'final_project', weight: DRAFT_WEIGHTS.final_project, score: finalProject.percent, max: 100 },
    { key: 'reflection_action_plan', weight: DRAFT_WEIGHTS.reflection_action_plan, score: reflection.percent, max: 100 },
  ];
  const overall = overallPercent(components);
  return { engagement, tasks, finalProject, reflection, overall, provisional: overall !== null && (tasks.partial || finalProject.partial || reflection.partial), missing };
}

export interface AttendedSession { curriculumSessionId: string; isCore: boolean; status: AttendanceStatus }
export interface CompletionCheck { key: string; label: string; ok: boolean }
export interface CompletionResult { checks: CompletionCheck[]; allMet: boolean }

/**
 * Draft completion requirements: attend at least 6 of 8 sessions including both core sessions, and submit the final
 * project and the reflection. "Attended" = present or late (excused does not count: no make-up arrangement is modelled).
 * A session run more than once counts once.
 */
export function completionChecks(input: {
  sessions: readonly AttendedSession[];
  coreSessionCount: number;
  finalProjectSubmitted: boolean;
  reflectionSubmitted: boolean;
  rules?: CompletionRules;
}): CompletionResult {
  const rules = input.rules ?? DRAFT_COMPLETION_RULES;
  const attended = new Map<string, boolean>();
  for (const s of input.sessions) if (s.status === 'present' || s.status === 'late') attended.set(s.curriculumSessionId, s.isCore);
  const total = attended.size;
  const core = [...attended.values()].filter(Boolean).length;
  const checks: CompletionCheck[] = [
    { key: 'sessions', label: `Attended at least ${rules.minSessions} of ${rules.of} sessions (${total} so far)`, ok: total >= rules.minSessions },
  ];
  if (rules.requireCore) checks.push({ key: 'core', label: `Attended both core sessions (${core} of ${input.coreSessionCount})`, ok: input.coreSessionCount > 0 && core >= input.coreSessionCount });
  checks.push({ key: 'final', label: 'Submitted the final project', ok: input.finalProjectSubmitted });
  checks.push({ key: 'reflection', label: 'Submitted the reflection and 30-day plan', ok: input.reflectionSubmitted });
  return { checks, allMet: checks.every((c) => c.ok) };
}

export const fmtPercent = (p: number | null): string => (p === null ? '–' : `${p}%`);
