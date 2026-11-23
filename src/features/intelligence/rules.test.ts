import { distinct, hoursText, meanOf, tableCsv, tabsFor, versusAverage, type CompareRow } from './rules';

const row = (o: Partial<CompareRow>): CompareRow => ({
  cohort_id: 'c', cohort_name: 'A', track_id: null, track_name: null, level: 'cohort', start_date: '2026-01-01', learners: 4, active_learners: 3, withdrawn: 1,
  avg_attendance: '81.3', submission_rate: '37.5', overdue: 5, avg_tasks: null, avg_final: null, avg_overall: '79.5', results_count: 1,
  requirements_met: 1, certified: 0, completion_rate: '33.3', needs_support: 2, ...o,
});

describe('cohort intelligence helpers', () => {
  it('gives staff every tab, M&E officers aggregates only, and everyone else nothing', () => {
    expect(tabsFor('founder')).toEqual(['intake', 'compare', 'facilitators', 'learners', 'support']);
    expect(tabsFor('me_officer')).toEqual(['intake', 'compare', 'support']);
    for (const r of ['trainer', 'mentor', 'participant', 'applicant', null]) expect(tabsFor(r)).toEqual([]);
  });
  it('averages only cohort rows that have a value, and describes the difference', () => {
    const rows = [row({ avg_attendance: '80' }), row({ avg_attendance: '60' }), row({ avg_attendance: null }), row({ level: 'track', avg_attendance: '10' })];
    expect(meanOf(rows, 'avg_attendance')).toBe(70);
    expect(meanOf([row({ avg_overall: null })], 'avg_overall')).toBeNull();
    expect(versusAverage('80', 70)).toEqual({ points: 10, label: '10 points above the average' });
    expect(versusAverage('62.5', 70)?.label).toBe('7.5 points below the average');
    expect(versusAverage(null, 70)).toBeNull();
  });
  it('lists seasons and intakes once, ignoring blanks', () => {
    expect(distinct(['Jan 2027', null, 'Jan 2027', ' ', 'Sep 2026'])).toEqual(['Jan 2027', 'Sep 2026']);
  });
  it('shows turnaround in plain words', () => {
    expect(hoursText(null)).toBe('–');
    expect(hoursText('0.4')).toBe('under 1 hour');
    expect(hoursText(30)).toBe('30 hours');
    expect(hoursText(96)).toBe('4 days');
  });
  it('exports any table as formula-safe CSV', () => {
    const csv = tableCsv([{ n: '=cmd', v: 3 }], [{ label: 'Name', value: (r) => r.n }, { label: 'Value', value: (r) => r.v }]);
    expect(csv).toBe("Name,Value\r\n'=cmd,3");
  });
});
