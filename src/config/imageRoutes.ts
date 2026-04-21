import imageRouteCatalog from '../../config/imageRoutes.json';
import { getImageModelById, getImageModelRequestName } from './imageModels';
import { roundNonNegativePoint } from '../utils/pointFormat';

export type ImageRouteTransport = 'openai-image' | 'gemini-native';
export type ImageRouteMode = 'async' | 'sync';
export type ImageRouteSizeKey = '1k' | '2k' | '4k';

export interface ImageRouteSizeOverrideConfig {
  upstreamModel?: string;
  pointCost?: number;
}

export type ImageRouteSizeOverrideMap = Partial<
  Record<ImageRouteSizeKey, ImageRouteSizeOverrideConfig>
>;

export interface ImageRouteConfig {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  line: string;
  transport: ImageRouteTransport;
  mode: ImageRouteMode;
  baseUrl: string;
  generatePath: string;
  taskPath?: string;
  editPath?: string;
  chatPath?: string;
  upstreamModel?: string;
  useRequestModel?: boolean;
  allowUserApiKeyWithoutLogin?: boolean;
  apiKeyEnv?: string;
  pointCost?: number;
  sizeOverrides?: ImageRouteSizeOverrideMap;
  isActive?: boolean;
  isDefaultRoute?: boolean;
  isDefaultNanoBananaLine?: boolean;
  sortOrder?: number;
  hasApiKey?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ImageRouteCatalogShape {
  defaultRouteId: string;
  defaultNanoBananaLine: string;
  routes: ImageRouteConfig[];
}

export interface ImageRouteOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  isDirectUserApiKeyCompatible?: boolean;
}

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

const normalizeSizeKey = (value?: string): ImageRouteSizeKey | '' => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1k', '2k', '4k'].includes(normalized) ? (normalized as ImageRouteSizeKey) : '';
};

const normalizeSizeOverrides = (
  overrides?: ImageRouteSizeOverrideMap | null,
): ImageRouteSizeOverrideMap => {
  const next: ImageRouteSizeOverrideMap = {};
  if (!overrides || typeof overrides !== 'object') {
    return next;
  }

  Object.entries(overrides).forEach(([rawKey, rawValue]) => {
    const key = normalizeSizeKey(rawKey);
    if (!key || !rawValue || typeof rawValue !== 'object') {
      return;
    }

    const upstreamModel = String(rawValue.upstreamModel || '').trim();
    const parsedPointCost = Number.parseFloat(String(rawValue.pointCost ?? ''));
    const entry: ImageRouteSizeOverrideConfig = {};
    if (upstreamModel) {
      entry.upstreamModel = upstreamModel;
    }
    if (Number.isFinite(parsedPointCost) && parsedPointCost >= 0) {
      entry.pointCost = roundNonNegativePoint(parsedPointCost, 0);
    }
    if (entry.upstreamModel || Number.isFinite(entry.pointCost)) {
      next[key] = entry;
    }
  });

  return next;
};

const normalizeRoute = (route: Partial<ImageRouteConfig> = {}): ImageRouteConfig => ({
  id: String(route.id || '').trim(),
  label: String(route.label || route.id || 'Route').trim(),
  description: String(route.description || '').trim(),
  modelFamily: String(route.modelFamily || 'default').trim(),
  line: String(route.line || 'default').trim(),
  transport: (route.transport || 'openai-image') as ImageRouteTransport,
  mode: (route.mode || 'async') as ImageRouteMode,
  baseUrl: String(route.baseUrl || '').trim(),
  generatePath: String(route.generatePath || '/v1/images/generations').trim(),
  taskPath: String(route.taskPath || '').trim(),
  editPath: String(route.editPath || '').trim(),
  chatPath: String(route.chatPath || '').trim(),
  upstreamModel: String(route.upstreamModel || '').trim(),
  useRequestModel: route.useRequestModel === true,
  allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
  apiKeyEnv: String(route.apiKeyEnv || '').trim(),
  pointCost: roundNonNegativePoint(route.pointCost || 0, 0),
  sizeOverrides: normalizeSizeOverrides(route.sizeOverrides),
  isActive: route.isActive !== false,
  isDefaultRoute: route.isDefaultRoute === true,
  isDefaultNanoBananaLine: route.isDefaultNanoBananaLine === true,
  sortOrder: Number(route.sortOrder || 0),
  hasApiKey: route.hasApiKey === true,
  createdAt: route.createdAt || null,
  updatedAt: route.updatedAt || null,
});

