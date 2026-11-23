// Programme time zone helpers (no libraries). Access times are stored as exact moments (timestamptz); the programme time zone
// only decides how they are typed in, shown, and written in emails. The default matches the existing reminder emails.

export const DEFAULT_TIME_ZONE = 'Africa/Nairobi';

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Offset (ms) of a time zone from UTC at a given instant: positive east of Greenwich. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2027-01-11T08:00" typed in the programme time zone to an ISO instant. Null when empty or invalid. */
export function zonedLocalToIso(local: string | null | undefined, tz: string): string | null {
  if (!local || !local.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  let result = guess - offsetMs(guess, tz);
  result = guess - offsetMs(result, tz);   // second pass settles daylight-saving boundaries
  const out = new Date(result);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant to the "YYYY-MM-DDTHH:mm" value a datetime-local input expects, as wall-clock time in the programme zone. */
export function isoToZonedLocal(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const shifted = new Date(t + offsetMs(t, tz));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** A readable date and time in the programme time zone. */
export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return 'not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'not set';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
}

/** Zones for a picker. Falls back to a short list where the browser cannot enumerate them. */
export function listTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof fn === 'function') {
    try {
      const all = fn('timeZone');
      // Some browsers leave out UTC or the programme default; the picker must always offer both.
      if (all.length) return Array.from(new Set([DEFAULT_TIME_ZONE, ...all, 'UTC'])).sort();
    } catch { /* fall through */ }
  }
  return [DEFAULT_TIME_ZONE, 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Lagos', 'Africa/Johannesburg', 'Europe/London', 'UTC'];
}

/** Today's calendar date ("YYYY-MM-DD") and hour (0-23) in the programme time zone. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function hourInZone(tz: string, now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }).formatToParts(now).find((p) => p.type === 'hour')?.value;
  return Number(h ?? 0);
}
