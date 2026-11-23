import { mergeMilestones, milestoneProgress, parseMilestones, participantCanEdit, validateEvidenceFile } from './rules';

describe('participantCanEdit', () => {
  it('allows editing only while working or after return', () => {
    expect(participantCanEdit('in_progress')).toBe(true);
    expect(participantCanEdit('needs_revision')).toBe(true);
    expect(participantCanEdit('submitted')).toBe(false);
    expect(participantCanEdit('reviewed')).toBe(false);
  });
});

describe('milestones', () => {
  it('parses one milestone per line', () => expect(parseMilestones('- Plan\n\nBuild\n').milestones).toEqual([{ title: 'Plan', done: false }, { title: 'Build', done: false }]));
  it('limits count and length', () => {
    expect(parseMilestones(Array.from({ length: 13 }, (_, i) => `m${i}`).join('\n')).error).toMatch(/at most 12/);
    expect(parseMilestones('x'.repeat(161)).error).toMatch(/under 160/);
  });
  it('keeps done flags for unchanged titles when editing', () => {
    const merged = mergeMilestones([{ title: 'Plan', done: false }, { title: 'Test', done: false }], [{ title: 'Plan', done: true }, { title: 'Build', done: true }]);
    expect(merged).toEqual([{ title: 'Plan', done: true }, { title: 'Test', done: false }]);
  });
  it('counts progress', () => expect(milestoneProgress([{ title: 'a', done: true }, { title: 'b', done: false }])).toEqual({ done: 1, total: 2 }));
});

describe('validateEvidenceFile', () => {
  it('accepts allowed types under 10 MB', () => expect(validateEvidenceFile({ type: 'image/png', size: 1000 })).toBeNull());
  it('rejects other types and oversized files', () => {
    expect(validateEvidenceFile({ type: 'application/zip', size: 10 })).toMatch(/PDF/);
    expect(validateEvidenceFile({ type: 'video/mp4', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });
});