const normalizeCatalog = (
  input: Partial<ImageRouteCatalogShape> | null | undefined,
): ImageRouteCatalogShape => {
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

  const defaultRouteId =
    String(input?.defaultRouteId || '').trim() ||
    routes.find((route) => route.isDefaultRoute)?.id ||
    routes[0]?.id ||
    'openai-image-default';
  const defaultNanoBananaLine =
    String(input?.defaultNanoBananaLine || '').trim() ||
    routes.find((route) => route.modelFamily === 'nano-banana' && route.isDefaultNanoBananaLine)
      ?.line ||
    routes.find((route) => route.modelFamily === 'nano-banana')?.line ||
    'line1';

  return {
    defaultRouteId,
    defaultNanoBananaLine,
    routes,
  };
};

let catalogState = normalizeCatalog(imageRouteCatalog as ImageRouteCatalogShape);
let pendingLoad: Promise<ImageRouteCatalogShape> | null = null;
const listeners = new Set<() => void>();

const emitCatalogChange = () => {
  listeners.forEach((listener) => listener());
};

const setCatalogState = (nextCatalog: Partial<ImageRouteCatalogShape>) => {
  catalogState = normalizeCatalog(nextCatalog);
  emitCatalogChange();
  return catalogState;
};

export const getImageRouteCatalogSnapshot = (): ImageRouteCatalogShape => catalogState;

