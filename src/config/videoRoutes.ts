import videoRouteCatalog from '../../config/videoRoutes.json';
import { getVideoModelById } from './videoModels';
import { roundNonNegativePoint } from '../utils/pointFormat';

export type VideoRouteTransport = 'openai-video';
export type VideoRouteMode = 'async';

export interface VideoRouteConfig {
  id: string;
  label: string;
  description?: string;
  routeFamily: string;
  line: string;
  transport: VideoRouteTransport;
  mode: VideoRouteMode;
  baseUrl: string;
  generatePath: string;
  taskPath?: string;
  upstreamModel?: string;
  useRequestModel?: boolean;
  allowUserApiKeyWithoutLogin?: boolean;
  apiKeyEnv?: string;
  pointCost?: number;
  isActive?: boolean;
  isDefaultRoute?: boolean;
  sortOrder?: number;
  hasApiKey?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface VideoRouteCatalogShape {
  defaultRouteId: string;
  routes: VideoRouteConfig[];
}

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

const normalizeRoute = (route: Partial<VideoRouteConfig> = {}): VideoRouteConfig => ({
  id: String(route.id || '').trim(),
  label: String(route.label || route.id || 'Route').trim(),
  description: String(route.description || '').trim(),
  routeFamily: String(route.routeFamily || 'default').trim(),
  line: String(route.line || 'default').trim(),
  transport: (route.transport || 'openai-video') as VideoRouteTransport,
  mode: (route.mode || 'async') as VideoRouteMode,
  baseUrl: String(route.baseUrl || '').trim(),
  generatePath: String(route.generatePath || '/v2/videos/generations').trim(),
  taskPath: String(route.taskPath || '').trim(),
  upstreamModel: String(route.upstreamModel || '').trim(),
  useRequestModel: route.useRequestModel === true,
  allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
  apiKeyEnv: String(route.apiKeyEnv || '').trim(),
  pointCost: roundNonNegativePoint(route.pointCost || 0, 0),
  isActive: route.isActive !== false,
  isDefaultRoute: route.isDefaultRoute === true,
  sortOrder: Number(route.sortOrder || 0),
  hasApiKey: route.hasApiKey === true,
  createdAt: route.createdAt || null,
  updatedAt: route.updatedAt || null,
});

const normalizeCatalog = (
  input: Partial<VideoRouteCatalogShape> | null | undefined,
): VideoRouteCatalogShape => {
  const routes = Array.isArray(input?.routes)
    ? input!.routes
        .map((route) => normalizeRoute(route))
        .filter((route) => route.id)
        .sort((left, right) => {
          if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
            return (left.sortOrder || 0) - (right.sortOrder || 0);
          }
          return left.label.localeCompare(right.label);
        })
    : [];

  return {
    defaultRouteId:
      String(input?.defaultRouteId || '').trim() ||
      routes.find((route) => route.isDefaultRoute)?.id ||
      routes[0]?.id ||
      '',
    routes,
  };
};

let catalogState = normalizeCatalog(videoRouteCatalog as VideoRouteCatalogShape);
let pendingLoad: Promise<VideoRouteCatalogShape> | null = null;
const listeners = new Set<() => void>();

const emitCatalogChange = () => {
  listeners.forEach((listener) => listener());
};

const setCatalogState = (nextCatalog: Partial<VideoRouteCatalogShape>) => {
  catalogState = normalizeCatalog(nextCatalog);
  emitCatalogChange();
  return catalogState;
};

export const getVideoRouteCatalogSnapshot = (): VideoRouteCatalogShape => catalogState;

