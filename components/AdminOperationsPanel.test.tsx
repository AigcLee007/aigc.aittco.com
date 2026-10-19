import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), trends: vi.fn(), tasks: vi.fn(), task: vi.fn() }));
vi.mock('../src/services/adminOperationsService', () => ({
  fetchOperationsSummary: mocks.summary, fetchOperationsTrends: mocks.trends, fetchOperationsTasks: mocks.tasks, fetchOperationsTask: mocks.task,
}));
import AdminOperationsPanel from './AdminOperationsPanel';

const coverage = { available: true, startedAt: '2026-10-19T00:00:00Z', lastCollectedAt: '2026-10-19T01:00:00Z', history: 'available', scope: 'durable_image_jobs', excluded: ['video', 'anonymous_legacy_images'] };
const task = { taskId: 'task-a', requestId: 'request-a', userId: 'user-a', userLabel: '测试用户', routeId: 'route-a', status: 'failed', phase: 'generation', storageStatus: 'not_started', settlementStatus: 'pending', failureStage: 'upstream', failureCategory: 'timeout', errorSummary: '上游超时', createdAt: '2026-10-19T00:59:00Z', completedAt: '2026-10-19T01:00:00Z' };
const summary = {
  success: true, generatedAt: '2026-10-19T01:00:00Z', coverage, freshness: { stale: false, ageMs: 100 },
  runtime: { generatedAt: '2026-10-19T01:00:00Z', limits: { concurrency: 48, userConcurrency: 3, maxQueued: 200, userMaxQueued: 20 }, active: 12, localQueued: 4, upstreamQueued: 2, activeUsers: 5, oldestLocalWaitMs: 2000, perUser: [{ userId: 'user-a', active: 2, queued: 1 }] },
  resources: { host: { available: false }, process: { rssBytes: 104857600, heapUsedBytes: 52428800, uptimeSeconds: 300, eventLoopP95Ms: 1.5 }, database: { available: true, latencyMs: 2 }, containers: { available: false, reason: '未配置宿主机代理' } },
  failures: { total: 10, succeeded: 8, failed: 2, successRate: 80, affectedUsers: 1, failedUserIds: ['user-a'], causes: [{ category: 'timeout', count: 2, affectedUsers: 1, userIds: ['user-a'] }], routes: [{ routeId: 'route-a', total: 10, failed: 2, successRate: 80, p95TotalMs: 6000 }], storageFailures: 1, settlementPending: 1, p50QueueMs: 100, p95QueueMs: 2000, p50TotalMs: 3000, p95TotalMs: 6000 },
  incidents: { items: [{ id: 'incident-a', category: 'queue', message: '本地队列等待升高', status: 'active', createdAt: '2026-10-19T01:00:00Z' }] },
};

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('admin operations panel', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    mocks.summary.mockResolvedValue(summary);
    mocks.trends.mockResolvedValue({ success: true, window: '15m', generatedAt: summary.generatedAt, coverage, freshness: { stale: false }, items: [] });
    mocks.tasks.mockResolvedValue({ success: true, coverage, items: [task], nextCursor: 'next' });
    mocks.task.mockResolvedValue({ success: true, coverage, task: { ...task, prompt: 'SECRET_PROMPT', authorization: 'SECRET_TOKEN' }, events: [{ type: 'generation_failed', createdAt: task.completedAt, failureCategory: 'timeout', errorSummary: '超时事件说明' }] });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('renders real scheduler limits, terminal generation success, resources and coverage', async () => {
    render(<AdminOperationsPanel />); await flush();
    expect(screen.getByText('12 / 48')).toBeTruthy();
    expect(screen.getByText('近15分钟终态成功率')).toBeTruthy();
    expect(screen.getAllByText('80.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(text => text.includes('成功 / (成功 + 失败)'))).toBeTruthy();
    expect(screen.getByText(/上游排队属于已占用槽位/)).toBeTruthy();
    expect(screen.getAllByText(/视频、匿名及旧同步图片任务未覆盖/).length).toBeGreaterThan(0);
    expect(screen.getByText('本地队列等待升高')).toBeTruthy();
    expect(screen.getByText('进程 RSS')).toBeTruthy();
    expect(screen.getByText('暂无趋势样本')).toBeTruthy();
    expect(screen.getByText((text, element) => element?.tagName === 'DIV' && element.textContent === '失败用户 ID：user-a')).toBeTruthy();
  });

  it('polls at independent cadences with bounded jitter and pauses while hidden', async () => {
    const { unmount } = render(<AdminOperationsPanel />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    expect(mocks.trends).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(200000); });
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange')); await flush();
    expect(mocks.summary).toHaveBeenCalledTimes(3);
    expect(mocks.trends).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(101000); });
    expect(mocks.trends).toHaveBeenCalledTimes(3);
    const signal = mocks.summary.mock.calls.at(-1)?.[0] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    const calls = mocks.summary.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(200000); });
    expect(mocks.summary).toHaveBeenCalledTimes(calls);
  });

  it('does not overlap slow requests and aborts pending work when unmounted', async () => {
    mocks.summary.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<AdminOperationsPanel />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(150000); });
    fireEvent.click(screen.getByRole('button', { name: '刷新运行数据' })); await flush();
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    const signal = mocks.summary.mock.calls[0][0] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
  });

  it('keeps the last successful snapshot visible and marks refresh failures stale', async () => {
    mocks.summary.mockResolvedValueOnce(summary).mockRejectedValue(new Error('采集超时'));
    render(<AdminOperationsPanel />); await flush();
    fireEvent.click(screen.getByRole('button', { name: '刷新运行数据' })); await flush();
    expect(screen.getByText('12 / 48')).toBeTruthy();
    expect(screen.getByText(/采集超时/)).toBeTruthy();
    expect(screen.getAllByText(/数据可能已过期/).length).toBeGreaterThan(0);
  });

  it('shows loading, unavailable history and no terminal samples without zero success', async () => {
    mocks.summary.mockResolvedValue({ ...summary, coverage: { ...coverage, available: false, history: 'unavailable', error: 'MySQL 未连接' }, failures: { ...summary.failures, total: 0, succeeded: 0, failed: 0, successRate: null, causes: [], routes: [] } });
    render(<AdminOperationsPanel />);
    expect(screen.getByText('正在加载运行数据...')).toBeTruthy();
    await flush();
    expect(screen.getByText(/历史采集不可用/)).toBeTruthy();
    expect(screen.getByText('暂无终态样本')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('applies bounded filters, pages tasks and displays a safe task timeline', async () => {
    render(<AdminOperationsPanel />); await flush();
    fireEvent.change(screen.getByLabelText('用户 ID'), { target: { value: 'user-a' } });
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'failed' } });
    fireEvent.click(screen.getByRole('button', { name: '查询任务' })); await flush();
    expect(mocks.tasks.mock.calls.at(-1)?.[0]).toMatchObject({ userId: 'user-a', status: 'failed', limit: 25, window: '15m' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await flush();
    expect(mocks.tasks.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: 'next' });
    fireEvent.click(screen.getByRole('button', { name: '查看 task-a' })); await flush();
    const detail = screen.getByRole('region', { name: '任务详情' });
    expect(within(detail).getByText('上游超时')).toBeTruthy();
    expect(within(detail).getByText('generation_failed')).toBeTruthy();
    expect(within(detail).getByText('超时事件说明')).toBeTruthy();
    expect(within(detail).getByText('结算状态')).toBeTruthy();
    expect(within(detail).getByText('存储状态')).toBeTruthy();
    expect(screen.queryByText('SECRET_PROMPT')).toBeNull();
    expect(screen.queryByText('SECRET_TOKEN')).toBeNull();
  });

  it('shows initial API failures without inventing a zero success rate', async () => {
    mocks.summary.mockRejectedValue(new Error('服务暂不可用'));
    mocks.tasks.mockRejectedValue(new Error('任务查询失败'));
    render(<AdminOperationsPanel />); await flush();
    expect(screen.getByText(/服务暂不可用/)).toBeTruthy();
    expect(screen.getByText(/任务查询失败/)).toBeTruthy();
    expect(screen.getByText('暂无终态样本')).toBeTruthy();
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('plots available trends and aborts obsolete trend and detail requests', async () => {
    mocks.trends.mockResolvedValue({ success: true, window: '15m', generatedAt: summary.generatedAt, coverage, freshness: { stale: true }, items: [{ timestamp: summary.generatedAt, submitted: 10, succeeded: 8, completed: 10, failed: 2, active: 12, localQueued: 4, upstreamQueued: 2 }] });
    const { unmount } = render(<AdminOperationsPanel />); await flush();
    expect(screen.getByRole('img', { name: '图片任务提交、成功、失败与队列趋势' })).toBeTruthy();
    const trendSignal = mocks.trends.mock.calls[0][1] as AbortSignal;
    fireEvent.change(screen.getByLabelText('历史窗口'), { target: { value: '1h' } }); await flush();
    expect(trendSignal.aborted).toBe(true);
    expect(mocks.trends.mock.calls.at(-1)?.[0]).toBe('1h');
    fireEvent.click(screen.getByRole('button', { name: '查看 task-a' })); await flush();
    const detailSignal = mocks.task.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(detailSignal.aborted).toBe(true);
    unmount();
  });

  it('backs off failed polling to bounded summary and trend intervals', async () => {
    mocks.summary.mockRejectedValue(new Error('采集超时'));
    mocks.trends.mockRejectedValue(new Error('趋势超时'));
    render(<AdminOperationsPanel />); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(21000); });
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(mocks.summary).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(mocks.summary).toHaveBeenCalledTimes(4);
    expect(mocks.trends).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(38000); });
    expect(mocks.trends).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(301000); });
    expect(mocks.trends).toHaveBeenCalledTimes(3);
  });

  it('shows telemetry gaps, actual configured limits, uptime and container states', async () => {
    mocks.summary.mockResolvedValue({ ...summary, coverage: { ...coverage, collectionError: '事件写入失败' },
      runtime: { ...summary.runtime, active: 2, limits: { ...summary.runtime.limits, concurrency: 7, userConcurrency: 1 }, coverage: { events: { dropped: 3, failed: 2 } } },
      resources: { ...summary.resources, containers: { available: true, app: 'running', mysql: 'running' } } });
    render(<AdminOperationsPanel />); await flush();
    expect(screen.getByText('2 / 7')).toBeTruthy();
    expect(screen.getByText(/事件写入失败/)).toBeTruthy();
    expect(screen.getByText(/丢弃 3.*失败 2/)).toBeTruthy();
    expect(screen.getByText('进程运行时间')).toBeTruthy();
    expect(screen.getByText('本轮聚合查询耗时')).toBeTruthy();
    expect(screen.getByText(/app: running.*mysql: running/)).toBeTruthy();
  });

  it('offers persisted task statuses and labels bucket duration estimates', async () => {
    render(<AdminOperationsPanel />); await flush();
    const statuses = screen.getByLabelText('任务状态');
    expect(within(statuses).getByRole('option', { name: 'rejected' })).toBeTruthy();
    expect(within(statuses).queryByRole('option', { name: 'upstream_queued' })).toBeNull();
    expect(within(statuses).queryByRole('option', { name: 'cancelled' })).toBeNull();
    expect(screen.getAllByText(/耗时分桶估计/).length).toBeGreaterThan(0);
  });

  it('shows capacity refusals separately from generation failures', async () => {
    mocks.summary.mockResolvedValue({ ...summary, failures: { ...summary.failures, refusals: { userQueueFull: 3, siteQueueFull: 2, total: 5 } } });
    render(<AdminOperationsPanel />); await flush();
    expect(screen.getByText(/容量拒绝 5.*用户队列满 3.*本站队列满 2/)).toBeTruthy();
    expect(screen.getByText(/拒绝不计入生成终态成功率/)).toBeTruthy();
  });

  it('does not draw missing runtime samples as zero and explains hourly maxima', async () => {
    const point = { submitted: 10, succeeded: 8, completed: 10, failed: 2, active: 12, localQueued: 4, upstreamQueued: 2 };
    mocks.trends.mockResolvedValue({ success: true, window: '7d', generatedAt: summary.generatedAt, coverage, freshness: { stale: false }, items: [
      { ...point, timestamp: '2026-10-19T01:00:00Z' },
      { ...point, timestamp: '2026-10-19T02:00:00Z', active: null, localQueued: null, upstreamQueued: null },
      { ...point, timestamp: '2026-10-19T03:00:00Z' },
    ] });
    render(<AdminOperationsPanel />); await flush();
    const chart = screen.getByRole('img', { name: '图片任务提交、成功、失败与队列趋势' });
    expect(chart.querySelectorAll('[data-series="active"]').length).toBe(2);
    expect(chart.querySelectorAll('[data-series="localQueued"]').length).toBe(2);
    expect(screen.getByText(/7天窗口.*每小时.*最大采样值/)).toBeTruthy();
  });
});
