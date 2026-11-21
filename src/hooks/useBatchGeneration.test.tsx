import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { clear, createStore } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchGenerationSettings } from '../services/batchGenerationTypes';
import { listBatchGenerations } from '../services/batchGenerationStore';
import { submitBatchImageRequest } from '../services/batchImageRequest';
import { updateBatchGeneration } from '../services/batchGenerationStore';
import { useCanvasStore } from '../store/canvasStore';
import { useBatchGeneration } from './useBatchGeneration';

vi.mock('../services/batchImageRequest', () => ({
  submitBatchImageRequest: vi.fn(),
}));

const batchStore = createStore('batch-generation-v1', 'batches');

const settings: BatchGenerationSettings = {
  modelId: 'model-a',
  routeId: 'route-a',
  aspectRatio: '1:1',
  imageSize: '1k',
  outputCount: 1,
  concurrency: 3,
  autoDownload: false,
};

const initializeBatchGenerations = vi.fn((items: Array<{ taskId: string }>) =>
  Object.fromEntries(items.map((item) => [item.taskId, `node-${item.taskId}`])),
);
const onUpdateGeneration = vi.fn(async () => {});
const createHook = () => renderHook(() => useBatchGeneration({
  apiKey: undefined,
  ownerId: 'owner-a',
  initializeBatchGenerations,
  onUpdateGeneration,
}));

beforeEach(async () => {
  await clear(batchStore);
  vi.clearAllMocks();
});

