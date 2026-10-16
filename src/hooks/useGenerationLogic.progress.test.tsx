import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../store/canvasStore';
import { useGenerationLogic } from './useGenerationLogic';

beforeEach(async () => {
  await useCanvasStore.persist.rehydrate();
  useCanvasStore.getState().setNodes([{ id: 'video', type: 'VIDEO', x: 0, y: 0, width: 512, height: 288, loading: true, generationStartedAt: Date.now() }], true);
});

describe('generation progress storage', () => {
  it('stores task acceptance while keeping estimated ticks out of the canvas store', () => {
    const h = renderHook(() => useGenerationLogic());
    act(() => h.result.current.handleUpdateProgress('video', 0, 'estimated', 'PENDING'));
    expect(useCanvasStore.getState().nodes[0].generationStatus).toBe('PENDING');
    const nodes = useCanvasStore.getState().nodes;
    act(() => h.result.current.handleUpdateProgress('video', 60, 'estimated', 'PENDING'));
    expect(useCanvasStore.getState().nodes).toBe(nodes);
    expect(nodes[0].progress).toBeUndefined();
    h.unmount();
  });

  it('preserves reported progress across lower values and subsequent placeholder responses', () => {
    const h = renderHook(() => useGenerationLogic());
    act(() => h.result.current.handleUpdateProgress('video', 65, 'reported', 'PROCESSING'));
    act(() => h.result.current.handleUpdateProgress('video', 30, 'reported', 'PROCESSING'));
    act(() => h.result.current.handleUpdateProgress('video', 0, 'estimated', 'PROCESSING'));
    expect(useCanvasStore.getState().nodes[0]).toMatchObject({ progress: 65, progressSource: 'reported' });
    h.unmount();
  });
});
