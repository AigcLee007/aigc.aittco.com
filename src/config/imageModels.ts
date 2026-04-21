import imageModelCatalog from '../../config/imageModels.json';
import { getDoubaoSize } from '../utils/imageUtils';
import { roundNonNegativePoint } from '../utils/pointFormat';

export type ImageModelIconKind =
  | 'banana'
  | 'banana-zap'
  | 'sparkles'
  | 'layers'
  | 'zap'
  | 'none';
export type ImageModelPanelLayout = 'nano-banana' | 'default' | 'compact';
export type ImageModelSizeBehavior =
  | 'passthrough'
  | 'doubao-v5'
  | 'doubao-v45'
  | 'z-image-turbo';

export interface ImageModelConfig {
  id: string;
  label: string;
  description?: string;
  modelFamily: string;
  routeFamily: string;
  requestModel?: string;
  selectorCost?: number;
  iconKind?: ImageModelIconKind;
  panelLayout?: ImageModelPanelLayout;
  sizeBehavior?: ImageModelSizeBehavior;
  defaultSize?: string;
  sizeOptions?: string[];
  extraAspectRatios?: string[];
  showSizeSelector?: boolean;
  supportsCustomRatio?: boolean;
  isActive?: boolean;
  isDefaultModel?: boolean;
  sortOrder?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ImageModelCatalogShape {
  defaultModelId: string;
  models: ImageModelConfig[];
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

  return Array.from(
    new Set(
      input
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
};

const normalizeModel = (model: Partial<ImageModelConfig> = {}): ImageModelConfig => ({
  id: String(model.id || '').trim(),
  label: String(model.label || model.id || 'Image Model').trim(),
  description: String(model.description || '').trim(),
  modelFamily: String(model.modelFamily || model.id || 'default').trim(),
  routeFamily: String(model.routeFamily || model.modelFamily || 'default').trim(),
  requestModel: String(model.requestModel || '').trim(),
  selectorCost: roundNonNegativePoint(model.selectorCost || 0, 0),
  iconKind: (model.iconKind || 'banana') as ImageModelIconKind,
  panelLayout: (model.panelLayout || 'default') as ImageModelPanelLayout,
  sizeBehavior: (model.sizeBehavior || 'passthrough') as ImageModelSizeBehavior,
  defaultSize: String(model.defaultSize || '1k').trim().toLowerCase(),
  sizeOptions: normalizeStringArray(model.sizeOptions || ['1k']).map((item) =>
    item.toLowerCase(),
  ),
  extraAspectRatios: normalizeStringArray(model.extraAspectRatios || []),
  showSizeSelector: model.showSizeSelector !== false,
  supportsCustomRatio: model.supportsCustomRatio !== false,
  isActive: model.isActive !== false,
  isDefaultModel: model.isDefaultModel === true,
  sortOrder: Number(model.sortOrder || 0),
  createdAt: model.createdAt || null,
  updatedAt: model.updatedAt || null,
});

const normalizeCatalog = (
  input: Partial<ImageModelCatalogShape> | null | undefined,
): ImageModelCatalogShape => {
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
    String(input?.defaultModelId || '').trim() ||
    models.find((model) => model.isDefaultModel)?.id ||
    models[0]?.id ||
    'nano-banana';

  return {
    defaultModelId,
    models,
  };
};

let catalogState = normalizeCatalog(imageModelCatalog as ImageModelCatalogShape);
let pendingLoad: Promise<ImageModelCatalogShape> | null = null;
const listeners = new Set<() => void>();

const emitCatalogChange = () => {
  listeners.forEach((listener) => listener());
};

const setCatalogState = (nextCatalog: Partial<ImageModelCatalogShape>) => {
  catalogState = normalizeCatalog(nextCatalog);
  emitCatalogChange();
  return catalogState;
};

export const getImageModelCatalogSnapshot = (): ImageModelCatalogShape => catalogState;

export const subscribeImageModelCatalog = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const refreshImageModelCatalog = async (): Promise<ImageModelCatalogShape> => {
  if (typeof window === 'undefined') {
    return catalogState;
  }

  const response = await fetch(`${cleanUrl(API_BASE_URL)}/image-models/catalog`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = (await response.json().catch(() => ({}))) as ImageModelCatalogShape & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load image model catalog');
  }

  return setCatalogState(data);
};

export const ensureImageModelCatalogLoaded = async (): Promise<ImageModelCatalogShape> => {
  if (typeof window === 'undefined') {
    return catalogState;
  }

  if (!pendingLoad) {
    pendingLoad = refreshImageModelCatalog().finally(() => {
      pendingLoad = null;
    });
  }

  return pendingLoad;
};

export const IMAGE_MODELS = (): ImageModelConfig[] => catalogState.models;
export const DEFAULT_IMAGE_MODEL_ID = () => catalogState.defaultModelId;

export const getImageModelById = (modelId?: string): ImageModelConfig => {
  return (
    IMAGE_MODELS().find((model) => model.id === modelId) ||
    IMAGE_MODELS().find((model) => model.id === DEFAULT_IMAGE_MODEL_ID()) ||
    IMAGE_MODELS()[0]
  );
};

export const getImageModelOptions = () => IMAGE_MODELS();

export const getImageModelSizeOptions = (modelId?: string): string[] => {
  const model = getImageModelById(modelId);
  return model.sizeOptions?.length ? model.sizeOptions : [model.defaultSize || '1k'];
};

export const getDefaultImageSizeForModel = (modelId?: string): string => {
  const model = getImageModelById(modelId);
  const sizeOptions = getImageModelSizeOptions(model.id);
  return (
    (model.defaultSize && sizeOptions.includes(model.defaultSize) && model.defaultSize) ||
    sizeOptions[0] ||
    '1k'
  );
};

export const getNormalizedImageSizeForModel = (
  modelId: string | undefined,
  currentSize?: string,
): string => {
  const normalized = String(currentSize || '').trim().toLowerCase();
  const options = getImageModelSizeOptions(modelId);
  return options.includes(normalized)
    ? normalized
    : getDefaultImageSizeForModel(modelId);
};

export const shouldShowImageSizeSelector = (modelId?: string) =>
  getImageModelById(modelId).showSizeSelector !== false;

export const getImageModelExtraAspectRatios = (modelId?: string) =>
  getImageModelById(modelId).extraAspectRatios || [];

export const getImageModelRequestName = (modelId?: string) => {
  const model = getImageModelById(modelId);
  return model.requestModel || model.id;
};

export const getImageModelEffectiveRequestSize = ({
  modelId,
  imageSize,
  aspectRatio,
}: {
  modelId?: string;
  imageSize?: string;
  aspectRatio?: string;
}) => {
  const model = getImageModelById(modelId);
  const size = getNormalizedImageSizeForModel(model.id, imageSize);
  const ratio = String(aspectRatio || '1:1').trim() || '1:1';

  switch (model.sizeBehavior) {
    case 'doubao-v5': {
      let normalizedSize = size;
      if (normalizedSize === '1k') normalizedSize = '2k';
      if (normalizedSize === '4k') normalizedSize = '3k';
      if (!['2k', '3k'].includes(normalizedSize)) normalizedSize = '2k';
      return getDoubaoSize(model.id, normalizedSize, ratio);
    }
    case 'doubao-v45': {
      let normalizedSize = size;
      if (normalizedSize === '1k') normalizedSize = '2k';
      if (normalizedSize === '3k') normalizedSize = '2k';
      if (!['2k', '4k'].includes(normalizedSize)) normalizedSize = '2k';
      return getDoubaoSize(model.id, normalizedSize, ratio);
    }
    case 'z-image-turbo':
      return getDoubaoSize(model.id, '1k', ratio);
    case 'passthrough':
    default:
      return size;
  }
};
