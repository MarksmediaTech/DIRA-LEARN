import type { Milestone, ProjectStatus } from '@/types/database';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: 'In progress', submitted: 'Submitted, waiting for review', needs_revision: 'Returned for changes', reviewed: 'Reviewed',
};

/** Mirrors guard_project(): participants may edit only while working or after the work is returned. */
export const participantCanEdit = (status: ProjectStatus): boolean => status === 'in_progress' || status === 'needs_revision';

export function parseMilestones(text: string): { milestones: Milestone[]; error: string | null } {
  const titles = text.split(/\r?\n/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  if (titles.length > 12) return { milestones: [], error: 'Use at most 12 milestones.' };
  if (titles.some((t) => t.length > 160)) return { milestones: [], error: 'Keep each milestone under 160 characters.' };
  return { milestones: titles.map((title) => ({ title, done: false })), error: null };
}

/** Keeps the done flag of milestones whose title is unchanged. */
export function mergeMilestones(next: readonly Milestone[], previous: readonly Milestone[]): Milestone[] {
  const done = new Set(previous.filter((m) => m.done).map((m) => m.title));
  return next.map((m) => ({ title: m.title, done: done.has(m.title) }));
}

export function milestoneProgress(ms: readonly Milestone[]): { done: number; total: number } {
  return { done: ms.filter((m) => m.done).length, total: ms.length };
}

export const EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'video/mp4'] as const;
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export function validateEvidenceFile(f: { type: string; size: number }): string | null {
  if (!(EVIDENCE_TYPES as readonly string[]).includes(f.type)) return 'Use a PDF, JPG, PNG or MP4 file.';
  if (f.size > EVIDENCE_MAX_BYTES) return 'The file is larger than 10 MB.';
  return null;
}
