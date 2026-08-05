const assert = require('assert');
const fs = require('fs');
const catalog = require('./config/pixelhubVideoCatalog.json');
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');

const model = (id) => catalog.models.find((item) => item.id === id);
const request = (body, modelId) => normalizePixelHubVideoRequest({
  body,
  model: model(modelId),
  upstreamModel: model(modelId).requestModel,
});

describe('normalizePixelHubVideoRequest', () => {
  it('materializes and validates video requests before reserving points', () => {
    const source = fs.readFileSync('./server.cjs', 'utf8');
    const endpointStart = source.indexOf('app.post("/api/video/generate"');
    const endpointEnd = source.indexOf('// ==================== Video Task Polling', endpointStart);
    const endpoint = source.slice(endpointStart, endpointEnd);
    assert.ok(endpoint.indexOf('materializeVideoReferenceMedia(') < endpoint.indexOf('normalizePixelHubVideoRequest('));
    assert.ok(endpoint.indexOf('normalizePixelHubVideoRequest(') < endpoint.indexOf('reservePoints('));
    assert.ok(endpoint.includes('route.routeFamily !== requestedVideoModel.routeFamily'));
    assert.ok(endpoint.indexOf('refundPoints(') > endpoint.indexOf('catch (error)'));
  });
  it('builds Gemini references and charges one point per second', () => {
    const result = request({
      prompt: 'city at night', aspectRatio: '16:9', resolution: '1080p', duration: 10,
      referenceImages: ['https://app.test/a.jpg'], referenceVideos: ['https://app.test/a.mp4'],
    }, 'gemini-omni-flash');
    assert.strictEqual(result.pointCost, 10);
    assert.deepStrictEqual(result.upstreamBody, {
      model: 'gemini-omni-flash', prompt: 'city at night', aspect_ratio: '16:9', duration: 10,
      resolution: '1080p', generate_audio: true, reference_image_urls: ['https://app.test/a.jpg'],
      reference_videos: ['https://app.test/a.mp4'],
    });
  });

  it('builds Sora references and charges ten points per second', () => {
    const result = request({
      prompt: 'portrait motion', aspectRatio: '1:1', resolution: '720p', duration: 15,
      referenceImages: ['https://app.test/1.jpg'], referenceVideos: ['https://app.test/1.mp4'],
    }, 'sora-v3-pro');
    assert.strictEqual(result.pointCost, 150);
    assert.deepStrictEqual(result.upstreamBody.reference_image_urls, ['https://app.test/1.jpg']);
    assert.deepStrictEqual(result.upstreamBody.reference_videos, ['https://app.test/1.mp4']);
  });

  it('maps Veo references to ordered frame URLs', () => {
    const result = request({
      prompt: 'camera move', aspectRatio: '9:16', resolution: '1080p', duration: 4,
      referenceImages: ['https://app.test/start.jpg', 'https://app.test/end.jpg'], referenceVideos: [],
    }, 'veo31-fast');
    assert.strictEqual(result.pointCost, 2);
    assert.deepStrictEqual(result.upstreamBody.image_urls, ['https://app.test/start.jpg', 'https://app.test/end.jpg']);
    assert.ok(!('reference_videos' in result.upstreamBody));
  });

  it('rejects unsupported values and legacy request fields before billing', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '1:1', resolution: '720p', duration: 4,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /aspect ratio/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4.5,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /integer/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: [], referenceVideos: [], hd: true,
    }, 'gemini-omni-flash'), /not supported/i);
  });

  it('rejects bad references, unsupported video, prompt, and count overflow', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '1080p', duration: 4,
      referenceImages: ['data:image/png;base64,abc'], referenceVideos: [],
    }, 'gemini-omni-flash'), /http/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '1080p', duration: 4,
      referenceImages: [], referenceVideos: ['https://app.test/v.mp4'],
    }, 'veo31-fast'), /video/i);
    assert.throws(() => request({
      prompt: 'x'.repeat(2501), aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: [], referenceVideos: [],
    }, 'sora-v3-pro'), /prompt/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: Array.from({ length: 6 }, (_, index) => `https://app.test/${index}.jpg`), referenceVideos: [],
    }, 'gemini-omni-flash'), /image/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: Array.from({ length: 5 }, (_, index) => `https://app.test/${index}.jpg`),
      referenceVideos: ['https://app.test/video.mp4', 'https://app.test/video-2.mp4'],
    }, 'gemini-omni-flash'), /video|total/i);
  });

  it('rejects models outside the active PixelHub catalog', () => {
    assert.throws(() => normalizePixelHubVideoRequest({
      body: { prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4, referenceImages: [], referenceVideos: [] },
      model: { ...model('gemini-omni-flash'), id: 'other-model', requestModel: 'other-model' },
      upstreamModel: 'other-model',
    }), /upstream model/i);
  });
});
