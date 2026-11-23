// Scheduling and capacity rules used for instant feedback in the UI. The database triggers in
// 20260101000004_applications_cohorts.sql are the real enforcement; keep the two in step.

export interface CapacityInfo { capacity: number; enrolled: number }
export const seatsLeft = ({ capacity, enrolled }: CapacityInfo) => Math.max(0, capacity - enrolled);
export const isFull = (c: CapacityInfo) => c.enrolled >= c.capacity;

export interface Slot {
  id?: string; cohortId: string; trainerId: string | null; trackId: string | null;
  startsAt: string; endsAt: string; status: string;
}
export type ConflictKind = 'trainer' | 'cohort';
export interface Conflict { kind: ConflictKind; with: Slot }

const LIVE = new Set(['scheduled', 'completed']);
const overlaps = (a: Slot, b: Slot) => new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);

/** Trainer double-booking, and cohort clashes. Sessions for different tracks may run in parallel; core sessions may not. */
export function findConflicts(candidate: Slot, existing: Slot[]): Conflict[] {
  const out: Conflict[] = [];
  for (const s of existing) {
    if (!LIVE.has(s.status) || (candidate.id && s.id === candidate.id) || !overlaps(candidate, s)) continue;
    if (candidate.trainerId && s.trainerId === candidate.trainerId) out.push({ kind: 'trainer', with: s });
    if (s.cohortId === candidate.cohortId) {
      const parallelTracks = candidate.trackId && s.trackId && candidate.trackId !== s.trackId;
      if (!parallelTracks) out.push({ kind: 'cohort', with: s });
    }
  }
  return out;
}

export const MAX_SESSION_MINUTES = 120;

export interface ScheduleDraft { startsAt: string; endsAt: string; cohortStart: string; cohortEnd: string }

/** Returns a plain-English problem, or null if the draft is sensible. */
export function validateScheduleTimes(d: ScheduleDraft): string | null {
  const s = new Date(d.startsAt); const e = new Date(d.endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'Enter a start and end time';
  if (e <= s) return 'The end time must be after the start time';
  if ((e.getTime() - s.getTime()) / 60000 > MAX_SESSION_MINUTES) return 'Sessions can be at most 2 hours';
  const day = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (day(s) < d.cohortStart || day(s) > d.cohortEnd) return `The date must fall within the cohort dates (${d.cohortStart} to ${d.cohortEnd})`;
  return null;
}

/** Converts a <input type="datetime-local"> value (browser local time) to an ISO string. */
export const localToIso = (v: string) => new Date(v).toISOString();

/**
 * Track to preselect when staff place a participant in a cohort (23 Nov 2026): the track already saved on the participant record,
 * if it belongs to this cohort's programme. Otherwise nothing is preselected and the learner chooses later, as before.
 */
export function preselectTrack(savedTrackId: string | null | undefined, programmeTrackIds: readonly string[]): string {
  return savedTrackId && programmeTrackIds.includes(savedTrackId) ? savedTrackId : '';
}
