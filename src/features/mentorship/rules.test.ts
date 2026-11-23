import { actionPointsToText, lastSessionDate, parseActionPoints, validateMentoringSession } from './rules';

describe('parseActionPoints', () => {
  it('splits lines, strips bullets and blanks', () => {
    expect(parseActionPoints('- Call the bank\n\n* Update CV \n  Book interview').points).toEqual(['Call the bank', 'Update CV', 'Book interview']);
  });
  it('refuses too many or too long points', () => {
    expect(parseActionPoints(Array.from({ length: 21 }, (_, i) => `p${i}`).join('\n')).error).toMatch(/at most 20/);
    expect(parseActionPoints('x'.repeat(301)).error).toMatch(/under 300/);
  });
  it('round-trips through text', () => {
    expect(parseActionPoints(actionPointsToText(['a', 'b'])).points).toEqual(['a', 'b']);
  });
});

describe('validateMentoringSession', () => {
  it('accepts a past date with a summary', () => expect(validateMentoringSession({ heldOn: '2026-10-30', summary: 'Talked about goals' }, '2026-10-31')).toBeNull());
  it('accepts today', () => expect(validateMentoringSession({ heldOn: '2026-10-31', summary: 'Talked about goals' }, '2026-10-31')).toBeNull());
  it('rejects the future, a missing date and an empty summary', () => {
    expect(validateMentoringSession({ heldOn: '2026-11-01', summary: 'Talked about goals' }, '2026-10-31')).toMatch(/future/);
    expect(validateMentoringSession({ heldOn: '', summary: 'Talked about goals' }, '2026-10-31')).toMatch(/date/);
    expect(validateMentoringSession({ heldOn: '2026-10-01', summary: ' hi ' }, '2026-10-31')).toMatch(/summary/);
  });
});

describe('lastSessionDate', () => {
  it('finds the latest date or null', () => {
    expect(lastSessionDate(['2026-10-01', '2026-10-20', '2026-10-05'])).toBe('2026-10-20');
    expect(lastSessionDate([])).toBeNull();
  });
});
