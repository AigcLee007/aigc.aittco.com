import {
  AuthUserProfile,
  ensureBillingIdentity,
  getAuthorizedBillingHeaders,
} from './accountIdentity';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface BillingRoutePricing {
  routeId: string;
  label: string;
  line: string;
  modelFamily: string;
  mode: string;
  transport: string;
  pointCost: number;
}

export interface BillingAccountProfile {
  accountId: string;
  ownerUserId?: string;
  ownerEmail?: string;
  points: number;
  totalRecharged: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface BillingLedgerEntry {
  id: string;
  type: string;
  accountId: string;
  points: number;
  balanceAfter: number;
  createdAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  meta: Record<string, unknown> | null;
}

export interface BillingLedgerPayload {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  entries: BillingLedgerEntry[];
}

export interface BillingSummaryPayload {
  spentPoints: number;
  rechargedPoints: number;
  refundedPoints: number;
  redeemedPoints: number;
  totalCount: number;
}

export interface BillingFilterOption {
  value: string;
  label: string;
}

export interface BillingCenterFiltersPayload {
  applied: {
    startDate: string | null;
    endDate: string | null;
    type: string | null;
    modelId: string | null;
    routeId: string | null;
  };
  availableTypes: BillingFilterOption[];
  availableModels: BillingFilterOption[];
  availableRoutes: BillingFilterOption[];
}

export interface RedeemCodeRecord {
  code: string;
  normalizedCode: string;
  points: number;
  note: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  createdAt: string | null;
  redeemedByUserId: string | null;
  redeemedByEmail: string | null;
  redeemedAccountId: string | null;
  redeemedAt: string | null;
  status: 'active' | 'redeemed';
}

export interface BillingAccountPayload {
  success: boolean;
  user?: AuthUserProfile;
  account: BillingAccountProfile;
  ledger?: BillingLedgerPayload;
  pricing: BillingRoutePricing[];
  redeemedCode?: RedeemCodeRecord;
}

export interface BillingCenterPayload {
  success: boolean;
  user?: AuthUserProfile;
  account: BillingAccountProfile;
  summary: BillingSummaryPayload;
  ledger: BillingLedgerPayload;
  filters: BillingCenterFiltersPayload;
}

export interface RedeemCodeListPayload {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  codes: RedeemCodeRecord[];
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

export const fetchBillingAccount = async ({
  ledgerPage = 1,
  ledgerPageSize = 20,
}: {
  ledgerPage?: number;
  ledgerPageSize?: number;
} = {}): Promise<BillingAccountPayload> => {
  await ensureBillingIdentity();

  const params = new URLSearchParams();
  params.set('ledgerPage', String(ledgerPage));
  params.set('ledgerPageSize', String(ledgerPageSize));

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/account/me?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
  });

  return parseResponse<BillingAccountPayload>(response);
};

export const fetchBillingCenter = async ({
  page = 1,
  pageSize = 20,
  startDate = '',
  endDate = '',
  type = '',
  modelId = '',
  routeId = '',
}: {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
  modelId?: string;
  routeId?: string;
} = {}): Promise<BillingCenterPayload> => {
  await ensureBillingIdentity();

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (type) params.set('type', type);
  if (modelId) params.set('modelId', modelId);
  if (routeId) params.set('routeId', routeId);

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/account/billing-center?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<BillingCenterPayload>(response);
};

export const rechargeBillingAccount = async ({
  accountId,
  points,
  note,
}: {
  accountId: string;
  points: number;
  note?: string;
}): Promise<BillingAccountPayload> => {
  await ensureBillingIdentity();

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/account/recharge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify({
      accountId,
      points,
      note,
    }),
  });

  return parseResponse<BillingAccountPayload>(response);
};

export const adjustBillingAccount = async ({
  accountId,
  delta,
  note,
}: {
  accountId: string;
  delta: number;
  note?: string;
}): Promise<BillingAccountPayload> => {
  await ensureBillingIdentity();

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/account/adjust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify({
      accountId,
      delta,
      note,
    }),
  });

  return parseResponse<BillingAccountPayload>(response);
};

export const redeemBillingCode = async ({
  code,
  ledgerPage = 1,
  ledgerPageSize = 20,
}: {
  code: string;
  ledgerPage?: number;
  ledgerPageSize?: number;
}): Promise<BillingAccountPayload> => {
  await ensureBillingIdentity();

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/account/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify({
      code,
      ledgerPage,
      ledgerPageSize,
    }),
  });

  return parseResponse<BillingAccountPayload>(response);
};

export const createBillingRedeemCodes = async ({
  points,
  quantity = 1,
  note,
}: {
  points: number;
  quantity?: number;
  note?: string;
}): Promise<{ success: boolean; codes: RedeemCodeRecord[] }> => {
  await ensureBillingIdentity();

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/redeem-codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify({
      points,
      quantity,
      note,
    }),
  });

  return parseResponse<{ success: boolean; codes: RedeemCodeRecord[] }>(response);
};

export const fetchBillingRedeemCodes = async ({
  page = 1,
  pageSize = 20,
  status = 'all',
}: {
  page?: number;
  pageSize?: number;
  status?: 'all' | 'active' | 'redeemed';
} = {}): Promise<RedeemCodeListPayload> => {
  await ensureBillingIdentity();

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  params.set('status', status);

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/redeem-codes?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<RedeemCodeListPayload>(response);
};

