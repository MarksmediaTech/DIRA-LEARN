// Phase 7: Cohort Intelligence. Every figure comes from the database (migration 28, built on the Phase 6 calculation);
// these helpers only filter, compare and export.
import { csvCell, toNum } from '@/features/performance/rules';

export type Tab = 'intake' | 'compare' | 'facilitators' | 'learners' | 'support';
export const TAB_LABEL: Record<Tab, string> = { intake: 'Intake', compare: 'Cohorts and tracks', facilitators: 'Facilitators', learners: 'Learners', support: 'Support' };

/** Tabs each role may open (the database enforces the same: M&E officers get aggregates only). */
export function tabsFor(role: string | null | undefined): Tab[] {
  if (['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'].includes(role ?? '')) return ['intake', 'compare', 'facilitators', 'learners', 'support'];
  if (role === 'me_officer') return ['intake', 'compare', 'support'];
  return [];
}

export interface IntakeRow { cohort_id: string; cohort_name: string; intake_label: string | null; season: string | null; start_date: string; end_date: string;
  recruitment_opens_on: string | null; recruitment_closes_on: string | null; capacity: number; enrolled: number; withdrawn: number; fill_pct: number | string | null;
  tracks: { track: string; learners: number }[]; applications_in_window: number | null; accepted_in_window: number | null; rejected_in_window: number | null }
export interface CompareRow { cohort_id: string; cohort_name: string; track_id: string | null; track_name: string | null; level: 'cohort' | 'track'; start_date: string;
  learners: number; active_learners: number; withdrawn: number; avg_attendance: number | string | null; submission_rate: number | string | null; overdue: number;
  avg_tasks: number | string | null; avg_final: number | string | null; avg_overall: number | string | null; results_count: number;
  requirements_met: number; certified: number; completion_rate: number | string | null; needs_support: number }
export interface FacilitatorRow { trainer_id: string; trainer_name: string; cohort_id: string; cohort_name: string; sessions_scheduled: number; sessions_completed: number;
  sessions_cancelled: number; reports_filed: number; learners: number; avg_attendance: number | string | null; awaiting_grading: number;
  graded_with_time: number; avg_turnaround_hours: number | string | null; feedback_notes: number }
export interface SupportRow { cohort_id: string; cohort_name: string; learners: number; needs_support: number; low_attendance: number; with_overdue_work: number;
  with_returned_work: number; access_scheduled: number; access_expired: number; access_suspended: number; reports_open: number; reports_escalated: number;
  reports_closed: number; active_mutes: number; closed_access_support_messages_30d: number; feedback_notes: number }

/** Seasons and intakes present, for the filter lists. */
export const distinct = (values: readonly (string | null | undefined)[]): string[] =>
  [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) => a.localeCompare(b));

/** Mean of the cohort-level values that exist (null when none). */
export function meanOf(rows: readonly CompareRow[], key: 'avg_attendance' | 'submission_rate' | 'avg_overall' | 'completion_rate'): number | null {
  const v = rows.filter((r) => r.level === 'cohort').map((r) => toNum(r[key])).filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

/** How far a value sits from the average, in percentage points, for a plain-language label. */
export function versusAverage(value: number | string | null, average: number | null): { points: number; label: string } | null {
  const v = toNum(value);
  if (v === null || average === null) return null;
  const points = Math.round((v - average) * 10) / 10;
  return { points, label: points === 0 ? 'at the average' : `${Math.abs(points)} points ${points > 0 ? 'above' : 'below'} the average` };
}

/** Turnaround hours as readable text. */
export function hoursText(h: number | string | null): string {
  const n = toNum(h);
  if (n === null) return '–';
  if (n < 1) return 'under 1 hour';
  if (n < 48) return `${Math.round(n)} hours`;
  return `${Math.round(n / 24)} days`;
}

/** Any table to CSV, with formula-safe cells. */
export function tableCsv<T>(rows: readonly T[], columns: readonly { label: string; value: (r: T) => unknown }[]): string {
  return [columns.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))].join('\r\n');
}

export function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`; a.click();
  URL.revokeObjectURL(url);
}
