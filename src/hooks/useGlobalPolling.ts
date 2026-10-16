import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { checkTaskStatus, checkVideoTaskStatus, findAllUrlsInObject } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useCanvasStore } from '../store/canvasStore';
import { extractErrorMessage } from '../utils/errorDebug';
import { readTaskProgress } from '../utils/generationProgress';

export const useGlobalPolling = (
  apiKey: string | undefined,
  onUpdateGeneration: (id: string, src: string | null, error?: string) => void,
  onUpdateProgress: (id: string, progress: number, source?: 'reported' | 'estimated') => void,
) => {
  const nodes = useCanvasStore((state) => state.nodes);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const { error: toastError } = useToast();
  const taskStartedAtRef = useRef(new Map<string, number>());
  const processedTasksRef = useRef<Map<string, { success: boolean; failed: boolean }>>(new Map());
  const IMAGE_WAIT_MAX_MS = 30 * 60 * 1000;
  const waitTimeoutMessage = '等待结果超时，结果未确认。请先查看历史记录，避免重复提交扣点。';

  const waitingImages = useMemo(() => nodes.filter((n) => n.loading && n.type === 'IMAGE' && !n.error), [nodes]);
  const pendingNodes = useMemo(() => nodes.filter((n) => n.loading && n.taskId && !n.error), [nodes]);
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
  for (const node of waitingImages) {
    const waitingKey = node.taskId || node.id;
    if (!taskStartedAtRef.current.has(waitingKey)) {
      taskStartedAtRef.current.set(waitingKey, node.generationStartedAt || Date.now());
    }
  }

  useEffect(() => {
    const timers = waitingImages.map((node) => {
      const waitingKey = node.taskId || node.id;
      const startedAt = taskStartedAtRef.current.get(waitingKey) || Date.now();
      return setTimeout(() => {
        const processedKey = `${waitingKey}:${node.id}`;
        const processed = processedTasksRef.current.get(processedKey);
        if (processed?.success || processed?.failed) return;
        processedTasksRef.current.set(processedKey, { success: false, failed: true });
        onUpdateGeneration(node.id, null, waitTimeoutMessage);
        toastError(waitTimeoutMessage);
      }, Math.max(0, IMAGE_WAIT_MAX_MS - (Date.now() - startedAt)));
    });
    return () => timers.forEach(clearTimeout);
  }, [waitingImages, onUpdateGeneration, toastError]);

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

        let statusRaw = String(data.status || data.state || '').trim().toUpperCase();
        if (!statusRaw || statusRaw === 'UNKNOWN') {
          const findStatusInObject = (obj: any): string | null => {
            if (!obj || typeof obj !== 'object') return null;
            if (typeof obj.status === 'string') return obj.status;
            if (typeof obj.state === 'string') return obj.state;
            if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
            return null;
          };
          const nestedStatus = findStatusInObject(data);
          if (nestedStatus) statusRaw = nestedStatus.trim().toUpperCase();
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
        const successWithoutImage = node.type === 'IMAGE' && isSuccess && resultUrls.length === 0;

        return {
          taskId: node.taskId,
          status: statusRaw,
          progress: readTaskProgress(data),
          isSuccess,
          isFailed: isFailed || successWithoutImage,
          urls: Array.from(new Set(resultUrls)),
          raw: successWithoutImage
            ? { ...data, error: '任务返回成功状态但未返回图片，结果未确认。请先查看历史记录，避免重复提交。' }
            : data,
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

  useEffect(() => {
    queries.forEach((result, index) => {
      const data = result.data;
      const taskNode = pendingTasks[index];
      const fallbackTaskId = taskNode?.taskId || '';

      if (result.error && fallbackTaskId) {
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
        const processedKey = `${data.taskId}:${node.id}`;
        const processedState = processedTasksRef.current.get(processedKey) || {
          success: false,
          failed: false,
        };

        if (processedState.success || processedState.failed) return;
        if (!data.isSuccess && !data.isFailed) {
          if (data.status && node.generationStatus !== data.status) {
            updateNode(node.id, { generationStatus: data.status }, true);
          }
          if (data.progress !== undefined && (node.progressSource !== 'reported' || data.progress > (node.progress ?? 0))) {
            onUpdateProgress(node.id, data.progress, 'reported');
          }
        }

        if (data.isSuccess && !processedState.success && !processedState.failed && data.urls.length > 0) {
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
    queries.map((q) => `${q.data?.taskId ?? ''}:${q.data?.status ?? ''}:${q.data?.progress ?? ''}`).join('|'),
    queries.map((q) => `${q.error ? 'E' : 'O'}:${q.error ? extractErrorMessage(q.error) : ''}`).join('|'),
    onUpdateGeneration,
    onUpdateProgress,
    updateNode,
    toastError,
  ]);
};
