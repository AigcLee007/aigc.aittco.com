import { assetStorage } from './assetStorage';
import { useCanvasStore } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';

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
      const match = String(item?.src || '').match(/asset-([a-zA-Z0-9-]+)/);
      if (match?.[1]) pushAssetId(ids, match[1]);
    });
  });
  const selectionState = useSelectionStore.getState() as any;
  if (Array.isArray(selectionState.referenceImages)) {
    selectionState.referenceImages.forEach((item: any) => pushAssetId(ids, item?.assetId));
  }
  return ids;
};

export const runLocalCacheMaintenance = async ({ force = false } = {}): Promise<{
  skipped: boolean;
  removed: number;
  kept: number;
}> => {
  if (typeof window !== 'undefined' && !force) {
    const lastRun = Number(window.localStorage.getItem(LOCAL_CACHE_MAINTENANCE_KEY) || 0);
    if (Number.isFinite(lastRun) && Date.now() - lastRun < LOCAL_CACHE_MAINTENANCE_INTERVAL_MS) {
      return { skipped: true, removed: 0, kept: 0 };
    }
  }

  useHistoryStore.getState().compactLogs();
  const activeAssetIds = collectReferencedAssetIds();
  const result = await assetStorage.cleanupUnusedAssets(activeAssetIds);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_CACHE_MAINTENANCE_KEY, String(Date.now()));
  }

  return {
    skipped: false,
    removed: result.removed,
    kept: result.kept,
  };
};
