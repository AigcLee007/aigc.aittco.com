import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Clock3, RefreshCw } from 'lucide-react';
import {
  fetchOperationsSummary, fetchOperationsTrends, fetchOperationsTasks, fetchOperationsTask,
  type OperationsCoverage, type OperationsResources, type OperationsSummary, type OperationsTrends,
  type OperationsTaskFilters, type OperationsTaskList, type OperationsTaskDetail, type OperationsWindow,
} from '../src/services/adminOperationsService';

const number = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString();
const rate = (value?: number | null) => value == null || !Number.isFinite(value) ? '暂无终态样本' : `${value.toFixed(1)}%`;
const time = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—';
const duration = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' : value < 1000 ? `${value.toFixed(0)} ms` : `${(value / 1000).toFixed(1)} s`;
const bytes = (value?: number | null) => value == null || !Number.isFinite(value) ? '不可用' : value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GB` : `${(value / 1048576).toFixed(1)} MB`;
const message = (error: unknown) => error instanceof Error ? error.message : '运行数据请求失败';
const isPageVisible = () => document.visibilityState !== 'hidden';

// Each channel schedules its next read after completion, so slow requests cannot overlap.
function useVisiblePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let failureCount = 0;
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const refresh = async () => {
      if (controller.signal.aborted || !isPageVisible() || inFlight) return;
      clearTimer(); inFlight = true; setLoading(true);
      try {
        const next = await fetcher(controller.signal);
        if (!controller.signal.aborted) { failureCount = 0; setData(next); setError(null); }
      } catch (cause) {
        if (!controller.signal.aborted) { failureCount += 1; setError(message(cause)); }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          const delay = Math.min(intervalMs * 3, intervalMs * (failureCount + 1));
          if (isPageVisible()) timer = setTimeout(() => void refresh(), delay + Math.random() * 2000);
        }
      }
    };
    const onVisibilityChange = () => {
      clearTimer();
      if (isPageVisible()) void refresh();
    };
    refreshRef.current = () => void refresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    void refresh();
    return () => {
      controller.abort(); clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      refreshRef.current = () => {};
    };
  }, [fetcher, intervalMs]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { data, loading, error, refresh };
}

const Card = ({ title, value, hint }: { title: string; value: React.ReactNode; hint: React.ReactNode }) => (
  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <div className="text-xs text-gray-400">{title}</div>
    <div className="mt-2 break-words text-2xl font-semibold text-white">{value}</div>
    <div className="mt-2 text-xs leading-5 text-gray-400">{hint}</div>
  </div>
);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-5">
    <h3 className="mb-4 text-base font-semibold text-white">{title}</h3>{children}
  </section>
);
const ErrorNotice = ({ error, retained = false }: { error: string | null; retained?: boolean }) => error ? (
  <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
    {error}{retained ? ' · 数据可能已过期，保留最近成功快照。' : ' · 可稍后刷新重试。'}
  </div>
) : null;

function Coverage({ data }: { data?: OperationsCoverage | null }) {
  if (!data) return null;
  return <div className="space-y-1 text-xs leading-5 text-gray-400">
    <p>覆盖范围：已登录持久化图片任务；视频、匿名及旧同步图片任务未覆盖。</p>
    <p>采集起点：{time(data.startedAt)}；最近采集：{time(data.lastCollectedAt)}。采集前历史不回填。</p>
    {data.aggregateUpdatedAt && <p>历史聚合更新：{time(data.aggregateUpdatedAt)}。</p>}
    {(!data.available || data.history === 'unavailable') && <p className="text-amber-200">历史采集不可用{data.error ? `：${data.error}` : '，实时调度快照仍可独立查看'}。</p>}
    {(data.collectionError || data.available && data.error) && <p className="text-amber-200">历史采集存在缺口：{data.collectionError || data.error}。</p>}
    {data.history === 'not_collected' && <p className="text-amber-200">历史尚未采集，等待首个样本。</p>}
  </div>;
}

function ResourceSnapshot({ data }: { data?: OperationsResources }) {
  const host = data?.host;
  return <Section title="资源快照">
    <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
      {[
        ['宿主机 CPU', host?.available && host.cpuPercent != null ? `${host.cpuPercent.toFixed(1)}%` : '不可用'],
        ['宿主机可用 / 总内存', `${bytes(host?.memoryAvailableBytes)} / ${bytes(host?.memoryTotalBytes)}`],
        ['进程 RSS', bytes(data?.process?.rssBytes)],
        ['进程堆内存', bytes(data?.process?.heapUsedBytes)],
        ['进程运行时间', duration(data?.process?.uptimeSeconds == null ? null : data.process.uptimeSeconds * 1000)],
        ['事件循环 P95', duration(data?.process?.eventLoopP95Ms)],
        ['容器内存 / 上限', `${bytes(data?.cgroup?.memoryCurrentBytes)} / ${bytes(data?.cgroup?.memoryMaxBytes)}`],
        ['数据卷可用 / 总量', `${bytes(data?.disk?.freeBytes)} / ${bytes(data?.disk?.totalBytes)}`],
        ['本轮聚合查询耗时', data?.database?.available ? duration(data.database.latencyMs) : '不可用'],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 break-words text-gray-200">{value}</dd></div>)}
    </dl>
    <p className="mt-4 text-xs text-gray-500">资源为当前进程可读取的快照；缺失值表示不可用。容器状态：{data?.containers?.available ? `app: ${data.containers.app || '未知'} · mysql: ${data.containers.mysql || '未知'}` : data?.containers?.reason || '未接入宿主机代理'}。</p>
  </Section>;
}

const series = [
  { key: 'submitted', label: '提交', color: '#38bdf8' },
  { key: 'succeeded', label: '成功', color: '#34d399' },
  { key: 'failed', label: '失败', color: '#fb7185' },
  { key: 'active', label: '占用槽位', color: '#a78bfa' },
  { key: 'localQueued', label: '本地排队', color: '#fbbf24' },
] as const;
function TrendChart({ data }: { data: OperationsTrends | null }) {
  const items = data?.items || [];
  if (!items.length) return <p className="py-10 text-center text-sm text-gray-500">暂无趋势样本</p>;
  const max = Math.max(1, ...items.flatMap(item => series.flatMap(({ key }) => item[key] != null && Number.isFinite(item[key]) ? [item[key] as number] : [])));
  const segments = (key: typeof series[number]['key']) => {
    const paths: string[][] = [];
    let current: string[] = [];
    const split = () => { if (current.length) paths.push(current); current = []; };
    let previousTime: number | null = null;
    const expectedStep = data?.window === '7d' ? 3600000 : 60000;
    items.forEach((item, index) => {
      const timestamp = Date.parse(item.timestamp);
      if (previousTime != null && timestamp - previousTime > expectedStep * 1.5) split();
      previousTime = timestamp;
      const value = item[key];
      if (value == null || !Number.isFinite(value)) { split(); return; }
      current.push(`${40 + index * 920 / Math.max(1, items.length - 1)},${180 - value / max * 150}`);
    });
    split(); return paths.map(path => path.join(' '));
  };
  return <>
    <div className="flex flex-wrap gap-4 text-xs text-gray-300">{series.map(item => <span key={item.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>
    <svg role="img" aria-label="图片任务提交、成功、失败与队列趋势" viewBox="0 0 1000 220" className="mt-3 w-full">
      {[0, 0.5, 1].map(part => <g key={part}><line x1="40" y1={180 - 150 * part} x2="960" y2={180 - 150 * part} stroke="#ffffff15" /><text x="32" y={184 - 150 * part} fill="#9ca3af" textAnchor="end" fontSize="12">{Math.round(max * part)}</text></g>)}
      {series.flatMap(item => segments(item.key).map((points, index) => <polyline key={`${item.key}-${index}`} data-series={item.key} fill="none" stroke={item.color} strokeLinecap="round" strokeWidth="2.5" points={points} />))}
      <text x="40" y="208" fill="#9ca3af" fontSize="12">{time(items[0].timestamp)}</text>
      <text x="960" y="208" fill="#9ca3af" textAnchor="end" fontSize="12">{time(items[items.length - 1].timestamp)}</text>
    </svg>
    <p className="text-xs text-gray-500">{data?.window === '7d' ? '7天窗口按每小时汇总任务数量，槽位与队列为该小时最大采样值。' : '提交、成功、失败为每分钟数量；槽位与本地队列为分钟采样值。'}空缺历史不代表零任务，缺失采样以断线展示。</p>
  </>;
}

type DraftFilters = Pick<OperationsTaskFilters, 'status' | 'userId' | 'routeId' | 'taskId' | 'requestId' | 'failureCategory' | 'storageStatus' | 'settlementStatus'>;
const inputClass = 'mt-1 h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-gray-200 focus:border-cyan-400/50 focus:outline-none';
const buttonClass = 'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-40';

const AdminOperationsPanel: React.FC = () => {
  const [window, setWindow] = useState<OperationsWindow>('15m');
  const summaryFetcher = useCallback((signal: AbortSignal) => fetchOperationsSummary(signal), []);
  const trendsFetcher = useCallback((signal: AbortSignal) => fetchOperationsTrends(window, signal), [window]);
  const summary = useVisiblePolling<OperationsSummary>(summaryFetcher, 20000);
  const trends = useVisiblePolling<OperationsTrends>(trendsFetcher, 100000);
  const [draft, setDraft] = useState<DraftFilters>({});
  const [filters, setFilters] = useState<OperationsTaskFilters>({ window: '15m', limit: 25 });
  const [tasks, setTasks] = useState<OperationsTaskList | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OperationsTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setTasksLoading(true); setTasksError(null);
    void fetchOperationsTasks(filters, controller.signal).then(next => {
      if (!controller.signal.aborted) setTasks(next);
    }).catch(error => { if (!controller.signal.aborted) setTasksError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setTasksLoading(false); });
    return () => controller.abort();
  }, [filters]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setDetail(null); setDetailError(null); setDetailLoading(true);
    void fetchOperationsTask(selectedId, controller.signal).then(next => {
      if (!controller.signal.aborted) setDetail(next);
    }).catch(error => { if (!controller.signal.aborted) setDetailError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  const applyFilters = (next: DraftFilters = draft) => {
    setDraft(next); setFilters({ ...next, window, limit: 25 }); setSelectedId(null);
  };
  const setField = (key: keyof DraftFilters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const data = summary.data;
  const runtime = data?.runtime;
  const failures = data?.failures;
  const stale = data?.freshness?.stale || Boolean(summary.error && data);
  const failedUserIds = failures?.failedUserIds || [...new Set(failures?.causes.flatMap(cause => cause.userIds || []) || [])];

  return <div className="space-y-5">
    <header className="rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_50%)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-cyan-200"><Activity size={14} />Operations</div><h2 className="text-2xl font-semibold">图片任务运行看板</h2><p className="mt-2 text-sm leading-6 text-gray-400">真实调度槽位、生成结果与故障定位。运行摘要每 20 秒、趋势每 100 秒刷新，另加 0–2 秒错峰；页面隐藏时暂停。</p></div>
        <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={() => { summary.refresh(); trends.refresh(); }}><RefreshCw size={14} className={summary.loading ? 'animate-spin' : ''} />刷新运行数据</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400"><span>摘要生成：{time(data?.generatedAt)}</span><span>采集年龄：{duration(data?.freshness?.ageMs)}</span>{stale && <span className="text-amber-200">数据可能已过期</span>}</div>
      <div className="mt-3"><Coverage data={data?.coverage} /></div>
      {Boolean(runtime?.coverage?.events?.dropped || runtime?.coverage?.events?.failed) && <p className="mt-2 text-xs text-amber-200">运行事件采集存在缺口：丢弃 {number(runtime?.coverage?.events?.dropped ?? 0)} · 失败 {number(runtime?.coverage?.events?.failed ?? 0)}。</p>}
    </header>
    {summary.loading && !data && <p role="status" className="text-sm text-gray-400">正在加载运行数据...</p>}
    <ErrorNotice error={summary.error} retained={Boolean(data)} />

    <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
      <Card title="已占用槽位 / 并发上限" value={`${number(runtime?.active)} / ${number(runtime?.limits.concurrency)}`} hint={`活跃用户 ${number(runtime?.activeUsers)}；单用户上限 ${number(runtime?.limits.userConcurrency)}`} />
      <Card title="本地排队" value={number(runtime?.localQueued)} hint={`队列上限 ${number(runtime?.limits.maxQueued)}；最久等待 ${duration(runtime?.oldestLocalWaitMs)}`} />
      <Card title="上游排队" value={number(runtime?.upstreamQueued)} hint="上游排队属于已占用槽位，不能与活跃槽位相加。" />
      <Card title="近15分钟终态成功率" value={rate(failures?.successRate)} hint={`成功 / (成功 + 失败)，不含处理中；成功 ${number(failures?.succeeded)}，失败 ${number(failures?.failed)}`} />
      <Card title="失败影响用户" value={number(failures?.affectedUsers)} hint="近15分钟生成失败去重用户，点击下方用户 ID 定位。" />
      <Card title="存储失败" value={number(failures?.storageFailures)} hint="与生成结果分开统计；保存失败不等同生成失败。" />
      <Card title="结算待处理" value={number(failures?.settlementPending)} hint="与生成状态独立；不计入生成成功率分母。" />
      <Card title="排队 / 总耗时 P95" value={`${duration(failures?.p95QueueMs)} / ${duration(failures?.p95TotalMs)}`} hint={`近15分钟耗时分桶估计；P50 ${duration(failures?.p50QueueMs)} / ${duration(failures?.p50TotalMs)}`} />
    </div>
    {failures?.refusals && <p className="text-xs leading-6 text-amber-100/80">近15分钟容量拒绝 {number(failures.refusals.total)}：用户队列满 {number(failures.refusals.userQueueFull)} · 本站队列满 {number(failures.refusals.siteQueueFull)}。拒绝不计入生成终态成功率。</p>}

    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="近15分钟失败原因与用户">
        {failures?.causes?.length ? <ul className="space-y-2">{failures.causes.map(cause => <li key={cause.category} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] p-3 text-sm"><button type="button" className="text-cyan-200 hover:underline" onClick={() => applyFilters({ status: 'failed', failureCategory: cause.category })}>{cause.category}</button><span className="text-gray-400">{cause.count} 次 · {cause.affectedUsers} 位用户</span></li>)}</ul> : <p className="text-sm text-gray-500">暂无失败原因样本</p>}
        {failedUserIds.length > 0 && <div className="mt-4 text-xs leading-6 text-gray-400">失败用户 ID：{failedUserIds.map((id, index) => <React.Fragment key={id}>{index > 0 && '、'}<button type="button" onClick={() => applyFilters({ status: 'failed', userId: id })} className="break-all text-cyan-200 hover:underline">{id}</button></React.Fragment>)}</div>}
      </Section>
      <Section title="事件与告警">
        {data?.incidents?.items?.length ? <ul className="space-y-3">{data.incidents.items.map((incident, index) => <li key={incident.id || incident.incidentId || index} className="rounded-xl border border-amber-400/10 bg-amber-500/5 p-3 text-sm"><div className="flex gap-2 text-amber-100"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{incident.message || incident.summary || incident.category || '运行事件'}</span></div><p className="mt-2 text-xs text-gray-400">{incident.status || '状态未知'} · {incident.routeId || '全局'} · {time(incident.lastSeenAt || incident.createdAt || incident.firstSeenAt)}</p></li>)}</ul> : <p className="text-sm text-gray-500">暂无已记录事件；未采集不代表无故障。</p>}
      </Section>
    </div>

    <Section title="近15分钟线路健康">
      <p className="mb-3 text-xs text-gray-500">P95 为耗时分桶估计，按分桶上界展示。</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-white/10 text-xs text-gray-500"><tr>{['线路', '终态数', '失败', '终态成功率', '总耗时 P95'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/5 text-gray-300">
        {failures?.routes?.length ? failures.routes.map(route => <tr key={route.routeId}><td className="px-3 py-3"><button type="button" className="text-cyan-200 hover:underline" onClick={() => applyFilters({ routeId: route.routeId })}>{route.routeId}</button></td><td className="px-3 py-3">{route.total}</td><td className="px-3 py-3">{route.failed}</td><td className="whitespace-nowrap px-3 py-3">{rate(route.successRate)}</td><td className="px-3 py-3">{duration(route.p95TotalMs)}</td></tr>) : <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">暂无线路终态样本</td></tr>}
      </tbody></table></div>
    </Section>
    {runtime?.perUser?.length ? <Section title="当前用户槽位"><div className="flex flex-wrap gap-2">{runtime.perUser.map(user => <button key={user.userId} type="button" className={`${buttonClass} break-all text-left`} onClick={() => applyFilters({ userId: user.userId })}>{user.userId} · 活跃 {user.active} / {runtime.limits.userConcurrency} · 排队 {user.queued} / {runtime.limits.userMaxQueued}</button>)}</div></Section> : null}
    <ResourceSnapshot data={data?.resources} />

    <Section title="历史趋势">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-gray-400">历史窗口<select aria-label="历史窗口" value={window} className={`${inputClass} !mt-0 !w-auto`} onChange={event => { const next = event.target.value as OperationsWindow; setWindow(next); setFilters({ ...draft, window: next, limit: 25 }); setSelectedId(null); }}>{[['15m', '15分钟'], ['1h', '1小时'], ['24h', '24小时'], ['7d', '7天']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span className="text-xs text-gray-500">趋势生成：{time(trends.data?.generatedAt)}{trends.loading ? ' · 更新中' : ''}{trends.data?.freshness?.stale || trends.error && trends.data ? ' · 数据可能已过期' : ''}</span></div>
      <ErrorNotice error={trends.error} retained={Boolean(trends.data)} />
      {trends.loading && !trends.data ? <p className="py-8 text-center text-sm text-gray-500">正在加载趋势...</p> : <TrendChart data={trends.data} />}
      <Coverage data={trends.data?.coverage} />
    </Section>

    <Section title="任务定位">
      <p className="mb-4 text-xs leading-5 text-gray-400">仅查询已采集任务；每页 25 条。生成、存储、结算状态分别展示。列表按查询刷新，不自动扫描。</p>
      <form onSubmit={event => { event.preventDefault(); applyFilters(); }} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="text-xs text-gray-400">任务状态<select className={inputClass} value={draft.status || ''} onChange={event => setField('status', event.target.value)}><option value="">全部</option>{['queued', 'running', 'succeeded', 'failed', 'rejected'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        {([['userId', '用户 ID'], ['routeId', '线路 ID'], ['taskId', '任务 ID'], ['requestId', '请求 ID'], ['failureCategory', '失败类别'], ['storageStatus', '存储状态筛选'], ['settlementStatus', '结算状态筛选']] as const).map(([key, label]) => <label key={key} className="text-xs text-gray-400">{label}<input value={draft[key] || ''} onChange={event => setField(key, event.target.value)} className={inputClass} autoComplete="off" /></label>)}
        <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-4"><button type="submit" className={`${buttonClass} !border-cyan-400/20 !bg-cyan-400/10`}>查询任务</button><button type="button" className={buttonClass} onClick={() => applyFilters({})}>清空筛选</button></div>
      </form>
      <div className="mt-4"><ErrorNotice error={tasksError} retained={Boolean(tasks)} /></div>
      {tasksLoading && <p role="status" className="mt-3 text-xs text-gray-400">正在查询任务...</p>}
      <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="border-b border-white/10 text-gray-500"><tr>{['任务 / 请求', '用户', '线路', '生成状态 / 阶段', '存储 / 结算', '失败阶段 / 原因', '提交时间'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/5 text-gray-300">
        {tasks?.items.length ? tasks.items.map(task => <tr key={task.taskId} className="align-top"><td className="max-w-[220px] break-all px-3 py-3"><button aria-label={`查看 ${task.taskId}`} type="button" className="text-cyan-200 hover:underline" onClick={() => setSelectedId(task.taskId)}>{task.taskId}</button><div className="mt-1 text-gray-500">{task.requestId || '—'}</div></td><td className="max-w-[160px] break-all px-3 py-3">{task.userLabel && <div>{task.userLabel}</div>}<button type="button" className="text-cyan-200 hover:underline" onClick={() => applyFilters({ userId: task.userId })}>{task.userId}</button></td><td className="max-w-[160px] break-all px-3 py-3">{task.routeId || '—'}</td><td className="whitespace-nowrap px-3 py-3">{task.status}<div className="mt-1 text-gray-500">{task.phase || '—'}</div></td><td className="whitespace-nowrap px-3 py-3">{task.storageStatus || '—'}<div className="mt-1 text-gray-500">{task.settlementStatus || '—'}</div></td><td className="px-3 py-3">{task.failureStage || '—'}<div className="mt-1 text-rose-200/70">{task.failureCategory || '—'}</div></td><td className="whitespace-nowrap px-3 py-3">{time(task.createdAt)}</td></tr>) : <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">{tasks?.coverage.available === false ? '任务历史未覆盖，无法查询' : '暂无符合条件的已采集任务'}</td></tr>}
      </tbody></table></div>
      <div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-gray-500">本页 {tasks?.items.length || 0} 条{tasksError ? ' · 保留上次查询结果' : ''}</span><div className="flex gap-2">{filters.cursor && <button type="button" className={buttonClass} onClick={() => setFilters(current => ({ ...current, cursor: undefined }))}>回到首页</button>}<button type="button" className={buttonClass} disabled={!tasks?.nextCursor || tasksLoading || Boolean(tasksError)} onClick={() => setFilters(current => ({ ...current, cursor: tasks?.nextCursor || undefined }))}>下一页</button></div></div>
    </Section>

    {selectedId && <section aria-label="任务详情" className="rounded-3xl border border-cyan-400/20 bg-slate-900/80 p-5">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">任务详情</h3><button type="button" className={buttonClass} onClick={() => setSelectedId(null)}>关闭详情</button></div>
      {detailLoading && <p className="mt-4 text-sm text-gray-400">正在加载任务详情...</p>}<div className="mt-3"><ErrorNotice error={detailError} /></div>
      {detail && <>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">{[
          ['任务 ID', detail.task.taskId], ['请求 ID', detail.task.requestId], ['用户 ID', detail.task.userId], ['用户名称', detail.task.userLabel],
          ['线路', detail.task.routeId], ['模型', detail.task.modelId], ['生成状态', detail.task.status], ['生成阶段', detail.task.phase],
          ['存储状态', detail.task.storageStatus], ['结算状态', detail.task.settlementStatus], ['失败阶段', detail.task.failureStage], ['失败类别', detail.task.failureCategory],
          ['错误代码', detail.task.failureCode], ['HTTP 状态', detail.task.httpStatus], ['提交时间', time(detail.task.createdAt)], ['开始时间', time(detail.task.startedAt)],
          ['上游开始', time(detail.task.upstreamStartedAt)], ['完成时间', time(detail.task.completedAt)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 break-all text-gray-200">{value ?? '—'}</dd></div>)}</dl>
        {detail.task.errorSummary && <p className="mt-4 break-words rounded-xl bg-rose-500/10 p-3 text-sm text-rose-100">{detail.task.errorSummary}</p>}
        <h4 className="mb-3 mt-5 flex items-center gap-2 text-sm font-medium"><Clock3 size={14} />任务时间线</h4>
        {detail.events.length ? <ol className="space-y-3 border-l border-white/10 pl-4">{detail.events.map((event, index) => <li key={`${event.type}-${event.createdAt}-${index}`} className="text-xs"><div className="flex flex-wrap gap-2"><span className="text-cyan-200">{event.type}</span><span className="text-gray-500">{time(event.createdAt)}</span></div><p className="mt-1 text-gray-400">{[event.phase, event.failureStage, event.failureCategory, event.storageStatus, event.settlementStatus].filter(Boolean).join(' · ')}</p>{(event.errorSummary || event.message) && <p className="mt-1 break-words text-gray-300">{event.errorSummary || event.message}</p>}</li>)}</ol> : <p className="text-xs text-gray-500">暂无已采集事件</p>}
      </>}
    </section>}
  </div>;
};

export default AdminOperationsPanel;
