import { attendanceRate, average, countByMonth, display, percent, periodRange, retention, scorePercent } from './rules';

describe('percent and averages', () => {
  it('rounds to one decimal and is null without a base', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(0, 0)).toBeNull();
    expect(percent(0, 5)).toBe(0);
  });
  it('averages only the real values', () => {
    expect(average([80, null, 60])).toBe(70);
    expect(average([null, null])).toBeNull();
  });
  it('turns a score into a percentage of the maximum', () => {
    expect(scorePercent(45, 60)).toBe(75);
    expect(scorePercent(null, 60)).toBeNull();
    expect(scorePercent(5, null)).toBeNull();
    expect(scorePercent(5, 0)).toBeNull();
  });
  it('shows "No data" instead of zero', () => { expect(display(null, '%')).toBe('No data'); expect(display(0, '%')).toBe('0%'); });
});

describe('attendanceRate', () => {
  it('counts present and late, leaves excused out, counts absent against', () => {
    expect(attendanceRate([{ status: 'present' }, { status: 'late' }, { status: 'absent' }, { status: 'excused' }])).toBe(66.7);
  });
  it('is null with no countable records', () => expect(attendanceRate([{ status: 'excused' }])).toBeNull());
});

describe('retention', () => {
  it('splits enrolled people into retained and dropped out', () => expect(retention(40, 4)).toEqual({ retention: 90, dropout: 10 }));
  it('is null with nobody enrolled', () => expect(retention(0, 0)).toEqual({ retention: null, dropout: null }));
});

describe('periodRange', () => {
  const now = new Date(2026, 10, 4, 15);
  it('covers today and the stated number of days or months', () => {
    const w = periodRange('7d', now); expect(w.to.getDate()).toBe(5); expect(w.from.getDate()).toBe(29);
    const y = periodRange('12m', now); expect(y.from.getFullYear()).toBe(2025); expect(y.from.getMonth()).toBe(10);
  });
});

describe('countByMonth', () => {
  it('includes empty months and ignores dates outside the range', () => {
    const r = countByMonth([new Date(2026, 8, 5), new Date(2026, 8, 20), new Date(2026, 10, 1), new Date(2025, 0, 1)], new Date(2026, 8, 1), new Date(2026, 11, 1));
    expect(r).toEqual([{ month: '2026-09', count: 2 }, { month: '2026-10', count: 0 }, { month: '2026-11', count: 1 }]);
  });
});
