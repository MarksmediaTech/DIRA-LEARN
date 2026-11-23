// Learning-access helpers for instant feedback in the UI. The database function learner_access_state() and the restrictive
// row level security policies (migration 20260101000018) are the real enforcement; keep the labels and meanings in step.

import { formatInZone, isoToZonedLocal, zonedLocalToIso } from '../../lib/timezone';

// Only these roles may extend, shorten or suspend access and set a cohort's access times (must match can_manage_learner_access() in the database).
export const ACCESS_MANAGER_ROLES: readonly string[] = ['super_admin', 'founder', 'co_founder', 'programme_director'];
export const canManageAccess = (role: string | null | undefined): boolean => !!role && ACCESS_MANAGER_ROLES.includes(role);

export type AccessStatus = 'pending' | 'scheduled' | 'active' | 'expired' | 'suspended';

export const ACCESS_LABEL: Record<AccessStatus, string> = {
  pending: 'Pending', scheduled: 'Scheduled', active: 'Active', expired: 'Expired', suspended: 'Suspended',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO timestamp to the value a <input type="datetime-local"> expects: programme time zone when given, else the browser's. */
export function isoToLocalInput(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '';
  if (tz) return isoToZonedLocal(iso, tz);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An empty or invalid datetime-local value means "not set" (null); otherwise an ISO string. */
export function optionalLocalToIso(v: string | null | undefined, tz?: string): string | null {
  if (!v || !v.trim()) return null;
  if (tz) return zonedLocalToIso(v, tz);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Returns an error message, or null when the window is acceptable. Either end may be empty. */
export function validateAccessWindow(opens: string | null | undefined, closes: string | null | undefined): string | null {
  const o = optionalLocalToIso(opens);
  const c = optionalLocalToIso(closes);
  if (o && c && new Date(c) <= new Date(o)) return 'Access must close after it opens.';
  return null;
}

/** A plain sentence for the learner. Times are shown in the programme time zone when one is given. */
export function describeAccess(status: AccessStatus, opensAt: string | null, closesAt: string | null, tz?: string): string {
  const fmt = (iso: string) => (tz ? formatInZone(iso, tz) : new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  switch (status) {
    case 'active': return closesAt ? `Your learning access is open until ${fmt(closesAt)}.` : 'Your learning access is open.';
    case 'scheduled': return opensAt ? `Your learning access opens on ${fmt(opensAt)}. Until then you can sign in, but programme materials stay closed.` : 'Your learning access is scheduled.';
    case 'expired': return closesAt ? `Your learning access ended on ${fmt(closesAt)}. You can still view your results and certificate. Contact the programme team if you need more time.` : 'Your learning access has ended. You can still view your results and certificate. Contact the programme team if you need more time.';
    case 'suspended': return 'Your learning access is paused. Please contact the programme team.';
    default: return 'Your learning access has not been scheduled yet. The programme team will tell you when it opens.';
  }
}

/** The one status a learner should be told about: open access wins; otherwise the most useful explanation. */
export function headlineAccess<T extends { status: AccessStatus }>(rows: T[]): T | null {
  const order: AccessStatus[] = ['active', 'scheduled', 'suspended', 'expired', 'pending'];
  for (const s of order) { const hit = rows.find((r) => r.status === s); if (hit) return hit; }
  return null;
}
