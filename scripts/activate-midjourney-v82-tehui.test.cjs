const assert = require('node:assert/strict');
const { activateMidjourney } = require('./activate-midjourney-v82-tehui.cjs');

describe('Midjourney additive activation', () => {
  it('previews without writes, imports only missing rows and preserves administrator changes', async () => {
    const models = new Map(), routes = new Map();
    const store = {
      getImageModelById: async id => models.get(id), getImageRouteById: async id => routes.get(id),
      createManagedImageModel: async value => models.set(value.id, structuredClone(value)),
      updateManagedImageModel: async (id, patch) => Object.assign(models.get(id), patch),
      createManagedImageRoute: async value => routes.set(value.id, structuredClone(value)),
    };
    assert.deepEqual(await activateMidjourney({ store }), { model: 'would-create', route: 'would-create' });
    assert.equal(models.size + routes.size, 0);
    assert.deepEqual(await activateMidjourney({ apply: true, store }), { model: 'created', route: 'created' });
    assert.equal(models.get('midjourney-v8.2-tehui').requestModel, 'Midjourney v8.2-特惠');
    const route = routes.get('midjourney-v8.2-osodm-tehui');
    assert.equal(route.pointCost, 8);
    assert.equal(route.apiKeyEnv, 'Midjourney-v8.2-osodm-tehui');
    route.pointCost = 99; route.isActive = false;
    assert.deepEqual(await activateMidjourney({ apply: true, store }), { model: 'existing', route: 'existing' });
    assert.equal(route.pointCost, 99); assert.equal(route.isActive, false);
    const model = models.get('midjourney-v8.2-tehui');
    model.label = 'Midjourney v8.2-特惠'; model.isActive = false;
    assert.deepEqual(await activateMidjourney({ apply: true, store }), { model: 'renamed', route: 'existing' });
    assert.equal(model.label, 'Midjourney v8.2'); assert.equal(model.isActive, false);
    model.label = '自定义名称';
    assert.deepEqual(await activateMidjourney({ apply: true, store }), { model: 'existing', route: 'existing' });
    assert.equal(model.label, '自定义名称');
  });
});
