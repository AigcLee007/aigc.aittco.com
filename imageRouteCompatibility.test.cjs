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
});
