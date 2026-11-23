import { EMPTY_FILTER, applyFilter, canExport, canGiveFeedback, canSeeCohortTable, csvCell, pct, sortRows, toCsv, trend, validateFeedback, type LearnerMetrics } from './rules';

const row = (o: Partial<LearnerMetrics>): LearnerMetrics => ({
  participant_id: 'p', participant_no: 'P-1', display_name: 'Ann', track_id: 't1', track_name: 'Digital', participant_status: 'active', access_status: 'active',
  attendance_records: 8, attendance_rate: '100.0', sessions_attended: 8, core_attended: 2, core_total: 2, assignments_expected: 4, submitted: 4, graded: 4,
  returned: 0, overdue: 0, late: 0, tasks_pct: '75.0', tasks_graded: 2, tasks_total: 2, final_pct: '70.0', final_graded: 1, final_total: 1,
  reflection_pct: '90.0', reflection_graded: 1, reflection_total: 1, overall: '79.5', provisional: false, final_submitted: true, reflection_submitted: true,
  completion_met: true, certified: false, completion_status: 'requirements_met', needs_support: false, support_reasons: [], ...o,
});

describe('learner performance helpers', () => {
  it('never shows missing figures as zero', () => {
    expect(pct(null)).toBe('–');
    expect(pct('62.5')).toBe('62.5%');
    expect(pct(0)).toBe('0%');
  });
  it('filters by name, support need, status and track, and lists learners who may need support first', () => {
    const rows = [row({ participant_id: 'a', display_name: 'Zoe' }), row({ participant_id: 'b', display_name: 'Ben', needs_support: true, completion_status: 'in_progress', track_id: 't2' })];
    expect(applyFilter(rows, { ...EMPTY_FILTER, search: 'zo' }).map((r) => r.participant_id)).toEqual(['a']);
    expect(applyFilter(rows, { ...EMPTY_FILTER, supportOnly: true }).map((r) => r.participant_id)).toEqual(['b']);
    expect(applyFilter(rows, { ...EMPTY_FILTER, status: 'requirements_met' })).toHaveLength(1);
    expect(applyFilter(rows, { ...EMPTY_FILTER, trackId: 't2' })).toHaveLength(1);
    expect(sortRows(rows).map((r) => r.display_name)).toEqual(['Ben', 'Zoe']);
  });
  it('works out the trend from the history', () => {
    const h = (overall: string | null, a: string | null) => ({ taken_on: 'x', attendance_rate: a, overall, submitted: 0, graded: 0, overdue: 0, completion_status: 'in_progress', needs_support: false });
    expect(trend([h(null, '50'), h('60', '75'), h('70.5', '80')], 'overall')).toBe(10.5);
    expect(trend([h(null, '50'), h('60', '75'), h('70.5', '80')], 'attendance_rate')).toBe(30);
    expect(trend([h('60', null)], 'overall')).toBeNull();
  });
  it('validates feedback', () => {
    expect(validateFeedback('ok')).toMatch(/short sentence/);
    expect(validateFeedback('Good progress this week.')).toBeNull();
    expect(validateFeedback('x'.repeat(2001))).toMatch(/2000/);
  });
  it('exports CSV that a spreadsheet cannot run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+254 700')).toBe("'+254 700");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    const csv = toCsv([row({ display_name: '@evil', support_reasons: ['attendance', 'overdue_work'], needs_support: true })]);
    const [head, line] = csv.split('\r\n');
    expect(head).toMatch(/^Participant no,Name,Track/);
    expect(line).toContain("'@evil");
    expect(line).toContain('Attendance below the draft threshold; Overdue work');
    expect(line).toContain('Requirements met (draft rules)');
  });
  it('limits the cohort table, feedback and export to the right roles', () => {
    expect(canSeeCohortTable('mentor')).toBe(true);
    expect(canGiveFeedback('mentor')).toBe(false);
    expect(canExport('trainer')).toBe(true);
    for (const r of ['participant', 'me_officer', 'applicant', null]) { expect(canSeeCohortTable(r)).toBe(false); expect(canGiveFeedback(r)).toBe(false); }
  });
});
