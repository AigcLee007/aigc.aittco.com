import { getAuthorizedBillingHeaders } from './accountIdentity';

const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3355/api' : '/api';

export type OperationsWindow = '15m' | '1h' | '24h' | '7d';
export interface OperationsCoverage {
  available: boolean;
  startedAt?: string | null;
  lastCollectedAt?: string | null;
  aggregateUpdatedAt?: string | null;
  error?: string | null;
  collectionError?: string | null;
  history?: string;
  scope?: string;
  excluded?: string[];
}
export interface OperationsFreshness { stale: boolean; ageMs?: number | null; runtime?: { stale: boolean; ageMs?: number | null }; history?: { stale: boolean; ageMs?: number | null } }
export interface OperationsRuntime {
  generatedAt: string;
  startedAt?: string;
  limits: { concurrency: number; userConcurrency: number; maxQueued: number; userMaxQueued: number };
  active: number; localQueued: number; upstreamQueued: number; activeUsers: number; oldestLocalWaitMs: number | null;
  perUser: { userId: string; active: number; queued: number }[];
  coverage?: { events?: { dropped?: number; failed?: number } };
}
export interface OperationsResources {
  host?: { available: boolean; cpuPercent?: number | null; memoryTotalBytes?: number | null; memoryAvailableBytes?: number | null } | null;
  process?: { rssBytes?: number | null; heapUsedBytes?: number | null; uptimeSeconds?: number | null; eventLoopP95Ms?: number | null } | null;
  cgroup?: { memoryCurrentBytes?: number | null; memoryMaxBytes?: number | null } | null;
  disk?: { totalBytes?: number | null; freeBytes?: number | null } | null;
  database?: { available: boolean; latencyMs?: number | null } | null;
  containers?: { available: boolean; reason?: string | null; app?: string | null; mysql?: string | null } | null;
}
export interface OperationsFailures {
  total: number; succeeded: number; failed: number; successRate: number | null; affectedUsers: number;
  failedUserIds?: string[];
  refusals?: { userQueueFull: number; siteQueueFull: number; total: number };
  causes: { category: string; count: number; affectedUsers: number; userIds?: string[] }[];
  routes: { routeId: string; total: number; failed: number; successRate: number | null; p95TotalMs?: number | null }[];
  storageFailures: number; settlementPending: number;
  p50QueueMs: number | null; p95QueueMs: number | null; p50TotalMs: number | null; p95TotalMs: number | null;
}
export interface OperationsIncident {
  id?: string; incidentId?: string; category?: string; routeId?: string | null; message?: string; summary?: string;
  status?: string; severity?: string; createdAt?: string; firstSeenAt?: string; lastSeenAt?: string; recoveredAt?: string | null;
}
export interface OperationsSummary {
  success: boolean; generatedAt: string; coverage: OperationsCoverage; freshness: OperationsFreshness;
  runtime: OperationsRuntime; resources: OperationsResources; failures: OperationsFailures;
  incidents: { items: OperationsIncident[] };
}
export interface OperationsTrendPoint {
  timestamp: string; submitted: number; completed: number; succeeded: number; failed: number;
  active: number | null; localQueued: number | null; upstreamQueued: number | null;
}
export interface OperationsTrends {
  success: boolean; generatedAt: string; coverage: OperationsCoverage; freshness: OperationsFreshness;
  window: OperationsWindow; items: OperationsTrendPoint[];
}
export interface OperationsTask {
  taskId: string; requestId?: string; userId: string; userLabel?: string | null; routeId?: string | null; modelId?: string | null;
  status: string; phase?: string; storageStatus?: string | null; settlementStatus?: string;
  failureStage?: string | null; failureCategory?: string | null; failureCode?: string | null; httpStatus?: number | null; errorSummary?: string | null;
  createdAt: string; startedAt?: string | null; upstreamStartedAt?: string | null; completedAt?: string | null; updatedAt?: string;
  queueMs?: number | null; totalMs?: number | null;
}
export interface OperationsTaskFilters {
  window?: OperationsWindow; status?: string; userId?: string; routeId?: string; taskId?: string; requestId?: string;
  failureCategory?: string; storageStatus?: string; settlementStatus?: string; limit?: number; cursor?: string;
}
export interface OperationsTaskList { success: boolean; items: OperationsTask[]; nextCursor?: string | null; coverage: OperationsCoverage }
export interface OperationsTaskEvent {
  type: string; createdAt: string; phase?: string; failureStage?: string; failureCategory?: string;
  storageStatus?: string; settlementStatus?: string; message?: string; errorSummary?: string;
}
export interface OperationsTaskDetail { success: boolean; task: OperationsTask; events: OperationsTaskEvent[]; coverage: OperationsCoverage }

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/admin/operations${path}`, {
    method: 'GET', signal, headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
  });
  const data = await response.json().catch(() => { throw new Error('运行看板返回了无效数据'); });
  if (!response.ok || data?.success === false) throw new Error(data?.error || '运行数据请求失败');
  if (!data || typeof data !== 'object') throw new Error('运行看板返回了无效数据');
  return data as T;
}

export const fetchOperationsSummary = (signal?: AbortSignal) => get<OperationsSummary>('/summary', signal);
export const fetchOperationsTrends = (window: OperationsWindow = '15m', signal?: AbortSignal) =>
  get<OperationsTrends>(`/trends?window=${encodeURIComponent(window)}`, signal);
export const fetchOperationsTasks = (filters: OperationsTaskFilters = {}, signal?: AbortSignal) => {
  const params = new URLSearchParams();
  for (const key of ['window', 'status', 'userId', 'routeId', 'taskId', 'requestId', 'failureCategory', 'storageStatus', 'settlementStatus', 'limit', 'cursor'] as const) {
    const value = filters[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    params.set(key, key === 'limit' ? String(Math.min(50, Math.max(1, Math.floor(Number(value)) || 25))) : String(value).trim());
  }
  return get<OperationsTaskList>(`/tasks${params.size ? `?${params}` : ''}`, signal);
};
export const fetchOperationsTask = (taskId: string, signal?: AbortSignal) =>
  get<OperationsTaskDetail>(`/tasks/${encodeURIComponent(taskId)}`, signal);
export const fetchOperationsFailures = (window: OperationsWindow = '15m', signal?: AbortSignal) =>
  get<OperationsFailures & { success: boolean; coverage: OperationsCoverage }>(`/failures?window=${encodeURIComponent(window)}`, signal);
export const fetchOperationsIncidents = (signal?: AbortSignal) =>
  get<{ success: boolean; items: OperationsIncident[]; coverage: OperationsCoverage }>('/incidents', signal);
