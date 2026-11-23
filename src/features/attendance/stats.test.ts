import { attendanceRate } from './stats';

describe('attendanceRate', () => {
  it('returns null when there is no data', () => { expect(attendanceRate([])).toBeNull(); });
  it('returns null when every record is excused (draft rule excludes them)', () => { expect(attendanceRate(['excused', 'excused'])).toBeNull(); });
  it('counts present and late as attended by default', () => { expect(attendanceRate(['present', 'late', 'absent', 'present'])).toBe(75); });
  it('excludes excused absences from the denominator by default', () => { expect(attendanceRate(['present', 'excused'])).toBe(100); });
  it('supports alternative rules', () => {
    expect(attendanceRate(['present', 'late'], { lateCountsAsAttended: false, excused: 'excluded' })).toBe(50);
    expect(attendanceRate(['present', 'excused'], { lateCountsAsAttended: true, excused: 'absent' })).toBe(50);
    expect(attendanceRate(['present', 'excused'], { lateCountsAsAttended: true, excused: 'attended' })).toBe(100);
  });
  it('rounds to one decimal place', () => { expect(attendanceRate(['present', 'absent', 'absent'])).toBe(33.3); });
});
