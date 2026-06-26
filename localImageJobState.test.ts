import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const { buildVisionaryPollingJobPatch } = require('./localImageJobState.cjs');

describe('Visionary local job polling state', () => {
  it('keeps a succeeded upstream Visionary record processing until local asset persistence is ready', () => {
    const patch = buildVisionaryPollingJobPatch({
      localTaskId: 'vision:local-1',
      upstreamTaskId: 'upstream-1',
      record: {
        id: 'upstream-1',
        status: 'succeeded',
        progress: 100,
        results: [{ url: 'https://visionary.beer/api/generations/upstream-1/image?token=abc' }],
      },
    });

    expect(patch.status).toBe('processing');
    expect(patch.progress).toBe(100);
    expect(patch.responseData.status).toBe('processing');
    expect(patch.responseData.results).toEqual([]);
  });

  it('passes through non-final Visionary polling status and progress', () => {
    const patch = buildVisionaryPollingJobPatch({
      localTaskId: 'vision:local-2',
      upstreamTaskId: 'upstream-2',
      record: {
        status: 'processing',
        progress: 42,
        results: [],
      },
    });

    expect(patch.status).toBe('processing');
    expect(patch.progress).toBe(42);
    expect(patch.responseData.status).toBe('processing');
    expect(patch.responseData.progress).toBe(42);
  });
});
