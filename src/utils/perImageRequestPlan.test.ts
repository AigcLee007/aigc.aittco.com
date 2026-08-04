import { describe, expect, it } from 'vitest';
import { buildPerImageRequestPlan } from './perImageRequestPlan';

describe('buildPerImageRequestPlan', () => {
  it('creates one n:1 attempt per requested image', () => {
    expect(buildPerImageRequestPlan(3)).toEqual([
      { index: 0, n: 1, candidateCount: 1 },
      { index: 1, n: 1, candidateCount: 1 },
      { index: 2, n: 1, candidateCount: 1 },
    ]);
  });

  it('falls back to one attempt for an invalid quantity', () => {
    expect(buildPerImageRequestPlan(Number.NaN)).toEqual([
      { index: 0, n: 1, candidateCount: 1 },
    ]);
  });
});