describe('useBatchGeneration', () => {
  it('persists a batch and expands input output counts into independent tasks', async () => {
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'Catalog images');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'glass bottle', referenceAssetIds: [], outputCount: 2, enabled: true },
        { id: 'group-b', prompt: 'wooden table', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
    });

    const saved = await listBatchGenerations('owner-a');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: batchId, title: 'Catalog images', mode: 't2i' });
    expect(saved[0].tasks).toHaveLength(3);
    expect(saved[0].tasks.map((task) => task.groupId)).toEqual(['group-a', 'group-a', 'group-b']);
    expect(new Set(saved[0].tasks.map((task) => task.requestId)).size).toBe(3);
    hook.unmount();
  });

  it('duplicates a batch as a fresh draft with new independent task request IDs', async () => {
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let batchId = '';
    let duplicateId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('i2i', settings, 'Reference set');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'reference-a', prompt: 'replace the sky', referenceAssetIds: ['asset-a'], outputCount: 2, enabled: true },
      ]);
      duplicateId = await hook.result.current.duplicateBatch(batchId);
    });

    const records = await listBatchGenerations('owner-a');
    const original = records.find((batch) => batch.id === batchId)!;
    const duplicate = records.find((batch) => batch.id === duplicateId)!;
    expect(duplicate).toMatchObject({ status: 'draft', title: 'Reference set (副本)', mode: 'i2i' });
    expect(duplicate.groups[0]).toMatchObject({ prompt: original.groups[0].prompt, referenceAssetIds: ['asset-a'] });
    expect(duplicate.tasks).toHaveLength(2);
    expect(duplicate.tasks.some((task) => original.tasks.some((source) => source.requestId === task.requestId))).toBe(false);
    hook.unmount();
  });

  it('creates all canvas placeholders once and records direct image results', async () => {
    vi.mocked(submitBatchImageRequest).mockResolvedValue({ images: ['/generated/a.png'] });
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'One prompt');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'greenhouse', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
    });
    const taskId = (await listBatchGenerations('owner-a'))[0].tasks[0].id;
    const nodeId = `node-${taskId}`;

    await act(async () => hook.result.current.startBatch(batchId));

    expect(hook.result.current.initializeBatchGenerations).toHaveBeenCalledTimes(1);
    expect(hook.result.current.onUpdateGeneration).toHaveBeenCalledWith(nodeId, '/generated/a.png');
    const saved = await listBatchGenerations('owner-a');
    expect(saved[0].tasks[0]).toMatchObject({ status: 'succeeded', resultUrl: '/generated/a.png', nodeId });
    expect(saved[0].status).toBe('completed');
    hook.unmount();
  });

  it('retries only the failed output and leaves its successful sibling untouched', async () => {
    vi.mocked(submitBatchImageRequest)
      .mockRejectedValueOnce(new Error('route timeout'))
      .mockResolvedValueOnce({ images: ['/generated/sibling.png'] })
      .mockResolvedValueOnce({ images: ['/generated/retry.png'] });
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'Retry one row');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'first output', referenceAssetIds: [], outputCount: 1, enabled: true },
        { id: 'group-b', prompt: 'second output', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
      await hook.result.current.startBatch(batchId);
    });

    const firstRecord = (await listBatchGenerations('owner-a'))[0];
    const failed = firstRecord.tasks.find((task) => task.status === 'failed')!;
    const succeeded = firstRecord.tasks.find((task) => task.status === 'succeeded')!;
    const originalSuccessRequestId = succeeded.requestId;

    await act(async () => hook.result.current.retryTasks(batchId, [failed.id]));

    const retried = (await listBatchGenerations('owner-a'))[0];
    expect(submitBatchImageRequest).toHaveBeenCalledTimes(3);
    expect(retried.tasks.find((task) => task.id === failed.id)?.status).toBe('succeeded');
    expect(retried.tasks.find((task) => task.id === succeeded.id)?.requestId).toBe(originalSuccessRequestId);
    expect(retried.tasks.find((task) => task.id === failed.id)?.resultUrl).toBe('/generated/retry.png');
    expect(retried.tasks.find((task) => task.id === succeeded.id)?.resultUrl).toBe('/generated/sibling.png');
    hook.unmount();
  });

  it('waits for a previously admitted task after reload without posting it again', async () => {
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'Recover accepted task');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'accepted prompt', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
    });
    const task = (await listBatchGenerations('owner-a'))[0].tasks[0];
    await updateBatchGeneration('owner-a', batchId, (record) => ({
      ...record,
      status: 'paused',
      tasks: record.tasks.map((item) => item.id === task.id
        ? { ...item, nodeId: 'recovered-node', serverTaskId: 'job-recovered', status: 'queued' }
        : item),
    }));
    useCanvasStore.getState().setNodes([{
      id: 'recovered-node',
      type: 'IMAGE',
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      opacity: 1,
      locked: false,
      loading: true,
      src: '',
      prompt: task.prompt,
      taskId: 'job-recovered',
      clientRequestId: task.requestId,
      batchId,
      batchTaskId: task.id,
      history: [],
      historyIndex: 0,
    }], true);

    hook.unmount();
    const recoveredHook = createHook();
    await waitFor(() => expect(recoveredHook.result.current.loading).toBe(false));
    const run = recoveredHook.result.current.startBatch(batchId);
    await waitFor(() => expect(recoveredHook.result.current.activeBatchId).toBe(batchId));
    await act(async () => useCanvasStore.getState().updateNode('recovered-node', {
      loading: false,
      src: '/generated/recovered.png',
    }, true));
    await act(async () => run);

    expect(submitBatchImageRequest).not.toHaveBeenCalled();
    expect((await listBatchGenerations('owner-a'))[0].tasks[0]).toMatchObject({
      status: 'succeeded',
      resultUrl: '/generated/recovered.png',
    });
    useCanvasStore.getState().setNodes([], true);
    recoveredHook.unmount();
  });

  it('resubmits a stable request ID when a reload interrupts submission before task admission', async () => {
    vi.mocked(submitBatchImageRequest).mockResolvedValue({ images: ['/generated/after-refresh.png'] });
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'Interrupted submit');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'same client request', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
    });
    const task = (await listBatchGenerations('owner-a'))[0].tasks[0];
    await updateBatchGeneration('owner-a', batchId, (record) => ({
      ...record,
      status: 'paused',
      tasks: record.tasks.map((item) => item.id === task.id
        ? { ...item, nodeId: 'pre-submit-node', status: 'submitting' }
        : item),
    }));
    useCanvasStore.getState().setNodes([{
      id: 'pre-submit-node',
      type: 'IMAGE',
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      opacity: 1,
      locked: false,
      loading: true,
      src: '',
      prompt: task.prompt,
      clientRequestId: task.requestId,
      batchId,
      batchTaskId: task.id,
      history: [],
      historyIndex: 0,
    }], true);
    hook.unmount();

    const recoveredHook = createHook();
    await waitFor(() => expect(recoveredHook.result.current.loading).toBe(false));
    await act(async () => recoveredHook.result.current.startBatch(batchId));

    expect(submitBatchImageRequest).toHaveBeenCalledTimes(1);
    expect(submitBatchImageRequest).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ prompt: task.prompt }),
      'pre-submit-node',
      task.requestId,
    );
    expect((await listBatchGenerations('owner-a'))[0].tasks[0]).toMatchObject({
      status: 'succeeded',
      requestId: task.requestId,
      resultUrl: '/generated/after-refresh.png',
    });
    useCanvasStore.getState().setNodes([], true);
    recoveredHook.unmount();
  });

  it('rebuilds a missing canvas node for an admitted task without marking it failed', async () => {
    const hook = createHook();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let batchId = '';
    await act(async () => {
      batchId = await hook.result.current.createBatch('t2i', settings, 'Restore deleted node');
      await hook.result.current.replaceGroups(batchId, [
        { id: 'group-a', prompt: 'already admitted', referenceAssetIds: [], outputCount: 1, enabled: true },
      ]);
    });
    const task = (await listBatchGenerations('owner-a'))[0].tasks[0];
    await updateBatchGeneration('owner-a', batchId, (record) => ({
      ...record,
      status: 'paused',
      tasks: record.tasks.map((item) => item.id === task.id
        ? { ...item, nodeId: 'deleted-canvas-node', serverTaskId: 'job-still-running', status: 'queued' }
        : item),
    }));
    useCanvasStore.getState().setNodes([], true);
    hook.unmount();

    const recoveredHook = createHook();
    await waitFor(() => expect(recoveredHook.result.current.loading).toBe(false));
    await act(async () => recoveredHook.result.current.startBatch(batchId));

    const saved = (await listBatchGenerations('owner-a'))[0];
    expect(saved.tasks[0]).toMatchObject({
      status: 'queued',
      serverTaskId: 'job-still-running',
      nodeId: `node-${task.id}`,
    });
    expect(submitBatchImageRequest).not.toHaveBeenCalled();
    useCanvasStore.getState().setNodes([], true);
    recoveredHook.unmount();
  });
});
