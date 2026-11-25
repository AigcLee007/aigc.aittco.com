const assert = require('node:assert/strict');
const { activateMidjourney } = require('./activate-midjourney-v82-tehui.cjs');

describe('Midjourney full-series migration', () => {
  it('previews safely, migrates both live routes, and preserves credentials and history', async () => {
    const model = { id: 'midjourney-v8.2-tehui', label: '自定义名称', requestModel: 'Midjourney v8.2-特惠', selectorCost: 8 };
    const discount = { id: 'midjourney-v8.2-osodm-tehui', isActive: true, isDefaultRoute: true, pointCost: 8, apiKey: 'discount-key', taskPath: '/old-tasks/{taskId}' };
    const stable = { id: 'midjourney-v8.2-osodm-wending', isActive: true, isDefaultRoute: false, pointCost: 16, apiKey: 'stable-key', upstreamModel: 'mj-v8.2' };
    const routes = new Map([[discount.id, discount], [stable.id, stable]]);
    const updatedRoutes = [];
    const store = {
      getImageModelById: async () => model,
      getImageRouteById: async id => routes.get(id),
      updateManagedImageModel: async (_id, patch) => Object.assign(model, patch),
      updateManagedImageRoute: async (id, patch) => {
        updatedRoutes.push(id);
        Object.assign(routes.get(id), patch);
      },
    };

    const expected = { model: 'update', stable: 'update', discount: 'retire' };
    assert.deepEqual(await activateMidjourney({ store }), expected);
    assert.equal(discount.isActive, true);
    assert.equal(stable.upstreamModel, 'mj-v8.2');
    assert.deepEqual(updatedRoutes, []);

    assert.deepEqual(await activateMidjourney({ apply: true, store }), expected);
    assert.deepEqual(updatedRoutes, [stable.id, discount.id]);
    assert.equal(model.label, '自定义名称');
    assert.equal(model.selectorCost, 16);
    assert.equal(model.showSizeSelector, false);
    assert.equal(stable.pointCost, 16);
    assert.equal(stable.isDefaultRoute, true);
    assert.equal(stable.upstreamModel, 'Midjourney-全系列');
    assert.equal(stable.apiKey, 'stable-key');
    assert.equal(discount.isActive, false);
    assert.equal(discount.isDefaultRoute, false);
    assert.equal(discount.pointCost, 8);
    assert.equal(discount.apiKey, 'discount-key');
    assert.equal(discount.taskPath, '/old-tasks/{taskId}');

    assert.deepEqual(await activateMidjourney({ apply: true, store }), { model: 'unchanged', stable: 'unchanged', discount: 'unchanged' });
    assert.deepEqual(updatedRoutes, [stable.id, discount.id]);
  });
});
