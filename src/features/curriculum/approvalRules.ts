import type { RoleCode } from '@/types/database';

// Curriculum Approval Centre rules. The database is the authority (can_approve_curriculum, review_curriculum_topic); this only drives the screen.
export type TopicStatus = 'pending' | 'approved' | 'rejected';
export type TopicDecision = 'approve' | 'reject' | 'reopen';

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' };
export const MAX_COMMENT_LENGTH = 1000;

/** Must match can_approve_curriculum() in migration 20260101000016. */
export const APPROVER_ROLES: readonly RoleCode[] = ['super_admin', 'founder', 'co_founder'];
export const canReviewTopics = (role: RoleCode | null | undefined) => !!role && APPROVER_ROLES.includes(role);

/** One row from the curriculum_proposals_list() function. */
export interface ProposalRow {
  id: string; track_id: string | null; track_name: string | null; track_position: number | null;
  session_id: string; session_no: number; week_no: number; session_title: string; session_description: string | null; session_objectives: string[] | null;
  title: string; description: string | null; status: TopicStatus; submitted_at: string; submitted_by_name: string | null;
  reviewed_at: string | null; reviewed_by_name: string | null; reviewer_comment: string | null;
}
export interface TrackInfo { id: string; name: string; position: number }

export interface Summary { total: number; pending: number; approved: number; rejected: number }
export function summarise(rows: readonly ProposalRow[]): Summary {
  const count = (s: TopicStatus) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, pending: count('pending'), approved: count('approved'), rejected: count('rejected') };
}

export interface Filters { status: TopicStatus | 'all'; trackId: string | 'all'; sessionId: string | 'all'; search: string }
export const NO_FILTERS: Filters = { status: 'all', trackId: 'all', sessionId: 'all', search: '' };

export function filterProposals(rows: readonly ProposalRow[], f: Filters): ProposalRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => (f.status === 'all' || r.status === f.status) && (f.trackId === 'all' || r.track_id === f.trackId)
    && (f.sessionId === 'all' || r.session_id === f.sessionId) && (q === '' || r.title.toLowerCase().includes(q)));
}

export interface SessionGroup { sessionId: string; sessionNo: number; weekNo: number; title: string; topics: ProposalRow[] }
export interface TrackGroup { trackId: string | null; trackName: string; sessions: SessionGroup[] }

/** Groups proposals by learning track, then session. Every known track is listed, even when it has no proposals. */
export function groupByTrack(rows: readonly ProposalRow[], tracks: readonly TrackInfo[]): TrackGroup[] {
  const groups: TrackGroup[] = [...tracks].sort((a, b) => a.position - b.position).map((t) => ({ trackId: t.id, trackName: t.name, sessions: [] }));
  for (const r of rows) {
    let g = groups.find((x) => x.trackId === r.track_id);
    if (!g) { g = { trackId: r.track_id, trackName: r.track_name ?? 'Shared core sessions', sessions: [] }; groups.push(g); }
    let s = g.sessions.find((x) => x.sessionId === r.session_id);
    if (!s) { s = { sessionId: r.session_id, sessionNo: r.session_no, weekNo: r.week_no, title: r.session_title, topics: [] }; g.sessions.push(s); }
    s.topics.push(r);
  }
  for (const g of groups) { g.sessions.sort((a, b) => a.sessionNo - b.sessionNo); for (const s of g.sessions) s.topics.sort((a, b) => a.title.localeCompare(b.title)); }
  return groups;
}

/** Sessions that have proposals, for the session filter (optionally limited to one track). */
export function sessionOptions(rows: readonly ProposalRow[], trackId: string | 'all'): { id: string; label: string }[] {
  const seen = new Map<string, { id: string; label: string; no: number }>();
  for (const r of rows) {
    if (trackId !== 'all' && r.track_id !== trackId) continue;
    if (!seen.has(r.session_id)) seen.set(r.session_id, { id: r.session_id, no: r.session_no, label: `Session ${r.session_no}: ${r.session_title}` });
  }
  return [...seen.values()].sort((a, b) => a.no - b.no).map(({ id, label }) => ({ id, label }));
}

/** Which actions the screen offers for a topic. */
export function actionsFor(status: TopicStatus, canReview: boolean): TopicDecision[] {
  if (!canReview) return [];
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'rejected') return ['reopen'];
  return [];
}

export const commentRequired = (d: TopicDecision) => d === 'reject';
export function validateComment(d: TopicDecision, comment: string): string | null {
  const c = comment.trim();
  if (commentRequired(d) && c === '') return 'Give a reason for rejecting this topic.';
  if (c.length > MAX_COMMENT_LENGTH) return `Keep the comment under ${MAX_COMMENT_LENGTH} characters.`;
  return null;
}
