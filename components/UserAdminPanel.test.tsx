import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
