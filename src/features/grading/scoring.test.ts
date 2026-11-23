import { overallPercent, weightsAreValid, DRAFT_WEIGHTS } from './scoring';

const comps = (scores: (number | null)[]) =>
  Object.entries(DRAFT_WEIGHTS).map(([key, weight], i) => ({ key, weight, score: scores[i] ?? null, max: 100 }));

describe('scoring', () => {
  it('draft weights total 100', () => { expect(weightsAreValid({ ...DRAFT_WEIGHTS })).toBe(true); });
  it('rejects weights that do not total 100', () => { expect(weightsAreValid({ a: 50, b: 40 })).toBe(false); });
  it('computes the weighted overall percentage', () => { expect(overallPercent(comps([80, 70, 90, 100]))).toBe(83); });
  it('returns null (not zero) while a component is unscored', () => { expect(overallPercent(comps([80, null, 90, 100]))).toBeNull(); });
  it('throws on out-of-range scores', () => { expect(() => overallPercent(comps([101, 70, 90, 100]))).toThrow(); });
  it('throws when weights are invalid', () => { expect(() => overallPercent([{ key: 'a', weight: 50, score: 1, max: 1 }])).toThrow(); });
});
