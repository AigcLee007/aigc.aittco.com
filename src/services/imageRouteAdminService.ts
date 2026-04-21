import {
  getAuthorizedBillingHeaders,
} from './accountIdentity';
import {
  refreshImageRouteCatalog,
  type ImageRouteCatalogShape,
  type ImageRouteConfig,
  type ImageRouteSizeOverrideMap,
} from '../config/imageRoutes';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AdminImageRoute extends ImageRouteConfig {
  isActive: boolean;
  isDefaultRoute: boolean;
  isDefaultNanoBananaLine: boolean;
  sortOrder: number;
  hasApiKey: boolean;
}

export interface AdminImageRouteCatalogResponse extends ImageRouteCatalogShape {
  success: boolean;
  routes: AdminImageRoute[];
}

export interface AdminImageRoutePayload {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  line: string;
  transport: 'openai-image' | 'gemini-native';
  mode: 'async' | 'sync';
  baseUrl: string;
  generatePath: string;
  taskPath?: string;
  editPath?: string;
  chatPath?: string;
  upstreamModel?: string;
  useRequestModel?: boolean;
  allowUserApiKeyWithoutLogin?: boolean;
  apiKeyEnv?: string;
  apiKey?: string;
  pointCost?: number;
  sizeOverrides?: ImageRouteSizeOverrideMap;
  sortOrder?: number;
  isActive?: boolean;
  isDefaultRoute?: boolean;
  isDefaultNanoBananaLine?: boolean;
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

export const fetchAdminImageRoutes = async (): Promise<AdminImageRouteCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/image-routes`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
  });

  return parseResponse<AdminImageRouteCatalogResponse>(response);
};

export const createAdminImageRoute = async (
  payload: AdminImageRoutePayload,
): Promise<AdminImageRouteCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/image-routes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify(payload),
  });

  const data = await parseResponse<AdminImageRouteCatalogResponse>(response);
  await refreshImageRouteCatalog().catch(() => undefined);
  return data;
};

export const updateAdminImageRoute = async (
  routeId: string,
  payload: Partial<AdminImageRoutePayload>,
): Promise<AdminImageRouteCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/image-routes/${encodeURIComponent(routeId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await parseResponse<AdminImageRouteCatalogResponse>(response);
  await refreshImageRouteCatalog().catch(() => undefined);
  return data;
};

export const deleteAdminImageRoute = async (
  routeId: string,
): Promise<AdminImageRouteCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/image-routes/${encodeURIComponent(routeId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  const data = await parseResponse<AdminImageRouteCatalogResponse>(response);
  await refreshImageRouteCatalog().catch(() => undefined);
  return data;
};

