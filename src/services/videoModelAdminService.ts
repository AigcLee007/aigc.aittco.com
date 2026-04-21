import { getAuthorizedBillingHeaders } from './accountIdentity';
import {
  refreshVideoModelCatalog,
  type VideoModelCatalogShape,
  type VideoModelConfig,
} from '../config/videoModels';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AdminVideoModel extends VideoModelConfig {
  isActive: boolean;
  isDefaultModel: boolean;
  sortOrder: number;
}

export interface AdminVideoModelCatalogResponse extends VideoModelCatalogShape {
  success: boolean;
  models: AdminVideoModel[];
}

export interface AdminVideoModelPayload {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  routeFamily: string;
  requestModel?: string;
  selectorCost?: number;
  maxReferenceImages?: number;
  referenceLabels?: string[];
  defaultAspectRatio?: string;
  aspectRatioOptions?: string[];
  defaultDuration?: string;
  durationOptions?: string[];
  supportsHd?: boolean;
  defaultHd?: boolean;
  isActive?: boolean;
  isDefaultModel?: boolean;
  sortOrder?: number;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }
  return data;
};

export const fetchAdminVideoModels = async (): Promise<AdminVideoModelCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/video-models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
  });
  return parseResponse<AdminVideoModelCatalogResponse>(response);
};

export const createAdminVideoModel = async (
  payload: AdminVideoModelPayload,
): Promise<AdminVideoModelCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/video-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await parseResponse<AdminVideoModelCatalogResponse>(response);
  await refreshVideoModelCatalog().catch(() => undefined);
  return data;
};

export const updateAdminVideoModel = async (
  modelId: string,
  payload: Partial<AdminVideoModelPayload>,
): Promise<AdminVideoModelCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/video-models/${encodeURIComponent(modelId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
      body: JSON.stringify(payload),
    },
  );
  const data = await parseResponse<AdminVideoModelCatalogResponse>(response);
  await refreshVideoModelCatalog().catch(() => undefined);
  return data;
};

export const deleteAdminVideoModel = async (
  modelId: string,
): Promise<AdminVideoModelCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/video-models/${encodeURIComponent(modelId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(await getAuthorizedBillingHeaders()) },
    },
  );
  const data = await parseResponse<AdminVideoModelCatalogResponse>(response);
  await refreshVideoModelCatalog().catch(() => undefined);
  return data;
};

