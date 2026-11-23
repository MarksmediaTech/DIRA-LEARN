import { actionsFor, canReviewTopics, commentRequired, filterProposals, groupByTrack, NO_FILTERS, sessionOptions, summarise, validateComment, type ProposalRow } from './approvalRules';
import { ROLE_CODES } from '@/types/database';

const row = (o: Partial<ProposalRow>): ProposalRow => ({
  id: 'p', track_id: 't1', track_name: 'Digital Marketing', track_position: 1, session_id: 's5', session_no: 5, week_no: 3, session_title: 'Online presence',
  session_description: null, session_objectives: null, title: 'SEO fundamentals', description: null, status: 'pending', submitted_at: '2026-11-08T00:00:00Z',
  submitted_by_name: null, reviewed_at: null, reviewed_by_name: null, reviewer_comment: null, ...o,
});
const rows = [
  row({ id: '1', title: 'SEO fundamentals' }),
  row({ id: '2', title: 'WhatsApp Business', status: 'approved' }),
  row({ id: '3', title: 'Visual hierarchy', track_id: 't3', track_name: 'Content Creation', session_id: 's6', session_no: 6, status: 'rejected' }),
  row({ id: '4', title: 'SEO fundamentals', track_id: 't4', track_name: 'Entrepreneurship & Business', session_id: 's4', session_no: 4 }),
];
const tracks = [{ id: 't4', name: 'Entrepreneurship & Business', position: 4 }, { id: 't1', name: 'Digital Marketing', position: 1 }, { id: 't2', name: 'AI Tools', position: 2 }, { id: 't3', name: 'Content Creation', position: 3 }];

describe('who may approve', () => {
  it('is the Founder, Co-Founder and Super Administrator only', () => {
    expect(ROLE_CODES.filter((r) => canReviewTopics(r))).toEqual(['super_admin', 'founder', 'co_founder']);
    for (const r of ['programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor', 'participant', 'applicant'] as const) expect(canReviewTopics(r)).toBe(false);
    expect(canReviewTopics(null)).toBe(false);
  });
});

describe('summary and filters', () => {
  it('counts topics by status', () => expect(summarise(rows)).toEqual({ total: 4, pending: 2, approved: 1, rejected: 1 }));
  it('filters by status, track, session and title search together', () => {
    expect(filterProposals(rows, NO_FILTERS)).toHaveLength(4);
    expect(filterProposals(rows, { ...NO_FILTERS, status: 'pending' }).map((r) => r.id)).toEqual(['1', '4']);
    expect(filterProposals(rows, { ...NO_FILTERS, trackId: 't3' }).map((r) => r.id)).toEqual(['3']);
    expect(filterProposals(rows, { ...NO_FILTERS, sessionId: 's5' }).map((r) => r.id)).toEqual(['1', '2']);
    expect(filterProposals(rows, { ...NO_FILTERS, search: ' seo ' }).map((r) => r.id)).toEqual(['1', '4']);
    expect(filterProposals(rows, { status: 'pending', trackId: 't1', sessionId: 'all', search: 'seo' }).map((r) => r.id)).toEqual(['1']);
  });
  it('lists sessions for the session filter, limited to a track when one is chosen', () => {
    expect(sessionOptions(rows, 'all').map((s) => s.id)).toEqual(['s4', 's5', 's6']);
    expect(sessionOptions(rows, 't1')).toEqual([{ id: 's5', label: 'Session 5: Online presence' }]);
  });
});

describe('grouping', () => {
  it('lists the four tracks in order, including a track with no proposals', () => {
    const g = groupByTrack(rows, tracks);
    expect(g.map((x) => x.trackName)).toEqual(['Digital Marketing', 'AI Tools', 'Content Creation', 'Entrepreneurship & Business']);
    expect(g[1]!.sessions).toEqual([]);
  });
  it('keeps the same title in different tracks as separate proposals', () => {
    const g = groupByTrack(rows, tracks);
    expect(g[0]!.sessions[0]!.topics.map((t) => t.id)).toEqual(['1', '2']);   // sorted by title
    expect(g[3]!.sessions[0]!.topics.map((t) => t.id)).toEqual(['4']);
  });
});

describe('actions and comments', () => {
  it('offers approve and reject on pending, reconsider on rejected, nothing on approved or to non-approvers', () => {
    expect(actionsFor('pending', true)).toEqual(['approve', 'reject']);
    expect(actionsFor('rejected', true)).toEqual(['reopen']);
    expect(actionsFor('approved', true)).toEqual([]);
    for (const s of ['pending', 'approved', 'rejected'] as const) expect(actionsFor(s, false)).toEqual([]);
  });
  it('requires a reason to reject, but not to approve or reconsider', () => {
    expect(commentRequired('reject')).toBe(true);
    expect(commentRequired('approve')).toBe(false);
    expect(validateComment('reject', '   ')).not.toBeNull();
    expect(validateComment('reject', 'Not relevant')).toBeNull();
    expect(validateComment('approve', '')).toBeNull();
    expect(validateComment('approve', 'x'.repeat(1001))).not.toBeNull();
  });
});
