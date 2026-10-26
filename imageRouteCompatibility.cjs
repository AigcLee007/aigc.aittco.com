const VISION_ROUTE_IDS = new Set(['nano-banana-pro-line4', 'nano-banana-pro-backup']);
const VISIONARY_BASE_URL = 'https://api.visionary.beer';
const VISIONARY_GENERATE_PATH = '/v1/images/generations';
const VISIONARY_TASK_PATH = '/v1/tasks/{taskId}';

const normalizeMouxihubGptImageModelName = (route = {}, modelName = '', requestBody = {}) => {
  let host = '';
  try {
    host = new URL(String(route.baseUrl || '')).hostname.toLowerCase();
  } catch (_) {}
  if (host !== 'api.mouxihub.com') return modelName;

  const model = String(modelName || '').trim();
  if (!/^gpt-image-2\.5(?:-|$)/i.test(model)) return modelName;

  const requestedSize = String(
    requestBody.image_size ||
      requestBody.imageSize ||
      requestBody.size ||
      requestBody.generationConfig?.imageConfig?.imageSize ||
      requestBody.generationConfig?.image_config?.image_size ||
      '',
  ).trim().toLowerCase();
  if (!['1k', '2k', '4k'].includes(requestedSize)) return modelName;

  const sizeSuffix = new RegExp(`(?:-${requestedSize})+$`, 'i');
  return sizeSuffix.test(model) ? model.replace(sizeSuffix, '') : modelName;
};

const normalizeImageRouteCompatibility = (route = {}) => {
  const isProductionVisionRoute =
    VISION_ROUTE_IDS.has(String(route.id || '').trim()) &&
    String(route.baseUrl || '').toLowerCase().includes('visionary.beer');

  if (!isProductionVisionRoute) return route;

  return {
    ...route,
    baseUrl: VISIONARY_BASE_URL,
    transport: 'openai-image',
    mode: 'async',
    generatePath: VISIONARY_GENERATE_PATH,
    taskPath: VISIONARY_TASK_PATH,
    ...(String(route.id || '').trim() === 'nano-banana-pro-backup'
      ? { upstreamModel: 'nano-banana-pro' }
      : {}),
  };
};

module.exports = {
  normalizeImageRouteCompatibility,
  normalizeMouxihubGptImageModelName,
  VISIONARY_BASE_URL,
  VISIONARY_GENERATE_PATH,
  VISIONARY_TASK_PATH,
  VISION_ROUTE_IDS,
};
