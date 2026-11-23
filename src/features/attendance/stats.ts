import type { AttendanceStatus } from '@/types/database';

export interface AttendanceRules {
  /** Late arrivals count as attended. DRAFT default; needs programme approval. */
  lateCountsAsAttended: boolean;
  /** How excused absences affect the rate. DRAFT default: removed from the denominator. */
  excused: 'excluded' | 'absent' | 'attended';
}
export const DRAFT_ATTENDANCE_RULES: AttendanceRules = { lateCountsAsAttended: true, excused: 'excluded' };

/** Returns a percentage 0-100, or null when there is nothing to measure (never 0% for "no data"). */
export function attendanceRate(records: readonly AttendanceStatus[], rules: AttendanceRules = DRAFT_ATTENDANCE_RULES): number | null {
  let attended = 0;
  let counted = 0;
  for (const r of records) {
    if (r === 'excused') {
      if (rules.excused === 'excluded') continue;
      counted += 1;
      if (rules.excused === 'attended') attended += 1;
      continue;
    }
    counted += 1;
    if (r === 'present' || (r === 'late' && rules.lateCountsAsAttended)) attended += 1;
  }
  if (counted === 0) return null;
  return Math.round((attended / counted) * 1000) / 10;
}
