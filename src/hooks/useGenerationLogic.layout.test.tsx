import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeData } from '../../types';
import { useCanvasStore } from '../store/canvasStore';
import { useGenerationLogic } from './useGenerationLogic';

const node = (id: string, x: number, y: number): NodeData => ({
  id,
  type: 'IMAGE',
  x,
  y,
  width: 512,
  height: 512,
  opacity: 1,
  locked: false,
  loading: false,
  src: `/${id}.png`,
  prompt: id,
  history: [],
  historyIndex: 0,
});

beforeEach(async () => {
  await useCanvasStore.persist.rehydrate();
  useCanvasStore.getState().setNodes([
    node('manual-a', 1320, -440),
    node('manual-b', -860, 970),
  ], true);
});

describe('generation placeholder layout', () => {
  it('preserves manually positioned existing nodes when adding images', () => {
    const hook = renderHook(() => useGenerationLogic());

    act(() => hook.result.current.handleInitGenerations(2, 'new prompt', '1:1'));

    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.find((item) => item.id === 'manual-a')).toMatchObject({ x: 1320, y: -440 });
    expect(nodes.find((item) => item.id === 'manual-b')).toMatchObject({ x: -860, y: 970 });

    const generated = nodes.filter((item) => item.prompt === 'new prompt');
    expect(generated).toHaveLength(2);
    for (const created of generated) {
      for (const existing of nodes.filter((item) => item.id.startsWith('manual-'))) {
        const overlaps =
          created.x < existing.x + existing.width + 20 &&
          created.x + created.width + 20 > existing.x &&
          created.y < existing.y + existing.height + 20 &&
          created.y + created.height + 20 > existing.y;
        expect(overlaps).toBe(false);
      }
    }

    hook.unmount();
  });

  it('creates a batch of linked placeholders without moving existing nodes', () => {
    const hook = renderHook(() => useGenerationLogic());
    const initializeBatch = (hook.result.current as unknown as {
      handleInitBatchGenerations: (items: Array<{
        batchId: string;
        taskId: string;
        prompt: string;
        aspectRatio: string;
      }>) => Record<string, string>;
    }).handleInitBatchGenerations;

    let nodeIds: Record<string, string> = {};
    act(() => {
      nodeIds = initializeBatch([
        { batchId: 'batch-a', taskId: 'task-a', prompt: 'first', aspectRatio: '1:1' },
        { batchId: 'batch-a', taskId: 'task-b', prompt: 'second', aspectRatio: '16:9' },
      ]);
    });

    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.find((item) => item.id === 'manual-a')).toMatchObject({ x: 1320, y: -440 });
    expect(nodes.find((item) => item.id === 'manual-b')).toMatchObject({ x: -860, y: 970 });
    expect(nodes.find((item) => item.id === nodeIds['task-a'])).toMatchObject({
      batchId: 'batch-a', batchTaskId: 'task-a', prompt: 'first', width: 512, height: 512,
    });
    expect(nodes.find((item) => item.id === nodeIds['task-b'])).toMatchObject({
      batchId: 'batch-a', batchTaskId: 'task-b', prompt: 'second', width: 512, height: 288,
    });

    hook.unmount();
  });
});
