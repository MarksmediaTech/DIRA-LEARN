import type { CourseFormat, CourseStatus, LessonKind } from '@/types/database';

export const FORMAT_LABEL: Record<CourseFormat, string> = { online: 'Online', physical: 'Physical classroom', hybrid: 'Hybrid', self_paced: 'Self-paced' };
export const STATUS_LABEL: Record<CourseStatus, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
export const KIND_LABEL: Record<LessonKind, string> = { reading: 'Reading', pdf: 'PDF document', presentation: 'Presentation', video: 'Video', link: 'Web link' };

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ACCEPT: Record<'pdf' | 'presentation' | 'video', readonly string[]> = {
  pdf: ['application/pdf'], presentation: [PPTX, 'application/vnd.ms-powerpoint'], video: ['video/mp4'],
};

export const isHttpUrl = (s: string): boolean => { try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

export function validateCourse(i: { title: string; summary: string; startsOn: string; endsOn: string }): string | null {
  const t = i.title.trim();
  if (t.length < 3 || t.length > 160) return 'The title must be 3 to 160 characters.';
  if (i.summary.length > 2000) return 'Keep the summary under 2,000 characters.';
  if (i.startsOn && i.endsOn && i.endsOn < i.startsOn) return 'The end date cannot be before the start date.';
  return null;
}

export interface LessonInput { title: string; kind: LessonKind; body: string; externalUrl: string; file: { type: string; size: number } | null }

/** What a lesson of each kind needs. Mirrors the table's check constraint, so errors show before the database refuses. */
export function validateLesson(i: LessonInput): string | null {
  if (i.title.trim().length < 2 || i.title.trim().length > 160) return 'The lesson title must be 2 to 160 characters.';
  if (i.kind === 'reading') return i.body.trim() ? null : 'Write the reading text.';
  if (i.kind === 'link') return isHttpUrl(i.externalUrl) ? null : 'Enter a web address starting with http:// or https://.';
  if (i.externalUrl.trim() && !isHttpUrl(i.externalUrl)) return 'The web address must start with http:// or https://.';
  if (!i.file && !i.externalUrl.trim()) return i.kind === 'video' ? 'Upload an MP4 file or paste a link to the video.' : 'Upload a file or paste a link.';
  if (i.file) {
    if (!ACCEPT[i.kind].includes(i.file.type)) return i.kind === 'pdf' ? 'Use a PDF file.' : i.kind === 'presentation' ? 'Use a PowerPoint (.pptx or .ppt) file.' : 'Use an MP4 video.';
    if (i.file.size > MAX_FILE_BYTES) return 'The file is larger than 50 MB. Host large videos elsewhere and paste the link.';
  }
  return null;
}

/** '<courseId>/<timestamp>-<safe name>': the first folder is the course id, which the storage rules rely on. */
export const materialPath = (courseId: string, fileName: string, now: number): string => `${courseId}/${now}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)}`;

/** New order after moving item `index` by `dir` (-1 up, +1 down); unchanged at the ends. */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir; const out = [...list];
  if (index < 0 || index >= out.length || j < 0 || j >= out.length) return out;
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}

export const progressPercent = (done: number, total: number): number | null => (total > 0 ? Math.round((done / total) * 100) : null);

/** Who may do what: trainers edit content but only management publishes, archives, assigns trainers and enrols. */
export function courseAbilities(role: string | null | undefined, assigned: boolean): { editContent: boolean; manage: boolean } {
  const manage = role === 'super_admin' || role === 'founder' || role === 'co_founder' || role === 'programme_director' || role === 'programme_coordinator';
  return { manage, editContent: manage || (role === 'trainer' && assigned) };
}
