const VISION_ROUTE_IDS = new Set(['nano-banana-pro-line4', 'nano-banana-pro-backup']);
const VISIONARY_BASE_URL = 'https://api.visionary.beer';
const VISIONARY_GENERATE_PATH = '/v1/images/generations';
const VISIONARY_TASK_PATH = '/v1/tasks/{taskId}';

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
  VISIONARY_BASE_URL,
  VISIONARY_GENERATE_PATH,
  VISIONARY_TASK_PATH,
  VISION_ROUTE_IDS,
};
