import {
  buildBillingIdentityHeaders,
  getAuthorizedBillingHeaders,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';
import {
  allowsDirectUserApiKeyImageRoute,
  getImageRouteById,
} from '../src/config/imageRoutes';
import {
  DEFAULT_GENERATION_ERROR_MESSAGE,
  toGenerationErrorMessage,
} from '../src/utils/errorDebug';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const USER_FACING_GENERATION_ERROR_MESSAGE = DEFAULT_GENERATION_ERROR_MESSAGE;

const cleanUrl = (url: string) => url.replace(/\/$/, '');
const sanitizeHeader = (value: string) => value.replace(/[^\x00-\x7F]/g, '').trim();

const buildAuthHeaders = (apiKey?: string | null): Record<string, string> => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return {};

  const authorization = sanitizeHeader(
    trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}`,
  );
  return authorization ? { Authorization: authorization } : {};
};

const buildOptionalSessionHeaders = (): Record<string, string> => {
  const sessionToken = getStoredAuthSessionToken();
  return sessionToken ? buildBillingIdentityHeaders(sessionToken) : {};
};

const shouldBypassBillingWithUserApiKey = (apiKey: string | undefined, payload: any) => {
  const trimmedApiKey = String(apiKey || '').trim();
  if (!trimmedApiKey) return false;

  const routeId = String(payload?.routeId || '').trim();
  if (!routeId) return false;

  return allowsDirectUserApiKeyImageRoute(getImageRouteById(routeId));
};

const buildImageRequestHeaders = async (
  apiKey: string | undefined,
  payload: any,
): Promise<Record<string, string>> => {
  const billingHeaders = shouldBypassBillingWithUserApiKey(apiKey, payload)
    ? buildOptionalSessionHeaders()
    : await getAuthorizedBillingHeaders();

  return {
    ...billingHeaders,
    ...buildAuthHeaders(apiKey),
    'Content-Type': 'application/json',
  };
};

const handleApiError = async (response: Response, fallbackMessage: string) => {
  const rawText = await response.text();
  let errJson: any = null;
  try {
    errJson = JSON.parse(rawText);
  } catch (_) {
    errJson = null;
  }

  console.error('[Generation API] request failed', {
    status: response.status,
    fallbackMessage,
    rawText: rawText?.slice?.(0, 1000) || rawText,
    error: errJson?.error || null,
    code: errJson?.code || null,
  });

  const detail = [
    `status=${response.status}`,
    errJson?.code ? `code=${errJson.code}` : '',
    errJson?.error ? `error=${errJson.error}` : '',
    rawText ? `raw=${String(rawText).slice(0, 300)}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  throw new Error(toGenerationErrorMessage(detail, USER_FACING_GENERATION_ERROR_MESSAGE));
};

const throwPollingError = async (response: Response) => {
  const rawText = await response.text().catch(() => '');
  let errJson: any = null;
  try {
    errJson = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    errJson = null;
  }

  const detail = [
    `status=${response.status}`,
    errJson?.code ? `code=${errJson.code}` : '',
    errJson?.error ? `error=${errJson.error}` : '',
    rawText ? `raw=${String(rawText).slice(0, 300)}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  throw new Error(toGenerationErrorMessage(detail, USER_FACING_GENERATION_ERROR_MESSAGE));
};

export const getModelBySize = (size: string): string => {
  switch (size.toLowerCase()) {
    case '4k':
      return 'nano-banana-2-4k';
    case '2k':
      return 'nano-banana-2-2k';
    case '1k':
    default:
      return 'nano-banana-2';
  }
};

export interface TaskStatusResponse {
  id: string;
  status: string;
  state?: string;
  output?: any;
  data?: any;
  [key: string]: any;
}

export function findAllUrlsInObject(obj: any, results: string[] = []) {
  if (!obj) return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => findAllUrlsInObject(item, results));
    return;
  }

  if (typeof obj !== 'object') return;

  if (
    obj.output &&
    typeof obj.output === 'string' &&
    (obj.output.startsWith('http') || obj.output.startsWith('data:'))
  ) {
    results.push(obj.output);
  } else if (
    obj.url &&
    typeof obj.url === 'string' &&
    (obj.url.startsWith('http') || obj.url.startsWith('data:'))
  ) {
    results.push(obj.url);
  } else if (
    obj.image_url &&
    typeof obj.image_url === 'string' &&
    (obj.image_url.startsWith('http') || obj.image_url.startsWith('data:'))
  ) {
    results.push(obj.image_url);
  }

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (typeof value === 'object') {
      findAllUrlsInObject(value, results);
    }
  });
}

export const generateImageApi = async (
  apiKey: string | undefined,
  payload: any,
): Promise<{ taskId: string; url?: string; data?: any[]; images?: string[] }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/generate`, {
    method: 'POST',
    headers: await buildImageRequestHeaders(apiKey, payload),
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, 'Image generation submit failed');
  }

  const resJson = await response.json();

  if (resJson.url || resJson.image_url) {
    return { taskId: '', url: resJson.url || resJson.image_url };
  }

  if (Array.isArray(resJson.images) && resJson.images.length > 0) {
    return { taskId: '', images: resJson.images, ...resJson };
  }

  const taskId = resJson.id || resJson.task_id || resJson.data?.task_id;
  if (!taskId && !resJson.url) {
    throw new Error(USER_FACING_GENERATION_ERROR_MESSAGE);
  }

  return { taskId: taskId || '', ...resJson };
};

export const editImageApi = async (
  apiKey: string | undefined,
  payload: any,
): Promise<{ taskId: string }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/edit`, {
    method: 'POST',
    headers: await buildImageRequestHeaders(apiKey, payload),
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, 'Image edit submit failed');
  }

  const resJson = await response.json();
  const taskId = resJson.id || resJson.task_id || resJson.data?.task_id;
  if (!taskId) {
    throw new Error(USER_FACING_GENERATION_ERROR_MESSAGE);
  }

  return { taskId };
};

export const getTaskStatusApi = async (
  apiKey: string | undefined,
  taskId: string,
): Promise<TaskStatusResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/task/${taskId}`, {
    method: 'GET',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    await throwPollingError(response);
  }

  return response.json();
};

export const checkTaskStatus = getTaskStatusApi;

export const checkVideoTaskStatus = async (
  apiKey: string | undefined,
  taskId: string,
): Promise<TaskStatusResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/video/task/${taskId}`, {
    method: 'GET',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    await throwPollingError(response);
  }

  return response.json();
};

export interface GeminiGeneratePayload {
  prompt: string;
  images?: string[];
  aspect_ratio?: string;
  image_size?: string;
  thinking_level?: string;
  output_format?: string;
}

export interface GeminiGenerateResponse {
  success: boolean;
  images: string[];
  text?: string;
  error?: string;
  data?: any[];
}

export const generateGeminiImage = async (
  apiKey: string | undefined,
  payload: GeminiGeneratePayload,
): Promise<GeminiGenerateResponse> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/gemini/generate`, {
    method: 'POST',
    headers: {
      ...buildOptionalSessionHeaders(),
      ...(await getAuthorizedBillingHeaders()),
      ...buildAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uiMode: 'canvas',
      ...payload,
    }),
  });

  if (!response.ok) {
    await handleApiError(response, 'Gemini generation submit failed');
  }

  return response.json();
};

