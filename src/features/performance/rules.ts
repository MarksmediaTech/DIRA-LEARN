// Phase 6: individual learner performance. The database (migration 27) calculates the figures and decides who may see whom;
// these helpers only label, filter and export them. Weights and thresholds are DRAFT until management approves them.

export type CompletionStatus = 'in_progress' | 'requirements_met' | 'certified' | 'withdrawn';
export type SupportReason = 'attendance' | 'overdue_work' | 'work_returned' | 'low_score';

/** One row of learner_metrics(). Numbers arrive from PostgreSQL as numbers or numeric strings. */
export interface LearnerMetrics {
  participant_id: string; participant_no: string; display_name: string; track_id: string | null; track_name: string | null;
  participant_status: string; access_status: string;
  attendance_records: number; attendance_rate: number | string | null; sessions_attended: number; core_attended: number; core_total: number;
  assignments_expected: number; submitted: number; graded: number; returned: number; overdue: number; late: number;
  tasks_pct: number | string | null; tasks_graded: number; tasks_total: number;
  final_pct: number | string | null; final_graded: number; final_total: number;
  reflection_pct: number | string | null; reflection_graded: number; reflection_total: number;
  overall: number | string | null; provisional: boolean; final_submitted: boolean; reflection_submitted: boolean;
  completion_met: boolean; certified: boolean; completion_status: CompletionStatus; needs_support: boolean; support_reasons: SupportReason[] | null;
}

export interface Snapshot { taken_on: string; attendance_rate: number | string | null; overall: number | string | null; submitted: number; graded: number; overdue: number; completion_status: string; needs_support: boolean }

export const STATUS_LABEL: Record<CompletionStatus, string> = {
  in_progress: 'In progress', requirements_met: 'Requirements met (draft rules)', certified: 'Certificate issued', withdrawn: 'Withdrawn',
};
export const REASON_LABEL: Record<SupportReason, string> = {
  attendance: 'Attendance below the draft threshold', overdue_work: 'Overdue work', work_returned: 'Work returned for revision', low_score: 'Result below the draft threshold',
};

export const toNum = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
export const pct = (v: number | string | null | undefined): string => { const n = toNum(v); return n === null ? '–' : `${n}%`; };

export interface Filter { search: string; supportOnly: boolean; status: CompletionStatus | 'all'; trackId: string | 'all' }
export const EMPTY_FILTER: Filter = { search: '', supportOnly: false, status: 'all', trackId: 'all' };

export function applyFilter(rows: readonly LearnerMetrics[], f: Filter): LearnerMetrics[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => (!q || r.display_name.toLowerCase().includes(q) || r.participant_no.toLowerCase().includes(q))
    && (!f.supportOnly || r.needs_support)
    && (f.status === 'all' || r.completion_status === f.status)
    && (f.trackId === 'all' || r.track_id === f.trackId));
}

/** Learners who may need support first, then by name. */
export const sortRows = (rows: readonly LearnerMetrics[]): LearnerMetrics[] =>
  [...rows].sort((a, b) => Number(b.needs_support) - Number(a.needs_support) || a.display_name.localeCompare(b.display_name));

/** Change between the first and last snapshot (null when there is not enough history). */
export function trend(history: readonly Snapshot[], key: 'overall' | 'attendance_rate'): number | null {
  const vals = history.map((h) => toNum(h[key])).filter((v): v is number => v !== null);
  const first = vals[0]; const last = vals[vals.length - 1];
  if (vals.length < 2 || first === undefined || last === undefined) return null;
  return Math.round((last - first) * 10) / 10;
}

export function validateFeedback(body: string): string | null {
  const t = body.trim();
  if (t.length < 5) return 'Write at least a short sentence.';
  if (t.length > 2000) return 'Feedback can be at most 2000 characters.';
  return null;
}

/** A spreadsheet cell that cannot be read as a formula, quoted for CSV. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS: { key: keyof LearnerMetrics; label: string }[] = [
  { key: 'participant_no', label: 'Participant no' }, { key: 'display_name', label: 'Name' }, { key: 'track_name', label: 'Track' },
  { key: 'access_status', label: 'Learning access' }, { key: 'attendance_rate', label: 'Attendance %' }, { key: 'sessions_attended', label: 'Sessions attended' },
  { key: 'core_attended', label: 'Core sessions attended' }, { key: 'assignments_expected', label: 'Assignments' }, { key: 'submitted', label: 'Submitted' },
  { key: 'graded', label: 'Graded' }, { key: 'overdue', label: 'Overdue' }, { key: 'tasks_pct', label: 'Tasks %' }, { key: 'final_pct', label: 'Final project %' },
  { key: 'reflection_pct', label: 'Reflection %' }, { key: 'overall', label: 'Overall % (draft)' }, { key: 'provisional', label: 'Provisional' },
  { key: 'completion_status', label: 'Completion' }, { key: 'support_reasons', label: 'May need support' },
];

export function toCsv(rows: readonly LearnerMetrics[]): string {
  const head = CSV_COLUMNS.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => {
    const v = r[c.key];
    if (c.key === 'support_reasons') return csvCell((r.support_reasons ?? []).map((x) => REASON_LABEL[x] ?? x));
    if (c.key === 'completion_status') return csvCell(STATUS_LABEL[r.completion_status] ?? r.completion_status);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return csvCell(v);
  }).join(','));
  return [head, ...body].join('\r\n');
}

/** Who sees the cohort table, and who may give feedback (the database enforces the same). */
export const canSeeCohortTable = (role: string | null | undefined): boolean =>
  ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor'].includes(role ?? '');
export const canGiveFeedback = (role: string | null | undefined): boolean =>
  ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer'].includes(role ?? '');
export const canExport = canGiveFeedback;
