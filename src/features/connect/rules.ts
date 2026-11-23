// DIRA Connect rules. The database (migration 22) decides who may read, post, report and moderate; these give instant feedback.

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 500;

/** Must match the check constraint on connect_reports.reason. */
export const REPORT_REASONS = [
  { value: 'bullying_or_harassment', label: 'Bullying or harassment' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'personal_information', label: 'Sharing personal information' },
  { value: 'safety_concern', label: 'I am worried about someone\'s safety' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

export function validateMessage(body: string): string | null {
  const t = body.trim();
  if (!t) return 'Write a message first.';
  if (t.length > MAX_MESSAGE_LENGTH) return `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`;
  return null;
}

export function validateReport(reason: string, note: string): string | null {
  if (!REPORT_REASONS.some((r) => r.value === reason)) return 'Choose a reason.';
  if (note.length > MAX_NOTE_LENGTH) return `The note can be at most ${MAX_NOTE_LENGTH} characters.`;
  return null;
}

export const validateOversightReason = (text: string): string | null => (text.trim().length >= 10 ? null : 'Write a reason of at least 10 characters. It is recorded.');
export const validateMuteReason = (text: string): string | null => (text.trim().length >= 5 ? null : 'Write a reason of at least 5 characters.');

/** Learners start conversations with their facilitators, and facilitators with their learners (decision of 19 Nov 2026). */
export const canStartPrivate = (role: string | null | undefined): boolean => role === 'participant' || role === 'trainer';
/** Learners and facilitators write; executives oversee cohort discussions read-only. */
export const canCompose = (role: string | null | undefined): boolean => role === 'participant' || role === 'trainer';

export interface ThreadLike { unread: number | string | null }
export function totalUnread(threads: readonly ThreadLike[]): number {
  return threads.reduce((n, t) => n + Number(t.unread ?? 0), 0);
}

export interface MessageLike { created_at: string }

/** Oldest first, grouped by calendar day in the given time zone. The server returns newest first. */
export function groupByDay<T extends MessageLike>(messages: readonly T[], tz: string): { day: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const ordered = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const out: { day: string; items: T[] }[] = [];
  for (const m of ordered) {
    const day = fmt.format(new Date(m.created_at));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(m); else out.push({ day, items: [m] });
  }
  return out;
}

export const MUTE_CHOICES = [{ label: '1 day', days: 1 }, { label: '7 days', days: 7 }] as const;
export const muteUntilIso = (days: number, now: Date = new Date()): string => new Date(now.getTime() + days * 86_400_000).toISOString();

// ---------- escalation (migration 24) ----------
export const URGENCY_CHOICES = [
  { value: 'urgent', label: 'Urgent: someone may be at risk now' },
  { value: 'standard', label: 'Standard: acknowledge within 24 hours' },
] as const;
export type Urgency = (typeof URGENCY_CHOICES)[number]['value'];

// ---------- attachments (migration 25) ----------
/** Must match connect_allowed_mime() and the connect-attachments bucket. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG image',
  'image/png': 'PNG image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint presentation',
};
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;

export interface FileLike { name: string; size: number; type: string }

/** Instant feedback only; the database re-checks the real stored type and size. */
export function validateAttachments(files: readonly FileLike[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `You can attach at most ${MAX_ATTACHMENTS} files to one message.`;
  for (const f of files) {
    if (!ATTACHMENT_TYPES[f.type]) return `${f.name}: only PDF, Word, Excel, PowerPoint, JPG and PNG files can be attached.`;
    if (f.size <= 0) return `${f.name} is empty.`;
    if (f.size > MAX_ATTACHMENT_BYTES) return `${f.name} is larger than 10 MB.`;
  }
  return null;
}

/** A file name that is safe in a storage path: letters, digits, dot, dash and underscore only, at most 100 characters. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
  const trimmed = cleaned.slice(-100);
  return trimmed || 'file';
}

/** Storage path rule enforced by the database: <conversation>/<uploader>/<unique>-<name>. */
export const attachmentPath = (conversationId: string, userId: string, unique: string, name: string): string =>
  `${conversationId}/${userId}/${unique}-${safeFileName(name)}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const isImageType = (mime: string): boolean => mime === 'image/jpeg' || mime === 'image/png';

// ---------- links ----------
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; text: string; host: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/**
 * Splits message text into plain text and safe links. Only http(s) addresses become links (never javascript:, data: or
 * other schemes), trailing punctuation is left out, and the host is returned so the screen can show where a link goes.
 */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    while (/[.,;:!?)\]]$/.test(raw)) raw = raw.slice(0, -1);
    const start = m.index ?? 0;
    let url: URL | null = null;
    try { url = new URL(raw); } catch { url = null; }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) continue;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'link', href: url.href, text: raw, host: url.hostname });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// ---------- virus checks (migration 29) ----------
export type ScanStatus = 'pending' | 'scanning' | 'clean' | 'infected' | 'scan_failed' | 'not_scanned';
/** Only a file a scanner has marked clean can be downloaded (the database enforces this too). */
export const canDownload = (scan: string): boolean => scan === 'clean';
export function scanLabel(scan: string): string {
  switch (scan) {
    case 'clean': return 'Checked for viruses';
    case 'infected': return 'Blocked: a virus was found';
    case 'scan_failed': return 'Could not be checked, so it cannot be opened';
    default: return 'Waiting for a virus check before it can be opened';
  }
}
