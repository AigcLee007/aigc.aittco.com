import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./accountIdentity', () => ({
  getAuthorizedBillingHeaders: vi.fn(async () => ({
    'X-Auth-Session': 'session-token',
  })),
}));

import { resetAdminUserPassword } from './userAdminService';

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
