export interface PerImageRequestAttempt {
  index: number;
  n: 1;
  candidateCount: 1;
}

export const buildPerImageRequestPlan = (
  quantity: number,
): PerImageRequestAttempt[] => {
  const parsed = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  const count = Math.max(1, parsed);

  return Array.from({ length: count }, (_, index) => ({
    index,
    n: 1 as const,
    candidateCount: 1 as const,
  }));
};
