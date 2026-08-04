const VISION_ROUTE_ID = 'nano-banana-pro-line4';
const VISIONARY_GENERATE_PATH = '/openapi/v1/images/generations';

const normalizeImageRouteCompatibility = (route = {}) => {
  const isProductionVisionRoute =
    String(route.id || '').trim() === VISION_ROUTE_ID &&
    String(route.baseUrl || '').toLowerCase().includes('visionary.beer');

  if (!isProductionVisionRoute) return route;

  return {
    ...route,
    transport: 'openai-image',
    mode: 'sync',
    generatePath: VISIONARY_GENERATE_PATH,
  };
};

module.exports = {
  normalizeImageRouteCompatibility,
  VISIONARY_GENERATE_PATH,
  VISION_ROUTE_ID,
};
