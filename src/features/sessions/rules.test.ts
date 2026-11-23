import { bucketFor, completeBlocker, expectedRoster, missingAttendance, safeFileName, summariseAttendance, validateResource } from './rules';

const now = new Date('2026-11-03T12:00:00');
describe('session buckets', () => {
  it('sorts sessions into today, upcoming and past', () => {
    expect(bucketFor({ startsAt: '2026-11-03T08:00:00', endsAt: '2026-11-03T10:00:00', status: 'scheduled' }, now)).toBe('today');
    expect(bucketFor({ startsAt: '2026-11-04T08:00:00', endsAt: '2026-11-04T10:00:00', status: 'scheduled' }, now)).toBe('upcoming');
    expect(bucketFor({ startsAt: '2026-11-02T08:00:00', endsAt: '2026-11-02T10:00:00', status: 'completed' }, now)).toBe('past');
  });
  it('treats cancelled sessions as past even if in the future', () => {
    expect(bucketFor({ startsAt: '2026-11-10T08:00:00', endsAt: '2026-11-10T10:00:00', status: 'cancelled' }, now)).toBe('past');
  });
});

describe('roster and attendance', () => {
  const enrol = [{ participantId: 'a', trackId: 'x' }, { participantId: 'b', trackId: 'y' }, { participantId: 'c', trackId: null }];
  it('core sessions expect everyone; track sessions only that track', () => {
    expect(expectedRoster(enrol, null)).toHaveLength(3);
    expect(expectedRoster(enrol, 'x').map((e) => e.participantId)).toEqual(['a']);
  });
  it('finds participants without a mark', () => {
    expect(missingAttendance(enrol, { a: 'present', b: undefined })).toEqual(['b', 'c']);
  });
  it('counts statuses', () => {
    expect(summariseAttendance(['present', 'present', 'late', 'absent'])).toEqual({ present: 2, late: 1, excused: 0, absent: 1 });
  });
});

describe('completing a session', () => {
  const base = { status: 'scheduled', startsAt: '2026-11-03T08:00:00', missingCount: 0, hasUnsavedMarks: false, now };
  it('allows completion when started and fully marked', () => { expect(completeBlocker(base)).toBeNull(); });
  it('blocks future, unsaved, incomplete and already-completed sessions', () => {
    expect(completeBlocker({ ...base, startsAt: '2026-11-03T15:00:00' })).toMatch(/not started/);
    expect(completeBlocker({ ...base, hasUnsavedMarks: true })).toMatch(/Save attendance/);
    expect(completeBlocker({ ...base, missingCount: 1 })).toBe('Attendance is missing for 1 participant');
    expect(completeBlocker({ ...base, missingCount: 3 })).toBe('Attendance is missing for 3 participants');
    expect(completeBlocker({ ...base, status: 'completed' })).toMatch(/already/);
    expect(completeBlocker({ ...base, status: 'cancelled' })).toMatch(/cancelled/);
  });
});

describe('resources', () => {
  const ok = { title: 'Slides', kind: 'presentation' as const, url: '', file: { size: 1000 } };
  it('accepts a file or a link, not both or neither', () => {
    expect(validateResource(ok)).toBeNull();
    expect(validateResource({ ...ok, file: null, url: 'https://example.org/x' })).toBeNull();
    expect(validateResource({ ...ok, file: null })).toMatch(/link or choose a file/);
    expect(validateResource({ ...ok, url: 'https://example.org/x' })).toMatch(/not both/);
  });
  it('rejects bad links, big and empty files, short titles', () => {
    expect(validateResource({ ...ok, file: null, url: 'example.org' })).toMatch(/https/);
    expect(validateResource({ ...ok, file: { size: 51 * 1024 * 1024 } })).toMatch(/50 MB/);
    expect(validateResource({ ...ok, file: { size: 0 } })).toMatch(/empty/);
    expect(validateResource({ ...ok, title: ' ' })).toMatch(/title/);
  });
  it('cleans file names', () => {
    expect(safeFileName('../../My Slides (final).pptx')).toBe('My-Slides-final.pptx');
    expect(safeFileName('???')).toBe('file');
  });
});
