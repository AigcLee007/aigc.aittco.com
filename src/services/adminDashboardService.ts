import { getAuthorizedBillingHeaders } from './accountIdentity';

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }

  return data;
};

export interface AdminDashboardAuthSummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
  superAdminUsers: number;
  totalSessions: number;
  activeSessions: number;
  onlineUsers: number;
  recentUsers: number;
  latestUserCreatedAt: string | null;
  onlineWindowMinutes: number;
  recentWindowDays: number;
}

export interface AdminDashboardBillingSummary {
  totalAccounts: number;
  totalBalancePoints: number;
  totalRechargedPoints: number;
  totalSpentPoints: number;
  totalCharges: number;
  successfulCharges: number;
  failedCharges: number;
  pendingTasks: number;
  grossChargePoints: number;
  refundedPoints: number;
  netSpentPoints: number;
  requestsLast24h: number;
  successfulLast24h: number;
  failedLast24h: number;
  successRate: number;
  successRateLast24h: number;
  lastChargeAt: string | null;
}

export interface AdminDashboardRouteStat {
  routeId: string;
  label: string;
  description: string;
  mediaType: 'image' | 'video' | 'unknown';
  modelFamily: string;
  line: string;
  mode: string;
  transport: string;
  baseUrl: string;
  pointCost: number;
  isActive: boolean;
  isDefaultRoute: boolean;
  isDefaultNanoBananaLine: boolean;
  totalCharges: number;
  successfulCharges: number;
  failedCharges: number;
  pendingTasks: number;
  grossChargePoints: number;
  refundedPoints: number;
  netSpentPoints: number;
  requestsLast24h: number;
  successfulLast24h: number;
  failedLast24h: number;
  successRate: number;
  successRateLast24h: number;
  lastChargeAt: string | null;
}

export interface AdminDashboardModelStat {
  modelKey: string;
  modelId: string | null;
  label: string;
  description: string;
  mediaType: 'image' | 'video' | 'unknown';
  modelFamily: string;
  routeFamily: string;
  requestModel: string;
  selectorCost: number;
  panelLayout: string;
  sizeBehavior: string;
  isActive: boolean;
  isDefaultModel: boolean;
  totalCharges: number;
  successfulCharges: number;
  failedCharges: number;
  pendingTasks: number;
  grossChargePoints: number;
  refundedPoints: number;
  netSpentPoints: number;
  requestsLast24h: number;
  successfulLast24h: number;
  failedLast24h: number;
  successRate: number;
  successRateLast24h: number;
  lastChargeAt: string | null;
}

export interface AdminDashboardPayload {
  success: boolean;
  generatedAt: string;
  windows: {
    onlineWindowMinutes: number;
    recentUserWindowDays: number;
    recentRuntimeWindowHours: number;
  };
  auth: AdminDashboardAuthSummary;
  billing: AdminDashboardBillingSummary;
  routeCatalog: {
    defaultRouteId: string;
    defaultNanoBananaLine: string;
    totalRoutes: number;
    activeRoutes: number;
    imageTotalRoutes: number;
    imageActiveRoutes: number;
    videoTotalRoutes: number;
    videoActiveRoutes: number;
  };
  modelCatalog: {
    defaultModelId: string;
    totalModels: number;
    activeModels: number;
    imageTotalModels: number;
    imageActiveModels: number;
    videoTotalModels: number;
    videoActiveModels: number;
  };
  routeStats: AdminDashboardRouteStat[];
  modelStats: AdminDashboardModelStat[];
  imageRouteStats: AdminDashboardRouteStat[];
  videoRouteStats: AdminDashboardRouteStat[];
  imageModelStats: AdminDashboardModelStat[];
  videoModelStats: AdminDashboardModelStat[];
}

export const fetchAdminDashboard = async (): Promise<AdminDashboardPayload> => {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/dashboard`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
  });

  return parseResponse<AdminDashboardPayload>(response);
};

