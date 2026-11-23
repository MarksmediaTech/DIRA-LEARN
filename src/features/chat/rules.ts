// Chat rules (22 Nov 2026). The database decides who may read, post, react, publish and download
// (supabase/pending/20261122000002_chat_notifications_calendar.sql); these give instant feedback and shared formatting.

/** The reaction emoji; must match chat_allowed_emoji() in the database. */
export const REACTIONS: readonly { emoji: string; label: string }[] = [
  { emoji: '👍', label: 'Thumbs up' }, { emoji: '❤️', label: 'Heart' }, { emoji: '😂', label: 'Laughing' }, { emoji: '😮', label: 'Surprised' },
  { emoji: '😢', label: 'Sad' }, { emoji: '🙏', label: 'Thank you' }, { emoji: '👏', label: 'Applause' }, { emoji: '🎉', label: 'Celebrate' },
  { emoji: '🔥', label: 'Fire' }, { emoji: '💯', label: 'Hundred' }, { emoji: '✅', label: 'Done' }, { emoji: '👀', label: 'Looking' },
  { emoji: '🤔', label: 'Thinking' }, { emoji: '💡', label: 'Idea' }, { emoji: '📌', label: 'Pinned' }, { emoji: '🙌', label: 'Raised hands' },
];
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🙏', '🎉'] as const;
export const isReaction = (e: string): boolean => REACTIONS.some((r) => r.emoji === e);

