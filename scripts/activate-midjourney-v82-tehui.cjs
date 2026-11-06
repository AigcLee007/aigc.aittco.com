const models = require('../config/imageModels.json');
const routes = require('../config/production-image-routes.json');
const modelStore = require('../imageModelStore.cjs');
const routeStore = require('../imageRouteStore.cjs');
const { closePool, isMySqlConfigured } = require('../db.cjs');

const MODEL_ID = 'midjourney-v8.2-tehui';
const model = models.models.find(item => item.id === MODEL_ID);
const discountRoute = routes.routes.find(item => item.id === 'midjourney-v8.2-osodm-tehui');
const stableRoute = routes.routes.find(item => item.id === 'midjourney-v8.2-osodm-wending');

// Preserve administrator settings; migrate only the original default display name.
// The two creates are independently committed; a rerun resumes a partial import.
const activateMidjourney = async ({ apply = false, stable = false, store = { ...modelStore, ...routeStore } } = {}) => {
  const route = stable ? stableRoute : discountRoute;
  const existingModel = await store.getImageModelById(model.id, { includeInactive: true });
  const existingRoute = await store.getImageRouteById(route.id, { includeInactive: true });
  const result = {
    model: existingModel ? 'existing' : 'would-create',
    route: existingRoute ? 'existing' : 'would-create',
  };
  if (apply && !existingModel) {
    await store.createManagedImageModel(model);
    result.model = 'created';
  } else if (apply && existingModel?.label === 'Midjourney v8.2-特惠') {
    await store.updateManagedImageModel(model.id, { label: model.label });
    result.model = 'renamed';
  }
  if (apply && !existingRoute) {
    await store.createManagedImageRoute(route);
    result.route = 'created';
  }
  return result;
};

const syncConfiguredStableMidjourneyRoute = async () => {
  if (!isMySqlConfigured() || !String(process.env[stableRoute.apiKeyEnv] || '').trim()) return;
  return activateMidjourney({ apply: true, stable: true });
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && arg !== '--stable')) {
    throw new Error('Usage: node scripts/activate-midjourney-v82-tehui.cjs [--stable] [--apply]');
  }
  if (!isMySqlConfigured()) throw new Error('Run inside the app container with its MySQL environment configured');
  const apply = args.includes('--apply');
  const stable = args.includes('--stable');
  const route = stable ? stableRoute : discountRoute;
  if (apply && !String(process.env[route.apiKeyEnv] || '').trim()) {
    throw new Error(`Missing environment variable: ${route.apiKeyEnv}`);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', model, route,
    result: await activateMidjourney({ apply, stable }) }, null, 2));
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => closePool());
}

module.exports = { activateMidjourney, syncConfiguredStableMidjourneyRoute };
