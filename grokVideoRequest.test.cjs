const assert = require('assert');
const nodeTest = require('node:test');
const describe = globalThis.describe || nodeTest.describe;
const it = globalThis.it || nodeTest.it;
const modelCatalog = require('./config/videoModels.json');
const routeCatalog = require('./config/videoRoutes.json');
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');
const { materializeVideoReferenceMedia } = require('./videoReferenceMedia.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const serverSource = fs.readFileSync('./server.cjs', 'utf8');

const model = modelCatalog.models.find((item) => item.id === 'grok-imagine-video-1.5');
const route = routeCatalog.routes.find((item) => item.id === 'grok-imagine-video-1.5-mouxihub');
const request = (body) => normalizePixelHubVideoRequest({ body, model, upstreamModel: route.upstreamModel, transport: route.transport, route });
const base = (overrides = {}) => ({ aspectRatio: '16:9', resolution: '480p', duration: 8, generationMode: 'text', ...overrides });

describe('Grok Imagine Video 1.5 Mouxihub contract', () => {
  it('exposes an active model and backend-only route', () => {
    assert.strictEqual(model.label, 'Grok Imagine Video 1.5');
    assert.strictEqual(route.transport, 'mouxihub-video');
    assert.strictEqual(route.baseUrl, 'https://api.mouxihub.com');
    assert.strictEqual(route.apiKeyEnv, 'MOUXIHUB_GROK_VIDEO_API_KEY');
    assert.strictEqual(route.allowUserApiKeyWithoutLogin, false);
  });
  it('materializes browser image data URLs before policy conversion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-media-'));
    const req = { protocol: 'https', get: (name) => name === 'host' ? 'app.test' : '' };
    const body = materializeVideoReferenceMedia({ ...base({ generationMode: 'first_last' }), startFrame: 'data:image/png;base64,aGVsbG8=', lastFrame: 'data:image/png;base64,aGVsbG8=' }, req, root);
    const result = request(body);
    assert.match(result.upstreamBody.image.url, /^https:\/\/app\.test\/uploads\/video-frames\//);
    assert.match(result.upstreamBody.last_frame.url, /^https:\/\/app\.test\/uploads\/video-frames\//);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('keeps the existing refund path for upstream generation failures', () => {
    const endpoint = serverSource.slice(serverSource.indexOf('app.post("/api/video/generate"'), serverSource.indexOf('// ==================== Video Task Polling'));
    assert.ok(endpoint.includes('refundPoints('));
    assert.ok(serverSource.includes('settlePendingTask(normalizedTaskId, \"FAILED\")'));
  });
  it('maps text to video with audio default enabled', () => {
    assert.deepStrictEqual(request(base({ prompt: 'a fox runs' })).upstreamBody, {
      model: 'grok-imagine-video-1.5', prompt: 'a fox runs', seconds: '8',
      aspect_ratio: '16:9', resolution: '480p',
    });
  });
  it('maps image, reference, first/last and keyframes', () => {
    assert.deepStrictEqual(request(base({ generationMode: 'image', image: 'https://app.test/image.jpg' })).upstreamBody.image, { url: 'https://app.test/image.jpg' });
    assert.deepStrictEqual(request(base({ generationMode: 'reference', referenceImages: ['https://app.test/a.jpg', 'https://app.test/b.jpg'] })).upstreamBody.reference_images, [{ url: 'https://app.test/a.jpg' }, { url: 'https://app.test/b.jpg' }]);
    assert.deepStrictEqual(request(base({ generationMode: 'first_last', startFrame: 'https://app.test/a.jpg', lastFrame: 'https://app.test/b.jpg' })).upstreamBody, {
      model: 'grok-imagine-video-1.5', seconds: '8', aspect_ratio: '16:9', resolution: '480p',
      image: { url: 'https://app.test/a.jpg' }, last_frame: { url: 'https://app.test/b.jpg' },
    });
    assert.deepStrictEqual(request(base({ generationMode: 'keyframes', keyframes: [{ image: 'https://app.test/a.jpg', timestamp_s: 2 }, { image: 'https://app.test/b.jpg', timestamp_s: 4.333333333333333 }] })).upstreamBody.keyframes, [
      { image: { url: 'https://app.test/a.jpg' }, timestamp_s: 2 },
      { image: { url: 'https://app.test/b.jpg' }, timestamp_s: 4.333333333333333 },
    ]);
  });
  it('allows empty prompt when media exists and validates limits', () => {
    assert.doesNotThrow(() => request(base({ prompt: '', generationMode: 'image', image: 'https://app.test/a.jpg' })));
    assert.throws(() => request(base({ prompt: '' })), /prompt/i);
    assert.throws(() => request(base({ generationMode: 'reference', referenceImages: Array.from({ length: 8 }, (_, i) => `https://app.test/${i}.jpg`) })), /7/);
    assert.throws(() => request(base({ generationMode: 'keyframes', keyframes: Array.from({ length: 5 }, (_, i) => ({ image: `https://app.test/${i}.jpg`, timestamp_s: i + 1 })) })), /keyframe/i);
    assert.throws(() => request(base({ generationMode: 'keyframes', keyframes: [{ image: 'https://app.test/a.jpg', timestamp_s: 2.1 }] })), /1\/3|grid|timestamp/i);
    assert.throws(() => request(base({ duration: 0 })), /duration/i);
    assert.throws(() => request(base({ duration: 16 })), /duration/i);
    assert.throws(() => request(base({ aspectRatio: '5:4' })), /aspect ratio/i);
    assert.throws(() => request(base({ resolution: '4k' })), /resolution/i);
    assert.throws(() => request(base({ generationMode: 'reference', resolution: '1080p', referenceImages: ['https://app.test/a.jpg'] })), /720p/i);
  });
});
