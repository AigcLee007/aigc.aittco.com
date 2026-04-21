import { useEffect, useMemo, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { checkTaskStatus, checkVideoTaskStatus, findAllUrlsInObject } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useCanvasStore } from '../store/canvasStore';
import {
  DEFAULT_GENERATION_ERROR_MESSAGE,
  extractErrorMessage,
  toGenerationErrorMessage,
} from '../utils/errorDebug';

const USER_FACING_GENERATION_ERROR_MESSAGE = DEFAULT_GENERATION_ERROR_MESSAGE;

export const useGlobalPolling = (
  apiKey: string | undefined,
  onUpdateGeneration: (id: string, src: string | null, error?: string) => void,
  onUpdateProgress: (id: string, progress: number) => void,
) => {
  const nodes = useCanvasStore((state) => state.nodes);
  const { error: toastError } = useToast();
  void onUpdateProgress;

  const pendingNodes = nodes.filter((n) => n.loading && n.taskId && !n.error);
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
      queryKey: ['task', node.taskId],
      queryFn: async () => {
        if (!node.taskId) return null;
        if (node.type === 'VIDEO' && !apiKey) return null;

        const data =
          node.type === 'VIDEO'
            ? await checkVideoTaskStatus(apiKey, node.taskId)
            : await checkTaskStatus(apiKey, node.taskId);

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
          findAllUrlsInObject(data, resultUrls);
        }

        return {
          taskId: node.taskId,
          status: statusRaw,
          isSuccess,
          isFailed,
          urls: Array.from(new Set(resultUrls)),
          raw: data,
        };
      },
      refetchInterval: (query: any) => {
        const data = query.state.data;
        if (data && (data.isSuccess || data.isFailed)) return false;
        return 5000;
      },
      retry: 3,
      enabled: !!node.taskId && (node.type === 'IMAGE' || !!apiKey),
    })),
  });

  const processedTasksRef = useRef<Map<string, { success: boolean; failed: boolean }>>(new Map());

  useEffect(() => {
    queries.forEach((result) => {
      const data = result.data;
      if (!data || !data.taskId) return;

      const targetNodes = pendingNodes.filter((n) => n.taskId === data.taskId);
      if (!targetNodes.length) return;

      targetNodes.forEach((node) => {
        const processedKey = `${data.taskId}:${node.id}`;
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
          onUpdateGeneration(node.id, selectedUrl);
          return;
        }

        if (data.isFailed && !processedState.failed) {
          processedTasksRef.current.set(processedKey, { ...processedState, failed: true });
          const nextError = toGenerationErrorMessage(
            extractErrorMessage(data.raw?.error || data.raw?.message || data.raw?.details || data.raw),
            USER_FACING_GENERATION_ERROR_MESSAGE,
          );
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
    queries.map((q) => `${q.data?.taskId ?? ''}:${q.data?.status ?? ''}`).join('|'),
    onUpdateGeneration,
    toastError,
  ]);
};

