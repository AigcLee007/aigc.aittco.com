export const DEFAULT_ERROR_MESSAGE = '请求失败，未返回错误详情';

export interface AppErrorMeta {
  code?: string;
  status?: number;
  traceId?: string;
  details?: string;
}

export class AppError extends Error {
  code?: string;
  status?: number;
  traceId?: string;
  details?: string;

  constructor(message: string, meta: AppErrorMeta = {}) {
    super(message || DEFAULT_ERROR_MESSAGE);
    this.name = 'AppError';
    this.code = meta.code;
    this.status = meta.status;
    this.traceId = meta.traceId;
    this.details = meta.details;
  }
}

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseJsonLikeText = (value: string): unknown => {
  const text = value.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const isMeaningfulErrorText = (value: unknown): value is string => {
  const text = toText(value).trim();
  if (!text) return false;
  const normalized = text.toLowerCase();
  return !['success', 'succeeded', 'ok', 'completed', 'complete', 'done'].includes(normalized);
};

const getObjectValue = (obj: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
};

const ERROR_MESSAGE_PATHS = [
  'fail_reason',
  'failReason',
  'failure_reason',
  'failureReason',
  'error_message',
  'errorMessage',
  'reason',
  'data.fail_reason',
  'data.failReason',
  'data.failure_reason',
  'data.failureReason',
  'data.error_message',
  'data.errorMessage',
  'data.reason',
  'data.error.message',
  'error.fail_reason',
  'error.failReason',
  'error.failure_reason',
  'error.failureReason',
  'error.error_message',
  'error.errorMessage',
  'error.reason',
  'error.message',
  'message',
  'details',
  'msg',
  'data.message',
  'data.details',
  'data.msg',
  'code',
  'data.code',
] as const;

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') {
    const parsed = parseJsonLikeText(error);
    if (parsed && parsed !== error) {
      const parsedMessage = extractErrorMessage(parsed);
      if (parsedMessage) return parsedMessage;
    }
    return isMeaningfulErrorText(error) ? error.trim() : '';
  }
  if (error instanceof Error) {
    const message = error.message || '';
    if (/^failed to fetch$/i.test(message.trim())) {
      return '无法连接到服务器，请检查本地网络后重试';
    }
    return isMeaningfulErrorText(message) ? message.trim() : '';
  }

  if (typeof error === 'object') {
    const maybeError = error as Record<string, unknown>;
    for (const path of ERROR_MESSAGE_PATHS) {
      const value = getObjectValue(maybeError, path);
      if (isMeaningfulErrorText(value)) return toText(value).trim();
    }

    const nested = maybeError.error;
    if (isMeaningfulErrorText(nested)) return toText(nested).trim();

    return toText(maybeError).trim();
  }

  return toText(error).trim();
};

export const extractAppErrorMeta = (error: unknown): AppErrorMeta => {
  if (!error || typeof error !== 'object') return {};
  const maybeError = error as Record<string, unknown>;
  return {
    code: toText(maybeError.code).trim() || undefined,
    status:
      typeof maybeError.status === 'number'
        ? maybeError.status
        : Number.isFinite(Number(maybeError.status))
          ? Number(maybeError.status)
          : undefined,
    traceId: toText(maybeError.traceId).trim() || undefined,
    details: toText(maybeError.details).trim() || undefined,
  };
};

export const toDisplayErrorMessage = (
  error: unknown,
  fallback = DEFAULT_ERROR_MESSAGE,
): string => extractErrorMessage(error) || fallback;
