import { canPublishBriefs, deadlineReminders, greetingFor, mustPickCohort, objectivesToText, parseObjectives, pickBrief, validateBrief, type BriefInput } from './rules';

const base: BriefInput = { title: 'Monday focus', briefDate: '2027-01-11', reflection: '', objectivesText: '', question: '', action: 'draft', publishAtIso: null, cohortId: '' };

describe('who may publish briefs', () => {
  it('always allows the three executive roles', () => {
    for (const r of ['super_admin', 'founder', 'co_founder']) { expect(canPublishBriefs(r, false)).toBe(true); expect(canPublishBriefs(r, true)).toBe(true); }
  });
  it('allows staff and facilitators only when authorised', () => {
    for (const r of ['programme_director', 'programme_coordinator', 'trainer']) { expect(canPublishBriefs(r, false)).toBe(false); expect(canPublishBriefs(r, true)).toBe(true); }
  });
  it('never allows learners, applicants, mentors or M&E, even if flagged', () => {
    for (const r of ['participant', 'applicant', 'mentor', 'me_officer', '', null, undefined]) expect(canPublishBriefs(r, true)).toBe(false);
  });
  it('makes facilitators pick a cohort', () => {
    expect(mustPickCohort('trainer')).toBe(true);
    expect(mustPickCohort('programme_coordinator')).toBe(false);
  });
});

describe('brief validation', () => {
  it('accepts a minimal draft', () => { expect(validateBrief(base)).toBeNull(); });
  it('rejects a short title, a missing date and long text', () => {
    expect(validateBrief({ ...base, title: 'Hi' })).toMatch(/title/);
    expect(validateBrief({ ...base, briefDate: '' })).toMatch(/date/);
    expect(validateBrief({ ...base, reflection: 'x'.repeat(1201) })).toMatch(/1200/);
    expect(validateBrief({ ...base, question: 'x'.repeat(401) })).toMatch(/400/);
  });
  it('limits objectives to eight lines of 200 characters', () => {
    expect(validateBrief({ ...base, objectivesText: Array.from({ length: 9 }, (_, i) => `Goal ${i}`).join('\n') })).toMatch(/at most 8/);
    expect(validateBrief({ ...base, objectivesText: 'x'.repeat(201) })).toMatch(/200/);
    expect(validateBrief({ ...base, objectivesText: 'One\n\nTwo\n' })).toBeNull();
  });
  it('requires a future time to schedule', () => {
    const now = new Date('2027-01-10T08:00:00.000Z');
    expect(validateBrief({ ...base, action: 'schedule', publishAtIso: null }, now)).toMatch(/when to publish/);
    expect(validateBrief({ ...base, action: 'schedule', publishAtIso: '2027-01-10T07:00:00.000Z' }, now)).toMatch(/future/);
    expect(validateBrief({ ...base, action: 'schedule', publishAtIso: '2027-01-11T05:00:00.000Z' }, now)).toBeNull();
  });
  it('makes a facilitator choose a cohort', () => {
    expect(validateBrief({ ...base, role: 'trainer' })).toMatch(/Choose one of your cohorts/);
    expect(validateBrief({ ...base, role: 'trainer', cohortId: 'c1' })).toBeNull();
  });
});

describe('objectives text', () => {
  it('splits on lines, trims and drops blanks, and round-trips', () => {
    expect(parseObjectives('  One  \r\n\r\nTwo\n')).toEqual(['One', 'Two']);
    expect(objectivesToText(['One', 'Two'])).toBe('One\nTwo');
    expect(objectivesToText(null)).toBe('');
  });
});

describe('choosing the brief a learner sees', () => {
  const all = { id: 'all', cohort_id: null };
  const mine = { id: 'mine', cohort_id: 'c1' };
  const other = { id: 'other', cohort_id: 'c2' };
  it('prefers the learner\'s own cohort, then the all-cohorts brief', () => {
    expect(pickBrief([all, mine, other], ['c1'])?.id).toBe('mine');
    expect(pickBrief([all, other], ['c1'])?.id).toBe('all');
  });
  it('never picks another cohort\'s brief', () => { expect(pickBrief([other], ['c1'])).toBeNull(); });
  it('returns null when there is no brief', () => { expect(pickBrief([], ['c1'])).toBeNull(); });
});

describe('greeting and deadline reminders', () => {
  it('greets by time of day', () => {
    expect(greetingFor(6)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(23)).toBe('Good evening');
  });
  const now = new Date('2027-01-10T08:00:00.000Z');
  const items = [
    { id: 1, state: 'to_do', dueAt: '2027-01-12T08:00:00.000Z' },
    { id: 2, state: 'overdue', dueAt: '2027-01-08T08:00:00.000Z' },
    { id: 3, state: 'to_do', dueAt: '2027-01-30T08:00:00.000Z' },
    { id: 4, state: 'submitted', dueAt: '2027-01-11T08:00:00.000Z' },
    { id: 5, state: 'graded', dueAt: '2027-01-09T08:00:00.000Z' },
    { id: 6, state: 'to_do', dueAt: null },
    { id: 7, state: 'returned', dueAt: '2027-01-15T08:00:00.000Z' },
  ];
  it('lists overdue and soon-due work, soonest first, and skips finished or far-off work', () => {
    expect(deadlineReminders(items, now).map((i) => i.id)).toEqual([2, 1, 7]);
  });
});
