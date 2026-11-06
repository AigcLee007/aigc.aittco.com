const assert = require('node:assert/strict');
const { isMidjourneyImageRoute, normalizeMidjourneyImageRequest, normalizeMidjourneyImageTask } = require('./midjourneyImagePolicy.cjs');

describe('OSODM Midjourney image contract', () => {
  it('recognizes only the Midjourney route family', () => {
    assert.equal(isMidjourneyImageRoute({ modelFamily: 'midjourney-v8.2-tehui' }), true);
    assert.equal(isMidjourneyImageRoute({ modelFamily: 'gpt-image-2' }), false);
  });
  it('maps the requested size to hd while sending the ratio and a fixed n=1', () => {
    assert.deepEqual(normalizeMidjourneyImageRequest({ prompt: 'a pavilion', size: '2k', aspect_ratio: '16:9', quality: '2', n: 1, image: 'data:image/png;base64,YQ==', routeId: 'private' }), {
      model: 'Midjourney v8.2-特惠', prompt: 'a pavilion', size: '16:9', hd: true,
      quality: '2', n: 1, stream: false, response_format: 'url', image: 'data:image/png;base64,YQ==',
    });
    assert.equal(normalizeMidjourneyImageRequest({ prompt: 'x', size: '1k', aspect_ratio: '4:5' }).hd, false);
    assert.equal(normalizeMidjourneyImageRequest({ prompt: 'x', size: '1:1' }).quality, '1');
  });
  it('rejects unsupported count, ratios, size, quality, mask and reference count', () => {
    for (const patch of [{ n: 4 }, { aspect_ratio: '9:21' }, { size: '4k' }, { quality: 'max' }, { mask: 'mask' }, { images: ['https://a.test/1.png', 'https://a.test/2.png'] }]) {
      assert.throws(() => normalizeMidjourneyImageRequest({ prompt: 'x', ...patch }), error => error.status === 400);
    }
  });
  it('uses the configured upstream model for stable generation', () => {
    const body = { prompt: 'a pavilion', model: 'Midjourney v8.2-特惠' };
    assert.equal(normalizeMidjourneyImageRequest(body, { upstreamModel: 'mj-v8.2' }).model, 'mj-v8.2');
  });
  it('returns all four result.data images and excludes the composite preview', () => {
    const data = Array.from({ length: 4 }, (_, i) => ({ url: `https://images.test/${i}.png` }));
    const result = normalizeMidjourneyImageTask({ task_id: 'mj-1', status: 'SUCCESS', progress: '100%', image_url: 'https://images.test/grid.png', result: { data, url: 'https://images.test/grid.png' } });
    assert.deepEqual(result.data, data);
    assert.equal(JSON.stringify(result).includes('grid.png'), false);
    assert.equal(result.task_id, 'mj-1');
    assert.equal(result.status, 'SUCCESS');
  });
  it('preserves progress and failure details for existing task recovery/refunds', () => {
    assert.equal(normalizeMidjourneyImageTask({ task_id: 'mj-1', status: 'PROCESSING', progress: '35%' }).progress, '35%');
    assert.equal(normalizeMidjourneyImageTask({ task_id: 'mj-1', status: 'FAILED', error: 'provider failed' }).error, 'provider failed');
  });
});
