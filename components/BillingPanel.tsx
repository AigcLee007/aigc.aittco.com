import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Coins,
  Copy,
  CreditCard,
  Gift,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Ticket,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  adjustBillingAccount,
  BillingAccountPayload,
  createBillingRedeemCodes,
  fetchBillingAccount,
  fetchBillingRedeemCodes,
  RedeemCodeListPayload,
  redeemBillingCode,
} from '../src/services/accountService';
import { AuthSessionPayload } from '../src/services/accountIdentity';
import { useToast } from '../src/context/ToastContext';
import { formatPoint, roundPoint, roundPositivePoint } from '../src/utils/pointFormat';

interface BillingPanelProps {
  session: AuthSessionPayload | null;
}

const BillingPanel: React.FC<BillingPanelProps> = ({ session }) => {
  const toast = useToast();
  const isAuthenticated = session?.authenticated === true;
  const isSuperAdmin = session?.user?.isSuperAdmin === true;

  const [data, setData] = useState<BillingAccountPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const [adjustAccountId, setAdjustAccountId] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('100');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const [giftPoints, setGiftPoints] = useState('100');
  const [giftQuantity, setGiftQuantity] = useState('1');
  const [giftNote, setGiftNote] = useState('');
  const [creatingCodes, setCreatingCodes] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);

  const [codeFilter, setCodeFilter] = useState<'all' | 'active' | 'redeemed'>('all');
  const [codeData, setCodeData] = useState<RedeemCodeListPayload | null>(null);
  const [codesLoading, setCodesLoading] = useState(false);

  const loadAccount = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await fetchBillingAccount();
      setData(next);
      setAdjustAccountId((prev) => prev || next.account.accountId);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const loadRedeemCodes = useCallback(async () => {
    if (!isAuthenticated || !isSuperAdmin) {
      setCodeData(null);
      setCodesLoading(false);
      return;
    }

    setCodesLoading(true);
    try {
      const next = await fetchBillingRedeemCodes({
        page: 1,
        pageSize: 20,
        status: codeFilter,
      });
      setCodeData(next);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setCodesLoading(false);
    }
  }, [codeFilter, isAuthenticated, isSuperAdmin]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    void loadRedeemCodes();
  }, [loadRedeemCodes]);

  const handleCopy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label}已复制`);
  };

  const handleRedeem = async () => {
    if (!redeemCodeInput.trim()) {
      setError('请输入兑换码');
      return;
    }

    setRedeeming(true);
    setError(null);
    try {
      const next = await redeemBillingCode({
        code: redeemCodeInput.trim(),
      });
      setData(next);
      setRedeemCodeInput('');
      toast.success(`兑换成功，已到账 ${next.redeemedCode?.points || 0} 点`);
      await loadRedeemCodes();
    } catch (redeemError) {
      setError((redeemError as Error).message);
    } finally {
      setRedeeming(false);
    }
  };

  const handleAdjustPoints = async () => {
    const delta = roundPoint(adjustDelta, 0);
    if (!adjustAccountId.trim()) {
      setError('请输入目标账户 ID');
      return;
    }
    if (!Number.isFinite(delta) || delta === 0) {
      setError('调整点数不能为 0');
      return;
    }

    setAdjusting(true);
    setError(null);
    try {
      const next = await adjustBillingAccount({
        accountId: adjustAccountId.trim(),
        delta,
        note: adjustNote.trim(),
      });
      if (data?.account.accountId === next.account.accountId) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                account: next.account,
              }
            : prev,
        );
      }
      setAdjustNote('');
      toast.success(`${delta > 0 ? '加点' : '减点'}成功`);
      await loadAccount();
    } catch (adjustError) {
      setError((adjustError as Error).message);
    } finally {
      setAdjusting(false);
    }
  };

  const handleCreateCodes = async () => {
    const points = roundPositivePoint(giftPoints, 0);
    const quantity = Number.parseInt(giftQuantity, 10);
    if (!Number.isFinite(points) || points <= 0) {
      setError('兑换码点数必须大于 0');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('生成数量必须大于 0');
      return;
    }

    setCreatingCodes(true);
    setError(null);
    try {
      const result = await createBillingRedeemCodes({
        points,
        quantity,
        note: giftNote.trim(),
      });
      setGeneratedCodes(result.codes.map((item) => item.code));
      setGiftNote('');
      toast.success(`已生成 ${result.codes.length} 个兑换码`);
      await loadRedeemCodes();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreatingCodes(false);
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-amber-500/20 bg-linear-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <Wallet size={16} />
            点数账户
          </div>
          <p className="mt-1 text-xs leading-6 text-amber-100/70">
            这里保留账户摘要和兑换入口，完整统计、筛选和分页账本已迁移到账单中心。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAccount()}
          disabled={!isAuthenticated || loading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
          title="刷新点数账户"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {!isAuthenticated ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-gray-300">
          请先登录后再查看点数、兑换码和账单中心。
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-gray-400">
                <Coins size={14} />
                当前点数
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">
                {formatPoint(data?.account.points || 0)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-gray-400">
                <TrendingDown size={14} />
                累计消费
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">
                {formatPoint(data?.account.totalSpent || 0)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-gray-400">
                <TrendingUp size={14} />
                累计入账
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">
                {formatPoint(data?.account.totalRecharged || 0)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
                  <Ticket size={16} />
                  兑换码兑换
                </div>
                <p className="mt-1 text-xs leading-6 text-sky-100/70">
                  成功到账后会立即刷新当前点数；更详细的流水和统计请到账单中心查看。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/billing';
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-400/10 px-4 text-xs font-medium text-sky-100 transition-colors hover:bg-sky-400/20"
              >
                <CreditCard size={14} />
                打开账单中心
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={redeemCodeInput}
                onChange={(event) => setRedeemCodeInput(event.target.value)}
                placeholder="输入兑换码，例如 NBP-ABCD-EFGH-IJKL"
                className="h-10 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleRedeem()}
                disabled={redeeming}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
              >
                {redeeming ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}
                立即兑换
              </button>
            </div>
          </div>
        </>
      )}

      {isSuperAdmin && (
        <>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-100">
              <ShieldCheck size={16} />
              超级管理员调点
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={adjustAccountId}
                onChange={(event) => setAdjustAccountId(event.target.value)}
                placeholder="目标账户 ID"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={adjustDelta}
                onChange={(event) => setAdjustDelta(event.target.value)}
                placeholder="调整点数，例如 100 或 -50"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={adjustNote}
                onChange={(event) => setAdjustNote(event.target.value)}
                placeholder="备注（可选）"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleAdjustPoints()}
              disabled={adjusting}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
            >
              {adjusting ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
              立即调整点数
            </button>
          </div>

          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fuchsia-100">
              <Ticket size={16} />
              兑换码生成
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={giftPoints}
                onChange={(event) => setGiftPoints(event.target.value)}
                placeholder="每个兑换码点数"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={giftQuantity}
                onChange={(event) => setGiftQuantity(event.target.value)}
                placeholder="生成数量"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={giftNote}
                onChange={(event) => setGiftNote(event.target.value)}
                placeholder="备注（可选）"
                className="h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleCreateCodes()}
              disabled={creatingCodes}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-fuchsia-600 px-4 text-sm font-medium text-white transition-colors hover:bg-fuchsia-500 disabled:opacity-60"
            >
              {creatingCodes ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
              生成兑换码
            </button>

            {generatedCodes.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 text-xs font-medium text-fuchsia-100">本次生成的兑换码</div>
                <div className="space-y-2">
                  {generatedCodes.map((code) => (
                    <div
                      key={code}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                    >
                      <code className="truncate text-white">{code}</code>
                      <button
                        type="button"
                        onClick={() => void handleCopy(code, '兑换码')}
                        className="rounded-md p-1.5 text-gray-300 hover:bg-white/10 hover:text-white"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Gift size={16} />
                最近兑换码记录
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={codeFilter}
                  onChange={(event) =>
                    setCodeFilter(event.target.value as 'all' | 'active' | 'redeemed')
                  }
                  className="h-9 rounded-xl border border-white/10 bg-black/25 px-3 text-xs text-white focus:border-white/20 focus:outline-none"
                >
                  <option value="all">全部</option>
                  <option value="active">未兑换</option>
                  <option value="redeemed">已兑换</option>
                </select>
                <button
                  type="button"
                  onClick={() => void loadRedeemCodes()}
                  disabled={codesLoading}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {codesLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  刷新
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {codeData?.codes?.length ? (
                codeData.codes.map((item) => (
                  <div
                    key={item.normalizedCode}
                    className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="truncate text-white">{item.code}</code>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                              item.status === 'redeemed'
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : 'bg-amber-500/15 text-amber-200'
                            }`}
                          >
                            {item.status === 'redeemed' ? '已兑换' : '未兑换'}
                          </span>
                        </div>
                        <div className="mt-1 text-gray-500">
                          {formatPoint(item.points)} 点
                          {item.note ? ` / ${item.note}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(item.code, '兑换码')}
                        className="rounded-md p-1.5 text-gray-300 hover:bg-white/10 hover:text-white"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-gray-400 md:grid-cols-2">
                      <div>创建时间：{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</div>
                      <div>兑换人：{item.redeemedByEmail || '-'}</div>
                      <div>创建者：{item.createdByEmail || '-'}</div>
                      <div>兑换时间：{item.redeemedAt ? new Date(item.redeemedAt).toLocaleString() : '-'}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-6 text-center text-xs text-gray-500">
                  暂无兑换码记录
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default BillingPanel;
