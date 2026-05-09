import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';

const MAX_HISTORY_LOGS = 50;

export interface GenerationLog {
  id: string;
  time: string;
  prompt: string;
  imageUrl: string;
  thumbnailUrl?: string;
  assetId?: string;
  type: 'IMAGE' | 'VIDEO';
}

interface HistoryStore {
  logs: GenerationLog[];
  addLog: (prompt: string, imageUrl: string, assetId?: string, type?: 'IMAGE' | 'VIDEO', thumbnailUrl?: string) => string;
  updateLogAsset: (id: string, assetId: string, imageUrl?: string, thumbnailUrl?: string) => void;
  compactLogs: () => void;
  clearLogs: () => void;
  getRecentLogs: (count: number) => GenerationLog[];
}

const isInlineDataUrl = (value?: string | null): boolean =>
  typeof value === 'string' && value.trim().toLowerCase().startsWith('data:');

const cleanUrlForLocalHistory = (value?: string | null): string =>
  isInlineDataUrl(value) ? '' : String(value || '').trim();

const sanitizeHistoryLog = (log: Partial<GenerationLog> | null | undefined, allowEmptyAsset = false): GenerationLog | null => {
  if (!log || typeof log !== 'object') return null;
  const imageUrl = cleanUrlForLocalHistory(log.imageUrl);
  const thumbnailUrl = cleanUrlForLocalHistory(log.thumbnailUrl) || undefined;
  const assetId = String(log.assetId || '').trim() || undefined;
  if (!allowEmptyAsset && !imageUrl && !thumbnailUrl && !assetId) return null;
  return {
    id: String(log.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    time: String(log.time || new Date().toISOString()),
    prompt: String(log.prompt || ''),
    imageUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(assetId ? { assetId } : {}),
    type: log.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
  };
};

const sanitizeHistoryLogs = (logs: Partial<GenerationLog>[] = []): GenerationLog[] =>
  (Array.isArray(logs) ? logs : [])
    .map((log) => sanitizeHistoryLog(log))
    .filter((log): log is GenerationLog => Boolean(log))
    .slice(0, MAX_HISTORY_LOGS);

const indexedDbHistoryStorage: StateStorage = {
  getItem: async (name: string) => {
    const value = await get<string>(name);
    if (typeof value === 'string') return value;
    if (typeof window !== 'undefined' && window.localStorage) {
      const legacyValue = window.localStorage.getItem(name);
      if (legacyValue) {
        await set(name, legacyValue);
        window.localStorage.removeItem(name);
        return legacyValue;
      }
    }
    return null;
  },
  setItem: async (name: string, value: string) => {
    await set(name, value);
  },
  removeItem: async (name: string) => {
    await del(name);
  },
};

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      logs: [],

      addLog: (prompt: string, imageUrl: string, assetId?: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE', thumbnailUrl?: string) => {
        const id = `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newLog = sanitizeHistoryLog({
          id,
          time: new Date().toISOString(),
          prompt,
          imageUrl,
          thumbnailUrl,
          assetId,
          type,
        }, true);
        if (!newLog) return id;
        set(state => ({
          logs: [newLog, ...sanitizeHistoryLogs(state.logs)].slice(0, MAX_HISTORY_LOGS)
        }));
        return newLog.id;
      },

      updateLogAsset: (id: string, assetId: string, imageUrl?: string, thumbnailUrl?: string) =>
        set(state => ({
          logs: sanitizeHistoryLogs(state.logs.map(log => {
            if (log.id !== id) return log;
            const nextImageUrl = cleanUrlForLocalHistory(imageUrl) || log.imageUrl;
            const nextThumbnailUrl = cleanUrlForLocalHistory(thumbnailUrl) || log.thumbnailUrl;
            return {
              ...log,
              assetId,
              imageUrl: nextImageUrl,
              ...(nextThumbnailUrl ? { thumbnailUrl: nextThumbnailUrl } : {}),
            };
          }))
        })),

      compactLogs: () =>
        set(state => ({
          logs: sanitizeHistoryLogs(state.logs)
        })),

      clearLogs: () => set({ logs: [] }),

      getRecentLogs: (count: number) => {
        return get().logs.slice(0, count);
      },
    }),
    {
      name: 'infinitemuse-history',
      storage: createJSONStorage(() => indexedDbHistoryStorage),
      partialize: (state) => ({ logs: sanitizeHistoryLogs(state.logs) }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        logs: sanitizeHistoryLogs((persistedState as Partial<HistoryStore> | null)?.logs || []),
      }),
    }
  )
);
