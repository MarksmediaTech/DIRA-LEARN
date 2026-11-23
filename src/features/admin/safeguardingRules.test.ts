import { SG_NEXT_STATUSES, SG_STATUSES, ackState, ackText, canRaiseConcern, describeMinutes, sortForOfficer, validateConcern, validateExceptionalReason } from './safeguardingRules';

const now = new Date('2026-11-19T10:00:00Z');
const at = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString();

describe('safeguarding rules', () => {
  it('knows every status the database accepts, and never offers "open" or the legacy status as a next step', () => {
    expect([...SG_STATUSES].sort()).toEqual(['acknowledged', 'closed', 'in_progress', 'open', 'referred', 'resolved', 'under_review']);
    expect(SG_NEXT_STATUSES).not.toContain('open');
    expect(SG_NEXT_STATUSES).not.toContain('under_review');
  });
  it('lets staff, facilitators, mentors and M&E raise concerns, never learners or applicants', () => {
    for (const r of ['founder', 'programme_coordinator', 'trainer', 'mentor', 'me_officer']) expect(canRaiseConcern(r)).toBe(true);
    for (const r of ['participant', 'applicant', null, undefined, '']) expect(canRaiseConcern(r)).toBe(false);
  });
  it('tracks the acknowledgement target', () => {
    expect(ackState({ acknowledged_at: null, ack_due_at: at(45), status: 'open' }, now)).toEqual({ state: 'due', minutesLeft: 45 });
    expect(ackState({ acknowledged_at: null, ack_due_at: at(-90), status: 'open' }, now)).toEqual({ state: 'overdue', minutesLate: 90 });
    expect(ackState({ acknowledged_at: at(-5), ack_due_at: at(-90), status: 'acknowledged' }, now)).toEqual({ state: 'acknowledged' });
    expect(ackState({ acknowledged_at: null, ack_due_at: null, status: 'open' }, now)).toEqual({ state: 'none' });
    expect(ackText({ state: 'overdue', minutesLate: 90 })).toBe('Acknowledgement target missed by 1 h 30 min');
    expect(ackText({ state: 'due', minutesLeft: 1 })).toBe('Acknowledge within 1 minute');
    expect(describeMinutes(24 * 60)).toBe('24 hours');
    expect(describeMinutes(72 * 60)).toBe('3 days');
  });
  it('puts overdue, then urgent, concerns first', () => {
    const rows = [
      { id: 'done', urgency: 'urgent', status: 'resolved', acknowledged_at: at(-10), ack_due_at: at(-20), created_at: at(-5) },
      { id: 'std', urgency: 'standard', status: 'open', acknowledged_at: null, ack_due_at: at(600), created_at: at(-1) },
      { id: 'urg', urgency: 'urgent', status: 'open', acknowledged_at: null, ack_due_at: at(30), created_at: at(-30) },
      { id: 'late', urgency: 'standard', status: 'open', acknowledged_at: null, ack_due_at: at(-1), created_at: at(-2000) },
    ];
    expect(sortForOfficer(rows, now).map((r) => r.id)).toEqual(['late', 'urg', 'std', 'done']);
  });
  it('requires factual descriptions and reasons', () => {
    expect(validateConcern('too short')).toMatch(/at least 20/);
    expect(validateConcern('Learner said she feels unsafe travelling home')).toBeNull();
    expect(validateExceptionalReason('Board review')).toMatch(/at least 20/);
  });
});
