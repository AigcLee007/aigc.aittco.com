import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { NodeData } from '../../types';
import { useCanvasStore } from '../store/canvasStore';
import { assetStorage, isValidAssetBlob } from '../services/assetStorage';
import {
  AUTH_SESSION_CHANGE_EVENT,
  fetchCurrentAuthSession,
  getStoredAuthSessionToken,
} from '../services/accountIdentity';
import { getImageJobOwner, isTransientJobError, REQUEST_TASK_PREFIX } from '../services/imageJobClient';
import { buildBillingIdentityHeaders } from '../services/accountIdentity';
import { blobToDataUrl } from '../services/imageBlobUtils';
import { getImageModelNameForRoute, getImageRouteById } from '../config/imageRoutes';
import { submitBatchImageRequest } from '../services/batchImageRequest';
import { getBatchRoutes, getBatchSizes } from '../services/batchGenerationOptions';
import {
  deleteBatchGeneration,
  listBatchGenerations,
  readBatchGeneration,
  saveBatchGeneration,
  updateBatchGeneration,
} from '../services/batchGenerationStore';
import { BatchGenerationCoordinator } from '../services/batchGenerationCoordinator';
import type {
  BatchGenerationRecord,
  BatchGenerationSettings,
  BatchGenerationTask,
  BatchInputGroup,
  BatchMode,
} from '../services/batchGenerationTypes';
import type { BatchPlaceholderRequest } from './useGenerationLogic';

export interface UseBatchGenerationOptions {
  apiKey?: string | null;
  ownerId?: string;
  canvasHydrated?: boolean;
  initializeBatchGenerations: (
    items: BatchPlaceholderRequest[],
    options?: { focus?: boolean; preserveToolMode?: boolean },
  ) => Record<string, string>;
  onUpdateGeneration: (
    id: string,
    src: string | null,
    error?: string,
    taskId?: string,
  ) => Promise<unknown> | unknown;
}

export const MAX_BATCH_OUTPUT_COUNT = 16;

const newTask = (group: BatchInputGroup, outputIndex: number): BatchGenerationTask => ({
  id: uuidv4(),
  groupId: group.id,
  prompt: group.prompt,
  referenceAssetIds: [...group.referenceAssetIds],
  outputIndex,
  requestId: uuidv4(),
  status: 'pending',
});

const clampOutputCount = (value: number) =>
  Math.min(MAX_BATCH_OUTPUT_COUNT, Math.max(1, Math.floor(Number.isFinite(value) ? value : 1)));

const imageRequestOwner = async (apiKey?: string | null) => {
  const session = getStoredAuthSessionToken();
  if (session) {
    const current = await fetchCurrentAuthSession().catch(() => null);
    if (session !== getStoredAuthSessionToken()) return '';
    if (current?.authenticated && current.user?.userId) return current.user.userId;
    return '';
  }

  if (!apiKey) return 'local';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `local-key:${fingerprint}`;
  } catch {
    return 'local';
  }
};

const terminalNode = (node?: NodeData) => {
  if (!node) return true;
  return !node.loading && Boolean(node.src || node.error || node.generationConnectionStatus === 'result-unavailable');
};

function waitForCanvasNode(nodeId: string): Promise<NodeData | undefined> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const check = () => {
      const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      if (terminalNode(node)) {
        unsubscribe();
        resolve(node);
      }
    };

    unsubscribe = useCanvasStore.subscribe(check);
    check();
  });
}

const canvasTaskStatus = (task: BatchGenerationTask, node: NodeData) => {
  if (node.error || node.generationConnectionStatus === 'result-unavailable') {
    return { status: 'failed' as const, error: node.errorMessage || '生成结果不可用' };
  }
  if (!node.loading && node.src) {
    return { status: 'succeeded' as const, resultUrl: node.src, error: undefined };
  }
  if (!node.loading || !node.taskId) return null;
  if (node.generationConnectionStatus === 'recovering' || node.generationConnectionStatus === 'unconfirmed' || node.taskId.startsWith('request-')) {
    return { status: 'awaiting-confirmation' as const };
  }
  const status = String(node.generationStatus || '').toUpperCase();
  return {
    status: status === 'RUNNING' || status === 'PROCESSING' ? 'running' as const : 'queued' as const,
    progress: node.progress,
  };
};

