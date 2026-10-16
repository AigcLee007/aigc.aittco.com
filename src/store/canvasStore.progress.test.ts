import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { NodeData } from '../../types';
import { sanitizePersistedNode } from './canvasStore';

const node: NodeData = { id: 'image', type: 'IMAGE', x: 0, y: 0, width: 512, height: 512, loading: true, taskId: 'task', generationStartedAt: 1_790_000_000_000 };

describe('persisted generation feedback', () => {
  it('restores reported progress, queue status and the original start time', () => {
    const saved = sanitizePersistedNode({ ...node, progress: 65, progressSource: 'reported', generationStatus: 'QUEUED' });
    expect(saved).toMatchObject({ progress: 65, progressSource: 'reported', generationStatus: 'QUEUED', generationStartedAt: node.generationStartedAt });
  });

  it('does not persist legacy simulated values as reported progress', () => {
    const saved = sanitizePersistedNode({ ...node, progress: 65, progressSource: 'estimated' });
    expect(saved.progress).toBeUndefined();
    expect(saved.progressSource).toBeUndefined();
  });

  it('migrates an old waiting task to a stable start timestamp for refresh recovery', () => {
    const saved = sanitizePersistedNode({ ...node, generationStartedAt: undefined });
    expect(saved.generationStartedAt).toBeGreaterThan(0);
    expect(sanitizePersistedNode(saved).generationStartedAt).toBe(saved.generationStartedAt);
  });
});
