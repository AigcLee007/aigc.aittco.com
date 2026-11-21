import { getImageModelOptions, getImageModelSizeOptions } from '../config/imageModels';
import { getImageRouteSizeOptions, getImageRoutesByModelFamily, isGeminiNativeImageRoute } from '../config/imageRoutes';
import { shouldUseVisionaryEditUpload } from '../utils/gptImagePayload';
import type { BatchMode } from './batchGenerationTypes';

export function getBatchRoutes(mode: BatchMode, modelId: string, directKeyOnly: boolean) {
  const model = getImageModelOptions().find((item) => item.id === modelId && item.isActive !== false);
  if (!model) return [];
  return getImageRoutesByModelFamily(model.routeFamily).filter((route) =>
    route.isActive !== false &&
    (!directKeyOnly || route.allowUserApiKeyWithoutLogin === true) &&
    (mode === 't2i' || model.id.toLowerCase().startsWith('doubao') || Boolean(route.editPath) || isGeminiNativeImageRoute(route) || shouldUseVisionaryEditUpload(route.id)),
  );
}

export function getBatchSizes(modelId: string, route: ReturnType<typeof getBatchRoutes>[number] | undefined) {
  return getImageRouteSizeOptions(route, getImageModelSizeOptions(modelId));
}
