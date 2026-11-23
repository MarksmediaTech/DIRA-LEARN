import { assignmentProgress, latestAttempt, learnerState, onTimeStatus, percentOf, submissionBlocker, validateAssignment, validateGrade, validateSubmission } from './rules';

const now = new Date('2026-11-10T12:00:00Z');

describe('late flagging', () => {
  it('flags work after the due date, not before, and not when there is no due date', () => {
    expect(onTimeStatus('2026-11-10T11:00:00Z', now)).toBe('late');
    expect(onTimeStatus('2026-11-10T13:00:00Z', now)).toBe('submitted');
    expect(onTimeStatus(null, now)).toBe('submitted');
  });
});

describe('who can submit', () => {
  const once = { dueAt: null, allowResubmission: false };
  const again = { dueAt: null, allowResubmission: true };
  it('first attempt is always open', () => expect(submissionBlocker(once, [])).toBeNull());
  it('blocks a second attempt when resubmission is off', () => expect(submissionBlocker(once, [{ attempt: 1, status: 'returned' }])).toMatch(/already submitted/));
  it('allows another attempt only after the work is returned', () => {
    expect(submissionBlocker(again, [{ attempt: 1, status: 'returned' }])).toBeNull();
    expect(submissionBlocker(again, [{ attempt: 1, status: 'submitted' }])).toMatch(/with your trainer/);
    expect(submissionBlocker(again, [{ attempt: 1, status: 'graded' }])).toMatch(/graded/);
  });
  it('uses the highest attempt number as the latest', () => {
    expect(latestAttempt([{ attempt: 1, status: 'returned' }, { attempt: 2, status: 'graded' }])?.status).toBe('graded');
    expect(latestAttempt([])).toBeNull();
  });
});

describe('submission content', () => {
  const pdf = { size: 1000, type: 'application/pdf' };
  it('needs an answer or a file', () => expect(validateSubmission({ body: '  ', file: null })).toMatch(/Add your answer/));
  it('accepts text only, or an allowed file', () => {
    expect(validateSubmission({ body: 'My answer', file: null })).toBeNull();
    expect(validateSubmission({ body: '', file: pdf })).toBeNull();
  });
  it('rejects empty, oversized and disallowed files', () => {
    expect(validateSubmission({ body: '', file: { size: 0, type: 'application/pdf' } })).toMatch(/empty/);
    expect(validateSubmission({ body: '', file: { size: 11 * 1024 * 1024, type: 'application/pdf' } })).toMatch(/10 MB/);
    expect(validateSubmission({ body: '', file: { size: 10, type: 'application/zip' } })).toMatch(/PDF, Word/);
  });
});

describe('learner state', () => {
  const a = { dueAt: '2026-11-09T00:00:00Z', allowResubmission: true };
  it('shows overdue only while nothing is submitted', () => {
    expect(learnerState(a, [], now)).toBe('overdue');
    expect(learnerState({ ...a, dueAt: '2026-11-20T00:00:00Z' }, [], now)).toBe('to_do');
    expect(learnerState(a, [{ attempt: 1, status: 'late' }], now)).toBe('late');
    expect(learnerState(a, [{ attempt: 1, status: 'returned' }, { attempt: 2, status: 'graded' }], now)).toBe('graded');
  });
});

describe('assignment and grade validation', () => {
  it('validates a new assignment', () => {
    expect(validateAssignment({ cohortId: '', title: 'Quiz', dueAt: '', maxScore: '' })).toMatch(/cohort/);
    expect(validateAssignment({ cohortId: 'c', title: 'ab', dueAt: '', maxScore: '' })).toMatch(/title/);
    expect(validateAssignment({ cohortId: 'c', title: 'CV draft', dueAt: '', maxScore: '0' })).toMatch(/above 0/);
    expect(validateAssignment({ cohortId: 'c', title: 'CV draft', dueAt: '2026-11-20T10:00', maxScore: '20' })).toBeNull();
  });
  it('requires a score within range when the assignment has marks', () => {
    const base = { action: 'grade' as const, maxScore: 20, feedback: '', allowResubmission: false };
    expect(validateGrade({ ...base, score: '' })).toMatch(/Enter a score/);
    expect(validateGrade({ ...base, score: '21' })).toMatch(/between 0 and 20/);
    expect(validateGrade({ ...base, score: '-1' })).toMatch(/between/);
    expect(validateGrade({ ...base, score: '0' })).toBeNull();
    expect(validateGrade({ ...base, score: '20' })).toBeNull();
  });
  it('lets feedback-only assignments be graded without a score', () => {
    expect(validateGrade({ action: 'grade', score: '', maxScore: null, feedback: '', allowResubmission: false })).toBeNull();
  });
  it('returning needs resubmission on and feedback', () => {
    expect(validateGrade({ action: 'return', score: '', maxScore: 20, feedback: 'x', allowResubmission: false })).toMatch(/does not allow/);
    expect(validateGrade({ action: 'return', score: '', maxScore: 20, feedback: ' ', allowResubmission: true })).toMatch(/what needs to change/);
    expect(validateGrade({ action: 'return', score: '', maxScore: 20, feedback: 'Add your sources', allowResubmission: true })).toBeNull();
  });
  it('computes a percentage only when it can', () => {
    expect(percentOf(15, 20)).toBe(75);
    expect(percentOf(null, 20)).toBeNull();
    expect(percentOf(5, null)).toBeNull();
  });
});

