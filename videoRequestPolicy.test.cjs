const assert = require('assert');
const fs = require('fs');
const catalog = require('./config/pixelhubVideoCatalog.json');
const { normalizePixelHubVideoRequest } = require('./videoRequestPolicy.cjs');

const model = (id) => catalog.models.find((item) => item.id === id);
const requestWithModel = (body, selectedModel) => normalizePixelHubVideoRequest({
  body,
  model: selectedModel,
  upstreamModel: selectedModel.requestModel,
});
const request = (body, modelId) => requestWithModel(body, model(modelId));

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
  it('returns policy validation errors as HTTP 400', () => {
    const source = fs.readFileSync('./server.cjs', 'utf8');
    const helperStart = source.indexOf('const respondWithUserFacingGenerationError =');
    const helperEnd = source.indexOf('const requestWithRetry =', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    assert.match(
      helper,
      /if \(error\?\.status === 400\)\s*\{\s*return sendUserFacingGenerationError\(res, 400, error\);\s*\}/,
    );
  });
  it('persists only safe PixelHub provider summaries in video generation metadata', () => {
    const source = fs.readFileSync('./server.cjs', 'utf8');
    const endpointStart = source.indexOf('app.post("/api/video/generate"');
    const endpointEnd = source.indexOf('// ==================== Video Task Polling', endpointStart);
    const endpoint = source.slice(endpointStart, endpointEnd);
    assert.match(
      endpoint,
      /const\s*\{\s*upstreamBody\s*,\s*providerSummary\s*,\s*pointCost\s*\}\s*=\s*normalizePixelHubVideoRequest\(/,
    );

    const recordStart = endpoint.indexOf('generationRecord = await buildGenerationRecordPayload({');
    const recordEnd = endpoint.indexOf('const response = await requestWithRetry', recordStart);
    const recordPayload = endpoint.slice(recordStart, recordEnd);
    assert.ok(recordPayload.includes('providerSummary'));
    assert.ok(!recordPayload.includes('image_urls'));
    assert.ok(!recordPayload.includes('video_urls'));
    assert.ok(!recordPayload.includes('Authorization'));
  });

  it('builds Gemini references, summary, and charges one point per second', () => {
    const result = request({
      prompt: 'city at night', aspectRatio: '16:9', resolution: '1080p', duration: 10,
      referenceImages: ['https://app.test/a.jpg'], referenceVideos: ['https://app.test/a.mp4'],
    }, 'gemini-omni-flash');
    assert.strictEqual(result.pointCost, 10);
    assert.deepStrictEqual(result.upstreamBody, {
      model: 'gemini-omni-flash', prompt: 'city at night', aspect_ratio: '16:9', duration: 10,
      resolution: '1080p', image_urls: ['https://app.test/a.jpg'], video_urls: ['https://app.test/a.mp4'],
    });
    for (const field of ['image_url', 'reference_image_urls', 'reference_video', 'reference_videos', 'generate_audio']) {
      assert.ok(!(field in result.upstreamBody));
    }
    assert.deepStrictEqual(result.providerSummary, {
      model: 'gemini-omni-flash',
      referenceImageCount: 1,
      referenceVideoCount: 1,
    });
    const serializedSummary = JSON.stringify(result.providerSummary);
    assert.ok(!serializedSummary.includes('https://'));
    assert.ok(!serializedSummary.includes('Authorization'));
    assert.ok(!serializedSummary.includes('Bearer'));
  });

  it('builds Gemini image-only references with no video alias', () => {
    const result = request({
      prompt: 'city at night', aspectRatio: '16:9', resolution: '1080p', duration: 10,
      referenceImages: ['https://app.test/a.jpg'], referenceVideos: [],
    }, 'gemini-omni-flash');
    assert.deepStrictEqual(result.upstreamBody.image_urls, ['https://app.test/a.jpg']);
    assert.ok(!('video_urls' in result.upstreamBody));
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

  it('rejects an unsupported aspect ratio before billing', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '1:1', resolution: '720p', duration: 4,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /aspect ratio/i);
  });

  it('rejects an unsupported resolution before billing', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '4k', duration: 4,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /resolution/i);
  });

  it('rejects an integer duration that is unavailable for the model', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 5,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /duration/i);
  });

  it('rejects a non-integer duration before billing', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4.5,
      referenceImages: [], referenceVideos: [],
    }, 'gemini-omni-flash'), /integer/i);
  });

  it('rejects a video quantity other than one', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: [], referenceVideos: [], quantity: 2,
    }, 'gemini-omni-flash'), /quantity/i);
  });

  for (const field of ['video_reference', 'start_frame', 'end_frame', 'hd']) {
    it(`rejects the legacy ${field} request field`, () => {
      assert.throws(() => request({
        prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
        referenceImages: [], referenceVideos: [], [field]: field === 'hd' ? true : 'https://app.test/legacy',
      }, 'gemini-omni-flash'), new RegExp(field, 'i'));
    });
  }

  it('rejects a combined reference overflow independently of media-specific limits', () => {
    const constrainedModel = { ...model('gemini-omni-flash'), maxTotalReferences: 2 };
    assert.throws(() => requestWithModel({
      prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 4,
      referenceImages: ['https://app.test/1.jpg', 'https://app.test/2.jpg'],
      referenceVideos: ['https://app.test/1.mp4'],
    }, constrainedModel), /total reference limit is 2/i);
  });

  it('rejects bad references, unsupported video, prompt, and count overflow', () => {
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '1080p', duration: 4,
      referenceImages: ['data:image/png;base64,abc'], referenceVideos: [],
    }, 'gemini-omni-flash'), /http/i);
    assert.throws(() => request({
      prompt: 'test', aspectRatio: '16:9', resolution: '1080p', duration: 4,
      referenceImages: ['http://app.test/insecure.jpg'], referenceVideos: [],
    }, 'gemini-omni-flash'), /https/i);
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
