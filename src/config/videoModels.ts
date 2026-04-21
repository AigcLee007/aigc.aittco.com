import videoModelCatalog from '../../config/videoModels.json';
import { roundNonNegativePoint } from '../utils/pointFormat';

export interface VideoModelConfig {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  routeFamily: string;
  requestModel?: string;
  selectorCost?: number;
  maxReferenceImages?: number;
  referenceLabels?: string[];
  defaultAspectRatio?: string;
  aspectRatioOptions?: string[];
  defaultDuration?: string;
  durationOptions?: string[];
  supportsHd?: boolean;
  defaultHd?: boolean;
  isActive?: boolean;
  isDefaultModel?: boolean;
  sortOrder?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface VideoModelCatalogShape {
  defaultModelId: string;
  models: VideoModelConfig[];
}

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');
const normalizeStringArray = (value: unknown): string[] => {
  const input = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(new Set(input.map((item) => String(item || '').trim()).filter(Boolean)));
};

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'veo3.1-4k': 'veo3.1-fast-4K',
  'veo3.1-components-4k': 'veo3.1-fast-components-4K',
};

export const normalizeVideoModelId = (modelId?: string) =>
  LEGACY_MODEL_ALIASES[String(modelId || '').trim()] || String(modelId || '').trim();

const normalizeModel = (model: Partial<VideoModelConfig> = {}): VideoModelConfig => ({
  id: normalizeVideoModelId(model.id),
  label: String(model.label || model.id || 'Video Model').trim(),
  description: String(model.description || '').trim(),
  modelFamily: String(model.modelFamily || model.id || 'default').trim(),
  routeFamily: String(model.routeFamily || model.modelFamily || 'default').trim(),
  requestModel: String(model.requestModel || '').trim(),
  selectorCost: roundNonNegativePoint(model.selectorCost || 0, 0),
  maxReferenceImages: Math.max(0, Number(model.maxReferenceImages || 1)),
  referenceLabels: normalizeStringArray(model.referenceLabels || []),
  defaultAspectRatio: String(model.defaultAspectRatio || '16:9').trim(),
  aspectRatioOptions: normalizeStringArray(model.aspectRatioOptions || ['16:9', '9:16']),
  defaultDuration: String(model.defaultDuration || '4').trim(),
  durationOptions: normalizeStringArray(model.durationOptions || ['4', '6', '8']),
  supportsHd: model.supportsHd === true,
  defaultHd: model.defaultHd === true,
  isActive: model.isActive !== false,
  isDefaultModel: model.isDefaultModel === true,
  sortOrder: Number(model.sortOrder || 0),
  createdAt: model.createdAt || null,
  updatedAt: model.updatedAt || null,
});

const normalizeCatalog = (input: Partial<VideoModelCatalogShape> | null | undefined): VideoModelCatalogShape => {
  const models = Array.isArray(input?.models)
    ? input!.models
        .map((model) => normalizeModel(model))
        .filter((model) => model.id)
        .sort((left, right) => {
          if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
            return (left.sortOrder || 0) - (right.sortOrder || 0);
          }
          return left.label.localeCompare(right.label);
        })
    : [];

  const defaultModelId =
    normalizeVideoModelId(input?.defaultModelId) ||
    models.find((model) => model.isDefaultModel)?.id ||
    models[0]?.id ||
    'veo3.1-fast';

  return {
    defaultModelId,
    models,
  };
};

let catalogState = normalizeCatalog(videoModelCatalog as VideoModelCatalogShape);
let pendingLoad: Promise<VideoModelCatalogShape> | null = null;
const listeners = new Set<() => void>();

const emitCatalogChange = () => {
  listeners.forEach((listener) => listener());
};

const setCatalogState = (nextCatalog: Partial<VideoModelCatalogShape>) => {
  catalogState = normalizeCatalog(nextCatalog);
  emitCatalogChange();
  return catalogState;
};

export const getVideoModelCatalogSnapshot = (): VideoModelCatalogShape => catalogState;

export const subscribeVideoModelCatalog = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const refreshVideoModelCatalog = async (): Promise<VideoModelCatalogShape> => {
  if (typeof window === 'undefined') return catalogState;

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/video-models/catalog`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = (await response.json().catch(() => ({}))) as VideoModelCatalogShape & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load video model catalog');
  }

  return setCatalogState(data);
};

export const ensureVideoModelCatalogLoaded = async (): Promise<VideoModelCatalogShape> => {
  if (typeof window === 'undefined') return catalogState;
  if (!pendingLoad) {
    pendingLoad = refreshVideoModelCatalog().finally(() => {
      pendingLoad = null;
    });
  }
  return pendingLoad;
};

export const VIDEO_MODELS = (): VideoModelConfig[] => catalogState.models;
export const DEFAULT_VIDEO_MODEL_ID = () => catalogState.defaultModelId;

export const getVideoModelById = (modelId?: string): VideoModelConfig => {
  const normalized = normalizeVideoModelId(modelId);
  return (
    VIDEO_MODELS().find((model) => model.id === normalized) ||
    VIDEO_MODELS().find((model) => model.id === DEFAULT_VIDEO_MODEL_ID()) ||
    VIDEO_MODELS()[0]
  );
};

export const getVideoModelOptions = () => VIDEO_MODELS();
export const getVideoModelAspectRatioOptions = (modelId?: string) => getVideoModelById(modelId).aspectRatioOptions || ['16:9', '9:16'];
export const getVideoModelDurationOptions = (modelId?: string) => getVideoModelById(modelId).durationOptions || ['4', '6', '8'];
export const getDefaultVideoAspectRatioForModel = (modelId?: string) =>
  getVideoModelById(modelId).defaultAspectRatio || getVideoModelAspectRatioOptions(modelId)[0] || '16:9';
export const getDefaultVideoDurationForModel = (modelId?: string) =>
  getVideoModelById(modelId).defaultDuration || getVideoModelDurationOptions(modelId)[0] || '4';
export const getVideoModelMaxReferenceImages = (modelId?: string) =>
  Math.max(0, Number(getVideoModelById(modelId).maxReferenceImages || 1));
export const getVideoModelReferenceLabels = (modelId?: string) => getVideoModelById(modelId).referenceLabels || [];
export const getVideoModelSupportsHd = (modelId?: string) => getVideoModelById(modelId).supportsHd === true;
export const getVideoModelDefaultHd = (modelId?: string) => getVideoModelById(modelId).defaultHd === true;
export const getVideoModelDisplayCost = (modelId?: string) =>
  roundNonNegativePoint(getVideoModelById(modelId).selectorCost || 0, 0);
export const getVideoModelRequestName = (modelId?: string) => {
  const model = getVideoModelById(modelId);
  return model.requestModel || model.id;
};

