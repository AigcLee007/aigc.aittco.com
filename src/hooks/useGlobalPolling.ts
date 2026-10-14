import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkTaskStatus, checkVideoTaskStatus, findAllUrlsInObject } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useCanvasStore, persistImageJobCredentials } from '../store/canvasStore';
import { extractErrorMessage } from '../utils/errorDebug';
import { getImageJobOwner, isTransientJobError, queryImageJob } from '../services/imageJobClient';
import { buildBillingIdentityHeaders, getStoredAuthSessionToken } from '../services/accountIdentity';
import { listImageRequests, removeImageRequest } from '../services/imageJobRequests';

export const useGlobalPolling = (
  apiKey: string | undefined,
  onUpdateGeneration: (id: string, src: string | null, error?: string) => void,
  onUpdateProgress: (id: string, progress: number) => void,
) => {
  const nodes = useCanvasStore((state) => state.nodes);
  const { error: toastError } = useToast();
  void onUpdateProgress;
  const [ownerId, setOwnerId] = useState('');

  useEffect(() => {
    const submitting = (event: Event) => {
      const { nodeIds, clientRequestId, owner } = (event as CustomEvent).detail;
      nodeIds.forEach((id: string) => useCanvasStore.getState().updateNode(id, {
        clientRequestId, generationOwnerId: owner, generationStartedAt: Date.now(),
        taskId: `request-${clientRequestId}`, loading: true, error: false,
      }, true));
    };
    window.addEventListener('image-job-submitting', submitting);
    return () => window.removeEventListener('image-job-submitting', submitting);
  }, []);

  useEffect(() => {
    let active = true, busy = false;
    const recover = async () => {
      if (busy) return;
      const session = getStoredAuthSessionToken();
      if (!session) { setOwnerId(''); return; }
      busy = true;
      try {
        const headers = buildBillingIdentityHeaders(session);
        const owner = await getImageJobOwner(headers);
        if (!active || session !== getStoredAuthSessionToken()) return;
        setOwnerId(owner);
        const savedRequests = await listImageRequests(owner).catch(() => []);
        if (!active || session !== getStoredAuthSessionToken()) return;
        for (const request of savedRequests) for (const id of request.nodeIds) {
          const state = useCanvasStore.getState();
          const existing = state.nodes.find(node => node.id === id);
          if (existing) {
            if (existing.loading && (!existing.generationOwnerId || existing.generationOwnerId === owner)) state.updateNode(id, {
              clientRequestId: request.requestId, generationOwnerId: owner, generationStartedAt: request.createdAt,
              taskId: request.taskId || `request-${request.requestId}`,
            }, true);
            continue;
          }
          state.addNode({ id, type: 'IMAGE', x: 360 + state.nodes.length % 4 * 532, y: 100,
            width: 512, height: 512, opacity: 1, locked: false, loading: true, src: '', prompt: request.prompt,
            clientRequestId: request.requestId, generationOwnerId: owner, generationStartedAt: request.createdAt,
            taskId: request.taskId || `request-${request.requestId}`, history: [], historyIndex: 0,
          }, true);
        }
        const response = await fetch('/api/image-jobs?uiMode=canvas&limit=100', { headers });
        if (!response.ok) return;
        const data = await response.json();
        if (!active || session !== getStoredAuthSessionToken()) return;
        for (const job of data.jobs || []) {
          const state = useCanvasStore.getState();
          const requestId = job.clientRequestId || job.requestId || job.request_id;
          const taskId = job.task_id || job.taskId || job.id;
          if (!taskId) continue;
          const liveIds = job.clientLiveTaskIds || job.client_live_task_ids || [];
          for (const id of liveIds) {
            const existing = state.nodes.find(node => node.id === id);
            if (existing?.loading && !existing.generationOwnerId) state.updateNode(id, { clientRequestId: requestId, generationOwnerId: owner, taskId }, true);
          }
          try { await persistImageJobCredentials(); await removeImageRequest(owner, requestId); } catch { /* Keep receipt until nodes are durable. */ }
          if (!active || session !== getStoredAuthSessionToken()) return;
          const matches = state.nodes.filter(node => node.type === 'IMAGE' && (node.generationOwnerId === owner || (!node.generationOwnerId && node.loading && liveIds.includes(node.id))) && (node.clientRequestId === requestId || node.taskId === taskId || liveIds.includes(node.id)));
          for (const node of matches) {
            if (node.loading || node.generationConnectionStatus === 'recovering' || node.generationConnectionStatus === 'unconfirmed' || (node.generationConnectionStatus === 'result-unavailable' && job.images?.length)) state.updateNode(node.id, { taskId, loading: true, error: false }, true);
            // Saving a remote result runs after generation; upgrade the URL without a second download/log.
            if (!node.loading && !node.error && node.src && (!node.generationResultSrc || node.src === node.generationResultSrc) && ['succeeded', 'success'].includes(String(job.status).toLowerCase())) {
              const urls = job.results || job.images || job.data?.map((item: any) => item.url) || [];
              const siblings = matches.filter(item => !item.loading && !item.error);
              const slot = node.generationResultIndex ?? (String(job.model || '').toLowerCase().startsWith('grok') && siblings.length === 1
                ? urls.length - 1 : siblings.findIndex(item => item.id === node.id));
              const url = urls[Math.min(Math.max(slot, 0), urls.length - 1)];
              state.updateNode(node.id, {
                ...(typeof url === 'string' ? { src: url, generationResultSrc: url } : {}),
                ...(job.preview_url && slot === 0 ? { thumbnailSrc: job.preview_url } : {}),
                generationStorageStatus: job.storage_status,
              }, true);
            }
          }
        }
      } catch { /* An offline page keeps its persisted task credentials. */ }
      finally { busy = false; }
    };
    void recover();
    const timer = setInterval(recover, 30_000);
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    const changeOwner = () => { setOwnerId(''); void recover(); };
    const storedOwnerChanged = (event: StorageEvent) => { if (event.key === 'auth-session-v1') changeOwner(); };
    window.addEventListener('auth-session-change', changeOwner);
    window.addEventListener('storage', storedOwnerChanged);
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', recover); window.removeEventListener('focus', recover); window.removeEventListener('auth-session-change', changeOwner); window.removeEventListener('storage', storedOwnerChanged); };
  }, []);

  const pendingNodes = nodes.filter((n) => n.loading && n.taskId && !n.error && (!n.generationOwnerId || n.generationOwnerId === ownerId));
  const pendingTasks = useMemo(() => {
    const map = new Map<string, (typeof pendingNodes)[number]>();
    for (const node of pendingNodes) {
      if (!node.taskId) continue;
      if (!map.has(node.taskId)) {
        map.set(node.taskId, node);
      }
    }
    return Array.from(map.values());
  }, [pendingNodes]);

  const queries = useQueries({
    queries: pendingTasks.map((node) => ({
      queryKey: ['task', node.generationOwnerId || ownerId, node.taskId],
      queryFn: async () => {
        if (!node.taskId) return null;
        if (node.type === 'VIDEO' && !apiKey) return null;

        const session = getStoredAuthSessionToken();
        if (node.generationOwnerId) {
          if (!session || await getImageJobOwner(buildBillingIdentityHeaders(session)) !== node.generationOwnerId || session !== getStoredAuthSessionToken()) return null;
        }
        const data =
          node.type === 'VIDEO'
            ? await checkVideoTaskStatus(apiKey, node.taskId)
            : node.taskId.startsWith('request-') && node.generationOwnerId
            ? await queryImageJob(node.taskId, buildBillingIdentityHeaders(session || ''), '/api', node.generationOwnerId)
            : await checkTaskStatus(apiKey, node.taskId);
        if (session !== getStoredAuthSessionToken()) return null;

        let statusRaw = String(data.status || data.state || '').toUpperCase();
        if (!statusRaw || statusRaw === 'UNKNOWN') {
          const findStatusInObject = (obj: any): string | null => {
            if (!obj || typeof obj !== 'object') return null;
            if (typeof obj.status === 'string') return obj.status;
            if (typeof obj.state === 'string') return obj.state;
            if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
            return null;
          };
          const nestedStatus = findStatusInObject(data);
          if (nestedStatus) statusRaw = nestedStatus.toUpperCase();
        }

        const isSuccess =
          statusRaw === 'SUCCESS' || statusRaw === 'SUCCEEDED' || statusRaw === 'COMPLETED';
        const isFailed =
          statusRaw === 'FAILURE' ||
          statusRaw === 'FAILED' ||
          statusRaw === 'ERROR' ||
          statusRaw === 'CANCELLED' ||
          statusRaw === 'CANCELED';

        const resultUrls: string[] = [];
        if (isSuccess) {
          if (node.taskId.startsWith('job-') || node.taskId.startsWith('request-')) {
            for (const url of data.images || data.results || []) if (typeof url === 'string') resultUrls.push(url);
            for (const item of data.data || []) if (typeof item.url === 'string') resultUrls.push(item.url);
          } else findAllUrlsInObject(data, resultUrls);
        }

        return {
          taskId: node.taskId,
          status: statusRaw,
          isSuccess,
          isFailed,
          urls: Array.from(new Set(resultUrls)),
          raw: isSuccess && !resultUrls.length ? { ...data, error: '任务结果未返回图片，请查看历史记录或联系管理员核对' } : data,
        };
      },
      refetchInterval: (query: any) => {
        const data = query.state.data;
        if (data && (data.isSuccess || data.isFailed)) return false;
        return 5000;
      },
      retry: 3,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      enabled: !!node.taskId && (node.type === 'IMAGE' || !!apiKey),
    })),
  });

  const processedTasksRef = useRef<Map<string, { success: boolean; failed: boolean }>>(new Map());

  useEffect(() => {
    queries.forEach((result, index) => {
      const data = result.data;
      const taskNode = pendingTasks[index];
      const fallbackTaskId = taskNode?.taskId || '';

      if (result.error && fallbackTaskId) {
        // A failed status query does not prove a failed generation (including expired login).
        if (taskNode?.type === 'IMAGE' || isTransientJobError(result.error)) {
          pendingNodes.filter(n => n.taskId === fallbackTaskId).forEach(node => {
            if (node.generationConnectionStatus !== 'recovering') useCanvasStore.getState().updateNode(node.id, { generationConnectionStatus: 'recovering' }, true);
          });
          return;
        }
        const targetNodes = pendingNodes.filter((n) => n.taskId === fallbackTaskId);
        targetNodes.forEach((node) => {
          const processedKey = `${fallbackTaskId}:${node.id}`;
          const processedState = processedTasksRef.current.get(processedKey) || {
            success: false,
            failed: false,
          };
          if (processedState.failed) return;
          processedTasksRef.current.set(processedKey, { ...processedState, failed: true });
          const nextError = extractErrorMessage(result.error) || '任务查询失败，未返回错误详情';
          onUpdateGeneration(node.id, null, nextError);
          toastError(nextError);
        });
        return;
      }

      if (!data || !data.taskId) return;

      const targetNodes = pendingNodes.filter((n) => n.taskId === data.taskId);
      if (!targetNodes.length) return;

      targetNodes.forEach((node) => {
        // A request lookup can finish before its original POST acknowledgement.
        // Promote the durable ID before completion so a late acknowledgement
        // cannot reopen the same completed task under its synthetic alias.
        const resolvedTaskId = String(data.raw?.task_id || '');
        if ((data.isSuccess || data.isFailed) && resolvedTaskId.startsWith('job-') && node.taskId !== resolvedTaskId) {
          useCanvasStore.getState().updateNode(node.id, { taskId: resolvedTaskId }, true);
        }
        if (data.isSuccess && data.urls.length === 0) {
          useCanvasStore.getState().updateNode(node.id, { loading: false, error: false, generationConnectionStatus: 'result-unavailable', generationStorageStatus: 'failed' }, true);
          return;
        }
        if (node.generationConnectionStatus !== data.raw?.connection_status) useCanvasStore.getState().updateNode(node.id, { generationConnectionStatus: data.raw?.connection_status }, true);
        const processedKey = `${resolvedTaskId.startsWith('job-') ? resolvedTaskId : data.taskId}:${node.id}`;
        const processedState = processedTasksRef.current.get(processedKey) || {
          success: false,
          failed: false,
        };

        if (data.isSuccess && !processedState.success && data.urls.length > 0) {
          processedTasksRef.current.set(processedKey, { ...processedState, success: true });
          const nodeIndex = targetNodes.findIndex((n) => n.id === node.id);
          const urlIndex = Math.min(Math.max(nodeIndex, 0), data.urls.length - 1);
          const responseModel = String(
            data.raw?.properties?.model || data.raw?.model || '',
          ).toLowerCase();
          const isSingleNodeGrok =
            targetNodes.length === 1 && responseModel.startsWith('grok') && data.urls.length > 1;
          const selectedUrl = isSingleNodeGrok
            ? data.urls[data.urls.length - 1]
            : data.urls[urlIndex] || data.urls[0];
          useCanvasStore.getState().updateNode(node.id, { generationResultIndex: isSingleNodeGrok ? data.urls.length - 1 : urlIndex, generationResultSrc: selectedUrl }, true);
          if (data.raw?.preview_url || data.raw?.storage_status) useCanvasStore.getState().updateNode(node.id, { thumbnailSrc: !isSingleNodeGrok && urlIndex === 0 ? data.raw?.preview_url || undefined : undefined, generationStorageStatus: data.raw?.storage_status }, true);
          onUpdateGeneration(node.id, selectedUrl);
          return;
        }

        if (data.isFailed && !processedState.failed) {
          processedTasksRef.current.set(processedKey, { ...processedState, failed: true });
          const nextError = extractErrorMessage(data.raw) || '任务失败，未返回错误详情';
          onUpdateGeneration(node.id, null, nextError);
          toastError(nextError);
        }
      });
    });

    if (processedTasksRef.current.size > 50) {
      const entries = Array.from(processedTasksRef.current.entries());
      processedTasksRef.current = new Map(entries.slice(-100));
    }
  }, [
    pendingNodes,
    pendingTasks,
    queries.map((q) => `${q.data?.taskId ?? ''}:${q.data?.status ?? ''}`).join('|'),
    queries.map((q) => `${q.error ? 'E' : 'O'}:${q.error ? extractErrorMessage(q.error) : ''}`).join('|'),
    onUpdateGeneration,
    toastError,
  ]);
};
