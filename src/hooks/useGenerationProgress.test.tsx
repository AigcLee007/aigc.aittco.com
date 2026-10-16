import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeData } from '../../types';
import { useGenerationProgress } from './useGenerationProgress';

const startedAt = 1_790_000_000_000;
const node: NodeData = { id: 'image', type: 'IMAGE', x: 0, y: 0, width: 512, height: 512, loading: true, taskId: 'task', generationStartedAt: startedAt };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(startedAt + 10_000); });
afterEach(() => { vi.useRealTimers(); });

describe('generation display clock', () => {
  it('shares one timer for the node and tooltip and cleans up after the last view', () => {
    const first = renderHook(() => useGenerationProgress(node));
    const second = renderHook(() => useGenerationProgress(node));
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(first.result.current).toEqual(second.result.current);
    expect(first.result.current.elapsedLabel).toBe('已等待 00:11');
    first.unmount();
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not tick while a node is outside the viewport or after completion', () => {
    const view = renderHook(({ enabled, loading }) => useGenerationProgress({ ...node, loading }, enabled), { initialProps: { enabled: false, loading: true } });
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ enabled: true, loading: true });
    expect(vi.getTimerCount()).toBe(1);
    view.rerender({ enabled: true, loading: false });
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  });

  it('resumes from the persisted start timestamp when a culled node remounts', () => {
    const first = renderHook(() => useGenerationProgress(node));
    const before = first.result.current.percent;
    first.unmount();
    vi.setSystemTime(startedAt + 80_000);
    const restored = renderHook(() => useGenerationProgress(node));
    expect(restored.result.current.percent).toBeGreaterThan(before);
    expect(restored.result.current.elapsedLabel).toBe('已等待 01:20');
    restored.unmount();
  });

  it('shares one fallback start for a legacy task with a later tooltip and remount', () => {
    const legacy = { ...node, id: 'legacy-image', generationStartedAt: undefined };
    const first = renderHook(() => useGenerationProgress(legacy));
    act(() => { vi.advanceTimersByTime(20_000); });
    const tooltip = renderHook(() => useGenerationProgress({ ...legacy }));
    expect(tooltip.result.current).toEqual(first.result.current);
    first.unmount(); tooltip.unmount();
    vi.setSystemTime(startedAt + 60_000);
    const restored = renderHook(() => useGenerationProgress({ ...legacy }));
    expect(restored.result.current.elapsedLabel).toBe('已等待 00:50');
    restored.unmount();
  });
});
