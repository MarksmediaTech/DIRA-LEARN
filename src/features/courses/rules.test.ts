import { ACCEPT, courseAbilities, isHttpUrl, materialPath, moveItem, progressPercent, validateCourse, validateLesson, type LessonInput } from './rules';

const base: LessonInput = { title: 'Intro', kind: 'reading', body: 'Text', externalUrl: '', file: null };

describe('validateCourse', () => {
  const ok = { title: 'Digital skills', summary: '', startsOn: '', endsOn: '' };
  it('accepts a valid course', () => expect(validateCourse(ok)).toBeNull());
  it('rejects a short title, a long summary and reversed dates', () => {
    expect(validateCourse({ ...ok, title: 'ab' })).toMatch(/title/);
    expect(validateCourse({ ...ok, summary: 'x'.repeat(2001) })).toMatch(/summary/);
    expect(validateCourse({ ...ok, startsOn: '2026-12-02', endsOn: '2026-12-01' })).toMatch(/end date/);
  });
});

describe('validateLesson', () => {
  it('needs text for a reading and a real link for a link lesson', () => {
    expect(validateLesson(base)).toBeNull();
    expect(validateLesson({ ...base, body: '  ' })).toMatch(/reading/);
    expect(validateLesson({ ...base, kind: 'link', externalUrl: 'javascript:alert(1)' })).toMatch(/http/);
    expect(validateLesson({ ...base, kind: 'link', externalUrl: 'https://x.org/a' })).toBeNull();
  });
  it('needs a file or a link for documents and video', () => {
    expect(validateLesson({ ...base, kind: 'pdf' })).toMatch(/Upload a file/);
    expect(validateLesson({ ...base, kind: 'video' })).toMatch(/MP4/);
    expect(validateLesson({ ...base, kind: 'video', externalUrl: 'https://youtu.be/x' })).toBeNull();
  });
  it('checks file type and size against the lesson kind', () => {
    expect(validateLesson({ ...base, kind: 'pdf', file: { type: 'application/pdf', size: 1000 } })).toBeNull();
    expect(validateLesson({ ...base, kind: 'pdf', file: { type: 'video/mp4', size: 1000 } })).toMatch(/PDF/);
    expect(validateLesson({ ...base, kind: 'presentation', file: { type: ACCEPT.presentation[0]!, size: 1000 } })).toBeNull();
    expect(validateLesson({ ...base, kind: 'video', file: { type: 'video/mp4', size: 51 * 1024 * 1024 } })).toMatch(/50 MB/);
  });
  it('refuses a malformed optional link on a document lesson', () => expect(validateLesson({ ...base, kind: 'pdf', externalUrl: 'ftp://x', file: { type: 'application/pdf', size: 1 } })).toMatch(/http/));
});

describe('helpers', () => {
  it('recognises only http and https addresses', () => { expect(isHttpUrl('https://a.org')).toBe(true); expect(isHttpUrl('mailto:a@b.org')).toBe(false); expect(isHttpUrl('nope')).toBe(false); });
  it('builds a storage path that starts with the course id and has a safe name', () => {
    const p = materialPath('c1', '../My file (1).pdf', 123);
    expect(p.startsWith('c1/123-')).toBe(true);
    expect(p.includes('/..')).toBe(false);
    expect(/[ ()]/.test(p)).toBe(false);
  });
  it('moves items and leaves the ends alone', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
  it('gives no percentage for a course without lessons', () => { expect(progressPercent(0, 0)).toBeNull(); expect(progressPercent(1, 3)).toBe(33); });
});

describe('courseAbilities', () => {
  it('lets management do everything and trainers edit only assigned courses', () => {
    expect(courseAbilities('programme_coordinator', false)).toEqual({ manage: true, editContent: true });
    expect(courseAbilities('trainer', true)).toEqual({ manage: false, editContent: true });
    expect(courseAbilities('trainer', false)).toEqual({ manage: false, editContent: false });
    expect(courseAbilities('participant', true)).toEqual({ manage: false, editContent: false });
  });
});
