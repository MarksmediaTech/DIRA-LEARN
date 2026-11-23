// Daily Brief rules. The database (migration 21) is the authority on who may publish and who may read; these give instant feedback.

export type BriefStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export const STATUS_LABEL: Record<BriefStatus, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', withdrawn: 'Withdrawn' };

export const MAX_OBJECTIVES = 8;
export const MAX_OBJECTIVE_LENGTH = 200;

/** Roles that can be given publishing authorisation by an executive (must match guard_brief_publisher()). */
export const AUTHORISABLE_ROLES: readonly string[] = ['programme_director', 'programme_coordinator', 'trainer'];
const EXECUTIVE: readonly string[] = ['super_admin', 'founder', 'co_founder'];

/** Mirrors can_publish_briefs(): executives always; staff and facilitators only when authorised. */
export function canPublishBriefs(role: string | null | undefined, authorised: boolean): boolean {
  if (!role) return false;
  if (EXECUTIVE.includes(role)) return true;
  return AUTHORISABLE_ROLES.includes(role) && authorised;
}

/** A facilitator may only write for their own cohorts, never for "all cohorts". */
export const mustPickCohort = (role: string | null | undefined): boolean => role === 'trainer';

/** One objective per line; blank lines dropped. */
export function parseObjectives(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
export const objectivesToText = (objectives: readonly string[] | null | undefined): string => (objectives ?? []).join('\n');

export interface BriefInput {
  title: string; briefDate: string; reflection: string; objectivesText: string; question: string;
  action: 'draft' | 'publish' | 'schedule'; publishAtIso: string | null; cohortId: string; role?: string | null;
}

export function validateBrief(input: BriefInput, now: Date = new Date()): string | null {
  if (input.title.trim().length < 3) return 'Give the brief a title of at least 3 characters.';
  if (input.title.trim().length > 120) return 'The title can be at most 120 characters.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.briefDate)) return 'Choose the date this brief is for.';
  if (input.reflection.length > 1200) return 'The reflection can be at most 1200 characters.';
  if (input.question.length > 400) return 'The reflection question can be at most 400 characters.';
  const objectives = parseObjectives(input.objectivesText);
  if (objectives.length > MAX_OBJECTIVES) return `Use at most ${MAX_OBJECTIVES} learning objectives.`;
  if (objectives.some((o) => o.length > MAX_OBJECTIVE_LENGTH)) return `Each objective can be at most ${MAX_OBJECTIVE_LENGTH} characters.`;
  if (mustPickCohort(input.role) && !input.cohortId) return 'Choose one of your cohorts. Facilitators cannot write for all cohorts.';
  if (input.action === 'schedule') {
    if (!input.publishAtIso) return 'Choose when to publish.';
    if (new Date(input.publishAtIso) <= now) return 'Choose a future time to schedule publication.';
  }
  return null;
}

export interface PickableBrief { cohort_id: string | null }

/** A brief written for the learner's own cohort wins over the all-cohorts brief for the same day. */
export function pickBrief<T extends PickableBrief>(briefs: readonly T[], myCohortIds: readonly string[]): T | null {
  return briefs.find((b) => b.cohort_id !== null && myCohortIds.includes(b.cohort_id)) ?? briefs.find((b) => b.cohort_id === null) ?? null;
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface DueItem { state: string; dueAt: string | null }

/** Work that is overdue, or due within the next `days` days, soonest first. Work already submitted or graded is left out. */
export function deadlineReminders<T extends DueItem>(items: readonly T[], now: Date = new Date(), days = 7): T[] {
  const limit = now.getTime() + days * 86_400_000;
  return items
    .filter((i) => (i.state === 'to_do' || i.state === 'returned' || i.state === 'overdue') && i.dueAt !== null && new Date(i.dueAt).getTime() <= limit)
    .sort((a, b) => new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime());
}
