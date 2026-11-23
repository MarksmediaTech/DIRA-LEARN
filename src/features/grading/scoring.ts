export interface WeightedComponent { key: string; weight: number; score: number | null; max: number }

export const DRAFT_WEIGHTS = { engagement: 20, tasks_portfolio: 30, final_project: 40, reflection_action_plan: 10 } as const;

export function weightsAreValid(weights: Record<string, number>): boolean {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(total - 100) < 1e-9 && Object.values(weights).every((w) => w >= 0);
}

/**
 * Overall percentage from weighted components. Returns null while any component is unscored, so an
 * incomplete record is never shown as a low grade. No pass mark is applied: none has been approved.
 */
export function overallPercent(components: readonly WeightedComponent[]): number | null {
  if (!weightsAreValid(Object.fromEntries(components.map((c) => [c.key, c.weight])))) throw new Error('Component weights must total 100');
  let total = 0;
  for (const c of components) {
    if (c.score === null) return null;
    if (c.max <= 0 || c.score < 0 || c.score > c.max) throw new Error(`Invalid score for ${c.key}`);
    total += (c.score / c.max) * c.weight;
  }
  return Math.round(total * 10) / 10;
}
