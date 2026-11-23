import { achievementPercent, csvCell, latestByIndicator, toCsv, validateRecord } from './rules';
import type { MeRecord } from '@/types/database';

const R = (id: string, indicator: string, date: string, value: number | null): MeRecord => ({ id, indicator_id: indicator, cohort_id: null, value, data_quality: value === null ? 'missing' : 'measured', recorded_on: date, note: null });

describe('achievementPercent', () => {
  it('computes percent of target', () => expect(achievementPercent(45, 60)).toBe(75));
  it('is null, not zero, without a value or usable target', () => {
    expect(achievementPercent(null, 60)).toBeNull();
    expect(achievementPercent(5, null)).toBeNull();
    expect(achievementPercent(5, 0)).toBeNull();
  });
  it('can exceed 100', () => expect(achievementPercent(90, 60)).toBe(150));
});

describe('validateRecord', () => {
  it('accepts a number for measured or estimated data', () => expect(validateRecord({ quality: 'measured', value: ' 12.5 ' })).toEqual({ value: 12.5, error: null }));
  it('requires a value unless the data is missing', () => expect(validateRecord({ quality: 'estimated', value: '' }).error).toMatch(/Enter a value/));
  it('refuses non-numbers', () => expect(validateRecord({ quality: 'measured', value: 'abc' }).error).toMatch(/number/));
  it('stores missing data as null and refuses a value with it', () => {
    expect(validateRecord({ quality: 'missing', value: '' })).toEqual({ value: null, error: null });
    expect(validateRecord({ quality: 'missing', value: '3' }).error).toMatch(/empty/);
  });
});

describe('latestByIndicator', () => {
  it('keeps the newest record per indicator', () => {
    const m = latestByIndicator([R('1', 'a', '2026-01-01', 1), R('2', 'a', '2026-03-01', 3), R('3', 'b', '2026-02-01', 2)]);
    expect(m.get('a')?.id).toBe('2');
    expect(m.get('b')?.id).toBe('3');
  });
});

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'));
  it('neutralises spreadsheet formulas in text but not real numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5');
  });
  it('writes null as an empty cell', () => expect(toCsv(['a', 'b'], [['x', null]])).toBe('a,b\r\nx,\r\n'));
});