export const subscribeVideoRouteCatalog = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const refreshVideoRouteCatalog = async (): Promise<VideoRouteCatalogShape> => {
  if (typeof window === 'undefined') return catalogState;

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/video-routes/catalog`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = (await response.json().catch(() => ({}))) as VideoRouteCatalogShape & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load video route catalog');
  }

  return setCatalogState(data);
};

export const ensureVideoRouteCatalogLoaded = async (): Promise<VideoRouteCatalogShape> => {
  if (typeof window === 'undefined') return catalogState;
  if (!pendingLoad) {
    pendingLoad = refreshVideoRouteCatalog().finally(() => {
      pendingLoad = null;
    });
  }
  return pendingLoad;
};

export const VIDEO_ROUTES = (): VideoRouteConfig[] => catalogState.routes;
export const DEFAULT_VIDEO_ROUTE_ID = () => catalogState.defaultRouteId;

export const getVideoRouteById = (routeId?: string): VideoRouteConfig => {
  return (
    VIDEO_ROUTES().find((route) => route.id === routeId) ||
    VIDEO_ROUTES().find((route) => route.id === DEFAULT_VIDEO_ROUTE_ID()) ||
    VIDEO_ROUTES()[0]
  );
};

export const getVideoRoutesByRouteFamily = (routeFamily: string): VideoRouteConfig[] =>
  VIDEO_ROUTES().filter((route) => route.routeFamily === routeFamily);

const buildUserFacingVideoRouteLabel = (line: string, fallbackLabel?: string) => {
  const normalizedLine = String(line || '').trim().toLowerCase();
  const lineMatch = normalizedLine.match(/^line\s*([0-9]+)$/i);
  if (lineMatch?.[1]) {
    return `Line ${lineMatch[1]}`;
  }

  if (normalizedLine === 'default') {
    return 'Default';
  }

  const sanitizedFallback = String(fallbackLabel || '').trim();
  return sanitizedFallback || 'Route';
};

export const getSelectedVideoRoute = (videoModel: string, videoLine?: string): VideoRouteConfig => {
  const modelConfig = getVideoModelById(videoModel);
  const routeFamily = String(modelConfig?.routeFamily || 'default').trim() || 'default';
  const familyRoutes = getVideoRoutesByRouteFamily(routeFamily);
  if (familyRoutes.length === 0) return getVideoRouteById(DEFAULT_VIDEO_ROUTE_ID());
  return (
    familyRoutes.find((route) => route.line === videoLine) ||
    familyRoutes.find((route) => route.isDefaultRoute) ||
    familyRoutes[0]
  );
};

export const getVideoRouteOptions = (
  videoModel: string,
  { directKeyOnly = false }: { directKeyOnly?: boolean } = {},
) => {
  const modelConfig = getVideoModelById(videoModel);
  const routeFamily = String(modelConfig?.routeFamily || '').trim();
  if (!routeFamily) return [];
  const familyRoutes = getVideoRoutesByRouteFamily(routeFamily).filter((route) =>
    directKeyOnly ? route.allowUserApiKeyWithoutLogin === true : true,
  );
  if (familyRoutes.length <= 1) return [];
  return familyRoutes.map((route) => ({
    value: route.line,
    label: buildUserFacingVideoRouteLabel(route.line, route.label),
    description: undefined,
    badge: undefined,
  }));
};

export const allowsDirectUserApiKeyVideoRoute = (route?: VideoRouteConfig | null): boolean =>
  route?.allowUserApiKeyWithoutLogin === true;

export const canUseDirectUserApiKeyForVideoModel = (videoModel: string): boolean => {
  const modelConfig = getVideoModelById(videoModel);
  const routeFamily = String(modelConfig?.routeFamily || '').trim();
  if (!routeFamily) return false;

  return getVideoRoutesByRouteFamily(routeFamily).some(
    (route) => route.allowUserApiKeyWithoutLogin === true,
  );
};

export const getVideoModelNameForRoute = ({
  videoModel,
  videoLine,
}: {
  videoModel: string;
  videoLine?: string;
}) => {
  const route = getSelectedVideoRoute(videoModel, videoLine);
  const model = getVideoModelById(videoModel);
  if (route.upstreamModel) return route.upstreamModel;
  if (route.useRequestModel) return model.requestModel || model.id;
  return model.requestModel || model.id;
};

