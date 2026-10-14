import { createStore, get, set, del, keys } from 'idb-keyval';

const store = createStore('image-job-recovery-v1', 'requests');
export type PendingImageRequest = { owner: string; requestId: string; endpoint: string; payload: any; createdAt: number; admittedTaskId?: string };
const key = (owner: string, requestId: string) => `${owner}:${requestId}`;
export async function saveImageRequest(request: PendingImageRequest) {
  await pruneImageRequests();
  await set(key(request.owner, request.requestId), request, store);
}
export const removeImageRequest = async (owner: string, requestId: string) => del(key(owner, requestId), store);
export const readImageRequest = async (owner: string, requestId: string) => get<PendingImageRequest>(key(owner, requestId), store);
export async function markImageRequestAccepted(owner: string, requestId: string, taskId: string) {
  const request = await readImageRequest(owner, requestId);
  if (!request) return;
  await set(key(owner, requestId), { ...request, admittedTaskId: taskId, payload: {
    uiMode: request.payload.uiMode, prompt: request.payload.prompt, clientLiveTaskIds: request.payload.clientLiveTaskIds || [],
  } }, store);
}
export async function listImageRequests(owner: string) {
  const result: Array<{requestId: string; nodeIds: string[]; prompt: string; createdAt: number; taskId?: string}> = [];
  for (const id of await keys<string>(store)) {
    if (!id.startsWith(`${owner}:`)) continue;
    const value = await get<PendingImageRequest>(id, store);
    if (value?.payload.uiMode === 'canvas' && Date.now() - value.createdAt < 20 * 60 * 1000) {
      result.push({ requestId: value.requestId, nodeIds: value.payload.clientLiveTaskIds || [], prompt: value.payload.prompt || '', createdAt: value.createdAt, ...(value.admittedTaskId ? { taskId: value.admittedTaskId } : {}) });
    }
  }
  return result;
}
export async function pruneImageRequests() {
  // Read one upload at a time; getAll() would decode every large reference at once.
  for (const id of await keys<string>(store)) {
    const value = await get<PendingImageRequest>(id, store);
    if (!value || Date.now() - value.createdAt > 20 * 60 * 1000) await del(id, store);
  }
}
