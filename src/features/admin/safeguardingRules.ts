// Safeguarding screen rules (migration 24). The database decides who may read and change records; these give instant feedback.

export const SG_STATUSES = ['open', 'acknowledged', 'in_progress', 'referred', 'resolved', 'closed', 'under_review'] as const;
export type SgStatus = (typeof SG_STATUSES)[number];

export const SG_STATUS_LABEL: Record<SgStatus, string> = {
  open: 'Open: not yet acknowledged',
  acknowledged: 'Acknowledged',
  in_progress: 'Action in progress',
  referred: 'Referred to an outside agency',
  resolved: 'Resolved',
  closed: 'Closed',
  under_review: 'Under review (older record)',
};

/** Statuses an officer can move a record to. "Open" is only the starting state; "under review" exists only on older records. */
export const SG_NEXT_STATUSES: readonly SgStatus[] = ['acknowledged', 'in_progress', 'referred', 'resolved', 'closed'];

export const URGENCY_LABEL = { urgent: 'Urgent', standard: 'Standard' } as const;

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Recorded by an officer',
  raised_by_staff: 'Raised by staff, a facilitator or a mentor',
  connect_report: 'Escalated from a DIRA Connect report',
  connect_safety_report: 'DIRA Connect safety-concern report',
};

export const POSITION_LABEL = { lead: 'Safeguarding Lead', deputy: 'Safeguarding Deputy' } as const;

/** What sg_my_position() can return: an appointed position, or 'interim' for an active Super Administrator while no
 *  Safeguarding Lead or Deputy is appointed (owner decision 21 Nov 2026, migration 39). */
export type MyPosition = keyof typeof POSITION_LABEL | 'interim';
export function myPositionText(p: MyPosition): string {
  return p === 'interim' ? 'interim access as Super Administrator, until a Safeguarding Lead or Deputy is appointed' : `the ${POSITION_LABEL[p]}`;
}

/** Roles that can raise a concern on the Safeguarding page (must match sg_raise_concern()). */
export const CONCERN_ROLES = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor', 'me_officer'] as const;
export const canRaiseConcern = (role: string | null | undefined): boolean => (CONCERN_ROLES as readonly string[]).includes(role ?? '');
/** Roles an executive can appoint as Lead or Deputy (must match sg_appoint()). */
export const OFFICER_ELIGIBLE_ROLES = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'] as const;

export interface AckInfo { acknowledged_at: string | null; ack_due_at: string | null; status: string }
export type AckState = { state: 'acknowledged' } | { state: 'none' } | { state: 'due'; minutesLeft: number } | { state: 'overdue'; minutesLate: number };

/** Where a record stands against its acknowledgement target. */
export function ackState(r: AckInfo, now: Date = new Date()): AckState {
  if (r.acknowledged_at || r.status !== 'open') return { state: 'acknowledged' };
  if (!r.ack_due_at) return { state: 'none' };
  const diff = Math.round((new Date(r.ack_due_at).getTime() - now.getTime()) / 60_000);
  return diff >= 0 ? { state: 'due', minutesLeft: diff } : { state: 'overdue', minutesLate: -diff };
}

export function describeMinutes(mins: number): string {
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}

export function ackText(a: AckState): string {
  switch (a.state) {
    case 'acknowledged': return 'Acknowledged';
    case 'none': return 'No acknowledgement target (older record)';
    case 'due': return `Acknowledge within ${describeMinutes(a.minutesLeft)}`;
    case 'overdue': return `Acknowledgement target missed by ${describeMinutes(a.minutesLate)}`;
  }
}

const minLen = (n: number, what: string) => (t: string): string | null => (t.trim().length >= n ? null : `${what} must be at least ${n} characters.`);
export const validateConcern = minLen(20, 'The description');
export const validateAppointmentReason = minLen(10, 'The reason');
export const validateExceptionalReason = minLen(20, 'The reason');
export const validateReadReason = minLen(10, 'The reason');
export const validateHoldReason = minLen(10, 'The reason');

/** Records needing attention first: overdue, then urgent and unacknowledged, then newest. */
export function sortForOfficer<T extends AckInfo & { urgency: string; created_at: string }>(rows: readonly T[], now: Date = new Date()): T[] {
  const rank = (r: T) => { const a = ackState(r, now); return a.state === 'overdue' ? 0 : a.state === 'due' && r.urgency === 'urgent' ? 1 : a.state === 'due' ? 2 : 3; };
  return [...rows].sort((x, y) => rank(x) - rank(y) || new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
}
