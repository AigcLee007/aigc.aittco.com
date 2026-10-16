import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ session: vi.fn(), dashboard: vi.fn() }));
vi.mock('../src/services/accountIdentity', async original => ({
  ...await original<typeof import('../src/services/accountIdentity')>(), fetchCurrentAuthSession: mocks.session,
}));
vi.mock('../src/services/adminDashboardService', () => ({ fetchAdminDashboard: mocks.dashboard }));
vi.mock('./AuthPanel', () => ({ default: () => <div>登录表单</div> }));
vi.mock('./AdminOverviewPanel', () => ({ default: () => <div>后台运行总览</div> }));
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
});