export type FileCategory = 'document' | 'image' | 'audio' | 'video';
export interface FileRule { category: FileCategory; label: string; maxBytes: number; ext: string }
const MB = 1024 * 1024;
/** Supported files and default limits; must match chat_file_rules (executives may lower limits there; the database decides). */
export const FILE_RULES: Readonly<Record<string, FileRule>> = {
  'application/pdf': { category: 'document', label: 'PDF', maxBytes: 10 * MB, ext: '.pdf' },
  'application/msword': { category: 'document', label: 'Word (.doc)', maxBytes: 10 * MB, ext: '.doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { category: 'document', label: 'Word (.docx)', maxBytes: 10 * MB, ext: '.docx' },
  'application/vnd.ms-excel': { category: 'document', label: 'Excel (.xls)', maxBytes: 10 * MB, ext: '.xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { category: 'document', label: 'Excel (.xlsx)', maxBytes: 10 * MB, ext: '.xlsx' },
  'application/vnd.ms-powerpoint': { category: 'document', label: 'PowerPoint (.ppt)', maxBytes: 25 * MB, ext: '.ppt' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { category: 'document', label: 'PowerPoint (.pptx)', maxBytes: 25 * MB, ext: '.pptx' },
  'application/vnd.oasis.opendocument.text': { category: 'document', label: 'OpenDocument text', maxBytes: 10 * MB, ext: '.odt' },
  'application/vnd.oasis.opendocument.spreadsheet': { category: 'document', label: 'OpenDocument spreadsheet', maxBytes: 10 * MB, ext: '.ods' },
  'application/vnd.oasis.opendocument.presentation': { category: 'document', label: 'OpenDocument presentation', maxBytes: 25 * MB, ext: '.odp' },
  'text/plain': { category: 'document', label: 'Text', maxBytes: 2 * MB, ext: '.txt' },
  'text/csv': { category: 'document', label: 'CSV', maxBytes: 2 * MB, ext: '.csv' },
  'image/jpeg': { category: 'image', label: 'JPEG image', maxBytes: 10 * MB, ext: '.jpg,.jpeg' },
  'image/png': { category: 'image', label: 'PNG image', maxBytes: 10 * MB, ext: '.png' },
  'image/webp': { category: 'image', label: 'WebP image', maxBytes: 10 * MB, ext: '.webp' },
  'image/gif': { category: 'image', label: 'GIF image', maxBytes: 10 * MB, ext: '.gif' },
  'audio/webm': { category: 'audio', label: 'Audio (WebM)', maxBytes: 20 * MB, ext: '.weba' },
  'audio/ogg': { category: 'audio', label: 'Audio (Ogg)', maxBytes: 20 * MB, ext: '.ogg,.oga' },
  'audio/mpeg': { category: 'audio', label: 'Audio (MP3)', maxBytes: 20 * MB, ext: '.mp3' },
  'audio/mp4': { category: 'audio', label: 'Audio (M4A)', maxBytes: 20 * MB, ext: '.m4a' },
  'audio/wav': { category: 'audio', label: 'Audio (WAV)', maxBytes: 20 * MB, ext: '.wav' },
  'video/mp4': { category: 'video', label: 'Video (MP4)', maxBytes: 50 * MB, ext: '.mp4' },
  'video/webm': { category: 'video', label: 'Video (WebM)', maxBytes: 50 * MB, ext: '.webm' },
  'video/quicktime': { category: 'video', label: 'Video (MOV)', maxBytes: 50 * MB, ext: '.mov' },
};
export const FILE_ACCEPT = [...new Set(Object.values(FILE_RULES).flatMap((r) => r.ext.split(',')))].join(',');
export const MAX_FILES_PER_MESSAGE = 3;
export const MAX_FILES_PER_ANNOUNCEMENT = 10;
/** Recorders may report "audio/webm;codecs=opus": the base type is what counts. */
export const baseMime = (t: string): string => t.split(';')[0]!.trim().toLowerCase();
export const categoryOf = (mime: string): FileCategory | null => FILE_RULES[baseMime(mime)]?.category ?? null;

export interface FileLike { name: string; size: number; type: string }
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}
/** Instant feedback only; the database checks type and size again with the configured limits. */
export function fileProblem(files: readonly FileLike[], max = MAX_FILES_PER_MESSAGE): string | null {
  if (files.length > max) return `You can attach at most ${max} files at once.`;
  for (const f of files) {
    const rule = FILE_RULES[baseMime(f.type)];
    if (!rule) return `${f.name}: this file type is not supported. See the list of supported files.`;
    if (f.size <= 0) return `${f.name} is empty.`;
    if (f.size > rule.maxBytes) return `${f.name} is larger than ${formatBytes(rule.maxBytes)} (the limit for ${rule.label}).`;
  }
  return null;
}
export const SUPPORTED_SUMMARY = 'PDF, Word, Excel, PowerPoint, OpenDocument, text/CSV (up to 10 MB; slides 25 MB), images JPG/PNG/WebP/GIF (10 MB), audio WebM/Ogg/MP3/M4A/WAV (20 MB), video MP4/WebM/MOV (50 MB)';

/** Initials and a stable colour for a person (DIRA LEARN has no profile photos). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase();
}
const AVATAR_COLOURS = ['bg-purple-600', 'bg-orange-500', 'bg-dira-deep', 'bg-purple-400', 'bg-orange-600', 'bg-purple-800'] as const;
export function avatarColour(id: string | null | undefined): string {
  let h = 0; for (const c of id ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]!;
}

/** "14:05", "Yesterday", "Mon", "3 Dec" - short time labels for lists. */
export function shortTime(iso: string | null | undefined, now: Date = new Date(), tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  if (day(d) === day(now)) return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(d);
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(d);
}
/** "just now", "5 min ago", "2 h ago", then the date - for notifications. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export type ChatSection = 'announcements' | 'direct' | 'groups' | 'materials' | 'media';
export const SECTIONS: readonly { id: ChatSection; label: string }[] = [
  { id: 'announcements', label: 'Announcements' }, { id: 'direct', label: 'Direct messages' }, { id: 'groups', label: 'Group conversations' },
  { id: 'materials', label: 'Shared learning materials' }, { id: 'media', label: 'Audio & video messages' },
];
export const isSection = (s: string | null): s is ChatSection => SECTIONS.some((x) => x.id === s);
/** Which section a conversation belongs to: one-to-one kinds under Direct messages, cohort discussions and groups under Groups. */
export const sectionOfKind = (kind: string): ChatSection => (kind === 'group' || kind === 'cohort' ? 'groups' : 'direct');

/** Where a notification opens. Only links inside DIRA LEARN (a path starting with one "/") are followed; anything else goes to Chat. */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (!link || !/^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/.test(link)) return null;
  return link;
}

/** Message search inside one conversation (case-insensitive, whole text). */
export function matchesQuery(text: string | null | undefined, q: string): boolean {
  const t = q.trim().toLowerCase();
  return !t || (text ?? '').toLowerCase().includes(t);
}

export interface ReadInfo { last_read_at: string }
/** "Seen" when every other member has read up to this message; "Sent" otherwise. */
export function deliveryState(createdAt: string, reads: readonly ReadInfo[], others: number): 'seen' | 'sent' {
  if (others <= 0 || reads.length < others) return 'sent';
  return reads.every((r) => new Date(r.last_read_at).getTime() >= new Date(createdAt).getTime()) ? 'seen' : 'sent';
}

/** Toast queue rule: show each notification once; at most 3 visible. */
export function nextToasts<T extends { id: string }>(visible: readonly T[], incoming: T, shown: Set<string>, max = 3): T[] {
  if (shown.has(incoming.id)) return [...visible];
  shown.add(incoming.id);
  return [...visible, incoming].slice(-max);
}

export const AUDIENCES = [
  { value: 'everyone', label: 'Everyone in the programme' }, { value: 'track', label: 'A programme track' }, { value: 'cohort', label: 'A cohort' },
] as const;
export type Audience = (typeof AUDIENCES)[number]['value'];
export function announcementProblem(a: { title: string; body: string; audience: Audience; cohortId: string; trackId: string }): string | null {
  if (a.title.trim().length < 3) return 'Give the announcement a title.';
  if (a.title.trim().length > 160) return 'The title can be at most 160 characters.';
  if (!a.body.trim() && a.audience) { /* body may be empty when files or audio carry the content */ }
  if (a.body.length > 5000) return 'The message can be at most 5000 characters.';
  if (a.audience === 'cohort' && !a.cohortId) return 'Choose the cohort.';
  if (a.audience === 'track' && !a.trackId) return 'Choose the track.';
  return null;
}

/** The parent announcement embedded in a file row by `announcements(title)`.
 *  In the database this relationship is many-to-one: announcement_attachments.announcement_id is NOT NULL and references announcements(id), so every file
 *  belongs to exactly one announcement and PostgREST returns a single object (null only if Row Level Security hides the parent).
 *  The Supabase client here is not given generated table types, so it cannot know the cardinality and types the embed as a list.
 *  Both shapes are therefore accepted and read through embeddedAnnouncementTitle(), the one place that normalises them. */
export interface AnnouncementRef { title: string }
export type EmbeddedAnnouncement = AnnouncementRef | AnnouncementRef[] | null;
/** One row of announcement_attachments as the Shared materials list selects it. */
export interface AnnouncementFileRow {
  id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; created_at: string; announcement_id: string;
  announcements: EmbeddedAnnouncement;
}
/** Title of the announcement a file belongs to; '' when it is not visible. A list (never produced by PostgREST for this relationship) uses its first entry. */
export function embeddedAnnouncementTitle(e: EmbeddedAnnouncement | undefined): string {
  const parent = Array.isArray(e) ? e[0] : e;
  return parent?.title ?? '';
}
