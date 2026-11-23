import { findConflicts, isFull, preselectTrack, seatsLeft, validateScheduleTimes, type Slot } from './rules';
import { cohortSchema, scheduleSchema } from './schema';

const slot = (o: Partial<Slot>): Slot => ({ cohortId: 'c1', trainerId: 't1', trackId: null, startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-02T10:00:00Z', status: 'scheduled', ...o });

describe('capacity', () => {
  it('counts seats and never goes negative', () => {
    expect(seatsLeft({ capacity: 30, enrolled: 28 })).toBe(2);
    expect(seatsLeft({ capacity: 30, enrolled: 35 })).toBe(0);
    expect(isFull({ capacity: 30, enrolled: 30 })).toBe(true);
    expect(isFull({ capacity: 30, enrolled: 29 })).toBe(false);
  });
});

describe('schedule conflicts', () => {
  it('flags a trainer double booking in another cohort', () => {
    const r = findConflicts(slot({ cohortId: 'c2', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T11:00:00Z' }), [slot({ id: 'a' })]);
    expect(r.map((c) => c.kind)).toEqual(['trainer']);
  });
  it('allows back-to-back sessions', () => {
    expect(findConflicts(slot({ startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T12:00:00Z' }), [slot({ id: 'a' })])).toHaveLength(0);
  });
  it('blocks two core sessions at the same time for one cohort', () => {
    const r = findConflicts(slot({ trainerId: 't2' }), [slot({ id: 'a' })]);
    expect(r.map((c) => c.kind)).toEqual(['cohort']);
  });
  it('allows different tracks to run in parallel with different trainers', () => {
    expect(findConflicts(slot({ trainerId: 't2', trackId: 'x' }), [slot({ id: 'a', trackId: 'y' })])).toHaveLength(0);
  });
  it('blocks the same track twice, and a core session against a track session', () => {
    expect(findConflicts(slot({ trainerId: 't2', trackId: 'x' }), [slot({ id: 'a', trackId: 'x' })])).toHaveLength(1);
    expect(findConflicts(slot({ trainerId: 't2', trackId: null }), [slot({ id: 'a', trackId: 'x' })])).toHaveLength(1);
  });
  it('ignores cancelled sessions and the session being edited', () => {
    expect(findConflicts(slot({}), [slot({ id: 'a', status: 'cancelled' })])).toHaveLength(0);
    expect(findConflicts(slot({ id: 'a' }), [slot({ id: 'a' })])).toHaveLength(0);
  });
});

describe('schedule times', () => {
  const base = { cohortStart: '2026-11-02', cohortEnd: '2026-11-27' };
  it('accepts a normal session', () => {
    expect(validateScheduleTimes({ ...base, startsAt: '2026-11-03T09:00', endsAt: '2026-11-03T11:00' })).toBeNull();
  });
  it('rejects end before start, over two hours, and outside the cohort', () => {
    expect(validateScheduleTimes({ ...base, startsAt: '2026-11-03T11:00', endsAt: '2026-11-03T09:00' })).toMatch(/after the start/);
    expect(validateScheduleTimes({ ...base, startsAt: '2026-11-03T09:00', endsAt: '2026-11-03T11:01' })).toMatch(/2 hours/);
    expect(validateScheduleTimes({ ...base, startsAt: '2026-12-01T09:00', endsAt: '2026-12-01T10:00' })).toMatch(/cohort dates/);
    expect(validateScheduleTimes({ ...base, startsAt: '', endsAt: '' })).toMatch(/Enter/);
  });
});

describe('forms', () => {
  it('validates a cohort', () => {
    expect(cohortSchema.safeParse({ name: 'Cohort 1', startDate: '2026-11-02', endDate: '2026-11-27', capacity: '30' }).success).toBe(true);
    expect(cohortSchema.safeParse({ name: 'Cohort 1', startDate: '2026-11-27', endDate: '2026-11-02', capacity: 30 }).success).toBe(false);
    expect(cohortSchema.safeParse({ name: 'C', startDate: '2026-11-02', endDate: '2026-11-27', capacity: 0 }).success).toBe(false);
  });
  it('requires an https meeting link only when one is given', () => {
    const ok = { curriculumSessionId: '5b9b3f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', startsAt: 'a', endsAt: 'b', mode: 'online' as const };
    expect(scheduleSchema.safeParse(ok).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...ok, meetingUrl: 'zoom.us/j/1' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...ok, meetingUrl: 'https://meet.example/abc' }).success).toBe(true);
  });
});

describe('preselectTrack', () => {
  it('preselects the saved track when it belongs to the programme', () => { expect(preselectTrack('t2', ['t1', 't2'])).toBe('t2'); });
  it('preselects nothing when no track is saved or it is not in the programme', () => {
    expect(preselectTrack(null, ['t1'])).toBe(''); expect(preselectTrack(undefined, ['t1'])).toBe(''); expect(preselectTrack('x', ['t1'])).toBe('');
  });
});
