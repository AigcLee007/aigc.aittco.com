const models = require('../config/imageModels.json');
const routes = require('../config/production-image-routes.json');
const modelStore = require('../imageModelStore.cjs');
const routeStore = require('../imageRouteStore.cjs');
const { MODEL_ID, DISCOUNT_ROUTE_ID } = require('../midjourneyImagePolicy.cjs');
const { closePool, isMySqlConfigured } = require('../db.cjs');

const model = models.models.find(item => item.id === MODEL_ID);
const stableRoute = routes.routes.find(item => item.id === 'midjourney-v8.2-osodm-wending');

const changedFields = (current, target) => Object.fromEntries(
  Object.entries(target).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)),
);

const activateMidjourney = async ({ apply = false, store = { ...modelStore, ...routeStore } } = {}) => {
  const existingModel = await store.getImageModelById(model.id, { includeInactive: true });
  const existingStable = await store.getImageRouteById(stableRoute.id, { includeInactive: true });
  const existingDiscount = await store.getImageRouteById(DISCOUNT_ROUTE_ID, { includeInactive: true });

  const modelChanges = existingModel ? changedFields(existingModel, {
    ...(existingModel.label === 'Midjourney v8.2-特惠' ? { label: model.label } : {}),
    requestModel: model.requestModel, description: model.description, selectorCost: model.selectorCost,
    defaultSize: model.defaultSize, sizeOptions: model.sizeOptions, showSizeSelector: model.showSizeSelector,
  }) : {};
  const stableChanges = existingStable ? changedFields(existingStable, {
    upstreamModel: stableRoute.upstreamModel, pointCost: stableRoute.pointCost,
    supportedQualities: stableRoute.supportedQualities, sizeOverrides: {},
    isActive: true, isDefaultRoute: true,
  }) : {};
  const retireDiscount = existingDiscount && (existingDiscount.isActive !== false || existingDiscount.isDefaultRoute === true);
  const result = {
    model: !existingModel ? 'create' : Object.keys(modelChanges).length ? 'update' : 'unchanged',
    stable: !existingStable ? 'create' : Object.keys(stableChanges).length ? 'update' : 'unchanged',
    discount: retireDiscount ? 'retire' : 'unchanged',
  };

  if (apply) {
    // Prepare the replacement first. Retain the old route row and credentials for polling.
    if (result.model === 'create') await store.createManagedImageModel(model);
    if (result.model === 'update') await store.updateManagedImageModel(model.id, modelChanges);
    if (result.stable === 'create') await store.createManagedImageRoute(stableRoute);
    if (result.stable === 'update') await store.updateManagedImageRoute(stableRoute.id, stableChanges);
    if (retireDiscount) {
      await store.updateManagedImageRoute(DISCOUNT_ROUTE_ID, { isActive: false, isDefaultRoute: false });
    }
  }
  return result;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && arg !== '--stable')) {
    throw new Error('Usage: node scripts/activate-midjourney-v82-tehui.cjs [--apply]');
  }
  if (!isMySqlConfigured()) throw new Error('Run inside the app container with its MySQL environment configured');
  const apply = args.includes('--apply');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', result: await activateMidjourney({ apply }) }));
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => closePool());
}

module.exports = { activateMidjourney };
