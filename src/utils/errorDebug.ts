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

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) {
    const message = error.message || '';
    if (/^failed to fetch$/i.test(message.trim())) {
      return '无法连接到服务器，请检查本地网络后重试';
    }
    return message;
  }

  if (typeof error === 'object') {
    const maybeError = error as Record<string, unknown>;
    const nested = maybeError.error;
    if (nested && typeof nested === 'object') {
      const nestedMessage = (nested as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage.trim();
      }
    }
    if (typeof nested === 'string' && nested.trim()) return nested.trim();

    const direct = maybeError.message || maybeError.details || maybeError.code || '';
    const text = toText(direct).trim();
    if (text) return text;
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