export const subscribeImageRouteCatalog = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const refreshImageRouteCatalog = async (): Promise<ImageRouteCatalogShape> => {
  if (typeof window === 'undefined') {
    return catalogState;
  }

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/image-routes/catalog`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = (await response.json().catch(() => ({}))) as ImageRouteCatalogShape & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load image route catalog');
  }

  return setCatalogState(data);
};

export const ensureImageRouteCatalogLoaded = async (): Promise<ImageRouteCatalogShape> => {
  if (typeof window === 'undefined') {
    return catalogState;
  }

  if (!pendingLoad) {
    pendingLoad = refreshImageRouteCatalog().finally(() => {
      pendingLoad = null;
    });
  }

  return pendingLoad;
};

export const IMAGE_ROUTES = (): ImageRouteConfig[] => catalogState.routes;
export const DEFAULT_IMAGE_ROUTE_ID = () => catalogState.defaultRouteId;
export const DEFAULT_NANO_BANANA_LINE = () => catalogState.defaultNanoBananaLine;

export const getImageRouteById = (routeId?: string): ImageRouteConfig => {
  return (
    IMAGE_ROUTES().find((route) => route.id === routeId) ||
    IMAGE_ROUTES().find((route) => route.id === DEFAULT_IMAGE_ROUTE_ID()) ||
    IMAGE_ROUTES()[0]
  );
};

export const getImageRoutesByModelFamily = (modelFamily: string): ImageRouteConfig[] =>
  IMAGE_ROUTES().filter((route) => route.modelFamily === modelFamily);

const buildUserFacingRouteLabel = (line: string, fallbackLabel?: string) => {
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

export const getNanoBananaRouteByLine = (line?: string): ImageRouteConfig => {
  return (
    getImageRoutesByModelFamily('nano-banana').find((route) => route.line === line) ||
    getImageRoutesByModelFamily('nano-banana').find(
      (route) => route.line === DEFAULT_NANO_BANANA_LINE(),
    ) ||
    getImageRouteById(DEFAULT_IMAGE_ROUTE_ID())
  );
};

export const getSelectedImageRoute = (
  imageModel: string,
  imageLine?: string,
): ImageRouteConfig => {
  const modelConfig = getImageModelById(imageModel);
  const routeFamily = String(modelConfig?.routeFamily || 'default').trim() || 'default';
  const familyRoutes = getImageRoutesByModelFamily(routeFamily);

  if (familyRoutes.length === 0) {
    return getImageRouteById(DEFAULT_IMAGE_ROUTE_ID());
  }

  if (routeFamily === 'nano-banana') {
    return (
      familyRoutes.find((route) => route.line === imageLine) ||
      familyRoutes.find((route) => route.line === DEFAULT_NANO_BANANA_LINE()) ||
      familyRoutes[0]
    );
  }

  return (
    familyRoutes.find((route) => route.line === imageLine) ||
    familyRoutes.find((route) => route.isDefaultRoute) ||
    familyRoutes[0]
  );
};

export const getImageRouteOptions = (
  imageModel: string,
  {
    preferCompatibleFirst = false,
    recommendCompatible = false,
    directKeyOnly = false,
  }: {
    preferCompatibleFirst?: boolean;
    recommendCompatible?: boolean;
    directKeyOnly?: boolean;
  } = {},
): ImageRouteOption[] => {
  const modelConfig = getImageModelById(imageModel);
  const routeFamily = String(modelConfig?.routeFamily || '').trim();
  if (!routeFamily) {
    return [];
  }

  const familyRoutes = getImageRoutesByModelFamily(routeFamily).filter((route) =>
    directKeyOnly ? route.allowUserApiKeyWithoutLogin === true : true,
  );
  if (familyRoutes.length <= 1) {
    return [];
  }

  const sortedRoutes = preferCompatibleFirst
    ? [...familyRoutes].sort((left, right) => {
        const leftCompatible = left.allowUserApiKeyWithoutLogin === true ? 1 : 0;
        const rightCompatible = right.allowUserApiKeyWithoutLogin === true ? 1 : 0;
        if (leftCompatible !== rightCompatible) return rightCompatible - leftCompatible;
        if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
          return (left.sortOrder || 0) - (right.sortOrder || 0);
        }
        return left.label.localeCompare(right.label);
      })
    : familyRoutes;

  return sortedRoutes.map((route) => ({
    value: route.line,
    label: buildUserFacingRouteLabel(route.line, route.label),
    description: undefined,
    badge: undefined,
    isDirectUserApiKeyCompatible: route.allowUserApiKeyWithoutLogin === true,
  }));
};

export const canUseDirectUserApiKeyForImageModel = (imageModel: string): boolean => {
  const modelConfig = getImageModelById(imageModel);
  const routeFamily = String(modelConfig?.routeFamily || '').trim();
  if (!routeFamily) return false;

  return getImageRoutesByModelFamily(routeFamily).some(
    (route) => route.allowUserApiKeyWithoutLogin === true,
  );
};

export const isGeminiNativeImageRoute = (route: ImageRouteConfig) =>
  route.transport === 'gemini-native';

export const allowsDirectUserApiKeyImageRoute = (route?: ImageRouteConfig | null): boolean => {
  if (!route) return false;
  return route.allowUserApiKeyWithoutLogin === true;
};

export const getImageRouteSizeOverride = (
  route?: ImageRouteConfig | null,
  imageSize?: string,
): ImageRouteSizeOverrideConfig | null => {
  const key = normalizeSizeKey(imageSize);
  if (!route || !key) return null;
  return route.sizeOverrides?.[key] || null;
};

export const getImageRoutePointCost = (
  route?: ImageRouteConfig | null,
  imageSize?: string,
): number => {
  const sizeOverride = getImageRouteSizeOverride(route, imageSize);
  if (sizeOverride && Number.isFinite(sizeOverride.pointCost)) {
    return roundNonNegativePoint(sizeOverride.pointCost, 0);
  }
  return roundNonNegativePoint(route?.pointCost || 0, 0);
};

export const getImageModelNameForRoute = ({
  imageModel,
  imageLine,
  imageSize,
}: {
  imageModel: string;
  imageLine?: string;
  imageSize?: string;
}): string => {
  const route = getSelectedImageRoute(imageModel, imageLine);
  const requestModel = getImageModelRequestName(imageModel);
  const sizeOverride = getImageRouteSizeOverride(route, imageSize);

  if (sizeOverride?.upstreamModel) {
    return sizeOverride.upstreamModel;
  }

  if (route.upstreamModel) {
    return route.upstreamModel;
  }

  if (route.useRequestModel) {
    return requestModel;
  }

  return requestModel;
};
