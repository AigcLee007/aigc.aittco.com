import {
  AuthSessionPayload,
  AuthUserProfile,
  getAuthorizedBillingHeaders,
} from './accountIdentity';
import {
  BillingAccountProfile,
  BillingLedgerPayload,
  BillingRoutePricing,
} from './accountService';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AdminManagedUser extends AuthUserProfile {
  account: BillingAccountProfile | null;
}

export interface AdminUserListPayload {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  users: AdminManagedUser[];
}

export interface AdminUserDetailPayload {
  success: boolean;
  user: AuthUserProfile;
  account: BillingAccountProfile | null;
  ledger: BillingLedgerPayload;
  pricing: BillingRoutePricing[];
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }

  return data;
};

export const fetchAdminUsers = async ({
  search = '',
  page = 1,
  pageSize = 20,
}: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<AdminUserListPayload> => {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/users?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
  });

  return parseResponse<AdminUserListPayload>(response);
};

export const fetchAdminUserDetail = async ({
  userId,
  ledgerPage = 1,
  ledgerPageSize = 20,
}: {
  userId: string;
  ledgerPage?: number;
  ledgerPageSize?: number;
}): Promise<AdminUserDetailPayload> => {
  const params = new URLSearchParams();
  params.set('ledgerPage', String(ledgerPage));
  params.set('ledgerPageSize', String(ledgerPageSize));

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/users/${encodeURIComponent(userId)}?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<AdminUserDetailPayload>(response);
};

export const updateAdminUserProfile = async ({
  userId,
  displayName,
  role,
  status,
  ledgerPage = 1,
  ledgerPageSize = 20,
}: {
  userId: string;
  displayName?: string;
  role?: AuthUserProfile['role'];
  status?: AuthUserProfile['status'];
  ledgerPage?: number;
  ledgerPageSize?: number;
}): Promise<AdminUserDetailPayload> => {
  const params = new URLSearchParams();
  params.set('ledgerPage', String(ledgerPage));
  params.set('ledgerPageSize', String(ledgerPageSize));

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/users/${encodeURIComponent(userId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
      body: JSON.stringify({
        displayName,
        role,
        status,
      }),
    },
  );

  return parseResponse<AdminUserDetailPayload>(response);
};

