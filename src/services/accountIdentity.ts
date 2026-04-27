const API_BASE_URL =
  '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');
const STORAGE_KEY = 'auth-session-v1';
export const AUTH_SESSION_CHANGE_EVENT = 'auth-session-change';

export type AuthUserRole = 'user' | 'admin' | 'super_admin';
export type AuthUserStatus = 'active' | 'disabled';

export interface AuthUserProfile {
  userId: string;
  email: string;
  displayName: string;
  role: AuthUserRole;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  status: AuthUserStatus;
  passwordConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthSessionPayload {
  success: boolean;
  authenticated: boolean;
  user: AuthUserProfile;
}

interface LoginResponse {
  success: boolean;
  sessionToken: string;
  user: AuthUserProfile;
  createdSuperAdmin?: boolean;
}

export interface RegistrationStatusPayload {
  success: boolean;
  totalUsers: number;
  hasUsers: boolean;
  firstUserWillBeSuperAdmin: boolean;
  passwordLoginEnabled: boolean;
}

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const emitAuthSessionChange = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGE_EVENT));
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }

  return data;
};

export const getStoredAuthSessionToken = (): string | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw && raw.trim() ? raw.trim() : null;
};

export const setStoredAuthSessionToken = (sessionToken: string) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, sessionToken);
  emitAuthSessionChange();
};

export const clearStoredAuthSessionToken = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  emitAuthSessionChange();
};

export const buildBillingIdentityHeaders = (
  sessionToken: string,
): Record<string, string> => ({
  'X-Auth-Session': sessionToken,
});

export const getAuthorizedBillingHeaders = async (): Promise<Record<string, string>> => {
  const sessionToken = getStoredAuthSessionToken();
  if (!sessionToken) {
    throw new Error('璇峰厛鐧诲綍鍚庡啀浣跨敤鐐规暟鍔熻兘');
  }
  return buildBillingIdentityHeaders(sessionToken);
};

export const fetchRegistrationStatus = async (): Promise<RegistrationStatusPayload> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/registration-status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return parseResponse<RegistrationStatusPayload>(response);
};

export const fetchCurrentAuthSession = async (): Promise<AuthSessionPayload | null> => {
  const sessionToken = getStoredAuthSessionToken();
  if (!sessionToken) return null;

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/session`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...buildBillingIdentityHeaders(sessionToken),
    },
  });

  if (response.status === 401) {
    clearStoredAuthSessionToken();
    return null;
  }

  return parseResponse<AuthSessionPayload>(response);
};

export const ensureBillingIdentity = async (): Promise<{
  sessionToken: string;
  user: AuthUserProfile;
}> => {
  const sessionToken = getStoredAuthSessionToken();
  if (!sessionToken) {
    throw new Error('璇峰厛鐧诲綍鍚庡啀浣跨敤鐐规暟鍔熻兘');
  }

  const current = await fetchCurrentAuthSession();
  if (!current?.authenticated || !current.user) {
    throw new Error('鐧诲綍鐘舵€佸凡澶辨晥锛岃閲嶆柊鐧诲綍');
  }

  return {
    sessionToken,
    user: current.user,
  };
};

export const requestEmailCode = async (
  email: string,
): Promise<{ expiresInSeconds: number; previewCode?: string | null }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/request-email-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await parseResponse<{
    expiresInSeconds?: number;
    previewCode?: string | null;
  }>(response);

  return {
    expiresInSeconds: Number(data.expiresInSeconds || 0),
    previewCode: data.previewCode ?? null,
  };
};

export const requestPasswordResetCode = async (
  email: string,
): Promise<{ expiresInSeconds: number; previewCode?: string | null }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/password/forgot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await parseResponse<{
    expiresInSeconds?: number;
    previewCode?: string | null;
  }>(response);

  return {
    expiresInSeconds: Number(data.expiresInSeconds || 0),
    previewCode: data.previewCode ?? null,
  };
};

export const loginWithEmailCode = async (
  email: string,
  code: string,
): Promise<AuthSessionPayload> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/login/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code }),
  });

  const data = await parseResponse<LoginResponse>(response);
  if (!data.sessionToken) {
    throw new Error('鐧诲綍杩斿洖缂哄皯 session token');
  }

  setStoredAuthSessionToken(data.sessionToken);

  return {
    success: true,
    authenticated: true,
    user: data.user,
  };
};

export const registerWithPassword = async ({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthSessionPayload & { createdSuperAdmin?: boolean }> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      displayName,
    }),
  });

  const data = await parseResponse<LoginResponse>(response);
  if (!data.sessionToken) {
    throw new Error('娉ㄥ唽杩斿洖缂哄皯 session token');
  }

  setStoredAuthSessionToken(data.sessionToken);

  return {
    success: true,
    authenticated: true,
    user: data.user,
    createdSuperAdmin: data.createdSuperAdmin === true,
  };
};

export const loginWithPassword = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<AuthSessionPayload> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/login/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await parseResponse<LoginResponse>(response);
  if (!data.sessionToken) {
    throw new Error('鐧诲綍杩斿洖缂哄皯 session token');
  }

  setStoredAuthSessionToken(data.sessionToken);

  return {
    success: true,
    authenticated: true,
    user: data.user,
  };
};

export const logoutAuthSession = async () => {
  const sessionToken = getStoredAuthSessionToken();
  try {
    if (sessionToken) {
      await fetch(`${cleanUrl(API_BASE_URL)}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBillingIdentityHeaders(sessionToken),
        },
      });
    }
  } finally {
    clearStoredAuthSessionToken();
  }
};

export const resetPasswordWithEmailCode = async ({
  email,
  code,
  password,
}: {
  email: string;
  code: string;
  password: string;
}): Promise<AuthSessionPayload> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/password/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code, password }),
  });

  const data = await parseResponse<LoginResponse>(response);
  if (!data.sessionToken) {
    throw new Error('瀵嗙爜閲嶇疆杩斿洖缂哄皯 session token');
  }

  setStoredAuthSessionToken(data.sessionToken);

  return {
    success: true,
    authenticated: true,
    user: data.user,
  };
};

export const setCurrentUserPassword = async (password: string): Promise<AuthUserProfile> => {
  const sessionToken = getStoredAuthSessionToken();
  if (!sessionToken) {
    throw new Error('璇峰厛鐧诲綍鍚庡啀璁剧疆瀵嗙爜');
  }

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildBillingIdentityHeaders(sessionToken),
    },
    body: JSON.stringify({ password }),
  });

  const data = await parseResponse<{
    success: boolean;
    user: AuthUserProfile;
  }>(response);

  return data.user;
};

export const changeCurrentUserPassword = async ({
  currentPassword,
  newPassword,
}: {
  currentPassword: string;
  newPassword: string;
}): Promise<AuthUserProfile> => {
  const sessionToken = getStoredAuthSessionToken();
  if (!sessionToken) {
    throw new Error('璇峰厛鐧诲綍鍚庡啀淇敼瀵嗙爜');
  }

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/auth/password/change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildBillingIdentityHeaders(sessionToken),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  const data = await parseResponse<{
    success: boolean;
    user: AuthUserProfile;
  }>(response);

  return data.user;
};

