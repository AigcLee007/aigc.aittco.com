import { createStore, del, get, keys, set, update } from 'idb-keyval';
import type { BatchGenerationRecord } from './batchGenerationTypes';

const batchStore = createStore('batch-generation-v1', 'batches');
const batchKey = (ownerId: string, batchId: string) => `${ownerId}:${batchId}`;

const assertRecordIdentity = (record: BatchGenerationRecord, ownerId: string, id: string) => {
  if (record.ownerId !== ownerId || record.id !== id) {
    throw new Error('Batch record identity cannot be changed');
  }
};

export async function saveBatchGeneration(record: BatchGenerationRecord) {
  if (!record.ownerId || !record.id) throw new Error('Batch owner and ID are required');
  const saved = { ...record };
  await set(batchKey(record.ownerId, record.id), saved, batchStore);
  return saved;
}

export async function readBatchGeneration(ownerId: string, id: string) {
  if (!ownerId || !id) return undefined;
  const record = await get<BatchGenerationRecord>(batchKey(ownerId, id), batchStore);
  return record?.ownerId === ownerId && record.id === id ? record : undefined;
}

export async function listBatchGenerations(ownerId: string) {
  if (!ownerId) return [];
  const prefix = `${ownerId}:`;
  const records: BatchGenerationRecord[] = [];

  for (const key of await keys<string>(batchStore)) {
    if (!key.startsWith(prefix)) continue;
    const record = await get<BatchGenerationRecord>(key, batchStore);
    if (record?.ownerId === ownerId) records.push(record);
  }

  return records.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function updateBatchGeneration(
  ownerId: string,
  id: string,
  change: (current: BatchGenerationRecord) => BatchGenerationRecord,
) {
  if (!ownerId || !id) throw new Error('Batch owner and ID are required');
  const key = batchKey(ownerId, id);
  let updated: BatchGenerationRecord | undefined;

  await update<BatchGenerationRecord>(key, (current) => {
    if (!current || current.ownerId !== ownerId || current.id !== id) {
      throw new Error('Batch was not found for this owner');
    }

    const next = change(current);
    assertRecordIdentity(next, ownerId, id);
    updated = { ...next, updatedAt: Date.now() };
    return updated;
  }, batchStore);

  if (!updated) throw new Error('Batch update did not produce a record');
  return updated;
}

export async function deleteBatchGeneration(ownerId: string, id: string) {
  if (!ownerId || !id) return;
  await del(batchKey(ownerId, id), batchStore);
}
