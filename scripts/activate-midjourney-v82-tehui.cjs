const models = require('../config/imageModels.json');
const routes = require('../config/production-image-routes.json');
const modelStore = require('../imageModelStore.cjs');
const routeStore = require('../imageRouteStore.cjs');
const { closePool, isMySqlConfigured } = require('../db.cjs');

const MODEL_ID = 'midjourney-v8.2-tehui';
const model = models.models.find(item => item.id === MODEL_ID);
const route = routes.routes.find(item => item.id === 'midjourney-v8.2-osodm-tehui');

// Existing rows (including inactive rows) belong to administrators. Never overwrite them.
// The two creates are independently committed; a rerun resumes a partial import.
const activateMidjourney = async ({ apply = false, store = { ...modelStore, ...routeStore } } = {}) => {
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

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: node scripts/activate-midjourney-v82-tehui.cjs [--apply]');
  }
  if (!isMySqlConfigured()) throw new Error('Run inside the app container with its MySQL environment configured');
  const apply = args.includes('--apply');
  if (apply && !String(process.env[route.apiKeyEnv] || '').trim()) {
    throw new Error(`Missing environment variable: ${route.apiKeyEnv}`);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', model, route,
    result: await activateMidjourney({ apply }) }, null, 2));
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => closePool());
}

module.exports = { activateMidjourney };
