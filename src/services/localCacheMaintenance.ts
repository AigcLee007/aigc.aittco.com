import { assetStorage } from './assetStorage';
import { useCanvasStore } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { historyManager } from '../commands/HistoryManager';
import { pinnedAssetIds } from './assetStorage';
import { localReadsSafe } from './localHydrationSafety';
import { get, keys } from 'idb-keyval';
import { bounded } from './imageAssetTypes';

const LOCAL_CACHE_MAINTENANCE_KEY = 'infinitemuse-local-cache-maintenance-at';
const LOCAL_CACHE_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const pushAssetId = (target: Set<string>, value?: string | null) => {
  const assetId = String(value || '').trim();
  if (assetId) target.add(assetId);
};

export const collectReferencedAssetIds = (): Set<string> => {
  const ids = new Set<string>();
  useHistoryStore.getState().logs.forEach((log) => pushAssetId(ids, log.assetId));
  useCanvasStore.getState().nodes.forEach((node) => {
    pushAssetId(ids, node.assetId);
    node.history?.forEach((item) => {
      pushAssetId(ids, item.assetId);
      const match = String(item?.src || '').match(/^asset:([a-zA-Z0-9-]+)/);
      if (match?.[1]) pushAssetId(ids, match[1]);
    });
  });
  historyManager.getAssetIds().forEach(id => pushAssetId(ids,id));
  pinnedAssetIds().forEach(id => pushAssetId(ids,id));
  const selectionState = useSelectionStore.getState() as any;
  if (Array.isArray(selectionState.referenceImages)) {
    selectionState.referenceImages.forEach((item: any) => pushAssetId(ids, item?.assetId));
  }
  return ids;
};

const collectReferencedAssetSources = (): Set<string> => {
  const sources = new Set<string>();
  const addSource = (src?: string) => {
    const source = String(src || '').trim();
    if (source && !/^(data:|blob:|asset:)/i.test(source)) sources.add(source);
  };
  useCanvasStore.getState().nodes.forEach(node => {
    addSource(node.src);
    node.history?.forEach(item => addSource(item.src));
  });
  useHistoryStore.getState().logs.forEach(log => addSource(log.imageUrl));
  useSelectionStore.getState().referenceImages.forEach(ref => addSource(ref.src));
  historyManager.getAssetSources().forEach(addSource);
  return sources;
};

export const runLocalCacheMaintenance = async ({ force = false } = {}): Promise<{
  skipped: boolean;
  removed: number;
  kept: number;
}> => {
  // Wait for all persisted references, not a wall-clock guess about hydration.
  const stores = [useCanvasStore, useHistoryStore, useSelectionStore];
  if (!localReadsSafe() || stores.some(store => !store.persist.hasHydrated())) {
    return { skipped: true, removed: 0, kept: 0 };
  }
  if (typeof window !== 'undefined' && !force) {
    const lastRun = Number(window.localStorage.getItem(LOCAL_CACHE_MAINTENANCE_KEY) || 0);
    if (Number.isFinite(lastRun) && Date.now() - lastRun < LOCAL_CACHE_MAINTENANCE_INTERVAL_MS) {
      return { skipped: true, removed: 0, kept: 0 };
    }
  }

  useHistoryStore.getState().compactLogs();
  // Old records may retain only a canonical URL; its shared local copy is still owned.
  // Read all mappings so sources added while cleanup awaits IDB remain protected.
  const sourceIds = new Map<string, string>();
  for (const key of await bounded(keys())) {
    if (typeof key === 'string' && key.startsWith('asset-source-')) {
      const id = await bounded(get<string>(key));
      if (id) sourceIds.set(key.slice(13), id);
    }
  }
  const currentReferences = () => {
    const ids = collectReferencedAssetIds();
    collectReferencedAssetSources().forEach(source => pushAssetId(ids, sourceIds.get(source)));
    return ids;
  };
  const result = await assetStorage.cleanupUnusedAssets(currentReferences(), currentReferences);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_CACHE_MAINTENANCE_KEY, String(Date.now()));
  }

  return {
    skipped: false,
    removed: result.removed,
    kept: result.kept,
  };
};
