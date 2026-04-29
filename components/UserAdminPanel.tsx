import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Coins,
  Crown,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AuthSessionPayload } from '../src/services/accountIdentity';
import {
  fetchAdminUserDetail,
  fetchAdminUsers,
  updateAdminUserProfile,
  type AdminUserDetailPayload,
  type AdminUserListPayload,
} from '../src/services/userAdminService';
import { adjustBillingAccount } from '../src/services/accountService';
import { useToast } from '../src/context/ToastContext';
import { formatPoint, roundPoint } from '../src/utils/pointFormat';

interface UserAdminPanelProps {
  session: AuthSessionPayload | null;
}

const typeLabelMap: Record<string, string> = {
  signup: '注册赠送',
  recharge: '管理员充值',
  charge: '生成扣点',
  refund: '失败退款',
  admin_credit: '管理员加点',
  admin_debit: '管理员减点',
  redeem_code: '兑换码入账',
};

const positiveTypes = new Set([
  'signup',
  'recharge',
  'refund',
  'admin_credit',
  'redeem_code',
]);

const UserAdminPanel: React.FC<UserAdminPanelProps> = ({ session }) => {
  const toast = useToast();
  const isAdmin = session?.user?.isAdmin === true;
  const isSuperAdmin = session?.user?.isSuperAdmin === true;

  const [catalog, setCatalog] = useState<AdminUserListPayload | null>(null);
  const [detail, setDetail] = useState<AdminUserDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);

  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<'user' | 'admin' | 'super_admin'>('user');
  const [editStatus, setEditStatus] = useState<'active' | 'disabled'>('active');
  const [editAdminNote, setEditAdminNote] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('100');
  const [adjustNote, setAdjustNote] = useState('');

  const syncEditor = useCallback((payload: AdminUserDetailPayload | null) => {
    setEditDisplayName(payload?.user?.displayName || '');
    setEditRole((payload?.user?.role || 'user') as 'user' | 'admin' | 'super_admin');
    setEditStatus((payload?.user?.status || 'active') as 'active' | 'disabled');
    setEditAdminNote(payload?.user?.adminNote || '');
  }, []);

  const loadDetail = useCallback(
    async (userId: string, nextLedgerPage = 1) => {
      if (!isAdmin) return;

      setDetailLoading(true);
      setError(null);
      try {
        const next = await fetchAdminUserDetail({
          userId,
          ledgerPage: nextLedgerPage,
          ledgerPageSize: 20,
        });
        setSelectedUserId(userId);
        setLedgerPage(nextLedgerPage);
        setDetail(next);
        syncEditor(next);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [isAdmin, syncEditor],
  );

  const loadUsers = useCallback(
    async ({
      nextPage = page,
      nextSearch = searchKeyword,
      preferredUserId,
    }: {
      nextPage?: number;
      nextSearch?: string;
      preferredUserId?: string | null;
    } = {}) => {
      if (!isAdmin) {
        setCatalog(null);
        setDetail(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const next = await fetchAdminUsers({
          search: nextSearch,
          page: nextPage,
          pageSize: 20,
        });
        setCatalog(next);
        setPage(next.page);

        const nextSelectedUserId =
          preferredUserId || selectedUserId || next.users[0]?.userId || null;
        if (nextSelectedUserId) {
          const existingUser =
            next.users.find((item) => item.userId === nextSelectedUserId) || next.users[0];
          if (existingUser?.userId) {
            await loadDetail(existingUser.userId, 1);
          }
        } else {
          setDetail(null);
          setSelectedUserId(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [isAdmin, loadDetail, page, searchKeyword, selectedUserId],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const selectedUserSummary = useMemo(
    () => catalog?.users.find((item) => item.userId === selectedUserId) || null,
    [catalog, selectedUserId],
  );

  const handleSaveProfile = async () => {
    if (!detail || !isSuperAdmin) return;

    setSaving(true);
    setError(null);
    try {
      const next = await updateAdminUserProfile({
        userId: detail.user.userId,
        displayName: editDisplayName.trim(),
        role: editRole,
        status: editStatus,
        adminNote: editAdminNote.trim(),
        ledgerPage,
        ledgerPageSize: 20,
      });

      setDetail(next);
      syncEditor(next);
      setCatalog((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((item) =>
                item.userId === next.user.userId
                  ? { ...item, ...next.user, account: next.account }
                  : item,
              ),
            }
          : prev,
      );
      toast.success('用户资料已更新');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustPoints = async () => {
    if (!detail?.account) return;

    const delta = roundPoint(adjustDelta, 0);
    if (!Number.isFinite(delta) || delta === 0) {
      setError('调整点数不能为 0');
      return;
    }

    setAdjusting(true);
    setError(null);
    try {
      await adjustBillingAccount({
        accountId: detail.account.accountId,
        delta,
        note: adjustNote.trim() || `Manual adjustment for ${detail.user.email}`,
      });
      setAdjustNote('');
      toast.success(`${delta > 0 ? '加点' : '减点'}成功`);
      await loadUsers({
        nextPage: page,
        nextSearch: searchKeyword,
        preferredUserId: detail.user.userId,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdjusting(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-3xl border border-fuchsia-500/20 bg-linear-to-br from-fuchsia-500/10 via-fuchsia-500/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-fuchsia-100">
            <Users size={16} />
            用户管理后台
          </div>
          <p className="mt-1 text-xs leading-5 text-fuchsia-100/70">
            查看用户资料、角色、状态、账户余额和消费流水。超级管理员还可以直接为指定用户加点或减点。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadUsers()}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSearchKeyword(searchInput.trim());
                    void loadUsers({ nextPage: 1, nextSearch: searchInput.trim() });
                  }
                }}
                placeholder="搜索邮箱、显示名、用户 ID"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/20 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchKeyword(searchInput.trim());
                void loadUsers({ nextPage: 1, nextSearch: searchInput.trim() });
              }}
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10"
            >
              搜索
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>共 {catalog?.total || 0} 位用户</span>
            <span>
              第 {catalog?.page || 1} / {catalog?.totalPages || 1} 页
            </span>
          </div>

          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            {catalog?.users?.length ? (
              catalog.users.map((user) => (
                <button
                  key={user.userId}
                  type="button"
                  onClick={() => void loadDetail(user.userId, 1)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                    selectedUserId === user.userId
                      ? 'border-fuchsia-400/40 bg-fuchsia-500/10'
                      : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-100">
                          {user.displayName || user.email}
                        </span>
                        {user.isSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] text-yellow-200">
                            <Crown size={10} />
                            超级管理员
                          </span>
                        ) : user.isAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                            <ShieldCheck size={10} />
                            管理员
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-gray-400">{user.email}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                        <span>{user.status === 'active' ? '已启用' : '已停用'}</span>
                        <span>余额 {formatPoint(user.account?.points ?? 0)}</span>
                        <span>消费 {formatPoint(user.account?.totalSpent ?? 0)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-8 text-center text-xs text-gray-500">
                暂无匹配用户
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 text-[11px] text-gray-400">
            <button
              type="button"
              onClick={() =>
                void loadUsers({
                  nextPage: Math.max(1, page - 1),
                  nextSearch: searchKeyword,
                })
              }
              disabled={page <= 1 || loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() =>
                void loadUsers({
                  nextPage: Math.min(catalog?.totalPages || 1, page + 1),
                  nextSearch: searchKeyword,
                })
              }
              disabled={page >= (catalog?.totalPages || 1) || loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
          {detailLoading ? (
            <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-gray-300">
              <Loader2 size={16} className="animate-spin" />
              正在加载用户详情...
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">当前用户</div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {detail.user.displayName || detail.user.email}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">{detail.user.email}</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">账户余额</div>
                  <div className="mt-2 flex items-center gap-2 text-xl font-bold text-white">
                    <Coins size={16} className="text-yellow-400" />
                    {formatPoint(detail.account?.points ?? 0)}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">
                    累计消费 {formatPoint(detail.account?.totalSpent ?? 0)}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">最近登录</div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {detail.user.lastLoginAt
                      ? new Date(detail.user.lastLoginAt).toLocaleString()
                      : '尚未登录'}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">
                    用户 ID: {detail.user.userId}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs font-medium text-gray-300">用户资料</div>

                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">
                      显示名称
                    </label>
                    <input
                      value={editDisplayName}
                      onChange={(event) => setEditDisplayName(event.target.value)}
                      disabled={!isSuperAdmin}
                      className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">
                        角色
                      </label>
                      <select
                        value={editRole}
                        onChange={(event) =>
                          setEditRole(event.target.value as 'user' | 'admin' | 'super_admin')
                        }
                        disabled={!isSuperAdmin}
                        className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none disabled:opacity-60"
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                        <option value="super_admin">超级管理员</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">
                        账户状态
                      </label>
                      <select
                        value={editStatus}
                        onChange={(event) =>
                          setEditStatus(event.target.value as 'active' | 'disabled')
                        }
                        disabled={!isSuperAdmin}
                        className="h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:border-white/20 focus:outline-none disabled:opacity-60"
                      >
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </div>
                  </div>

                  {isSuperAdmin && (
                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">
                        管理备注
                      </label>
                      <textarea
                        value={editAdminNote}
                        onChange={(event) => setEditAdminNote(event.target.value)}
                        maxLength={2000}
                        placeholder="仅超级管理员可见，可记录来源、风险、沟通记录等"
                        className="min-h-24 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="space-y-1 text-[11px] text-gray-400">
                    <div>
                      注册时间：
                      {detail.user.createdAt ? new Date(detail.user.createdAt).toLocaleString() : '-'}
                    </div>
                    <div>密码已设置：{detail.user.passwordConfigured ? '是' : '否'}</div>
                    <div>账户 ID：{detail.account?.accountId || '尚未创建'}</div>
                  </div>

                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => void handleSaveProfile()}
                      disabled={saving}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-fuchsia-600 px-4 text-sm font-medium text-white transition-colors hover:bg-fuchsia-500 disabled:opacity-60"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                      保存用户资料
                    </button>
                  )}

                  {detail.account && isSuperAdmin && (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div className="mb-3 text-xs font-medium text-emerald-100">手动调整点数</div>
                      <p className="mb-3 text-[11px] leading-5 text-emerald-100/70">
                        正数代表加点，负数代表减点。
                      </p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input
                          value={adjustDelta}
                          onChange={(event) => setAdjustDelta(event.target.value)}
                          placeholder="例如 100 或 -50"
                          className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                        />
                        <input
                          value={adjustNote}
                          onChange={(event) => setAdjustNote(event.target.value)}
                          placeholder="备注（可选）"
                          className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAdjustPoints()}
                        disabled={adjusting}
                        className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {adjusting ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
                        立即调整
                      </button>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-gray-300">消费流水</div>
                    <div className="text-[11px] text-gray-500">共 {detail.ledger.total} 条</div>
                  </div>

                  <div className="space-y-2">
                    {detail.ledger.entries.length ? (
                      detail.ledger.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-gray-100">
                              {typeLabelMap[entry.type] || entry.type}
                            </div>
                            <div
                              className={
                                positiveTypes.has(entry.type) ? 'text-emerald-300' : 'text-amber-300'
                              }
                            >
                              {positiveTypes.has(entry.type) ? '+' : '-'}
                              {formatPoint(entry.points)}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
                            <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '-'}</span>
                            <span>余额 {formatPoint(entry.balanceAfter)}</span>
                          </div>
                          {entry.meta && (
                            <div className="mt-2 break-all text-[11px] text-gray-400">
                              {[
                                String(entry.meta.routeId || ''),
                                String(entry.meta.action || entry.meta.actionName || ''),
                                String(entry.meta.note || ''),
                                String(entry.meta.code || ''),
                                String(entry.meta.taskId || ''),
                              ]
                                .filter(Boolean)
                                .join(' / ')}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-8 text-center text-xs text-gray-500">
                        这个用户还没有消费流水
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 text-[11px] text-gray-400">
                    <button
                      type="button"
                      onClick={() => void loadDetail(detail.user.userId, Math.max(1, ledgerPage - 1))}
                      disabled={ledgerPage <= 1 || detailLoading}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <span>
                      第 {detail.ledger.page} / {detail.ledger.totalPages} 页
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void loadDetail(
                          detail.user.userId,
                          Math.min(detail.ledger.totalPages, ledgerPage + 1),
                        )
                      }
                      disabled={ledgerPage >= detail.ledger.totalPages || detailLoading}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-400">
              {selectedUserSummary ? '请选择用户查看详情' : '左侧选择一个用户开始管理'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserAdminPanel;