describe('progress', () => {
  it('counts each expected participant once, by latest attempt', () => {
    const subs = [
      { participantId: 'a', attempt: 1, status: 'returned' as const }, { participantId: 'a', attempt: 2, status: 'submitted' as const },
      { participantId: 'b', attempt: 1, status: 'graded' as const }, { participantId: 'd', attempt: 1, status: 'late' as const },
    ];
    expect(assignmentProgress(['a', 'b', 'c'], subs)).toEqual({ expected: 3, notSubmitted: 1, toGrade: 1, returned: 0, graded: 1 });
  });
});

import { assignmentGroup, countGroups, eligibleParticipants, groupAssignments, isAssignedTo, recipientMap } from './rules';

describe('individual assignments', () => {
  const rec = recipientMap([{ assignment_id: 'a1', participant_id: 'p1' }, { assignment_id: 'a1', participant_id: 'p2' }]);
  it('treats an assignment with no recipients as for everyone', () => {
    expect(isAssignedTo('a2', 'p9', rec)).toBe(true);
    expect(isAssignedTo('a2', 'p9', new Map())).toBe(true);
  });
  it('limits an assignment with recipients to those learners', () => {
    expect(isAssignedTo('a1', 'p1', rec)).toBe(true);
    expect(isAssignedTo('a1', 'p3', rec)).toBe(false);
  });
  const enrols = [{ participantId: 'p1', trackId: 't1' }, { participantId: 'p2', trackId: 't2' }, { participantId: 'p3', trackId: 't1' }];
  it('expects the whole cohort, a track, or only the chosen learners', () => {
    expect(eligibleParticipants({ id: 'a2', trackId: null }, enrols, rec)).toEqual(['p1', 'p2', 'p3']);
    expect(eligibleParticipants({ id: 'a2', trackId: 't1' }, enrols, rec)).toEqual(['p1', 'p3']);
    expect(eligibleParticipants({ id: 'a1', trackId: null }, enrols, rec)).toEqual(['p1', 'p2']);
  });
});

describe('My Assignments grouping', () => {
  it('maps each learner state to one of four groups', () => {
    expect(assignmentGroup('to_do')).toBe('upcoming');
    expect(assignmentGroup('returned')).toBe('upcoming');
    expect(assignmentGroup('overdue')).toBe('overdue');
    expect(assignmentGroup('submitted')).toBe('submitted');
    expect(assignmentGroup('late')).toBe('submitted');
    expect(assignmentGroup('graded')).toBe('graded');
  });
  const items = [
    { id: 1, state: 'to_do' as const, dueAt: '2027-02-10T10:00:00Z', submittedAt: null },
    { id: 2, state: 'to_do' as const, dueAt: '2027-02-01T10:00:00Z', submittedAt: null },
    { id: 3, state: 'to_do' as const, dueAt: null, submittedAt: null },
    { id: 4, state: 'overdue' as const, dueAt: '2027-01-20T10:00:00Z', submittedAt: null },
    { id: 5, state: 'submitted' as const, dueAt: null, submittedAt: '2027-01-25T10:00:00Z' },
    { id: 6, state: 'late' as const, dueAt: null, submittedAt: '2027-01-28T10:00:00Z' },
    { id: 7, state: 'graded' as const, dueAt: null, submittedAt: '2027-01-10T10:00:00Z' },
  ];
  it('sorts upcoming by soonest deadline with undated work last, and submitted by most recent', () => {
    const g = groupAssignments(items);
    expect(g.upcoming.map((x) => x.id)).toEqual([2, 1, 3]);
    expect(g.overdue.map((x) => x.id)).toEqual([4]);
    expect(g.submitted.map((x) => x.id)).toEqual([6, 5]);
    expect(g.graded.map((x) => x.id)).toEqual([7]);
  });
  it('counts each group', () => { expect(countGroups(items)).toEqual({ overdue: 1, upcoming: 3, submitted: 2, graded: 1 }); });
  it('handles no assignments', () => { expect(countGroups([])).toEqual({ overdue: 0, upcoming: 0, submitted: 0, graded: 0 }); });
});
