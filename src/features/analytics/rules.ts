export type Period = '7d' | '30d' | '12m';
export const PERIOD_LABEL: Record<Period, string> = { '7d': 'Last 7 days (weekly)', '30d': 'Last 30 days (monthly)', '12m': 'Last 12 months (annual)' };

/** Inclusive start and exclusive end, as Dates. */
export function periodRange(p: Period, now: Date): { from: Date; to: Date } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = p === '7d' ? new Date(to.getFullYear(), to.getMonth(), to.getDate() - 7)
    : p === '30d' ? new Date(to.getFullYear(), to.getMonth(), to.getDate() - 30) : new Date(to.getFullYear(), to.getMonth() - 12, to.getDate());
  return { from, to };
}

/** Percentage with one decimal, or null when there is nothing to divide by (never a made-up 0). */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Present and late count as attended; excused is left out; absent counts against. Matches the attendance views (draft rule). */
export function attendanceRate(rows: readonly { status: string }[]): number | null {
  const attended = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  const absent = rows.filter((r) => r.status === 'absent').length;
  return percent(attended, attended + absent);
}

export function scorePercent(score: number | null, max: number | null): number | null {
  if (score === null || max === null || max <= 0) return null;
  return Math.round((score / max) * 1000) / 10;
}

export function average(values: readonly (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

/** Retention = share of everyone ever enrolled who has not withdrawn; dropout is the rest. */
export function retention(total: number, withdrawn: number): { retention: number | null; dropout: number | null } {
  return { retention: percent(total - withdrawn, total), dropout: percent(withdrawn, total) };
}

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** Counts per calendar month between from (inclusive) and to (exclusive), with empty months included so charts have no gaps. */
export function countByMonth(dates: readonly Date[], from: Date, to: Date): { month: string; count: number }[] {
  const out = new Map<string, number>();
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.set(key(d), 0);
  for (const d of dates) if (d >= from && d < to) out.set(key(d), (out.get(key(d)) ?? 0) + 1);
  return [...out].map(([month, count]) => ({ month, count }));
}

export const display = (v: number | null, suffix = ''): string => (v === null ? 'No data' : `${v}${suffix}`);
