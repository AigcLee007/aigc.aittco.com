import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_SESSION_CHANGE_EVENT, getStoredAuthSessionToken } from '../services/accountIdentity';
import { clearGenerationRecords, fetchGenerationRecords, type GenerationRecord } from '../services/generationRecordService';
import type { GenerationLog } from '../store/historyStore';
import { imageResultStore } from '../services/imageResultStore';
import { getLocalLine4ThumbnailUrl } from '../utils/generatedImageStorage';

const usableUrl = (value: unknown) => typeof value === 'string' && value.length <= 8192
  && !/\[truncated\]/i.test(value) && /^(https?:\/\/|\/(?!\/))/i.test(value) && !/^\/9j\//.test(value) ? value : '';

function toLogs(records: GenerationRecord[], ownerId: string): GenerationLog[] {
  return records.filter(record => record.userId === ownerId && record.status === 'SUCCESS').flatMap(record => {
    const previews = Array.isArray(record.meta?.previewUrls) ? record.meta.previewUrls : [];
    const urls = record.resultUrls?.length ? record.resultUrls : Array.from({ length: Math.max(1, previews.length) }, () => '');
    const jobId = String(record.meta?.imageJobId || record.taskId || record.id);
    return urls.map((source, slot) => {
      const assetId = record.mediaType === 'IMAGE' ? imageResultStore.resultId(ownerId, jobId, slot) : undefined;
      const imageUrl = usableUrl(source);
      const thumbnailUrl = usableUrl(previews[slot]) || (slot === 0 ? usableUrl(record.previewUrl) : '') || getLocalLine4ThumbnailUrl(imageUrl) || undefined;
      return { id: `account:${record.id}:${slot}`, time: record.createdAt || record.completedAt || '', prompt: record.prompt,
        imageUrl, thumbnailUrl, assetId, type: record.mediaType };
    });
  });
}

type Snapshot = { scope: string; records: GenerationRecord[]; page: number; totalPages: number; loading: boolean; error: string | null };
const empty = (scope: string): Snapshot => ({ scope, records: [], page: 0, totalPages: 1, loading: false, error: null });

export function useAccountGenerationHistory({ enabled, ownerId, mediaType, localLogs }: {
  enabled: boolean; ownerId: string; mediaType: 'image' | 'video'; localLogs: GenerationLog[];
}) {
  const [session, setSession] = useState(getStoredAuthSessionToken);
  useEffect(() => {
    const changed = () => setSession(getStoredAuthSessionToken());
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, changed); window.removeEventListener('storage', changed); };
  }, []);
  const scope = `${ownerId}:${session || ''}:${mediaType}`;
  const current = useRef({ scope, enabled });
  current.current = { scope, enabled };
  const revision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(scope));

  const load = useCallback((page: number) => {
    if (!enabled || !ownerId || !session) return Promise.resolve();
    const version = ++revision.current;
    const isCurrent = () => version === revision.current && current.current.enabled && current.current.scope === scope && session === getStoredAuthSessionToken();
    setSnapshot(previous => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: null }));
    const work = (async () => {
      try {
        const response = await fetchGenerationRecords({ mediaType, status: 'success', page, pageSize: 50 });
        if (!isCurrent()) return;
        setSnapshot(previous => {
          const merged = new Map((previous.scope === scope ? previous.records : []).map(record => [record.id, record]));
          response.records.filter(record => record.userId === ownerId).forEach(record => merged.set(record.id, record));
          return { scope, records: [...merged.values()], page: Math.max(page, previous.scope === scope ? previous.page : 0), totalPages: response.totalPages, loading: false, error: null };
        });
      } catch {
        if (isCurrent()) setSnapshot(previous => ({ ...previous, loading: false, error: '账号历史暂时读取失败，已有记录已保留' }));
      }
    })();
    inFlight.current = work;
    void work.finally(() => { if (inFlight.current === work) inFlight.current = null; });
    return work;
  }, [enabled, ownerId, session, mediaType, scope]);

  useEffect(() => { void load(1); return () => { revision.current++; }; }, [load]);
  const active = snapshot.scope === scope && session === getStoredAuthSessionToken() ? snapshot : empty(scope);
  const remoteLogs = useMemo(() => toLogs(active.records, ownerId), [active.records, ownerId]);
  const logs = useMemo(() => {
    const results = new Map(remoteLogs.map(log => [log.assetId || log.id, log]));
    for (const log of localLogs) {
      // Explicitly owned local results from a different account are never merged.
      if (log.assetId?.startsWith('result:v1:') && !log.assetId.startsWith(`result:v1:${encodeURIComponent(ownerId)}:`)) continue;
      if (!results.has(log.assetId || log.id)) results.set(log.assetId || log.id, log);
    }
    return [...results.values()].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
  }, [localLogs, remoteLogs, ownerId]);

  const clearAccountHistory = async () => {
    if (!ownerId || !session || session !== getStoredAuthSessionToken()) return;
    await clearGenerationRecords({ mediaType: 'all' });
    if (session !== getStoredAuthSessionToken()) return;
    revision.current++;
    setSnapshot({ ...empty(scope), totalPages: 0 });
  };

  return { logs, remoteLogs, loading: active.loading, error: active.error, hasMore: active.page > 0 && active.page < active.totalPages,
    refresh: () => load(1), loadMore: () => inFlight.current || load(active.page + 1), clearAccountHistory };
}
