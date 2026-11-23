import type { DataQuality, MeRecord } from '@/types/database';

/** Percentage of target reached, or null when there is no value or no usable target. Never 0 for missing data. */
export function achievementPercent(value: number | null, target: number | null): number | null {
  if (value === null || target === null || target === 0) return null;
  return Math.round((value / target) * 1000) / 10;
}

export function validateRecord(input: { quality: DataQuality; value: string }): { value: number | null; error: string | null } {
  if (input.quality === 'missing') return { value: null, error: input.value.trim() ? 'Leave the value empty when the data is missing.' : null };
  const trimmed = input.value.trim();
  if (!trimmed) return { value: null, error: 'Enter a value, or mark the data as missing.' };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, error: 'The value must be a number.' };
  return { value: n, error: null };
}

/** Most recent record per indicator (by recorded date; later rows win ties). */
export function latestByIndicator(records: readonly MeRecord[]): Map<string, MeRecord> {
  const out = new Map<string, MeRecord>();
  for (const r of records) {
    const cur = out.get(r.indicator_id);
    if (!cur || r.recorded_on >= cur.recorded_on) out.set(r.indicator_id, r);
  }
  return out;
}

/** A spreadsheet treats text starting with = + - @ as a formula; prefix it so exported text stays text. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