export function useBatchGeneration({
  apiKey,
  ownerId: ownerIdOverride,
  canvasHydrated = true,
  initializeBatchGenerations,
  onUpdateGeneration,
}: UseBatchGenerationOptions) {
  const [ownerId, setOwnerId] = useState(ownerIdOverride || '');
  const [batches, setBatches] = useState<BatchGenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const batchesRef = useRef<BatchGenerationRecord[]>([]);
  const ownerRef = useRef(ownerId);
  const coordinatorRef = useRef(new BatchGenerationCoordinator());
  const pauseRequestedRef = useRef(new Set<string>());
  const reconcilingRef = useRef(false);
  const resyncRef = useRef(false);
  const startingRef = useRef(false);

  const replaceBatches = useCallback((next: BatchGenerationRecord[]) => {
    batchesRef.current = next;
    setBatches(next);
  }, []);

  const replaceBatch = useCallback((next: BatchGenerationRecord) => {
    const batchesNow = batchesRef.current.filter((batch) => batch.id !== next.id);
    batchesNow.push(next);
    batchesNow.sort((left, right) => right.updatedAt - left.updatedAt);
    replaceBatches(batchesNow);
  }, [replaceBatches]);

  const persistBatchChange = useCallback(async (
    batchId: string,
    change: (current: BatchGenerationRecord) => BatchGenerationRecord,
    currentOwner = ownerRef.current,
  ) => {
    if (!currentOwner) throw new Error('批次账户尚未就绪');
    const next = await updateBatchGeneration(currentOwner, batchId, change);
    if (ownerRef.current === currentOwner) replaceBatch(next);
    return next;
  }, [replaceBatch]);

  useEffect(() => {
    let revision = 0;
    const refreshOwner = () => {
      if (coordinatorRef.current.getActiveBatchId()) {
        const activeId = coordinatorRef.current.getActiveBatchId();
        if (activeId) {
          const activeBatch = batchesRef.current.find((batch) => batch.id === activeId);
          pauseRequestedRef.current.add(activeId);
          coordinatorRef.current.pause(activeId);
          if (activeBatch) {
            void persistBatchChange(activeId, (record) => ({ ...record, status: 'paused' }), activeBatch.ownerId).catch(console.error);
          }
        }
      }
      const version = ++revision;
      ownerRef.current = '';
      setOwnerId('');
      replaceBatches([]);
      setLoading(true);
      void Promise.resolve(ownerIdOverride || imageRequestOwner(apiKey)).then(async (nextOwner) => {
        const saved = await listBatchGenerations(nextOwner);
        if (version !== revision) return;
        ownerRef.current = nextOwner;
        setOwnerId(nextOwner);
        replaceBatches(saved);
      }).catch(console.error).finally(() => {
        if (version === revision) setLoading(false);
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'billing-auth-session') refreshOwner();
    };
    refreshOwner();
    if (!ownerIdOverride) {
      window.addEventListener(AUTH_SESSION_CHANGE_EVENT, refreshOwner);
      window.addEventListener('storage', onStorage);
    }
    return () => {
      revision++;
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, refreshOwner);
      window.removeEventListener('storage', onStorage);
    };
  }, [apiKey, ownerIdOverride, persistBatchChange, replaceBatches]);

  const createBatch = useCallback(async (
    mode: BatchMode,
    settings: BatchGenerationSettings,
    title = mode === 't2i' ? '文生图批次' : '图生图批次',
  ) => {
    const currentOwner = ownerRef.current;
    if (!currentOwner) throw new Error('批次账户尚未就绪');
    const now = Date.now();
    const batch: BatchGenerationRecord = {
      id: uuidv4(),
      ownerId: currentOwner,
      schemaVersion: 1,
      title,
      mode,
      status: 'draft',
      settings: { ...settings, outputCount: clampOutputCount(settings.outputCount) },
      groups: [],
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveBatchGeneration(batch);
    if (ownerRef.current === currentOwner) replaceBatch(batch);
    return batch.id;
  }, [replaceBatch]);

  const replaceGroups = useCallback(async (batchId: string, groups: BatchInputGroup[] | ((groups: BatchInputGroup[]) => BatchInputGroup[])) => {
    await persistBatchChange(batchId, (record) => {
      if (record.status !== 'draft' || startingRef.current) throw new Error('只有草稿批次可以编辑输入清单');
      const normalized = (typeof groups === 'function' ? groups(record.groups) : groups).map((group) => ({
        ...group,
        outputCount: clampOutputCount(group.outputCount),
        referenceAssetIds: [...group.referenceAssetIds],
      }));
      const previous = new Map(record.tasks.map((task) => [`${task.groupId}:${task.outputIndex}`, task]));
      const tasks = normalized.filter((group) => group.enabled).flatMap((group) =>
        Array.from({ length: group.outputCount }, (_, outputIndex) => ({
          ...(previous.get(`${group.id}:${outputIndex}`) || newTask(group, outputIndex)),
          prompt: group.prompt,
          referenceAssetIds: [...group.referenceAssetIds],
        })),
      );
      return { ...record, groups: normalized, tasks };
    });
  }, [persistBatchChange]);

  const updateSettings = useCallback(async (batchId: string, updates: Partial<BatchGenerationSettings>, title?: string) => {
    await persistBatchChange(batchId, (record) => {
      if (record.status !== 'draft' || startingRef.current) throw new Error('批次配置已锁定');
      return {
        ...record,
        title: title?.trim() || record.title,
        settings: { ...record.settings, ...updates, outputCount: clampOutputCount(updates.outputCount ?? record.settings.outputCount) },
      };
    });
  }, [persistBatchChange]);

  const updateTask = useCallback(async (
    batchId: string,
    taskId: string,
    updates: Partial<Pick<BatchGenerationTask, 'prompt' | 'referenceAssetIds'>>,
  ) => {
    await persistBatchChange(batchId, (record) => ({
      ...record,
      tasks: record.tasks.map((task) => task.id === taskId && task.status === 'pending'
        ? { ...task, ...updates, referenceAssetIds: updates.referenceAssetIds ? [...updates.referenceAssetIds] : task.referenceAssetIds }
        : task),
    }));
  }, [persistBatchChange]);

  const updateTaskState = useCallback(async (
    batch: BatchGenerationRecord,
    taskId: string,
    updates: Partial<BatchGenerationTask>,
  ) => persistBatchChange(batch.id, (record) => ({
    ...record,
    tasks: record.tasks.map((task) => task.id === taskId ? { ...task, ...updates, id: task.id, groupId: task.groupId } : task),
  }), batch.ownerId), [persistBatchChange]);

  const syncCanvasTasks = useCallback(async () => {
    if (!canvasHydrated || !ownerRef.current) return;
    if (reconcilingRef.current) {
      resyncRef.current = true;
      return;
    }
    reconcilingRef.current = true;
    const nodes = useCanvasStore.getState().nodes;
    const nodeByTaskId = new Map(nodes.filter((node) => node.batchTaskId).map((node) => [node.batchTaskId!, node]));

    try {
      for (const batch of batchesRef.current) {
        if (batch.ownerId !== ownerRef.current) continue;
        const changes = new Map<string, ReturnType<typeof canvasTaskStatus>>();
        for (const task of batch.tasks) {
          if (!task.nodeId || ['pending', 'succeeded', 'failed'].includes(task.status)) continue;
          const node = nodeByTaskId.get(task.id) || nodes.find((item) => item.id === task.nodeId);
          if (!node || node.clientRequestId !== task.requestId) continue;
          const next = canvasTaskStatus(task, node);
          if (!next) continue;
          if (Object.entries(next).some(([key, value]) => task[key as keyof BatchGenerationTask] !== value)) {
            changes.set(task.id, next);
          }
        }
        if (changes.size === 0) continue;

        const updated = await updateBatchGeneration(batch.ownerId, batch.id, (current) => {
          const tasks = current.tasks.map((task) => {
            const change = changes.get(task.id);
            const previous = batch.tasks.find((entry) => entry.id === task.id);
            return change && previous?.requestId === task.requestId && !['pending', 'succeeded', 'failed'].includes(task.status)
              ? { ...task, ...change } : task;
          });
          const completed = tasks.length > 0 && tasks.every((task) => ['succeeded', 'failed'].includes(task.status));
          return { ...current, tasks, status: completed ? 'completed' : current.status };
        });
        if (ownerRef.current === batch.ownerId) replaceBatch(updated);
      }
    } finally {
      reconcilingRef.current = false;
      if (resyncRef.current) {
        resyncRef.current = false;
        void syncCanvasTasks().catch(console.error);
      }
    }
  }, [canvasHydrated, replaceBatch]);

  useEffect(() => {
    const unsubscribe = useCanvasStore.subscribe(() => { void syncCanvasTasks().catch(console.error); });
    void syncCanvasTasks().catch(console.error);
    return unsubscribe;
  }, [loading, syncCanvasTasks]);

  const processTask = useCallback(async (batch: BatchGenerationRecord, task: BatchGenerationTask) => {
    if (ownerRef.current !== batch.ownerId) return;
    let nodeId = task.nodeId;
    if (!nodeId) throw new Error('批次任务没有画布节点');
    const route = getImageRouteById(batch.settings.routeId);
    if (!route || route.isActive === false) throw new Error('当前线路不可用，请调整批次线路后重试');

    if (task.status !== 'pending') {
      let currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      if (!currentNode) {
        const restored = initializeBatchGenerations([{
          batchId: batch.id,
          taskId: task.id,
          prompt: task.prompt,
          aspectRatio: batch.settings.aspectRatio,
          nodeId,
          requestId: task.requestId,
          autoDownload: batch.settings.autoDownload,
        }], { focus: false, preserveToolMode: true });
        nodeId = restored[task.id];
        await updateTaskState(batch, task.id, { nodeId });
        if (task.serverTaskId) await onUpdateGeneration(nodeId, null, undefined, task.serverTaskId);
        currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      }
      if (!currentNode) {
        await updateTaskState(batch, task.id, { status: task.serverTaskId ? 'queued' : 'pending' });
        return;
      }
      if (task.serverTaskId && !currentNode.taskId) {
        await onUpdateGeneration(nodeId, null, undefined, task.serverTaskId);
        currentNode = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      }
      if (!currentNode) {
        await updateTaskState(batch, task.id, { status: task.serverTaskId ? 'queued' : 'pending' });
        return;
      }
      if (!currentNode.taskId && !terminalNode(currentNode)) {
        await updateTaskState(batch, task.id, { status: 'pending' });
      } else {
        const node = terminalNode(currentNode) ? currentNode : await waitForCanvasNode(nodeId);
        if (!node) {
          await updateTaskState(batch, task.id, { status: task.serverTaskId ? 'queued' : 'pending' });
          return;
        }
        if (node.error) await updateTaskState(batch, task.id, { status: 'failed', error: node.errorMessage || '生成失败' });
        else if (node.src) await updateTaskState(batch, task.id, { status: 'succeeded', resultUrl: node.src, error: undefined });
        return;
      }
    }
    await updateTaskState(batch, task.id, { status: 'submitting', error: undefined });
    try {
      const references = await Promise.all(task.referenceAssetIds.map(async (assetId) => {
        const blob = await assetStorage.getBlob(assetId);
        if (!isValidAssetBlob(blob)) throw new Error('参考图片读取失败，请重新添加');
        return blobToDataUrl(blob);
      }));
      const modelName = getImageModelNameForRoute({
        imageModel: batch.settings.modelId,
        imageLine: route.line,
        imageSize: batch.settings.imageSize,
      });
      if (ownerRef.current !== batch.ownerId) {
        await updateTaskState(batch, task.id, { status: 'pending', error: '账户已切换，切回原账户后可继续' });
        return;
      }
      const response = await submitBatchImageRequest(apiKey || undefined, {
        mode: batch.mode,
        modelId: batch.settings.modelId,
        modelName,
        route,
        prompt: task.prompt,
        aspectRatio: batch.settings.aspectRatio,
        imageSize: batch.settings.imageSize,
        references,
      }, nodeId, task.requestId);

      if (response.taskId) {
        await onUpdateGeneration(nodeId, null, undefined, response.taskId);
        await updateTaskState(batch, task.id, {
          status: response.taskId.startsWith('request-') ? 'awaiting-confirmation' : 'queued',
          serverTaskId: response.taskId,
        });
        const node = await waitForCanvasNode(nodeId);
        if (!node) {
          await updateTaskState(batch, task.id, { status: 'queued', serverTaskId: response.taskId });
          return;
        }
        if (node.error || node.generationConnectionStatus === 'result-unavailable') {
          await updateTaskState(batch, task.id, { status: 'failed', error: node.errorMessage || '生成结果不可用' });
        } else if (node.src) {
          await updateTaskState(batch, task.id, { status: 'succeeded', resultUrl: node.src, error: undefined });
        }
        return;
      }

      const image = response.images[0];
      if (!image) throw new Error('没有收到图片结果');
      await onUpdateGeneration(nodeId, image);
      await updateTaskState(batch, task.id, { status: 'succeeded', resultUrl: image, error: undefined });
    } catch (error) {
      if (ownerRef.current !== batch.ownerId) return;
      const message = error instanceof Error ? error.message : '生成失败';
      const code = (error as { code?: string } | null)?.code;
      if (code === 'USER_QUEUE_FULL') {
        pauseRequestedRef.current.add(batch.id);
        coordinatorRef.current.pause(batch.id);
        await onUpdateGeneration(nodeId, null, message);
        await updateTaskState(batch, task.id, { status: 'pending', error: message });
        await persistBatchChange(batch.id, (record) => ({ ...record, status: 'paused' }), batch.ownerId);
        return;
      }

      await onUpdateGeneration(nodeId, null, message);
      await updateTaskState(batch, task.id, { status: 'failed', error: message });
    }
  }, [apiKey, onUpdateGeneration, persistBatchChange, updateTaskState]);

  const startBatch = useCallback(async (batchId: string) => {
    if (!ownerRef.current) throw new Error('批次账户尚未就绪');
    if (!canvasHydrated) throw new Error('画布仍在恢复，请稍后再开始批次');
    const current = batchesRef.current.find((batch) => batch.id === batchId);
    if (!current) throw new Error('批次不存在');
    const activeId = coordinatorRef.current.getActiveBatchId();
    if (activeId && activeId !== batchId) throw new Error('另一个批次正在运行');
    if (startingRef.current) throw new Error('正在启动批次');
    startingRef.current = true;

    const enabledGroups = new Set(current.groups.filter((group) => group.enabled).map((group) => group.id));
    let pending = current.tasks.filter((task) => !['succeeded', 'failed'].includes(task.status) && enabledGroups.has(task.groupId));
    if (pending.length === 0) {
      startingRef.current = false;
      return;
    }

    let nodeIds: Record<string, string>;
    try {
      const canvasNodeIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
      const toInitialize = pending.filter((task) =>
        task.status === 'pending' || !task.nodeId || !canvasNodeIds.has(task.nodeId),
      );
      nodeIds = initializeBatchGenerations(
        toInitialize.map((task) => ({
        batchId,
        taskId: task.id,
        prompt: task.prompt,
        aspectRatio: current.settings.aspectRatio,
        nodeId: task.nodeId,
        requestId: task.requestId,
        autoDownload: current.settings.autoDownload,
        })),
        { focus: toInitialize.some((task) => !task.nodeId || !canvasNodeIds.has(task.nodeId)), preserveToolMode: true },
      );
    } finally {
      startingRef.current = false;
    }
    await persistBatchChange(batchId, (record) => ({
      ...record,
      status: 'running',
      tasks: record.tasks.map((task) => nodeIds[task.id] ? { ...task, nodeId: nodeIds[task.id] } : task),
    }));
    for (const task of pending) {
      if (task.status !== 'pending' && nodeIds[task.id] && task.serverTaskId) {
        await onUpdateGeneration(nodeIds[task.id], null, undefined, task.serverTaskId);
      }
    }
    pending = batchesRef.current.find((batch) => batch.id === batchId)?.tasks
      .filter((task) => !['succeeded', 'failed'].includes(task.status) && enabledGroups.has(task.groupId)) || pending;
    pauseRequestedRef.current.delete(batchId);
    setActiveBatchId(batchId);

    try {
      await coordinatorRef.current.run(
        batchId,
        pending,
        current.settings.concurrency,
        (task) => processTask(current, task),
        async (task, error) => {
          const message = error instanceof Error ? error.message : '生成失败';
          await updateTaskState(current, task.id, { status: 'failed', error: message });
        },
      );
    } finally {
      setActiveBatchId(null);
      const latest = await readBatchGeneration(current.ownerId, batchId);
      if (latest) {
        const completed = latest.tasks.length > 0 && latest.tasks.every((task) => ['succeeded', 'failed'].includes(task.status));
        const status = completed ? 'completed' : 'paused';
        await persistBatchChange(batchId, (record) => ({ ...record, status }), current.ownerId);
      }
    }
  }, [canvasHydrated, initializeBatchGenerations, persistBatchChange, processTask, updateTaskState]);

  const pauseBatch = useCallback(async (batchId: string) => {
    pauseRequestedRef.current.add(batchId);
    coordinatorRef.current.pause(batchId);
    await persistBatchChange(batchId, (record) => ({ ...record, status: 'paused' }));
  }, [persistBatchChange]);

  const retryTasks = useCallback(async (batchId: string, taskIds: string[]) => {
    if (coordinatorRef.current.getActiveBatchId() === batchId) throw new Error('请等待在途任务结束后重试');
    const selected = new Set(taskIds);
    await persistBatchChange(batchId, (record) => ({
      ...record,
      status: 'paused',
      tasks: record.tasks.map((task) => task.status === 'failed' && selected.has(task.id)
        ? { ...task, requestId: uuidv4(), status: 'pending', error: undefined, progress: undefined }
        : task),
    }));
    return startBatch(batchId);
  }, [persistBatchChange, startBatch]);

  const duplicateBatch = useCallback(async (batchId: string) => {
    const source = batchesRef.current.find((batch) => batch.id === batchId);
    if (!source || source.ownerId !== ownerRef.current) throw new Error('批次不存在');
    const duplicateId = await createBatch(source.mode, source.settings, `${source.title} (副本)`);
    await replaceGroups(duplicateId, source.groups.map((group) => ({ ...group, id: uuidv4(), referenceAssetIds: [...group.referenceAssetIds] })));
    return duplicateId;
  }, [createBatch, replaceGroups]);

  const deleteBatch = useCallback(async (batchId: string) => {
    if (coordinatorRef.current.getActiveBatchId() === batchId) throw new Error('请先暂停当前批次');
    const currentOwner = ownerRef.current;
    if (!currentOwner) return;
    await deleteBatchGeneration(currentOwner, batchId);
    replaceBatches(batchesRef.current.filter((batch) => batch.id !== batchId));
    useCanvasStore.getState().setNodes(
      useCanvasStore.getState().nodes.map((node) => node.batchId === batchId
        ? { ...node, batchId: undefined, batchTaskId: undefined }
        : node),
      true,
    );
  }, [replaceBatches]);

  return {
    initializeBatchGenerations,
    onUpdateGeneration,
    ownerId,
    loading,
    batches,
    activeBatchId,
    createBatch,
    replaceGroups,
    updateSettings,
    getBatchRoutes,
    getBatchSizes,
    updateTask,
    startBatch,
    pauseBatch,
    retryTasks,
    duplicateBatch,
    deleteBatch,
  };
}
