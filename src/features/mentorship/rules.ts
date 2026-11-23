export const MAX_ACTION_POINTS = 20;
export const MAX_ACTION_POINT_LENGTH = 300;

/** One action point per line; blank lines and surrounding spaces are dropped. */
export function parseActionPoints(text: string): { points: string[]; error: string | null } {
  const points = text.split(/\r?\n/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  if (points.length > MAX_ACTION_POINTS) return { points: [], error: `Use at most ${MAX_ACTION_POINTS} action points.` };
  if (points.some((p) => p.length > MAX_ACTION_POINT_LENGTH)) return { points: [], error: `Keep each action point under ${MAX_ACTION_POINT_LENGTH} characters.` };
  return { points, error: null };
}

export const actionPointsToText = (points: readonly string[]): string => points.join('\n');

/** Dates are plain yyyy-mm-dd strings, compared as text (which sorts correctly for ISO dates). */
export function validateMentoringSession(input: { heldOn: string; summary: string }, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.heldOn)) return 'Choose the date of the session.';
  if (input.heldOn > today) return 'A session cannot be dated in the future. Log it after it happens.';
  if (input.summary.trim().length < 5) return 'Write a short summary of the session.';
  return null;
}

export function lastSessionDate(dates: readonly string[]): string | null {
  return dates.length ? [...dates].sort().at(-1) ?? null : null;
}
