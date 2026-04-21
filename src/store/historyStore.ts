/**
 * History Store - 生成历史记录存储
 * 使用 zustand persist 中间件持久化到 localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GenerationLog {
  id: string;
  time: string;        // ISO timestamp
  prompt: string;
  imageUrl: string;    // Base64 or URL
  assetId?: string;    // ID for IndexedDB blob resolution
  type: 'IMAGE' | 'VIDEO';
}

interface HistoryStore {
  logs: GenerationLog[];
  addLog: (prompt: string, imageUrl: string, assetId?: string, type?: 'IMAGE' | 'VIDEO') => string;
  updateLogAsset: (id: string, assetId: string, imageUrl?: string) => void;
  clearLogs: () => void;
  getRecentLogs: (count: number) => GenerationLog[];
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      logs: [],

      addLog: (prompt: string, imageUrl: string, assetId?: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE') => {
        const newLog: GenerationLog = {
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          time: new Date().toISOString(),
          prompt,
          imageUrl,
          assetId,
          type,
        };
        set(state => ({
          logs: [newLog, ...state.logs].slice(0, 500) // 最多保留 500 条
        }));
        return newLog.id;
      },

      updateLogAsset: (id: string, assetId: string, imageUrl?: string) =>
        set(state => ({
          logs: state.logs.map(log =>
            log.id === id
              ? { ...log, assetId, ...(imageUrl ? { imageUrl } : {}) }
              : log
          )
        })),

      clearLogs: () => set({ logs: [] }),

      getRecentLogs: (count: number) => {
        return get().logs.slice(0, count);
      },
    }),
    {
      name: 'infinitemuse-history',
      partialize: (state) => ({ logs: state.logs }),
    }
  )
);
