import { componentResult, completionChecks, summariseResult, type AssignmentInput, type SubmissionInput } from './rules';

const A = (id: string, component: AssignmentInput['component'], maxScore: number | null = 100): AssignmentInput => ({ id, component, maxScore });
const S = (assignmentId: string, score: number | null, status: SubmissionInput['status'] = 'graded', attempt = 1): SubmissionInput => ({ assignmentId, attempt, status, score });

describe('componentResult', () => {
  it('averages graded scored work as percentages', () => {
    const r = componentResult('task', [A('a', 'task', 10), A('b', 'task', 50)], [S('a', 8), S('b', 25)]);
    expect(r).toEqual({ percent: 65, graded: 2, total: 2, partial: false });
  });
  it('ignores feedback-only assignments and other components', () => {
    const r = componentResult('task', [A('a', 'task', null), A('b', 'final_project'), A('c', 'task', 10)], [S('c', 5)]);
    expect(r.total).toBe(1);
    expect(r.percent).toBe(50);
  });
  it('is partial while something scored is not graded, and never counts it as zero', () => {
    const r = componentResult('task', [A('a', 'task'), A('b', 'task')], [S('a', 80), S('b', null, 'submitted')]);
    expect(r).toEqual({ percent: 80, graded: 1, total: 2, partial: true });
  });
  it('uses the latest attempt only', () => {
    const r = componentResult('task', [A('a', 'task')], [S('a', 40, 'graded', 1), S('a', null, 'submitted', 2)]);
    expect(r.percent).toBeNull();
  });
  it('returns null percent when nothing is set up', () => {
    expect(componentResult('reflection', [], [])).toEqual({ percent: null, graded: 0, total: 0, partial: false });
  });
});

describe('summariseResult', () => {
  const assignments = [A('t1', 'task'), A('f', 'final_project'), A('r', 'reflection')];
  it('computes the weighted overall when every component has a score', () => {
    const s = summariseResult({
      attendance: ['present', 'present', 'absent', 'present'],           // 75%
      assignments, submissions: [S('t1', 80), S('f', 90), S('r', 100)],
    });
    // 75*.2 + 80*.3 + 90*.4 + 100*.1 = 15 + 24 + 36 + 10 = 85
    expect(s.overall).toBe(85);
    expect(s.provisional).toBe(false);
    expect(s.missing).toEqual([]);
  });
  it('has no overall (not zero) while a component is missing, and says why', () => {
    const s = summariseResult({ attendance: ['present'], assignments, submissions: [S('t1', 80)] });
    expect(s.overall).toBeNull();
    expect(s.missing).toContain('Final project not graded yet');
    expect(s.missing).toContain('Reflection not graded yet');
  });
  it('says nothing is set up when the component has no scored assignment', () => {
    const s = summariseResult({ attendance: ['present'], assignments: [A('t1', 'task')], submissions: [S('t1', 80)] });
    expect(s.missing).toContain('No scored final project set up');
  });
  it('flags a provisional overall when some scored work is still ungraded', () => {
    const s = summariseResult({
      attendance: ['present'], assignments: [A('t1', 'task'), A('t2', 'task'), A('f', 'final_project'), A('r', 'reflection')],
      submissions: [S('t1', 80), S('t2', null, 'submitted'), S('f', 90), S('r', 100)],
    });
    expect(s.overall).not.toBeNull();
    expect(s.provisional).toBe(true);
  });
  it('reports no attendance as missing, not 0%', () => {
    const s = summariseResult({ attendance: [], assignments, submissions: [S('t1', 80), S('f', 90), S('r', 100)] });
    expect(s.engagement).toBeNull();
    expect(s.overall).toBeNull();
    expect(s.missing).toContain('No attendance recorded yet');
  });
});

describe('completionChecks', () => {
  const sess = (n: number, core: boolean, status: 'present' | 'late' | 'absent' | 'excused' = 'present') => ({ curriculumSessionId: `s${n}`, isCore: core, status });
  const six = [sess(1, true), sess(2, true), sess(3, false), sess(4, false), sess(5, false), sess(6, false)];
  it('is met with 6 sessions including both core, final project and reflection', () => {
    const r = completionChecks({ sessions: six, coreSessionCount: 2, finalProjectSubmitted: true, reflectionSubmitted: true });
    expect(r.allMet).toBe(true);
  });
  it('fails when a core session is missed even with enough sessions', () => {
    const s = [sess(1, true, 'absent'), sess(2, true), ...six.slice(2), sess(7, false)];
    const r = completionChecks({ sessions: s, coreSessionCount: 2, finalProjectSubmitted: true, reflectionSubmitted: true });
    expect(r.checks.find((c) => c.key === 'sessions')!.ok).toBe(true);
    expect(r.checks.find((c) => c.key === 'core')!.ok).toBe(false);
    expect(r.allMet).toBe(false);
  });
  it('counts late as attended but not excused', () => {
    const s = [...six.slice(0, 5), sess(6, false, 'excused')];
    expect(completionChecks({ sessions: s, coreSessionCount: 2, finalProjectSubmitted: true, reflectionSubmitted: true }).checks[0]?.ok).toBe(false);
    const s2 = [...six.slice(0, 5), sess(6, false, 'late')];
    expect(completionChecks({ sessions: s2, coreSessionCount: 2, finalProjectSubmitted: true, reflectionSubmitted: true }).checks[0]?.ok).toBe(true);
  });
  it('counts a session run twice only once', () => {
    const s = [sess(1, true), { ...sess(1, true) }, sess(2, true)];
    expect(completionChecks({ sessions: s, coreSessionCount: 2, finalProjectSubmitted: false, reflectionSubmitted: false }).checks[0]?.label).toContain('(2 so far)');
  });
  it('requires the final project and reflection', () => {
    const r = completionChecks({ sessions: six, coreSessionCount: 2, finalProjectSubmitted: false, reflectionSubmitted: true });
    expect(r.allMet).toBe(false);
    expect(r.checks.find((c) => c.key === 'final')!.ok).toBe(false);
  });
  it('does not treat zero configured core sessions as satisfied', () => {
    const r = completionChecks({ sessions: six, coreSessionCount: 0, finalProjectSubmitted: true, reflectionSubmitted: true });
    expect(r.checks.find((c) => c.key === 'core')!.ok).toBe(false);
  });
});
