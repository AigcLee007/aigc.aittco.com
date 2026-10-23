const VISION_ROUTE_IDS = new Set(['nano-banana-pro-line4', 'nano-banana-pro-backup']);
const VISIONARY_GENERATE_PATH = '/openapi/v1/images/generations';

const normalizeImageRouteCompatibility = (route = {}) => {
  const isProductionVisionRoute =
    VISION_ROUTE_IDS.has(String(route.id || '').trim()) &&
    String(route.baseUrl || '').toLowerCase().includes('visionary.beer');

  if (!isProductionVisionRoute) return route;

  return {
    ...route,
    transport: 'openai-image',
    mode: 'sync',
    generatePath: VISIONARY_GENERATE_PATH,
    ...(String(route.id || '').trim() === 'nano-banana-pro-backup'
      ? { upstreamModel: 'Nano_Banana_Pro' }
      : {}),
  };
};

module.exports = {
  normalizeImageRouteCompatibility,
  VISIONARY_GENERATE_PATH,
  VISION_ROUTE_IDS,
};
