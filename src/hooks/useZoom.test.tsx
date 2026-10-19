import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { historyManager } from '../commands/HistoryManager';
import { useZoom } from './useZoom';

const node = (id: string) => ({ id, type: 'IMAGE' as const, x: 0, y: 0, width: 100, height: 100 });
const wheel = () => ({ evt: { preventDefault: vi.fn(), deltaY: -100 }, target: { getStage: () => ({ getPointerPosition: () => ({ x: 100, y: 100 }) }) } } as any);

beforeEach(async () => {
  await useCanvasStore.persist.rehydrate();
  useCanvasStore.getState().setNodes([node('old')], true);
  useSelectionStore.setState({ selectedIds: ['old'] });
  historyManager.clear();
});

it('does not remove new results when a wheel event uses the previous render callback', () => {
  const hook = renderHook(() => useZoom());
  const handleWheel = hook.result.current.handleWheel;
  act(() => {
    useCanvasStore.getState().addNode({ ...node('new'), src: '/generated.png', loading: false }, true);
    handleWheel(wheel());
  });
  expect(useCanvasStore.getState().nodes.map(n => n.id)).toEqual(['old', 'new']);
  expect(useCanvasStore.getState().nodes[1].src).toBe('/generated.png');
});

it('keeps a just-completed image when resizing before the next render', () => {
  useCanvasStore.getState().updateNode('old', { loading: true, src: '' }, true);
  const hook = renderHook(() => useZoom());
  const handleWheel = hook.result.current.handleWheel;
  act(() => {
    useCanvasStore.getState().updateNode('old', { loading: false, src: '/completed.png' }, true);
    handleWheel(wheel());
  });
  expect(useCanvasStore.getState().nodes[0]).toMatchObject({ loading: false, src: '/completed.png' });
  expect(useCanvasStore.getState().nodes[0].width).toBeCloseTo(110);
});
