const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('./config/imageModels.json');
const routes = require('./config/imageRoutes.json');

test('both Higgsfield models have server-only routes and valid options', () => {
  for (const id of ['higgsfield-soul-2', 'higgsfield-soul-cinema']) {
    const model = catalog.models.find(entry => entry.id === id);
    const route = routes.routes.find(entry => entry.modelFamily === id);
    assert.ok(model, id);
    assert.deepEqual(model.sizeOptions, ['720p', '1080p']);
    assert.equal(model.extraAspectRatios.length, 7);
    assert.equal(route.transport, 'higgsfield-image');
    assert.equal(route.apiKeyEnv, 'HIGGSFIELD_API_KEY');
    assert.equal(route.allowUserApiKeyWithoutLogin, false);
  }
});

test('maps generation options without upstream-compatible extras or silent batch expansion', () => {
  const { buildHiggsfieldImageInput } = require('./higgsfieldImageApi.cjs');
  assert.deepEqual(buildHiggsfieldImageInput('higgsfield-soul-2', {
    prompt: 'A quiet garden --ar 3:4', aspect_ratio: '3:4', image_size: '1080P', n: 4, quality: 'high',
  }), {
    path: '/higgsfield-ai/soul/v2/standard',
    input: { prompt: 'A quiet garden', aspect_ratio: '3:4', resolution: '1080p', batch_size: 4 },
    reference: '',
  });
  assert.throws(() => buildHiggsfieldImageInput('higgsfield-soul-cinema', { prompt: 'Tree', n: 2 }), /1 或 4/);
  assert.throws(() => buildHiggsfieldImageInput('higgsfield-soul-cinema', { prompt: 'Tree', images: ['AAAA'] }), /参考图/);
  assert.throws(() => buildHiggsfieldImageInput('higgsfield-soul-2', { prompt: 'Tree', images: ['AAAA', 'BBBB'] }), /一张/);
  assert.throws(() => buildHiggsfieldImageInput('higgsfield-soul-2', { prompt: 'Tree', image_size: '4k' }), /720p/);
});

test('uses an idempotent server-only submission and never sends the key to file storage', async () => {
  const { submitHiggsfieldImage, pollHiggsfieldImage } = require('./higgsfieldImageApi.cjs');
  const seen = [];
  const cdn = 'https://cdn.example.com/reference.png';
  const fetch = async (url, options) => {
    seen.push({ url, ...options });
    if (url.endsWith('/generate-upload-url')) return Response.json({
      public_url: cdn, upload_url: 'https://storage.example.com/upload', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary' },
    });
    if (options.method === 'PUT') return new Response(null, { status: 200 });
    if (options.method === 'POST') return Response.json({ status: 'queued', request_id: 'upstream-1', status_url: 'https://untrusted.example/status' });
    return Response.json({ status: 'completed', images: [{ url: 'https://cdn.example.com/result.png' }] });
  };
  const options = { fetch, key: 'test-id:test-secret' };
  const requestId = await submitHiggsfieldImage('higgsfield-soul-2', { prompt: 'A garden', image: 'data:image/png;base64,aGk=' }, 'job-local', options);
  assert.equal(requestId, 'upstream-1');
  assert.equal(seen[1].headers.Authorization, undefined);
  assert.equal(seen[1].headers['x-amz-tagging'], 'retention=temporary');
  assert.equal(seen[1].body.toString(), 'hi');
  assert.equal(seen[2].headers.Authorization, 'Key test-id:test-secret');
  assert.equal(seen[2].headers['Idempotency-Key'], 'job-local');
  assert.equal(seen[2].url, 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/image-to-image');
  assert.equal(JSON.parse(seen[2].body).image_url, cdn);
  assert.deepEqual(await pollHiggsfieldImage(requestId, options), {
    status: 'succeeded', results: ['https://cdn.example.com/result.png'],
  });
  assert.equal(seen[3].url, 'https://api.higgsfield.ai/requests/upstream-1/status');
});

test('maps moderation and authentication errors to terminal image failures', async () => {
  const { pollHiggsfieldImage } = require('./higgsfieldImageApi.cjs');
  const key = 'test-id:test-secret';
  const moderated = await pollHiggsfieldImage('request-2', { key, fetch: async () => Response.json({ status: 'nsfw' }) });
  assert.equal(moderated.status, 'failed');
  const rejected = await pollHiggsfieldImage('request-2', { key, fetch: async () => Response.json({ detail: key }, { status: 401 }) });
  assert.equal(rejected.status, 'failed');
  assert.doesNotMatch(rejected.error, /secret/);
});
