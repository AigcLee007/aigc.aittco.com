const assert = require('node:assert/strict');
const { activateGptImage26 } = require('./activate-gpt-image-2-6-sunburst.cjs');

describe('GPT Image 2.6 additive activation', () => {
  function store() {
    const models = new Map([['existing-model', { id: 'existing-model' }]]);
    const routes = new Map([['existing-route', { id: 'existing-route', pointCost: 99 }]]);
    return {
      models, routes,
      getImageModelById: async id => models.get(id),
      getImageRouteById: async id => routes.get(id),
      createManagedImageModel: async value => { models.set(value.id, structuredClone(value)); },
      createManagedImageRoute: async value => { routes.set(value.id, structuredClone(value)); },
    };
  }

  it('previews without writes and applies only the missing model and route', async () => {
    const state = store();
    const preview = await activateGptImage26({ store: state });
    assert.deepEqual(preview, { model: 'would-create', route: 'would-create' });
    assert.equal(state.models.size, 1);
    assert.equal(state.routes.size, 1);
    assert.deepEqual(await activateGptImage26({ apply: true, store: state }), { model: 'created', route: 'created' });
    assert.equal(state.models.size, 2);
    assert.equal(state.routes.size, 2);
    assert.equal(state.routes.get('existing-route').pointCost, 99);
    assert.equal(state.routes.get('gpt-image-2.6-sunburst-native').sizeOverrides['2k'].pointCost, 4.5);
  });

  it('preserves administrator changes and resumes a partially completed import', async () => {
    const state = store();
    state.models.set('gpt-image-2.6-sunburst', { id: 'gpt-image-2.6-sunburst', isActive: false });
    assert.deepEqual(await activateGptImage26({ apply: true, store: state }), { model: 'existing', route: 'created' });
    const route = state.routes.get('gpt-image-2.6-sunburst-native');
    route.pointCost = 77;
    route.isActive = false;
    assert.deepEqual(await activateGptImage26({ apply: true, store: state }), { model: 'existing', route: 'existing' });
    assert.equal(state.models.get('gpt-image-2.6-sunburst').isActive, false);
    assert.equal(state.routes.get(route.id).pointCost, 77);
    assert.equal(state.routes.get(route.id).isActive, false);
    await activateGptImage26({ apply: true, animation: true, store: state });
    const animation = state.routes.get('gpt-image-2.6-sunburst-osodm-1k');
    assert.equal(animation.apiKeyEnv, 'GPT-image-2.6-sunburst_osodm-1k');
    assert.equal(animation.pointCost, 2);
    animation.pointCost = 9;
    await activateGptImage26({ apply: true, animation: true, store: state });
    assert.equal(state.routes.get(animation.id).pointCost, 9);
  });

  it('can import only the MochiAI route and preserves it on reruns', async () => {
    const state = store();
    await activateGptImage26({ apply: true, store: state });
    const options = { mochiai: true, store: state };
    assert.deepEqual(await activateGptImage26(options), { model: 'existing', route: 'would-create' });
    assert.equal(state.routes.size, 2);
    assert.deepEqual(await activateGptImage26({ ...options, apply: true }), { model: 'existing', route: 'created' });
    const route = state.routes.get('gpt-image-2.6-sunburst-mochiai');
    assert.equal(route.apiKeyEnv, 'GPT-image-2.6-sunburst_mochiai');
    route.isActive = false;
    assert.deepEqual(await activateGptImage26({ ...options, apply: true }), { model: 'existing', route: 'existing' });
    assert.equal(state.routes.get(route.id).isActive, false);
  });
});
