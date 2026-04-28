import type { ImageEditType } from '../utils/imageEditPrompt';
import { formatPoint } from '../utils/pointFormat';
import {
  getDefaultImageSizeForModel,
  getImageModelById,
  getImageModelOptions,
  getImageModelSizeOptions,
  type ImageModelConfig,
} from './imageModels';
import {
  getImageRoutePointCost,
  getImageRoutesByModelFamily,
  type ImageRouteConfig,
} from './imageRoutes';

export type ImageEditModelGroup =
  | 'nano-banana-pro'
  | 'nano-banana-2'
  | 'gpt-image-2';

export interface ImageEditCapability {
  modelId: string;
  routeId: string;
  group: ImageEditModelGroup;
  modelLabel: string;
  routeLabel: string;
  routeLine: string;
  routeMode: 'sync' | 'async';
  sizeOptions: string[];
  defaultSize: string;
  pointCost: number;
  pointCostText: string;
  allowUserApiKeyWithoutLogin: boolean;
  supportsMask: boolean;
  supportsCustomRatio: boolean;
  recommendedFor: ImageEditType[];
  routeDescription: string;
}

const normalizeModelText = (model: Partial<ImageModelConfig> = {}) =>
  [
    model.id,
    model.label,
    model.description,
    model.modelFamily,
    model.routeFamily,
    model.requestModel,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join(' ');

export const getImageEditModelGroup = (
  model: Partial<ImageModelConfig> | undefined,
): ImageEditModelGroup | null => {
  const text = normalizeModelText(model);
  if (!text) return null;

  if (text.includes('gpt-image-2')) {
    return 'gpt-image-2';
  }

  if (
    text.includes('nano banana 2') ||
    text.includes('nano-banana-2') ||
    text.includes('flash-image-preview')
  ) {
    return 'nano-banana-2';
  }

  if (
    text.includes('nano banana pro') ||
    text.includes('nano-banana-pro') ||
    text.includes('gemini-3-pro-image') ||
    text.includes('nano-banana')
  ) {
    return 'nano-banana-pro';
  }

  return null;
};

const getRecommendedEditTypes = (group: ImageEditModelGroup): ImageEditType[] => {
  switch (group) {
    case 'gpt-image-2':
      return ['erase', 'retouch', 'replace'];
    case 'nano-banana-2':
      return ['replace', 'background', 'restyle', 'outpaint'];
    case 'nano-banana-pro':
    default:
      return ['retouch', 'replace', 'background', 'outpaint'];
  }
};

const getRouteDescription = (route: ImageRouteConfig, group: ImageEditModelGroup) => {
  const modeText = route.mode === 'sync' ? '同步返图' : '异步任务';
  const accessText = route.allowUserApiKeyWithoutLogin ? '支持用户 Key' : '登录积分线路';

  if (group === 'gpt-image-2') {
    return `${modeText} · ${accessText} · 适合擦除与快速修图`;
  }
  if (group === 'nano-banana-2') {
    return `${modeText} · ${accessText} · 适合创意替换、多轮尝试和扩图`;
  }
  return `${modeText} · ${accessText} · 适合高质量精修和扩图`;
};

const normalizeSizeOptions = (modelId: string) => {
  const sizeOptions = getImageModelSizeOptions(modelId).filter((value) => value !== 'auto');
  return sizeOptions.length > 0 ? sizeOptions : ['1k'];
};

export const getEditableImageModels = ({
  directKeyOnly = false,
}: {
  directKeyOnly?: boolean;
} = {}) =>
  getImageModelOptions().filter((model) => {
    if (model.isActive === false) return false;
    const group = getImageEditModelGroup(model);
    if (!group) return false;

    return getImageRoutesByModelFamily(model.routeFamily).some((route) => {
      if (route.isActive === false) return false;
      if (!route.editPath) return false;
      return directKeyOnly ? route.allowUserApiKeyWithoutLogin === true : true;
    });
  });

export const getEditableRoutesForModel = (
  modelId: string,
  {
    directKeyOnly = false,
  }: {
    directKeyOnly?: boolean;
  } = {},
): ImageEditCapability[] => {
  const model = getImageModelById(modelId);
  const group = getImageEditModelGroup(model);
  if (!group) return [];

  const sizeOptions = normalizeSizeOptions(model.id);
  const defaultSize =
    sizeOptions.find((value) => value === getDefaultImageSizeForModel(model.id)) ||
    sizeOptions[0] ||
    '1k';

  return getImageRoutesByModelFamily(model.routeFamily)
    .filter((route) => {
      if (route.isActive === false) return false;
      if (!route.editPath) return false;
      return directKeyOnly ? route.allowUserApiKeyWithoutLogin === true : true;
    })
    .map((route) => {
      const pointCost = getImageRoutePointCost(route, defaultSize);
      return {
        modelId: model.id,
        routeId: route.id,
        group,
        modelLabel: model.label,
        routeLabel: route.label || route.line,
        routeLine: route.line,
        routeMode: route.mode,
        sizeOptions,
        defaultSize,
        pointCost,
        pointCostText: formatPoint(pointCost),
        allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
        supportsMask: true,
        supportsCustomRatio: model.supportsCustomRatio !== false,
        recommendedFor: getRecommendedEditTypes(group),
        routeDescription: getRouteDescription(route, group),
      } satisfies ImageEditCapability;
    })
    .sort((left, right) => {
      if (left.pointCost !== right.pointCost) {
        return left.pointCost - right.pointCost;
      }
      if (left.routeMode !== right.routeMode) {
        return left.routeMode === 'sync' ? -1 : 1;
      }
      return left.routeLabel.localeCompare(right.routeLabel);
    });
};

export const getEditableRouteCapability = (
  modelId: string,
  routeId: string,
  {
    directKeyOnly = false,
  }: {
    directKeyOnly?: boolean;
  } = {},
) =>
  getEditableRoutesForModel(modelId, { directKeyOnly }).find(
    (item) => item.routeId === routeId,
  ) || null;
