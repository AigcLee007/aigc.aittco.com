import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorized = vi.hoisted(() => vi.fn());
vi.mock('./accountIdentity', () => ({ getAuthorizedBillingHeaders: authorized }));
import { fetchOperationsSummary, fetchOperationsTrends, fetchOperationsTasks, fetchOperationsTask, fetchOperationsFailures, fetchOperationsIncidents } from './adminOperationsService';

describe('admin operations requests', () => {
  const request = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    authorized.mockResolvedValue({ Authorization: 'Bearer admin-session' });
    request.mockResolvedValue({ ok: true, json: async () => ({ success: true, items: [] }) });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses authorized read-only requests and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    await fetchOperationsSummary(signal);
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/admin/operations/summary'), {
      method: 'GET', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-session' },
    });
  });

  it('encodes exact task filters and bounds the page size', async () => {
    await fetchOperationsTasks({ window: '1h', status: 'failed', userId: ' user +一 ', routeId: 'route/a', taskId: 'task-1', requestId: 'req-1', failureCategory: 'timeout', storageStatus: 'failed', settlementStatus: 'pending', limit: 500, cursor: 'page+1' });
    const url = new URL(request.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ window: '1h', status: 'failed', userId: 'user +一', routeId: 'route/a', taskId: 'task-1', requestId: 'req-1', failureCategory: 'timeout', storageStatus: 'failed', settlementStatus: 'pending', limit: '50', cursor: 'page+1' });
  });

  it('requests bounded trends and safe task paths plus optional breakdowns', async () => {
    await fetchOperationsTrends('24h');
    await fetchOperationsTask('task/a?b');
    await fetchOperationsFailures('7d');
    await fetchOperationsIncidents();
    expect(request.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('/trends?window=24h'), expect.stringContaining('/tasks/task%2Fa%3Fb'),
      expect.stringContaining('/failures?window=7d'), expect.stringContaining('/incidents'),
    ]);
  });

  it('rejects server and malformed responses without silently reporting zeros', async () => {
    request.mockResolvedValueOnce({ ok: false, json: async () => ({ error: '权限不足' }) });
    await expect(fetchOperationsSummary()).rejects.toThrow('权限不足');
    request.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad json'); } });
    await expect(fetchOperationsSummary()).rejects.toThrow();
  });
});
