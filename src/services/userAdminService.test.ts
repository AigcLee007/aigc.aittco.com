import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./accountIdentity', () => ({
  getAuthorizedBillingHeaders: vi.fn(async () => ({
    'X-Auth-Session': 'session-token',
  })),
}));

import { fetchAdminUsers, resetAdminUserPassword } from './userAdminService';

describe('resetAdminUserPassword', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts only the new password and returns the refreshed user detail', async () => {
    const payload = {
      success: true,
      user: { userId: 'user-1', email: 'user@example.com' },
      account: null,
      ledger: { entries: [], total: 0, page: 3, pageSize: 10, totalPages: 1 },
      pricing: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => payload,
      })),
    );

    await expect(
      resetAdminUserPassword({
        userId: 'user/1',
        password: 'new-password',
        ledgerPage: 3,
        ledgerPageSize: 10,
      }),
    ).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3355/api/admin/users/user%2F1/password?ledgerPage=3&ledgerPageSize=10',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: 'new-password' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Auth-Session': 'session-token',
        }),
      }),
    );
  });
});

 afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('admin user list requests', () => {
  it('times out a stalled response body so online polling can retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal('fetch', fetchMock);
    const outcome = fetchAdminUsers().then(
      () => ({ failed: false, message: '' }),
      error => ({ failed: true, message: error.message }),
    );
    await vi.advanceTimersByTimeAsync(12_000);
    const pending = Symbol('pending');
    const result = await Promise.race([outcome, Promise.resolve(pending)]);
    expect(result).not.toBe(pending);
    expect(result).toEqual({ failed: true, message: '用户列表读取超时，请重试' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('keeps authentication, search and pagination when refreshing the list', async () => {
    const payload = { success: true, users: [], onlineUsers: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAdminUsers({ search: 'user@example.com', page: 2, pageSize: 20 })).toEqual(payload);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get('search')).toBe('user@example.com');
    expect(new URL(url).searchParams.get('page')).toBe('2');
    expect(options.headers['X-Auth-Session']).toBe('session-token');
  });
});
