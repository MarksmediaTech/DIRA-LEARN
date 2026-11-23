import type { ApplicationStatus, RoleCode } from '@/types/database';

// DRAFT workflow. Must stay in sync with application_transition_allowed() in
// supabase/migrations/20260101000004_applications_cohorts.sql. The database is the authority; this only drives the UI.
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', shortlisted: 'Shortlisted',
  accepted: 'Accepted', rejected: 'Rejected', waitlisted: 'Waitlisted',
};

export const REVIEW_STATUSES: ApplicationStatus[] = ['submitted', 'under_review', 'shortlisted', 'waitlisted', 'accepted', 'rejected'];

const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: [],
  submitted: ['under_review', 'rejected'],
  under_review: ['shortlisted', 'waitlisted', 'accepted', 'rejected'],
  shortlisted: ['under_review', 'waitlisted', 'accepted', 'rejected'],
  waitlisted: ['shortlisted', 'accepted', 'rejected'],
  rejected: ['under_review'],
  accepted: [],
};

export const nextStatuses = (from: ApplicationStatus): ApplicationStatus[] => TRANSITIONS[from];
export const canTransition = (from: ApplicationStatus, to: ApplicationStatus) => TRANSITIONS[from].includes(to);
/** Rejecting, or reopening a rejected application, needs a written reason. */
export const noteRequired = (from: ApplicationStatus, to: ApplicationStatus) => to === 'rejected' || from === 'rejected';

// ---- Approval management (see migration 20260101000014_applicant_approval.sql; the database is the authority) ----
export type DecisionGroup = 'pending' | 'approved' | 'rejected';
export const GROUP_LABEL: Record<DecisionGroup, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
export const PENDING_STATUSES: ApplicationStatus[] = ['submitted', 'under_review', 'shortlisted', 'waitlisted'];

/** Pending / Approved / Rejected, as the administrator sees it. Drafts are the applicant's and belong to no group. */
export function decisionGroup(status: ApplicationStatus): DecisionGroup | null {
  if (PENDING_STATUSES.includes(status)) return 'pending';
  if (status === 'accepted') return 'approved';
  if (status === 'rejected') return 'rejected';
  return null;
}

// Must match can_decide_applications() in the database.
export const DECIDER_ROLES: RoleCode[] = ['super_admin', 'founder', 'co_founder', 'programme_director'];
export const canDecide = (role: RoleCode, status: ApplicationStatus, applicantId: string, myId: string) =>
  DECIDER_ROLES.includes(role) && PENDING_STATUSES.includes(status) && applicantId !== myId;

/** Review steps that are still done with the status buttons. Approve and Reject are separate server actions. */
export const reviewMoves = (from: ApplicationStatus): ApplicationStatus[] =>
  TRANSITIONS[from].filter((to) => to !== 'accepted' && to !== 'rejected');

export const MAX_REASON_LENGTH = 1000;

// Matches the roles allowed by the convert-application Edge Function.
const CONVERT_ROLES: RoleCode[] = ['super_admin', 'founder', 'co_founder', 'programme_coordinator'];
export const canConvert = (role: RoleCode, status: ApplicationStatus, alreadyConverted: boolean) =>
  CONVERT_ROLES.includes(role) && status === 'accepted' && !alreadyConverted;

/** Age in whole years from a stored date of birth string, or null if missing or invalid. */
export function ageFromDob(dob: unknown, ref: Date = new Date()): number | null {
  if (typeof dob !== 'string') return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  if (ref.getMonth() < d.getMonth() || (ref.getMonth() === d.getMonth() && ref.getDate() < d.getDate())) age -= 1;
  return age;
}

export function matchesSearch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || text.toLowerCase().includes(q);
}
