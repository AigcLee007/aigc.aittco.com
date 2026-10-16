import { useSyncExternalStore } from 'react';
import type { NodeData } from '../../types';
import { getGenerationProgress, resolveGenerationStartedAt } from '../utils/generationProgress';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
const clockSnapshot = () => Math.floor(Date.now() / 1000) * 1000;
const stoppedSnapshot = () => 0;
const noSubscription = () => () => {};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = setInterval(() => listeners.forEach(notify => notify()), 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

// Display-only clock: estimates never mutate the canvas store or IndexedDB.
export function useGenerationProgress(node: NodeData, enabled = true) {
  const fallbackStartedAt = resolveGenerationStartedAt(node);
  const active = enabled && !!node.loading && !node.error;
  const now = useSyncExternalStore(active ? subscribe : noSubscription, active ? clockSnapshot : stoppedSnapshot, stoppedSnapshot);
  return getGenerationProgress(node, now || Date.now(), fallbackStartedAt);
}
