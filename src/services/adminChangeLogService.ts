import { getAuthorizedBillingHeaders } from './accountIdentity';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }

  return data;
};

export interface AdminChangeLogEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  detail: unknown;
}

export interface AdminChangeLogResponse {
  success: boolean;
  entries: AdminChangeLogEntry[];
}

export const fetchAdminChangeLogs = async (limit = 30): Promise<AdminChangeLogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/change-logs?limit=${encodeURIComponent(String(limit))}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<AdminChangeLogResponse>(response);
};

