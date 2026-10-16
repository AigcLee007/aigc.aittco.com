import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthSessionPayload } from '../src/services/accountIdentity';

const mocks = vi.hoisted(() => ({ session: vi.fn(), registration: vi.fn() }));
vi.mock('../src/services/accountIdentity', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/accountIdentity')>(),
  fetchCurrentAuthSession: mocks.session,
  fetchRegistrationStatus: mocks.registration,
}));
vi.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
import AuthPanel from './AuthPanel';

const session: AuthSessionPayload = {
  success: true, authenticated: true,
  user: {
    userId: 'admin-a', email: 'admin@example.com', displayName: 'Admin',
    role: 'super_admin', isAdmin: true, isSuperAdmin: true, status: 'active',
    passwordConfigured: true, createdAt: '', updatedAt: '', lastLoginAt: null,
  },
};

describe('AuthPanel verification recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registration.mockResolvedValue(null);
  });

  it('publishes the verified account without waiting for registration status', async () => {
    mocks.session.mockResolvedValue(session);
    mocks.registration.mockReturnValue(new Promise(() => {}));
    const onSessionChange = vi.fn();
    render(<AuthPanel session={null} onSessionChange={onSessionChange} />);
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(session));
    expect(screen.queryByLabelText('正在验证登录状态')).toBeNull();
  });

  it('shows verification failure without clearing the known account and allows retry', async () => {
    mocks.session.mockRejectedValueOnce(new Error('登录状态验证超时，请重试')).mockResolvedValueOnce(session);
    const onSessionChange = vi.fn();
    render(<AuthPanel session={session} onSessionChange={onSessionChange} />);
    await screen.findByText('登录状态验证超时，请重试');
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(screen.getByText('admin@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新登录状态' }));
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(session));
    expect(screen.queryByText('登录状态验证超时，请重试')).toBeNull();
  });
});
