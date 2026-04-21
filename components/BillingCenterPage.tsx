import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Coins,
  CreditCard,
  Filter,
  Gift,
  Loader2,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Ticket,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import AuthPanel from './AuthPanel';
import {
  AUTH_SESSION_CHANGE_EVENT,
  AuthSessionPayload,
  fetchCurrentAuthSession,
} from '../src/services/accountIdentity';
import {
  BillingCenterPayload,
  BillingLedgerEntry,
  fetchBillingCenter,
  redeemBillingCode,
} from '../src/services/accountService';
import { formatPoint } from '../src/utils/pointFormat';

type FilterState = {
  startDate: string;
  endDate: string;
  type: string;
  modelId: string;
  routeId: string;
};

const typeLabelMap: Record<string, string> = {
  signup: '注册赠送',
  recharge: '管理员充值',
  charge: '生成扣点',
  refund: '失败退款',
  admin_credit: '管理员加点',
  admin_debit: '管理员减点',
  redeem_code: '兑换码到账',
};

const positiveTypes = new Set([
  'signup',
  'recharge',
  'refund',
  'admin_credit',
  'redeem_code',
]);

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDefaultFilters = (): FilterState => {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(today),
    type: '',
    modelId: '',
    routeId: '',
  };
};

const renderLedgerMeta = (entry: BillingLedgerEntry) => {
  if (!entry.meta || typeof entry.meta !== 'object') return null;

  const parts = [
    String(entry.meta.note || '').trim(),
    String(entry.meta.code || '').trim(),
    String(entry.meta.routeId || '').trim(),
    String(entry.meta.modelId || entry.meta.model || '').trim(),
    String(entry.meta.taskId || '').trim(),
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : null;
};

const BillingCenterPage: React.FC = () => {
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [data, setData] = useState<BillingCenterPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => createDefaultFilters());
  const [page, setPage] = useState(1);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const next = await fetchCurrentAuthSession();
      setSession(next);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const loadBillingCenter = useCallback(async () => {
    if (!session?.authenticated) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await fetchBillingCenter({
        page,
        pageSize: 20,
        ...appliedFilters,
      });
      setData(next);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, session?.authenticated]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const handleSessionChange = () => {
      void refreshSession();
    };
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, handleSessionChange);
    window.addEventListener('storage', handleSessionChange);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, handleSessionChange);
      window.removeEventListener('storage', handleSessionChange);
    };
  }, [refreshSession]);

  useEffect(() => {
    void loadBillingCenter();
  }, [loadBillingCenter]);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters(draftFilters);
  };

  const resetFilters = () => {
    const next = createDefaultFilters();
    setDraftFilters(next);
    setAppliedFilters(next);
    setPage(1);
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      setError('请输入兑换码');
      return;
    }

    setRedeeming(true);
    setError(null);
    try {
      await redeemBillingCode({
        code: redeemCode.trim(),
      });
      setRedeemCode('');
      await loadBillingCenter();
    } catch (redeemError) {
      setError((redeemError as Error).message);
    } finally {
      setRedeeming(false);
    }
  };

  const titleText = useMemo(() => {
    if (sessionLoading) return '账单中心';
    if (!session?.authenticated) return '账单中心';
    return session.user.displayName || session.user.email || '账单中心';
  }, [session, sessionLoading]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#020617_0%,#0b1120_45%,#020617_100%)] text-white">
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-gray-200">
            <Loader2 size={16} className="animate-spin" />
            正在加载账单中心...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[linear-gradient(180deg,#020617_0%,#0b1120_45%,#020617_100%)] px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-amber-300">Billing Center</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">{titleText}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-gray-400">
              统一查看当前账号的点数统计、充值与退款情况、兑换码到账，以及分页账本记录。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = '/create/canvas';
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回画布版
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/create/classic';
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回经典版
            </button>
          </div>
        </div>

        {!session?.authenticated ? (
          <div className="space-y-6">
            <div className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-6">
              <div className="text-sm font-medium text-amber-100">登录后可查看完整账单和统计</div>
              <p className="mt-2 text-sm leading-7 text-amber-100/80">
                账单中心会展示你在所选时间范围内的消费、充值、退款、兑换到账，以及完整分页账本记录。
              </p>
            </div>
            <AuthPanel session={session} onSessionChange={setSession} />
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-3xl border border-amber-500/20 bg-linear-to-br from-amber-500/12 via-amber-500/5 to-transparent p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                  <Wallet size={16} />
                  当前点数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatPoint(data?.account.points || 0)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <TrendingDown size={16} />
                  所选时间内消费总点数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatPoint(data?.summary.spentPoints || 0)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <CreditCard size={16} />
                  所选时间内充值总点数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatPoint(data?.summary.rechargedPoints || 0)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <RotateCcw size={16} />
                  所选时间内退款总点数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatPoint(data?.summary.refundedPoints || 0)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Gift size={16} />
                  所选时间内兑换到账总点数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatPoint(data?.summary.redeemedPoints || 0)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <ReceiptText size={16} />
                  记录总条数
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{Number(data?.summary.totalCount || 0)}</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Filter size={16} />
                    账单筛选
                  </div>
                  <p className="mt-1 text-xs leading-6 text-gray-400">
                    支持按日期、类型、模型和线路筛选，并自动刷新统计卡片。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadBillingCenter()}
                  disabled={loading}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  刷新
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
                <input
                  type="date"
                  value={draftFilters.startDate}
                  onChange={(event) =>
                    setDraftFilters((prev) => ({ ...prev, startDate: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
                />
                <input
                  type="date"
                  value={draftFilters.endDate}
                  onChange={(event) =>
                    setDraftFilters((prev) => ({ ...prev, endDate: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
                />
                <select
                  value={draftFilters.type}
                  onChange={(event) =>
                    setDraftFilters((prev) => ({ ...prev, type: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
                >
                  <option value="">全部类型</option>
                  {(data?.filters.availableTypes || []).map((item) => (
                    <option key={item.value} value={item.value}>
                      {typeLabelMap[item.value] || item.label}
                    </option>
                  ))}
                </select>
                <select
                  value={draftFilters.modelId}
                  onChange={(event) =>
                    setDraftFilters((prev) => ({ ...prev, modelId: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
                >
                  <option value="">全部模型</option>
                  {(data?.filters.availableModels || []).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <select
                  value={draftFilters.routeId}
                  onChange={(event) =>
                    setDraftFilters((prev) => ({ ...prev, routeId: event.target.value }))
                  }
                  className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
                >
                  <option value="">全部线路</option>
                  {(data?.filters.availableRoutes || []).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={applyFilters}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-amber-500 px-5 text-sm font-medium text-slate-950 transition-colors hover:bg-amber-400"
                >
                  <Filter size={15} />
                  查询统计
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-medium text-white hover:bg-white/10"
                >
                  <RotateCcw size={15} />
                  重置条件
                </button>
              </div>
            </div>

            <div className="rounded-[28px] border border-sky-500/20 bg-linear-to-br from-sky-500/12 via-sky-500/5 to-transparent p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
                    <Ticket size={16} />
                    兑换码兑换
                  </div>
                  <p className="mt-1 text-xs leading-6 text-sky-100/70">
                    登录后可在这里直接兑换点数，到账后会自动刷新统计卡片与分页账本。
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <input
                  value={redeemCode}
                  onChange={(event) => setRedeemCode(event.target.value)}
                  placeholder="输入兑换码，例如 NBP-ABCD-EFGH-IJKL"
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleRedeem()}
                  disabled={redeeming}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
                >
                  {redeeming ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}
                  立即兑换
                </button>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Coins size={16} />
                    账本明细
                  </div>
                  <p className="mt-1 text-xs leading-6 text-gray-400">
                    当前按分页展示，每页 20 条，方便在大量流水下继续检索和统计。
                  </p>
                </div>
                <div className="text-xs text-gray-400">
                  第 {data?.ledger.page || 1} / {data?.ledger.totalPages || 1} 页，共{' '}
                  {data?.ledger.total || 0} 条
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-gray-300">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      正在加载账本...
                    </div>
                  </div>
                ) : data?.ledger.entries?.length ? (
                  data.ledger.entries.map((entry) => {
                    const positive = positiveTypes.has(entry.type);
                    return (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">
                              {typeLabelMap[entry.type] || entry.type}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {entry.createdAt
                                ? new Date(entry.createdAt).toLocaleString()
                                : '-'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={`text-lg font-semibold ${
                                positive ? 'text-emerald-300' : 'text-amber-300'
                              }`}
                            >
                              {positive ? '+' : '-'}
                              {formatPoint(entry.points)}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">余额 {formatPoint(entry.balanceAfter)}</div>
                          </div>
                        </div>
                        {renderLedgerMeta(entry) && (
                          <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-gray-400">
                            {renderLedgerMeta(entry)}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-gray-400">
                    当前筛选条件下暂无账本记录。
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-gray-500">
                  当前账号：{data?.account.accountId || '-'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={loading || page <= 1}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((prev) =>
                        Math.min(Number(data?.ledger.totalPages || 1), prev + 1),
                      )
                    }
                    disabled={loading || page >= Number(data?.ledger.totalPages || 1)}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10 disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BillingCenterPage;
