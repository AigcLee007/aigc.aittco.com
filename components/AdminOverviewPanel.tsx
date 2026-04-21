import React from 'react';
import {
  Activity,
  Boxes,
  CircleCheckBig,
  Clock3,
  Loader2,
  Network,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import { AdminDashboardPayload } from '../src/services/adminDashboardService';
import { formatPoint } from '../src/utils/pointFormat';

interface AdminOverviewPanelProps {
  data: AdminDashboardPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const formatTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '暂无';

const formatRate = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`;

const MetricCard = ({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{title}</div>
        <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
        <div className="mt-2 text-xs leading-5 text-gray-400">{hint}</div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-cyan-200">
        {icon}
      </div>
    </div>
  </div>
);

const SectionTable = ({
  title,
  description,
  emptyText,
  children,
}: {
  title: string;
  description: string;
  emptyText: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
    <div className="mb-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-gray-400">{description}</div>
    </div>
    <div className="overflow-hidden rounded-2xl border border-white/10">
      {children || (
        <div className="bg-white/[0.03] px-4 py-10 text-center text-sm text-gray-500">
          {emptyText}
        </div>
      )}
    </div>
  </div>
);

const typeLabel = (value?: string) => {
  if (value === 'video') return '视频';
  if (value === 'image') return '图片';
  return '未知';
};

const AdminOverviewPanel: React.FC<AdminOverviewPanelProps> = ({
  data,
  loading,
  error,
  onRefresh,
}) => {
  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
              <Activity size={12} />
              站点运行总览
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
              独立管理后台
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-300">
              在这里可以直接看全站用户活跃度、模型与线路运行状态、24 小时请求量和成功率，
              不需要再到设置页里来回翻找。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-gray-300">
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">最近刷新</div>
              <div className="mt-1 font-medium text-white">
                {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '等待载入'}
              </div>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              刷新看板
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <MetricCard
          title="在线用户"
          value={data?.auth?.onlineUsers ?? 0}
          hint={`过去 ${data?.windows?.onlineWindowMinutes ?? 5} 分钟内活跃用户 ${data?.auth?.onlineUsers ?? 0}，当前活跃会话 ${data?.auth?.activeSessions ?? 0}。`}
          icon={<Users size={20} />}
        />
        <MetricCard
          title="24 小时请求"
          value={data?.billing?.requestsLast24h ?? 0}
          hint={`24 小时成功率 ${formatRate(data?.billing?.successRateLast24h)}，当前待处理任务 ${data?.billing?.pendingTasks ?? 0}。`}
          icon={<Clock3 size={20} />}
        />
        <MetricCard
          title="总站成功率"
          value={formatRate(data?.billing?.successRate)}
          hint={`累计请求 ${data?.billing?.totalCharges ?? 0} 次，成功 ${data?.billing?.successfulCharges ?? 0} 次，失败 ${data?.billing?.failedCharges ?? 0} 次。`}
          icon={<CircleCheckBig size={20} />}
        />
        <MetricCard
          title="总用户数"
          value={data?.auth?.totalUsers ?? 0}
          hint={`活跃用户 ${data?.auth?.activeUsers ?? 0}，禁用用户 ${data?.auth?.disabledUsers ?? 0}，最近 ${data?.windows?.recentUserWindowDays ?? 7} 天新增 ${data?.auth?.recentUsers ?? 0}。`}
          icon={<Users size={20} />}
        />
        <MetricCard
          title="模型 / 线路"
          value={`${data?.modelCatalog?.activeModels ?? 0} / ${data?.routeCatalog?.activeRoutes ?? 0}`}
          hint={`图片模型 ${data?.modelCatalog?.imageActiveModels ?? 0} 个，视频模型 ${data?.modelCatalog?.videoActiveModels ?? 0} 个；图片线路 ${data?.routeCatalog?.imageActiveRoutes ?? 0} 条，视频线路 ${data?.routeCatalog?.videoActiveRoutes ?? 0} 条。`}
          icon={<Boxes size={20} />}
        />
        <MetricCard
          title="点数余额"
          value={formatPoint(data?.billing?.totalBalancePoints ?? 0)}
          hint={`累计充值 ${formatPoint(data?.billing?.totalRechargedPoints ?? 0)} 点，累计净消费 ${formatPoint(data?.billing?.netSpentPoints ?? 0)} 点。`}
          icon={<Wallet size={20} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
        <SectionTable
          title="线路运行情况"
          description="展示每条线路的请求量、成功率、待处理任务和最近活跃时间，方便快速判断哪条线更稳。"
          emptyText="暂无线路统计数据"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-left text-sm">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-gray-400">
                <tr>
                  <th className="px-4 py-3">线路</th>
                  <th className="px-4 py-3">24h / 累计</th>
                  <th className="px-4 py-3">成功率</th>
                  <th className="px-4 py-3">待处理</th>
                  <th className="px-4 py-3">净消费</th>
                  <th className="px-4 py-3">最近请求</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-black/10">
                {data?.routeStats?.length ? (
                  data.routeStats.map((route) => (
                    <tr key={route.routeId} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Network size={14} className="text-violet-300" />
                          <div>
                            <div className="font-medium text-white">{route.label}</div>
                            <div className="mt-1 text-xs text-gray-400">
                              <span className="mr-2 rounded-full bg-white/10 px-2 py-0.5">
                                {typeLabel(route.mediaType)}
                              </span>
                              {route.modelFamily} / {route.line} / {route.transport} / {route.mode}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>
                          {route.requestsLast24h} / {route.totalCharges}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          失败 {route.failedLast24h} / {route.failedCharges}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>{formatRate(route.successRateLast24h)}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          累计 {formatRate(route.successRate)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{route.pendingTasks}</td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>{formatPoint(route.netSpentPoints)} 点</div>
                        <div className="mt-1 text-xs text-gray-500">
                          退款 {formatPoint(route.refundedPoints)} 点
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{formatTime(route.lastChargeAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                      暂无线路统计数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionTable>

        <SectionTable
          title="模型运行情况"
          description="展示模型维度的用量和成功率，方便判断哪些模型值得保留、提价或者下线。"
          emptyText="暂无模型统计数据"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-left text-sm">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-gray-400">
                <tr>
                  <th className="px-4 py-3">模型</th>
                  <th className="px-4 py-3">24h / 累计</th>
                  <th className="px-4 py-3">成功率</th>
                  <th className="px-4 py-3">净消费</th>
                  <th className="px-4 py-3">最近请求</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-black/10">
                {data?.modelStats?.length ? (
                  data.modelStats.map((model) => (
                    <tr key={model.modelKey} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Boxes size={14} className="text-cyan-300" />
                          <div>
                            <div className="font-medium text-white">{model.label}</div>
                            <div className="mt-1 text-xs text-gray-400">
                              <span className="mr-2 rounded-full bg-white/10 px-2 py-0.5">
                                {typeLabel(model.mediaType)}
                              </span>
                              {model.modelId || model.modelKey}
                              {model.requestModel ? ` / ${model.requestModel}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>
                          {model.requestsLast24h} / {model.totalCharges}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          失败 {model.failedLast24h} / {model.failedCharges}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>{formatRate(model.successRateLast24h)}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          累计 {formatRate(model.successRate)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{formatPoint(model.netSpentPoints)} 点</td>
                      <td className="px-4 py-3 text-gray-400">{formatTime(model.lastChargeAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                      暂无模型统计数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionTable>
      </div>
    </div>
  );
};

export default AdminOverviewPanel;
