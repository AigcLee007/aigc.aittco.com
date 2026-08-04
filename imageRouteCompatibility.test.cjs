const assert = require('assert');
const {
  normalizeImageRouteCompatibility,
} = require('./imageRouteCompatibility.cjs');

describe('normalizeImageRouteCompatibility', () => {
  it('routes the production VISON line through Visionary OpenAPI parsing', () => {
    const route = normalizeImageRouteCompatibility({
      id: 'nano-banana-pro-line4',
      transport: 'gemini-native',
      mode: 'sync',
      baseUrl: 'https://visionary.beer',
      generatePath: '/v1beta/models/{model}:generateContent',
    });

    assert.strictEqual(route.transport, 'openai-image');
    assert.strictEqual(route.mode, 'sync');
    assert.strictEqual(route.generatePath, '/openapi/v1/images/generations');
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
      transport: 'openai-image',
      mode: 'sync',
      generatePath: '/openapi/v1/images/generations',
    });
  });
});
