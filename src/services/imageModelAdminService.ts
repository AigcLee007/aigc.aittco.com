import { getAuthorizedBillingHeaders } from './accountIdentity';
import {
  refreshImageModelCatalog,
  type ImageModelCatalogShape,
  type ImageModelConfig,
  type ImageModelIconKind,
  type ImageModelPanelLayout,
  type ImageModelSizeBehavior,
} from '../config/imageModels';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AdminImageModel extends ImageModelConfig {
  isActive: boolean;
  isDefaultModel: boolean;
  sortOrder: number;
}

export interface AdminImageModelCatalogResponse extends ImageModelCatalogShape {
  success: boolean;
  models: AdminImageModel[];
}

export interface AdminImageModelPayload {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  routeFamily: string;
  requestModel?: string;
  selectorCost?: number;
  iconKind?: ImageModelIconKind;
  panelLayout?: ImageModelPanelLayout;
  sizeBehavior?: ImageModelSizeBehavior;
  defaultSize?: string;
  sizeOptions?: string[];
  extraAspectRatios?: string[];
  showSizeSelector?: boolean;
  supportsCustomRatio?: boolean;
  isActive?: boolean;
  isDefaultModel?: boolean;
  sortOrder?: number;
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

export const fetchAdminImageModels = async (): Promise<AdminImageModelCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/image-models`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
  });

  return parseResponse<AdminImageModelCatalogResponse>(response);
};

export const createAdminImageModel = async (
  payload: AdminImageModelPayload,
): Promise<AdminImageModelCatalogResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/image-models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify(payload),
  });

  const data = await parseResponse<AdminImageModelCatalogResponse>(response);
  await refreshImageModelCatalog().catch(() => undefined);
  return data;
};

export const updateAdminImageModel = async (
  modelId: string,
  payload: Partial<AdminImageModelPayload>,
): Promise<AdminImageModelCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/image-models/${encodeURIComponent(modelId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await parseResponse<AdminImageModelCatalogResponse>(response);
  await refreshImageModelCatalog().catch(() => undefined);
  return data;
};

export const deleteAdminImageModel = async (
  modelId: string,
): Promise<AdminImageModelCatalogResponse> => {
  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/admin/image-models/${encodeURIComponent(modelId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  const data = await parseResponse<AdminImageModelCatalogResponse>(response);
  await refreshImageModelCatalog().catch(() => undefined);
  return data;
};

