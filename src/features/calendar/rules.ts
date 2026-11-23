export type ItemKind = 'session' | 'assignment' | 'cohort_start' | 'cohort_end';
export interface CalendarItem {
  id: string; kind: ItemKind; title: string; start: Date; end: Date | null; allDay: boolean;
  detail?: string; mode?: string; url?: string | null; cancelled?: boolean;
}
export type View = 'day' | 'week' | 'month';

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Weeks start on Monday. */
export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** Month grid as full weeks (Monday first) covering the month. */
export function monthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks: Date[][] = [];
  for (let w = startOfWeek(first); w <= last; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  return weeks;
}

/** First day (inclusive) and day after the last (exclusive) of the visible range. */
export function visibleRange(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  if (view === 'week') { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 7) }; }
  const g = monthGrid(anchor); return { from: g[0]![0]!, to: addDays(g.at(-1)![6]!, 1) };
}

export function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

export function itemsOn(items: readonly CalendarItem[], day: Date): CalendarItem[] {
  return items.filter((i) => sameDay(i.start, day)).sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** A join link is offered only for a session that is not cancelled, has a link, is online or hybrid, and has not ended. */
export function canJoin(i: CalendarItem, now: Date): boolean {
  if (i.kind !== 'session' || i.cancelled || !i.url || (i.mode !== 'online' && i.mode !== 'hybrid')) return false;
  return (i.end ?? i.start).getTime() >= now.getTime();
}

// ---------- .ics export ----------
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const icsEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded as RFC 5545 requires (continuation lines start with a space). */
export function foldLine(line: string): string {
  const enc = new TextEncoder(); const out: string[] = []; let cur = ''; let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curBytes = 0; }
    cur += ch; curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toIcs(items: readonly CalendarItem[], now: Date): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DIRA Foundation//DIRA Learn//EN', 'CALSCALE:GREGORIAN'];
  for (const i of items) {
    if (i.cancelled) continue;
    lines.push('BEGIN:VEVENT', `UID:${i.id}@dira-learn`, `DTSTAMP:${utc(now)}`);
    if (i.allDay) { lines.push(`DTSTART;VALUE=DATE:${dateOnly(i.start)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(i.start, 1))}`); }
    else { lines.push(`DTSTART:${utc(i.start)}`, `DTEND:${utc(i.end ?? new Date(i.start.getTime() + 3_600_000))}`); }
    lines.push(`SUMMARY:${icsEscape(i.title)}`);
    const desc = [i.detail, i.url ? `Link: ${i.url}` : ''].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
