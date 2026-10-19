import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ session: vi.fn(), dashboard: vi.fn() }));
vi.mock('../src/services/accountIdentity', async original => ({
  ...await original<typeof import('../src/services/accountIdentity')>(), fetchCurrentAuthSession: mocks.session,
}));
vi.mock('../src/services/adminDashboardService', () => ({ fetchAdminDashboard: mocks.dashboard }));
vi.mock('./AuthPanel', () => ({ default: () => <div>登录表单</div> }));
vi.mock('./AdminOverviewPanel', () => ({ default: () => <div>后台运行总览</div> }));
vi.mock('./AdminOperationsPanel', () => ({ default: () => <div>图片任务运行看板</div> }));
import AdminDashboardPage from './AdminDashboardPage';

describe('admin verification failure', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dashboard.mockResolvedValue({}); });
  it('shows a retryable verification error without granting access or misreporting a logout', async () => {
    mocks.session.mockRejectedValueOnce(new Error('登录状态验证超时，请重试'))
      .mockResolvedValueOnce({ authenticated: true, user: { userId: 'admin-a', isAdmin: true } });
    render(<AdminDashboardPage />);
    await screen.findByText('登录状态验证超时，请重试');
    expect(screen.queryByText('登录表单')).toBeNull();
    expect(mocks.dashboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await screen.findByText('后台运行总览');
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
  it('mounts operations only after an administrator selects the section', async () => {
    mocks.session.mockResolvedValue({ authenticated: true, user: { userId: 'admin-a', isAdmin: true } });
    render(<AdminDashboardPage />);
    await screen.findByText('后台运行总览');
    expect(screen.queryByText('图片任务运行看板')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '运行看板' })[0]);
    expect(screen.getByText('图片任务运行看板')).toBeTruthy();
    expect(screen.queryByText('后台运行总览')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '运行总览' })[0]);
    expect(screen.queryByText('图片任务运行看板')).toBeNull();
  });
  it('never mounts operations for a non-admin session', async () => {
    mocks.session.mockResolvedValue({ authenticated: true, user: { userId: 'user-a', isAdmin: false } });
    render(<AdminDashboardPage />);
    await screen.findByText('当前账号没有后台权限');
    expect(screen.queryByRole('button', { name: '运行看板' })).toBeNull();
    expect(screen.queryByText('图片任务运行看板')).toBeNull();
  });
  it('pauses legacy dashboard polling hidden and outside overview or catalog', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    mocks.session.mockResolvedValue({ authenticated: true, user: { userId: 'admin-a', isAdmin: true } });
    const { unmount } = render(<AdminDashboardPage />);
    const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
    try {
      await flush(); expect(mocks.dashboard).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => { await vi.advanceTimersByTimeAsync(130000); });
      expect(mocks.dashboard).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      fireEvent(document, new Event('visibilitychange')); await flush();
      expect(mocks.dashboard).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getAllByRole('button', { name: '运行看板' })[0]); await flush();
      await act(async () => { await vi.advanceTimersByTimeAsync(130000); });
      expect(mocks.dashboard).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getAllByRole('button', { name: '运行总览' })[0]); await flush();
      expect(mocks.dashboard).toHaveBeenCalledTimes(3);
    } finally { unmount(); vi.useRealTimers(); }
  });
});
