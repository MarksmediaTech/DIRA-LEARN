import type { EmailStatus } from '@/types/database';

/** Placeholders a bulk send can fill for every recipient. System templates may use more (session, assignment, notification). */
export const BULK_VARS = ['first_name', 'last_name', 'cohort_name', 'programme_name'] as const;
export const SYSTEM_VARS: Record<string, readonly string[]> = {
  notification: ['first_name', 'last_name', 'title', 'body'],
  session_reminder: ['first_name', 'last_name', 'session_title', 'session_date', 'session_time', 'session_mode', 'session_place', 'cohort_name'],
  assignment_reminder: ['first_name', 'last_name', 'assignment_title', 'due_date', 'cohort_name'],
};

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1]!))];
}

/** Placeholders that are malformed or not available. The database also refuses an unresolved placeholder at send time. */
export function unknownPlaceholders(text: string, allowed: readonly string[]): string[] {
  return placeholders(text).filter((p) => !/^[a-z_]+$/.test(p) || !allowed.includes(p));
}

export function validateTemplate(input: { key: string; name: string; subject: string; body: string }, allowed: readonly string[], isNew: boolean): string | null {
  if (isNew && !/^[a-z][a-z0-9_]{2,40}$/.test(input.key)) return 'The key must be 3 to 41 characters: lower-case letters, digits and underscores, starting with a letter.';
  if (input.name.trim().length < 3) return 'Give the template a name.';
  if (input.subject.trim().length < 3 || input.subject.length > 200) return 'The subject must be 3 to 200 characters.';
  if (input.body.trim().length < 3 || input.body.length > 10000) return 'The message must be 3 to 10,000 characters.';
  const bad = [...unknownPlaceholders(input.subject, allowed), ...unknownPlaceholders(input.body, allowed)];
  if (bad.length) return `These placeholders are not available here: ${[...new Set(bad)].map((b) => `{{${b}}}`).join(', ')}. Available: ${allowed.map((a) => `{{${a}}}`).join(', ')}.`;
  return null;
}

export const STATUS_LABEL: Record<EmailStatus, string> = {
  queued: 'Queued', sending: 'Sending', sent: 'Sent to provider', delivered: 'Delivered', bounced: 'Bounced', complained: 'Marked as spam', failed: 'Failed', cancelled: 'Cancelled',
};

/** Delivered counts only emails the provider confirmed; "sent" means handed over, not yet confirmed. */
export function summarise(rows: readonly { status: EmailStatus }[]): Record<EmailStatus, number> {
  const out = { queued: 0, sending: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, cancelled: 0 } as Record<EmailStatus, number>;
  for (const r of rows) out[r.status]++;
  return out;
}

/** Combine a date and a time (both local) into an ISO instant, or null when empty. Refuses past times. */
export function scheduleInstant(date: string, time: string, now: Date): { iso: string | null; error: string | null } {
  if (!date && !time) return { iso: null, error: null };
  if (!date || !time) return { iso: null, error: 'Choose both a date and a time, or leave both empty to send as soon as possible.' };
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return { iso: null, error: 'That date and time is not valid.' };
  if (d.getTime() < now.getTime() - 5 * 60_000) return { iso: null, error: 'The scheduled time is in the past.' };
  return { iso: d.toISOString(), error: null };
}
