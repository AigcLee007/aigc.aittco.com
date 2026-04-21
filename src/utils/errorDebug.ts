export const DEFAULT_GENERATION_ERROR_MESSAGE =
  '请检查提示词或参考图，可能触发了安全限制，请更换后重试';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const isTruthy = (value: string | null | undefined) =>
  Boolean(value && TRUE_VALUES.has(String(value).trim().toLowerCase()));

export const isErrorDebugEnabled = (): boolean => {
  const envFlag = isTruthy(String(import.meta.env.VITE_EXPOSE_ERROR_DETAILS || ''));
  if (import.meta.env.DEV || envFlag) return true;

  if (typeof window === 'undefined') return false;

  const search = new URLSearchParams(window.location.search);
  if (
    isTruthy(search.get('debugErrors')) ||
    isTruthy(search.get('debug_errors')) ||
    isTruthy(search.get('error_debug'))
  ) {
    return true;
  }

  try {
    return isTruthy(window.localStorage.getItem('debug:error:detail'));
  } catch {
    return false;
  }
};

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || '';

  if (typeof error === 'object') {
    const maybeError = error as Record<string, unknown>;
    const direct =
      maybeError.error || maybeError.message || maybeError.details || maybeError.code || '';
    if (typeof direct === 'string') return direct;
    try {
      return JSON.stringify(direct || maybeError);
    } catch {
      return '';
    }
  }

  return String(error);
};

export const toGenerationErrorMessage = (
  detail: unknown,
  fallback = DEFAULT_GENERATION_ERROR_MESSAGE,
) => {
  const detailText = extractErrorMessage(detail).trim();
  if (!isErrorDebugEnabled() || !detailText) return fallback;
  return `${fallback}\n\n[调试信息] ${detailText}`;
};

