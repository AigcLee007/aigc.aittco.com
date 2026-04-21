import { getAuthorizedBillingHeaders } from './accountIdentity';
import {
  refreshVideoRouteCatalog,
  type VideoRouteCatalogShape,
  type VideoRouteConfig,
} from '../config/videoRoutes';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AdminVideoRoute extends VideoRouteConfig {
  isActive: boolean;
  isDefaultRoute: boolean;
  sortOrder: number;
  hasApiKey: boolean;
}

export interface AdminVideoRouteCatalogResponse extends VideoRouteCatalogShape {
  success: boolean;
  routes: AdminVideoRoute[];
}

export interface AdminVideoRoutePayload {
  id: string;
  label: string;
  description?: string;
  routeFamily: string;
  line: string;
  transport: 'openai-video';
  mode: 'async';
  baseUrl: string;
  generatePath: string;
  taskPath?: string;
  upstreamModel?: string;
  useRequestModel?: boolean;
  allowUserApiKeyWithoutLogin?: boolean;
  apiKeyEnv?: string;
  apiKey?: string;
  pointCost?: number;
  sortOrder?: number;
  isActive?: boolean;
  isDefaultRoute?: boolean;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }
  return data;
};

export const fetchAdminVideoRoutes = async (): Promise<AdminVideoRouteCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/video-routes`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
  });
  return parseResponse<AdminVideoRouteCatalogResponse>(response);
};

export const createAdminVideoRoute = async (
  payload: AdminVideoRoutePayload,
): Promise<AdminVideoRouteCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/video-routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse<AdminVideoRouteCatalogResponse>(response);
  await refreshVideoRouteCatalog().catch(() => undefined);
  return data;
};

export const updateAdminVideoRoute = async (
  routeId: string,
  payload: Partial<AdminVideoRoutePayload>,
): Promise<AdminVideoRouteCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/video-routes/${encodeURIComponent(routeId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
      body: JSON.stringify(payload),
    },
  );
  const data = await parseResponse<AdminVideoRouteCatalogResponse>(response);
  await refreshVideoRouteCatalog().catch(() => undefined);
  return data;
};

export const deleteAdminVideoRoute = async (
  routeId: string,
): Promise<AdminVideoRouteCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/video-routes/${encodeURIComponent(routeId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
    },
  );
  const data = await parseResponse<AdminVideoRouteCatalogResponse>(response);
  await refreshVideoRouteCatalog().catch(() => undefined);
  return data;
};

