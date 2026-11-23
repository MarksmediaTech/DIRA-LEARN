import type { AttendanceStatus } from '@/types/database';

// Mirrors complete_session() in supabase/migrations/20260101000005_sessions_curriculum_admin.sql.
// The database is the authority; these rules give instant feedback.

export type Bucket = 'today' | 'upcoming' | 'past';
export interface TimedSession { startsAt: string; endsAt: string; status: string }

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today = any session that starts today (browser local time). Cancelled/rescheduled sessions are always 'past'. */
export function bucketFor(s: TimedSession, now: Date = new Date()): Bucket {
  if (s.status === 'cancelled' || s.status === 'rescheduled') return 'past';
  const start = new Date(s.startsAt);
  if (sameDay(start, now)) return 'today';
  return start > now ? 'upcoming' : 'past';
}

export interface RosterEntry { participantId: string; trackId: string | null }

/** Core sessions (no track) are for the whole cohort; a track session is for the participants who chose that track. */
export function expectedRoster<T extends RosterEntry>(enrolments: readonly T[], sessionTrackId: string | null): T[] {
  return sessionTrackId === null ? [...enrolments] : enrolments.filter((e) => e.trackId === sessionTrackId);
}

export function missingAttendance(roster: readonly RosterEntry[], marks: Readonly<Record<string, AttendanceStatus | undefined>>): string[] {
  return roster.filter((r) => !marks[r.participantId]).map((r) => r.participantId);
}

export interface CompleteCheck { status: string; startsAt: string; missingCount: number; hasUnsavedMarks: boolean; now?: Date }

/** Returns why the session cannot be completed yet, or null if it can. */
export function completeBlocker(c: CompleteCheck): string | null {
  if (c.status === 'completed') return 'This session is already completed';
  if (c.status !== 'scheduled') return `A ${c.status} session cannot be completed`;
  if (new Date(c.startsAt) > (c.now ?? new Date())) return 'This session has not started yet';
  if (c.hasUnsavedMarks) return 'Save attendance first';
  if (c.missingCount > 0) return `Attendance is missing for ${c.missingCount} participant${c.missingCount === 1 ? '' : 's'}`;
  return null;
}

export function summariseAttendance(marks: readonly AttendanceStatus[]): { present: number; late: number; excused: number; absent: number } {
  const out = { present: 0, late: 0, excused: 0, absent: 0 };
  for (const m of marks) out[m] += 1;
  return out;
}

export const RESOURCE_KINDS = ['document', 'presentation', 'video', 'link'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const MAX_RESOURCE_BYTES = 50 * 1024 * 1024;

export function validateResource(input: { title: string; kind: ResourceKind; url: string; file: { size: number } | null }): string | null {
  if (input.title.trim().length < 2) return 'Give the resource a title';
  if (!input.url.trim() && !input.file) return 'Add a link or choose a file';
  if (input.url.trim() && input.file) return 'Use either a link or a file, not both';
  if (input.url.trim() && !/^https?:\/\/\S+$/i.test(input.url.trim())) return 'Links must start with https://';
  if (input.file && input.file.size > MAX_RESOURCE_BYTES) return 'Files must be 50 MB or smaller';
  if (input.file && input.file.size === 0) return 'The file is empty';
  if (input.kind === 'link' && input.file) return 'A link resource cannot be a file';
  return null;
}

/** Safe object name for storage: strips path characters and keeps the extension. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').replace(/\.{2,}/g, '.');
  return cleaned.replace(/^\.+/, '') || 'file';
}
