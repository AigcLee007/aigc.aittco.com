import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clear, createStore } from 'idb-keyval';
import type { BatchGenerationRecord } from './batchGenerationTypes';
import {
  deleteBatchGeneration,
  listBatchGenerations,
  readBatchGeneration,
  saveBatchGeneration,
  updateBatchGeneration,
} from './batchGenerationStore';

const store = createStore('batch-generation-v1', 'batches');

const batch = (ownerId: string, id: string): BatchGenerationRecord => ({
  id,
  ownerId,
  schemaVersion: 1,
  title: `Batch ${id}`,
  mode: 't2i',
  status: 'draft',
  settings: {
    modelId: 'model-a',
    routeId: 'route-a',
    aspectRatio: '1:1',
    imageSize: '1k',
    outputCount: 1,
    concurrency: 3,
    autoDownload: false,
  },
  groups: [
    { id: 'group-a', prompt: 'first prompt', referenceAssetIds: [], outputCount: 1, enabled: true },
    { id: 'group-b', prompt: 'second prompt', referenceAssetIds: [], outputCount: 1, enabled: true },
  ],
  tasks: [
    { id: 'task-a', groupId: 'group-a', prompt: 'first prompt', referenceAssetIds: [], outputIndex: 0, requestId: 'request-a', status: 'pending' },
    { id: 'task-b', groupId: 'group-b', prompt: 'second prompt', referenceAssetIds: [], outputIndex: 0, requestId: 'request-b', status: 'pending' },
  ],
  createdAt: 100,
  updatedAt: 100,
});

beforeEach(async () => {
  await clear(store);
});

describe('batch generation store', () => {
  it('keeps batches isolated by owner and lists newest first', async () => {
    await saveBatchGeneration(batch('owner-a', 'batch-old'));
    await saveBatchGeneration({ ...batch('owner-a', 'batch-new'), updatedAt: 200 });
    await saveBatchGeneration(batch('owner-b', 'batch-private'));

    expect((await listBatchGenerations('owner-a')).map((item) => item.id)).toEqual([
      'batch-new',
      'batch-old',
    ]);
    expect(await readBatchGeneration('owner-a', 'batch-private')).toBeUndefined();
    expect((await listBatchGenerations('owner-b')).map((item) => item.id)).toEqual(['batch-private']);
  });

  it('updates one task without losing sibling task state', async () => {
    await saveBatchGeneration(batch('owner-a', 'batch-a'));

    await updateBatchGeneration('owner-a', 'batch-a', (current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === 'task-a' ? { ...task, status: 'succeeded', resultUrl: '/result.png' } : task,
      ),
    }));

    expect(await readBatchGeneration('owner-a', 'batch-a')).toMatchObject({
      tasks: [
        { id: 'task-a', status: 'succeeded', resultUrl: '/result.png' },
        { id: 'task-b', status: 'pending' },
      ],
    });
  });

  it('deletes only the owner-scoped batch requested', async () => {
    await saveBatchGeneration(batch('owner-a', 'batch-a'));
    await saveBatchGeneration(batch('owner-b', 'batch-a'));

    await deleteBatchGeneration('owner-a', 'batch-a');

    expect(await readBatchGeneration('owner-a', 'batch-a')).toBeUndefined();
    expect(await readBatchGeneration('owner-b', 'batch-a')).toBeDefined();
  });
});
