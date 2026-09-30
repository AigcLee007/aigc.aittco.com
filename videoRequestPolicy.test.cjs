const assert = require('assert');
const nodeTest = require('node:test');
const describe = globalThis.describe || nodeTest.describe;
const it = globalThis.it || nodeTest.it;
const fs = require('fs');
const catalog = require('./config/pixelhubVideoCatalog.json');
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');

const model = (id = 'gemini-omni-1.1-flash') => catalog.models.find((item) => item.id === id);
const request = (body, modelId = 'gemini-omni-1.1-flash') => normalizePixelHubVideoRequest({
  body,
  model: model(modelId),
  upstreamModel: model(modelId)?.requestModel,
});
const omniRequest = (body) => normalizePixelHubVideoRequest({
  body,
  model: model('omni_flash-10s'),
  upstreamModel: 'omni_flash-10s',
  transport: 'openai-video',
  route: { transport: 'openai-video', id: 'omni_flash-10s-mouxihub' },
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

describe('Gemini Omni Flash 10s Mouxihub contract', () => {
  const base = (overrides = {}) => ({
    prompt: 'a red paper airplane crosses a blue sky',
    aspectRatio: '16:9',
    resolution: '720p',
    duration: 10,
    referenceImages: [],
    referenceVideos: [],
    generationMode: 'text',
    ...overrides,
  });

  it('maps text to video with fixed provider fields and size', () => {
    const result = omniRequest(base());
    assert.deepStrictEqual(result.upstreamBody, {
      model: 'omni_flash-10s',
      prompt: 'a red paper airplane crosses a blue sky',
      images: [],
      videos: [],
      aspect_ratio: '16:9',
      size: '1280x720',
      resolution: '720p',
      duration: 10,
      generateAudio: true,
      n: 1,
    });
    assert.strictEqual(result.pointCost, 20);
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'contentPath'));
  });

  it('maps image, reference, first/last, and video reference inputs without reordering', () => {
    const image = omniRequest(base({ generationMode: 'image', referenceImages: ['https://app.test/one.jpg'] }));
    assert.deepStrictEqual(image.upstreamBody.images, ['https://app.test/one.jpg']);

    const reference = omniRequest(base({ generationMode: 'reference', referenceImages: ['https://app.test/one.jpg', 'https://app.test/two.jpg'] }));
    assert.deepStrictEqual(reference.upstreamBody.images, ['https://app.test/one.jpg', 'https://app.test/two.jpg']);

    const frames = omniRequest(base({
      generationMode: 'first_last',
      referenceImages: ['https://app.test/first.jpg', 'https://app.test/last.jpg'],
    }));
    assert.deepStrictEqual(frames.upstreamBody.images, ['https://app.test/first.jpg', 'https://app.test/last.jpg']);
    assert.strictEqual(frames.upstreamBody.first_frame_url, 'https://app.test/first.jpg');
    assert.strictEqual(frames.upstreamBody.last_frame_url, 'https://app.test/last.jpg');

    const video = omniRequest(base({ referenceVideos: ['https://app.test/reference.mp4'] }));
    assert.deepStrictEqual(video.upstreamBody.videos, ['https://app.test/reference.mp4']);

    const mixed = omniRequest(base({
      generationMode: 'first_last',
      referenceImages: ['https://app.test/first.jpg', 'https://app.test/last.jpg'],
      referenceVideos: ['https://app.test/reference.mp4'],
    }));
    assert.deepStrictEqual(mixed.upstreamBody.videos, ['https://app.test/reference.mp4']);
  });

  it('supports both ratios and automatically derives the provider size', () => {
    assert.strictEqual(omniRequest(base({ aspectRatio: '16:9' })).upstreamBody.size, '1280x720');
    assert.strictEqual(omniRequest(base({ aspectRatio: '9:16' })).upstreamBody.size, '720x1280');
  });

  it('enforces Omni references, duration, resolution, quantity, and https URLs', () => {
    assert.doesNotThrow(() => omniRequest(base({ referenceImages: Array.from({ length: 7 }, (_, i) => `https://app.test/${i}.jpg`) })));
    assert.throws(() => omniRequest(base({ referenceImages: Array.from({ length: 8 }, (_, i) => `https://app.test/${i}.jpg`) })), /image limit/i);
    assert.throws(() => omniRequest(base({ referenceVideos: ['https://app.test/1.mp4', 'https://app.test/2.mp4'] })), /video limit/i);
    assert.throws(() => omniRequest(base({ referenceImages: Array.from({ length: 7 }, (_, i) => `https://app.test/${i}.jpg`), referenceVideos: ['https://app.test/ref.mp4'] })), /total reference/i);
    assert.throws(() => omniRequest(base({ duration: 3 })), /duration/i);
    assert.doesNotThrow(() => omniRequest(base({ duration: 10 })));
    assert.throws(() => omniRequest(base({ resolution: '1080p' })), /resolution/i);
    assert.throws(() => omniRequest(base({ aspectRatio: '1:1' })), /aspect ratio/i);
    assert.throws(() => omniRequest(base({ quantity: 2 })), /quantity/i);
    assert.throws(() => omniRequest(base({ referenceImages: ['http://app.test/insecure.jpg'] })), /https/i);
  });

  it('rejects unsupported keyframes and audio controls while keeping audio enabled', () => {
    assert.throws(() => omniRequest(base({ generationMode: 'keyframes', keyframes: [{ image: 'https://app.test/frame.jpg', timestamp_s: 1 }] })), /keyframe|unsupported/i);
    assert.throws(() => omniRequest(base({ audioReference: 'https://app.test/audio.mp3' })), /audio|unsupported/i);
    const result = omniRequest(base({ generateAudio: false }));
    assert.strictEqual(result.upstreamBody.generateAudio, true);
    assert.strictEqual(result.upstreamBody.n, 1);
  });
});
