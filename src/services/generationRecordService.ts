import { ensureBillingIdentity, getAuthorizedBillingHeaders } from './accountIdentity';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export type GenerationRecordMediaType = 'IMAGE' | 'VIDEO';
export type GenerationRecordStatus = 'PENDING' | 'SUCCESS' | 'FAILED';
export type GenerationRecordUiMode = 'canvas' | 'classic';

export interface GenerationRecord {
  id: string;
  userId: string;
  accountId: string | null;
  ownerEmail: string | null;
  uiMode: GenerationRecordUiMode;
  mediaType: GenerationRecordMediaType;
  actionName: string | null;
  prompt: string;
  modelId: string | null;
  modelName: string | null;
  routeId: string | null;
  routeLabel: string | null;
  taskId: string | null;
  status: GenerationRecordStatus;
  quantity: number;
  aspectRatio: string | null;
  outputSize: string | null;
  previewUrl: string | null;
  resultUrls: string[];
  errorMessage: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface GenerationRecordListPayload {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  records: GenerationRecord[];
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

export const fetchGenerationRecords = async ({
  mediaType = 'all',
  status = 'all',
  page = 1,
  pageSize = 50,
}: {
  mediaType?: 'all' | 'image' | 'video';
  status?: 'all' | 'pending' | 'success' | 'failed';
  page?: number;
  pageSize?: number;
} = {}): Promise<GenerationRecordListPayload> => {
  await ensureBillingIdentity();

  const params = new URLSearchParams();
  params.set('mediaType', mediaType);
  params.set('status', status);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/generation-records?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<GenerationRecordListPayload>(response);
};

export const clearGenerationRecords = async ({
  mediaType = 'all',
}: {
  mediaType?: 'all' | 'image' | 'video';
} = {}): Promise<{ success: boolean; removed: number }> => {
  await ensureBillingIdentity();

  const params = new URLSearchParams();
  params.set('mediaType', mediaType);

  const response = await fetch(
    `${cleanUrl(API_BASE_URL)}/generation-records?${params.toString()}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
    },
  );

  return parseResponse<{ success: boolean; removed: number }>(response);
};

