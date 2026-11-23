import type { RoleCode } from '@/types/database';

// Matches the database: content writes are super admin + coordinator (RLS); approval is super admin + programme director.
export const canEditCurriculum = (r: RoleCode) => r === 'super_admin' || r === 'founder' || r === 'co_founder' || r === 'programme_coordinator';
export const canApproveCurriculum = (r: RoleCode) => r === 'super_admin' || r === 'founder' || r === 'co_founder' || r === 'programme_director';

/** Textarea text (one item per line) to a clean array. */
export const linesToArray = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
export const arrayToLines = (items: readonly string[] | null | undefined): string => (items ?? []).join('\n');

export interface SessionDraft {
  title: string; description: string; weekNo: number; sessionNo: number; durationMinutes: number;
  objectives: string; activities: string; topics: string; expectedOutput: string; assessmentNotes: string;
}

/** Returns field-keyed problems; an empty object means valid. */
export function validateSessionDraft(d: SessionDraft): Partial<Record<keyof SessionDraft, string>> {
  const e: Partial<Record<keyof SessionDraft, string>> = {};
  if (d.title.trim().length < 3) e.title = 'Enter a title of at least 3 characters';
  if (!Number.isInteger(d.weekNo) || d.weekNo < 1 || d.weekNo > 4) e.weekNo = 'Week must be 1 to 4';
  if (!Number.isInteger(d.sessionNo) || d.sessionNo < 1 || d.sessionNo > 8) e.sessionNo = 'Session number must be 1 to 8';
  if (!Number.isInteger(d.durationMinutes) || d.durationMinutes < 1 || d.durationMinutes > 120) e.durationMinutes = 'Duration must be 1 to 120 minutes';
  if (linesToArray(d.objectives).length === 0) e.objectives = 'Add at least one learning objective';
  return e;
}

export interface Row { id: string; track_id: string | null; session_no: number }
/** True if another session in the same track (or the core set) already uses this number. */
export function sessionNumberTaken(rows: readonly Row[], trackId: string | null, sessionNo: number, ignoreId?: string): boolean {
  return rows.some((r) => r.id !== ignoreId && r.track_id === trackId && r.session_no === sessionNo);
}
