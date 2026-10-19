import { AppError, extractErrorMessage } from '../utils/errorDebug';
import { saveImageRequest, removeImageRequest, readImageRequest, markImageRequestAccepted } from './imageJobRequests';
import { getStoredAuthSessionToken } from './accountIdentity';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getImageRouteById } from '../config/imageRoutes';

export const REQUEST_TASK_PREFIX = 'request-';
const ownerCache = new Map<string, Promise<string>>();
const activeSubmissions = new Set<string>();
const submissionKey = (owner: string, requestId: string) => JSON.stringify([owner, requestId]);
const REQUEST_TIMEOUT_MS = 120_000;

export const newImageRequestId = () => globalThis.crypto?.randomUUID?.() || `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function isTransientJobError(error: unknown): boolean {
  const value = error as { status?: number; code?: string; name?: string; message?: string };
  // A per-user queue refusal is final; only a busy server or network loss is retried.
  if (value?.code === 'USER_QUEUE_FULL') return false;
  if (value?.status) return value.status === 408 || value.status === 429 || value.status >= 500;
  return value?.name === 'TypeError' || value?.name === 'AbortError' || /failed to fetch|network|timeout|超时/i.test(value?.message || '');
}
async function jsonRequest(url: string, options: RequestInit, timeout = REQUEST_TIMEOUT_MS): Promise<any> {
  if (options.method === 'POST') {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    options = { ...options, headers };
  }
  return fetchWithTimeout(url, options, async response => {
    const data = await response.json().catch(() => {
      if (!response.ok) throw new AppError(`请求失败 (${response.status})`, { status: response.status });
      throw new TypeError('任务响应中断，正在核对受理结果');
    });
    if (!response.ok) throw new AppError(extractErrorMessage(data) || `请求失败 (${response.status})`, { status: response.status, code: typeof data?.code === 'string' ? data.code : undefined });
    return data;
  }, timeout, options.method === 'POST'
    ? '提交等待超时，结果未确认。请先查看历史记录，避免重复提交扣点。'
    : '任务查询超时，结果未确认。联网后继续恢复任务。');
}
export async function getImageJobOwner(headers: Record<string, string>): Promise<string> {
  const token = headers['X-Auth-Session'] || '';
  if (!token) return '';
  let work = ownerCache.get(token);
  if (!work) {
    work = jsonRequest('/api/auth/session', { headers }, 15_000).then(data => String(data.user?.userId || '')).catch(error => { ownerCache.delete(token); throw error; });
    if (ownerCache.size > 2) ownerCache.clear();
    ownerCache.set(token, work);
  }
  return work;
}
export async function queryImageJob(taskId: string, headers: Record<string, string>, base = '/api', owner = ''): Promise<any> {
  const path = taskId.startsWith(REQUEST_TASK_PREFIX)
    ? `/image-jobs/request/${encodeURIComponent(taskId.slice(REQUEST_TASK_PREFIX.length))}`
    : `/task/${encodeURIComponent(taskId)}`;
  try {
    const result = await jsonRequest(`${base}${path}`, { headers }, 20_000);
    if (owner && taskId.startsWith(REQUEST_TASK_PREFIX)) await removeImageRequest(owner, taskId.slice(REQUEST_TASK_PREFIX.length)).catch(() => {});
    return result;
  }
  catch (error) {
    if (taskId.startsWith(REQUEST_TASK_PREFIX) && (error as AppError).status === 404) {
      if (owner) {
        const requestId = taskId.slice(REQUEST_TASK_PREFIX.length);
        const session = headers['X-Auth-Session'];
        if (!session || session !== getStoredAuthSessionToken() || await getImageJobOwner(headers) !== owner) {
          throw new AppError('登录账号已切换，请重新登录后恢复任务', { status: 401 });
        }
        const saved = await readImageRequest(owner, requestId).catch(() => undefined);
        if (session !== getStoredAuthSessionToken()) throw new AppError('登录账号已切换', { status: 401 });
        if (saved && !activeSubmissions.has(submissionKey(owner, requestId)) && Date.now() - saved.createdAt < 20 * 60 * 1000) {
          if (saved.admittedTaskId) return queryImageJob(saved.admittedTaskId, headers, base);
          try {
            const result = await jsonRequest(saved.endpoint, { method: 'POST', headers, body: JSON.stringify(saved.payload) });
            await removeImageRequest(owner, requestId).catch(() => {});
            return result;
          } catch (resendError) {
            if (!isTransientJobError(resendError)) await removeImageRequest(owner, requestId).catch(() => {});
            throw resendError;
          }
        }
      }
      return { id: taskId, task_id: taskId, status: 'processing', connection_status: 'unconfirmed', results: [] };
    }
    throw error;
  }
}
export async function submitImageJob(endpoint: string, payload: any, headers: Record<string, string>): Promise<any> {
  const clientRequestId = String(payload.clientRequestId || newImageRequestId());
  const nodeIds: string[] = payload.clientLiveTaskIds || (payload.clientLiveTaskId ? [payload.clientLiveTaskId] : []);
  const owner = await getImageJobOwner(headers);
  if (!owner) {
    const route = getImageRouteById(String(payload.routeId || ''));
    const timeout = route?.mode === 'sync' && route.id !== 'gpt-image-2-line2' ? 25 * 60 * 1000 : REQUEST_TIMEOUT_MS;
    return jsonRequest(endpoint, { method: 'POST', headers, body: JSON.stringify({ uiMode: 'canvas', ...payload }) }, timeout);
  }
  const session = headers['X-Auth-Session'];
  if (getStoredAuthSessionToken() && session !== getStoredAuthSessionToken()) throw new AppError('登录账号已切换，请重新提交', { status: 401 });
  const body = { uiMode: 'canvas', ...payload, asyncTask: true, clientRequestId };
  const key = submissionKey(owner, clientRequestId);
  activeSubmissions.add(key);
  try {
    // IndexedDB keeps the upload off localStorage and permits identical retries after reload.
    await saveImageRequest({ owner, requestId: clientRequestId, endpoint, payload: body, createdAt: Date.now() }).catch(() => {});
    const currentSession = getStoredAuthSessionToken();
    if (currentSession && session !== currentSession) throw new AppError('登录账号已切换', { status: 401 });
    if (nodeIds.length && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('image-job-submitting', { detail: { nodeIds, clientRequestId, owner } }));
    }
    let credentialsSaved = !nodeIds.length;
    if (nodeIds.length) {
      try { await (await import('../store/canvasStore')).persistImageJobCredentials(); credentialsSaved = true; }
      catch { /* A compact admission receipt remains if canvas persistence is unavailable. */ }
    }
    const accepted = async (result: any) => {
      if (credentialsSaved) await removeImageRequest(owner, clientRequestId).catch(() => {});
      else await markImageRequestAccepted(owner, clientRequestId, result.task_id || result.id).catch(() => {});
      return result;
    };
    try {
      const result = await jsonRequest(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      return accepted(result);
    }
    catch (error) {
      if (!isTransientJobError(error)) { await removeImageRequest(owner, clientRequestId).catch(() => {}); throw error; }
      try {
        const result = await queryImageJob(`${REQUEST_TASK_PREFIX}${clientRequestId}`, headers, endpoint.replace(/\/(generate|edit|gemini\/generate)$/, ''));
        if (result.connection_status !== 'unconfirmed') return accepted(result);
        // Only resend after an online lookup confirms no admission; reuse the exact request.
        if (getStoredAuthSessionToken() && session !== getStoredAuthSessionToken()) throw new AppError('登录账号已切换', { status: 401 });
        try { return await accepted(await jsonRequest(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })); }
        catch (retryError) { if (!isTransientJobError(retryError)) throw retryError; }
        return result;
      }
      catch (lookupError) {
        if (!isTransientJobError(lookupError)) { await removeImageRequest(owner, clientRequestId).catch(() => {}); throw lookupError; }
      }
      return { id: `${REQUEST_TASK_PREFIX}${clientRequestId}`, task_id: `${REQUEST_TASK_PREFIX}${clientRequestId}`, status: 'processing', connection_status: 'recovering', results: [] };
    }
  } finally {
    activeSubmissions.delete(key);
  }
}
