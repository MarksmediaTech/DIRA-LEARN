import { arrayToLines, canApproveCurriculum, canEditCurriculum, linesToArray, sessionNumberTaken, validateSessionDraft } from './adminRules';

const draft = { title: 'Digital marketing foundations', description: '', weekNo: 2, sessionNo: 3, durationMinutes: 120, objectives: 'Organise files', activities: '', topics: '', expectedOutput: '', assessmentNotes: '' };

describe('curriculum admin rules', () => {
  it('splits and joins one-per-line text', () => {
    expect(linesToArray(' a \n\n b\r\nc ')).toEqual(['a', 'b', 'c']);
    expect(arrayToLines(['a', 'b'])).toBe('a\nb');
    expect(arrayToLines(null)).toBe('');
  });
  it('accepts a good draft', () => { expect(validateSessionDraft(draft)).toEqual({}); });
  it('flags each bad field', () => {
    const e = validateSessionDraft({ ...draft, title: 'ab', weekNo: 5, sessionNo: 0, durationMinutes: 121, objectives: ' \n ' });
    expect(Object.keys(e).sort()).toEqual(['durationMinutes', 'objectives', 'sessionNo', 'title', 'weekNo']);
  });
  it('detects a taken session number within the same track only', () => {
    const rows = [{ id: '1', track_id: null, session_no: 1 }, { id: '2', track_id: 'x', session_no: 3 }];
    expect(sessionNumberTaken(rows, null, 1)).toBe(true);
    expect(sessionNumberTaken(rows, 'y', 3)).toBe(false);
    expect(sessionNumberTaken(rows, 'x', 3, '2')).toBe(false);
  });
  it('separates editing from approving', () => {
    expect(canEditCurriculum('programme_coordinator')).toBe(true);
    expect(canApproveCurriculum('programme_coordinator')).toBe(false);
    expect(canApproveCurriculum('programme_director')).toBe(true);
    expect(canEditCurriculum('programme_director')).toBe(false);
    expect(canEditCurriculum('trainer')).toBe(false);
  });
});
