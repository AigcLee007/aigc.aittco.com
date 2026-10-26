const assert = require('assert');
const {
  normalizeImageRouteCompatibility,
  normalizeMouxihubGptImageModelName,
} = require('./imageRouteCompatibility.cjs');

describe('normalizeImageRouteCompatibility', () => {
  it('normalizes the production Visionary backup route to its documented async API contract', () => {
    const route = normalizeImageRouteCompatibility({
      id: 'nano-banana-pro-backup',
      transport: 'openai-image',
      mode: 'sync',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1/images/generations',
      upstreamModel: 'nano-banana-pro',
    });

    assert.strictEqual(route.transport, 'openai-image');
    assert.strictEqual(route.mode, 'async');
    assert.strictEqual(route.baseUrl, 'https://api.visionary.beer');
    assert.strictEqual(route.generatePath, '/v1/images/generations');
    assert.strictEqual(route.taskPath, '/v1/tasks/{taskId}');
    assert.strictEqual(route.upstreamModel, 'nano-banana-pro');
  });

  it('routes the production VISON line through Visionary OpenAPI parsing', () => {
    const route = normalizeImageRouteCompatibility({
      id: 'nano-banana-pro-line4',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1beta/models/{model}:generateContent',
    });

    assert.strictEqual(route.transport, 'openai-image');
    assert.strictEqual(route.mode, 'async');
    assert.strictEqual(route.baseUrl, 'https://api.visionary.beer');
    assert.strictEqual(route.generatePath, '/v1/images/generations');
    assert.strictEqual(route.taskPath, '/v1/tasks/{taskId}');
  });

  it('does not change the Adobe Gemini route', () => {
    const adobe = {
      id: 'nano-banana-pro-线路二',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1beta/models/{model}:generateContent',
    };

    assert.deepStrictEqual(normalizeImageRouteCompatibility(adobe), adobe);
  });

  it('does not change the VISON route id when it targets another provider', () => {
    const route = {
      id: 'nano-banana-pro-line4',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://api.example.com',
      generatePath: '/v1beta/models/{model}:generateContent',
    };

    assert.deepStrictEqual(normalizeImageRouteCompatibility(route), route);
  });

  it('does not change other routes hosted by visionary.beer', () => {
    const route = {
      id: 'nano-banana-pro-line3',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1beta/models/{model}:generateContent',
    };

    assert.deepStrictEqual(normalizeImageRouteCompatibility(route), route);
  });

  it('preserves VISON metadata while normalizing its transport fields', () => {
    const route = {
      id: 'nano-banana-pro-line4',
      transport: 'gemini-native',
      mode: 'async',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1beta/models/{model}:generateContent',
      apiKey: 'secret-key',
      pointCost: 42,
      taskPath: '/v1/tasks/{taskId}',
      isActive: true,
      allowUserApiKeyWithoutLogin: true,
      useRequestModel: true,
    };

    assert.deepStrictEqual(normalizeImageRouteCompatibility(route), {
      ...route,
      baseUrl: 'https://api.visionary.beer',
      transport: 'openai-image',
      mode: 'async',
      generatePath: '/v1/images/generations',
      taskPath: '/v1/tasks/{taskId}',
    });
  });
});

describe('normalizeMouxihubGptImageModelName', () => {
  const route = { baseUrl: 'https://api.mouxihub.com' };

  it('sends the base model when Mouxihub derives the 4K variant from image_size', () => {
    assert.strictEqual(
      normalizeMouxihubGptImageModelName(route, 'gpt-image-2.5-sunburst-4k', { image_size: '4k' }),
      'gpt-image-2.5-sunburst',
    );
  });

  it('sends the base model when Mouxihub derives the 2K variant from image_size', () => {
    assert.strictEqual(
      normalizeMouxihubGptImageModelName(route, 'gpt-image-2.5-sunburst-2k', { image_size: '2k' }),
      'gpt-image-2.5-sunburst',
    );
  });

  it('leaves correctly suffixed models and other providers unchanged', () => {
    assert.strictEqual(
      normalizeMouxihubGptImageModelName(route, 'gpt-image-2.5-sunburst-4k', { image_size: '4k' }),
      'gpt-image-2.5-sunburst',
    );
    assert.strictEqual(
      normalizeMouxihubGptImageModelName(route, 'gpt-image-2.5-sunburst-4k', { image_size: '2k' }),
      'gpt-image-2.5-sunburst-4k',
    );
    assert.strictEqual(
      normalizeMouxihubGptImageModelName({ baseUrl: 'https://api.example.com' }, 'gpt-image-2.5-sunburst-4k-4k', { image_size: '4k' }),
      'gpt-image-2.5-sunburst-4k-4k',
    );
  });
});
