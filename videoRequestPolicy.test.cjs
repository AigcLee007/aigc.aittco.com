const assert = require('assert');
const fs = require('fs');
const catalog = require('./config/pixelhubVideoCatalog.json');
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');

const model = (id = 'gemini-omni-1.1-flash') => catalog.models.find((item) => item.id === id);
const request = (body, modelId = 'gemini-omni-1.1-flash') => normalizePixelHubVideoRequest({
  body,
  model: model(modelId),
  upstreamModel: model(modelId)?.requestModel,
});
const valid = (overrides = {}) => ({
  prompt: 'cinematic transition',
  aspectRatio: '16:9',
  resolution: '720p',
  duration: 5,
  referenceImages: [],
  referenceVideos: [],
  ...overrides,
});

describe('normalizePixelHubVideoRequest', () => {
  it('keeps validation before reservation and refunds failed generation requests', () => {
    const source = fs.readFileSync('./server.cjs', 'utf8');
    const endpointStart = source.indexOf('app.post("/api/video/generate"');
    const endpointEnd = source.indexOf('// ==================== Video Task Polling', endpointStart);
    const endpoint = source.slice(endpointStart, endpointEnd);
    assert.ok(endpoint.indexOf('materializeVideoReferenceMedia(') < endpoint.indexOf('normalizePixelHubVideoRequest('));
    assert.ok(endpoint.indexOf('normalizePixelHubVideoRequest(') < endpoint.indexOf('reservePoints('));
    assert.ok(endpoint.includes('route.routeFamily !== requestedVideoModel.routeFamily'));
    assert.ok(endpoint.indexOf('refundPoints(') > endpoint.indexOf('catch (error)'));
  });

  it('maps ordered first and last frames plus one reference video to RollDek', () => {
    const result = request({
      prompt: 'cinematic transition',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 5,
      referenceImages: ['https://app.test/first.jpg', 'https://app.test/last.jpg'],
      referenceVideos: ['https://app.test/reference.mp4'],
    });
    assert.strictEqual(result.pointCost, 20);
    assert.deepStrictEqual(result.upstreamBody, {
      model: 'gemini-omni-1.1-flash',
      prompt: 'cinematic transition',
      first_frame_url: 'https://app.test/first.jpg',
      last_frame_url: 'https://app.test/last.jpg',
      videos: ['https://app.test/reference.mp4'],
      aspect_ratio: '16:9',
      duration: 5,
      resolution: '720p',
      generateAudio: true,
      n: 1,
    });
    for (const field of ['images', 'image_urls', 'video_urls', 'start_frame', 'end_frame', 'audios']) {
      assert.ok(!(field in result.upstreamBody));
    }
  });

  it('maps one image to first_frame_url only and preserves upload order for two images', () => {
    const firstOnly = request(valid({ referenceImages: ['https://app.test/first.jpg'] }));
    assert.strictEqual(firstOnly.upstreamBody.first_frame_url, 'https://app.test/first.jpg');
    assert.ok(!('last_frame_url' in firstOnly.upstreamBody));
    const ordered = request(valid({ referenceImages: ['https://app.test/one.jpg', 'https://app.test/two.jpg'] }));
    assert.strictEqual(ordered.upstreamBody.first_frame_url, 'https://app.test/one.jpg');
    assert.strictEqual(ordered.upstreamBody.last_frame_url, 'https://app.test/two.jpg');
  });

  it('rejects image, video, total-reference, and duration overflow', () => {
    assert.throws(() => request(valid({ referenceImages: Array.from({ length: 3 }, (_, i) => `https://app.test/${i}.jpg`) })), /image limit/i);
    assert.throws(() => request(valid({ referenceVideos: ['https://app.test/1.mp4', 'https://app.test/2.mp4'] })), /video limit/i);
    assert.throws(() => request(valid({ referenceImages: ['https://app.test/1.jpg', 'https://app.test/2.jpg'], referenceVideos: ['https://app.test/1.mp4', 'https://app.test/2.mp4'] })), /video limit|total reference/i);
    assert.throws(() => request(valid({ duration: 4 })), /duration/i);
  });

  it('rejects invalid references and legacy request fields', () => {
    assert.throws(() => request(valid({ referenceImages: ['http://app.test/insecure.jpg'] })), /https/i);
    assert.throws(() => request(valid({ start_frame: 'https://app.test/legacy' })), /start_frame/i);
    assert.throws(() => request(valid({ quantity: 2 })), /quantity/i);
  });

  it('rejects models outside the active PixelHub target catalog', () => {
    assert.throws(() => normalizePixelHubVideoRequest({
      body: valid(),
      model: { ...model(), id: 'legacy-model', requestModel: 'legacy-model' },
      upstreamModel: 'legacy-model',
    }), /upstream model/i);
  });

  it('exposes an authenticated local content proxy without arbitrary URL forwarding', () => {
    const source = fs.readFileSync('./server.cjs', 'utf8');
    const start = source.indexOf('app.get("/api/video/task/:taskId/content"');
    assert.ok(start >= 0);
    const endpoint = source.slice(start, source.indexOf('// ==================== Shared Prompt Tool Helpers', start));
    assert.ok(endpoint.includes('requireBillingAccount(req)'));
    assert.ok(endpoint.includes('parseVideoTaskToken'));
    assert.ok(endpoint.includes('route.contentPath'));
    assert.ok(endpoint.includes('req.headers.range'));
    assert.ok(!endpoint.includes('req.query.url'));
  });
});
