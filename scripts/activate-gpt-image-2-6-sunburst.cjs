const models = require('../config/imageModels.json');
const routes = require('../config/production-image-routes.json');
const modelStore = require('../imageModelStore.cjs');
const routeStore = require('../imageRouteStore.cjs');
const { closePool, isMySqlConfigured } = require('../db.cjs');

const MODEL_ID = 'gpt-image-2.6-sunburst';
const model = models.models.find(item => item.id === MODEL_ID);
const nativeRoute = routes.routes.find(item => item.id === `${MODEL_ID}-native`);
const mochiaiRoute = routes.routes.find(item => item.id === `${MODEL_ID}-mochiai`);
const animationRoute = routes.routes.find(item => item.id === `${MODEL_ID}-osodm-1k`);

// Existing rows (including inactive rows) belong to administrators. Never overwrite them.
// The two creates are independently committed; a rerun resumes a partial import.
const activateGptImage26 = async ({ apply = false, mochiai = false, animation = false, store = { ...modelStore, ...routeStore } } = {}) => {
  const route = animation ? animationRoute : mochiai ? mochiaiRoute : nativeRoute;
  const existingModel = await store.getImageModelById(model.id, { includeInactive: true });
  const existingRoute = await store.getImageRouteById(route.id, { includeInactive: true });
  const result = {
    model: existingModel ? 'existing' : 'would-create',
    route: existingRoute ? 'existing' : 'would-create',
  };
  if (apply && !existingModel) {
    await store.createManagedImageModel(model);
    result.model = 'created';
  }
  if (apply && !existingRoute) {
    await store.createManagedImageRoute(route);
    result.route = 'created';
  }
  return result;
};

const syncConfiguredMochiaiRoute = async () => {
  if (!isMySqlConfigured() || !String(process.env[mochiaiRoute.apiKeyEnv] || '').trim()) return;
  return activateGptImage26({ apply: true, mochiai: true });
};

const syncConfiguredAnimationRoute = async () => {
  if (!isMySqlConfigured() || !String(process.env[animationRoute.apiKeyEnv] || '').trim()) return;
  return activateGptImage26({ apply: true, animation: true });
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--mochiai', '--animation'].includes(arg)) || (args.includes('--mochiai') && args.includes('--animation'))) {
    throw new Error('Usage: node scripts/activate-gpt-image-2-6-sunburst.cjs [--mochiai | --animation] [--apply]');
  }
  if (!isMySqlConfigured()) throw new Error('Run inside the app container with its MySQL environment configured');
  const apply = args.includes('--apply');
  const mochiai = args.includes('--mochiai');
  const animation = args.includes('--animation');
  const route = animation ? animationRoute : mochiai ? mochiaiRoute : nativeRoute;
  if (apply && !String(process.env[route.apiKeyEnv] || '').trim()) {
    throw new Error(`Missing environment variable: ${route.apiKeyEnv}`);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', model, route,
    result: await activateGptImage26({ apply, mochiai, animation }) }, null, 2));
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => closePool());
}

module.exports = { activateGptImage26, syncConfiguredMochiaiRoute, syncConfiguredAnimationRoute };
