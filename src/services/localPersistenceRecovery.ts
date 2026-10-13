import { useCanvasStore } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { localReadFailed } from './localHydrationSafety';

const pendingRetries = new Map<string, Promise<void>>();

export async function retryFailedLocalReads() {
  const stores = [useCanvasStore, useHistoryStore, useSelectionStore];
  await Promise.allSettled(stores.map(store => {
    const name = store.persist.getOptions().name;
    if (!name || !localReadFailed(name)) return;
    const pending = pendingRetries.get(name);
    if (pending) return pending;
    const retry = Promise.resolve().then(() => store.persist.rehydrate()).then(() => undefined)
      .finally(() => { pendingRetries.delete(name); });
    pendingRetries.set(name, retry);
    return retry;
  }));
}
