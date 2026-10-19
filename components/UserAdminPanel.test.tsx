import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  fetchAdminUserDetail: vi.fn(),
  updateAdminUserProfile: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  adjustBillingAccount: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../src/services/userAdminService', () => ({
  fetchAdminUsers: mocks.fetchAdminUsers,
  fetchAdminUserDetail: mocks.fetchAdminUserDetail,
  updateAdminUserProfile: mocks.updateAdminUserProfile,
  resetAdminUserPassword: mocks.resetAdminUserPassword,
}));
vi.mock('../src/services/accountService', () => ({ adjustBillingAccount: mocks.adjustBillingAccount }));
vi.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() }),
}));

import UserAdminPanel from './UserAdminPanel';

const user = {
  userId: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'user' as const,
  isAdmin: false,
  isSuperAdmin: false,
  status: 'active' as const,
  passwordConfigured: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
};
const detail = {
  success: true,
  user,
  account: null,
  ledger: { entries: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
  pricing: [],
};
const session = {
  success: true,
  authenticated: true,
  user: { ...user, userId: 'admin-1', email: 'admin@example.com', role: 'admin' as const, isAdmin: true },
};

describe('UserAdminPanel password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAdminUsers.mockResolvedValue({
      success: true,
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      onlineTotal: 0,
      onlineWindowMinutes: 5,
      onlineUsers: [],
      users: [user],
    });
    mocks.fetchAdminUserDetail.mockResolvedValue(detail);
    mocks.resetAdminUserPassword.mockResolvedValue(detail);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('validates confirmation and clears fields after a successful reset', async () => {
    render(<UserAdminPanel session={session} />);

    const password = await screen.findByPlaceholderText('输入新密码');
    const confirmation = screen.getByPlaceholderText('再次输入新密码');
    expect(password).toHaveProperty('type', 'password');
    expect(confirmation).toHaveProperty('type', 'password');
    fireEvent.change(password, { target: { value: 'new-password' } });
    fireEvent.change(confirmation, { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeTruthy();
    expect(mocks.resetAdminUserPassword).not.toHaveBeenCalled();

    fireEvent.change(confirmation, { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    await waitFor(() => expect(mocks.resetAdminUserPassword).toHaveBeenCalled());
    expect(mocks.resetAdminUserPassword).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'new-password',
      ledgerPage: 1,
      ledgerPageSize: 20,
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('输入新密码')).toHaveProperty('value', ''),
    );
    expect(screen.getByPlaceholderText('再次输入新密码')).toHaveProperty('value', '');
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('does not expose reset controls to a regular admin for an admin target', async () => {
    mocks.fetchAdminUsers.mockResolvedValueOnce({
      success: true,
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      onlineTotal: 0,
      onlineWindowMinutes: 5,
      onlineUsers: [],
      users: [{ ...user, role: 'admin', isAdmin: true }],
    });
    mocks.fetchAdminUserDetail.mockResolvedValueOnce({
      ...detail,
      user: { ...user, role: 'admin', isAdmin: true },
    });

    render(<UserAdminPanel session={session} />);

    await waitFor(() => expect(mocks.fetchAdminUserDetail).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('输入新密码')).toBeNull();
    expect(screen.queryByRole('button', { name: '重置密码' })).toBeNull();
  });

  it('clears password fields when switching to another user', async () => {
    const secondUser = { ...user, userId: 'user-2', email: 'second@example.com', displayName: 'Second' };
    mocks.fetchAdminUsers.mockResolvedValueOnce({
      success: true,
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      onlineTotal: 0,
      onlineWindowMinutes: 5,
      onlineUsers: [],
      users: [user, secondUser],
    });
    mocks.fetchAdminUserDetail.mockImplementation(async ({ userId }: { userId: string }) => ({
      ...detail,
      user: userId === 'user-2' ? secondUser : user,
    }));

    render(<UserAdminPanel session={session} />);
    const password = await screen.findByPlaceholderText('输入新密码');
    const confirmation = screen.getByPlaceholderText('再次输入新密码');
    fireEvent.change(password, { target: { value: 'secret-for-first-user' } });
    fireEvent.change(confirmation, { target: { value: 'secret-for-first-user' } });

    fireEvent.click(screen.getByRole('button', { name: /Second/ }));

    await waitFor(() => expect(mocks.fetchAdminUserDetail).toHaveBeenCalledWith({
      userId: 'user-2',
      ledgerPage: 1,
      ledgerPageSize: 20,
    }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('输入新密码')).toHaveProperty('value', ''),
    );
    expect(screen.getByPlaceholderText('再次输入新密码')).toHaveProperty('value', '');
  });
});

describe('UserAdminPanel online status refresh', () => {
  const onlineUser = { ...user, isOnline: true, lastSeenAt: '2026-10-19T01:00:00.000Z' };
  const onlineCatalog = {
    success: true, total: 1, page: 1, pageSize: 20, totalPages: 1,
    onlineTotal: 1, onlineWindowMinutes: 5, onlineUsers: [onlineUser], users: [onlineUser],
  };
  const offlineCatalog = {
    ...onlineCatalog, onlineTotal: 0, onlineUsers: [], users: [{ ...user, isOnline: false, lastSeenAt: null }],
  };
  const flush = async () => {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T01:00:00.000Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    mocks.fetchAdminUsers.mockResolvedValue(onlineCatalog);
    mocks.fetchAdminUserDetail.mockResolvedValue(detail);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('refreshes online users without resetting an in-progress password edit', async () => {
    render(<UserAdminPanel session={session} />);
    await flush();
    expect(screen.getAllByText('在线')).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText('输入新密码'), { target: { value: 'draft-password' } });
    mocks.fetchAdminUsers.mockResolvedValue(offlineCatalog);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(screen.queryByText('在线')).toBeNull();
    expect(screen.getByText('当前没有在线用户')).toBeTruthy();
    expect(screen.getByPlaceholderText('输入新密码')).toHaveProperty('value', 'draft-password');
    expect(mocks.fetchAdminUserDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/含后台自动查询/)).toBeTruthy();
    expect(screen.getByText(/最近更新/)).toBeTruthy();
  });

  it('pauses hidden polling and refreshes once on return while a request is pending', async () => {
    render(<UserAdminPanel session={session} />);
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.fetchAdminUsers).toHaveBeenCalledTimes(1);

    let finish!: (value: typeof offlineCatalog) => void;
    mocks.fetchAdminUsers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));
    expect(mocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
    await act(async () => { finish(offlineCatalog); });
    expect(screen.queryByText('在线')).toBeNull();
  });

  it('marks a failed refresh as stale and clears the warning after recovery', async () => {
    render(<UserAdminPanel session={session} />);
    await flush();
    mocks.fetchAdminUsers.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText(/在线状态刷新失败/)).toBeTruthy();
    expect(screen.getAllByText('在线')).toHaveLength(2);

    mocks.fetchAdminUsers.mockResolvedValue(offlineCatalog);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByText(/在线状态刷新失败/)).toBeNull();
    expect(screen.queryByText('在线')).toBeNull();
  });

  it('ignores a delayed background response after a different search is loaded', async () => {
    render(<UserAdminPanel session={session} />);
    await flush();
    let finish!: (value: typeof onlineCatalog) => void;
    mocks.fetchAdminUsers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
    mocks.fetchAdminUsers.mockResolvedValue({ ...offlineCatalog, total: 0, users: [] });
    fireEvent.change(screen.getByPlaceholderText('搜索邮箱、显示名、用户 ID'), { target: { value: 'absent' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await flush();
    await act(async () => { finish(onlineCatalog); });
    expect(screen.queryByText('在线')).toBeNull();
    expect(screen.getByText('共 0 位用户')).toBeTruthy();
  });

  it('removes polling and ignores a pending refresh after unmount', async () => {
    const view = render(<UserAdminPanel session={session} />);
    await flush();
    let finish!: (value: typeof offlineCatalog) => void;
    mocks.fetchAdminUsers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    view.unmount();
    await act(async () => { finish(offlineCatalog); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent(window, new Event('focus'));
    expect(mocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
  });
});
