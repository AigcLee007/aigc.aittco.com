const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
sharp.cache(false);

test('native inline images become one readable original and preview without exposing base64 paths', async t => {
  const root = await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT || os.tmpdir(), 'native-image-results-'));
  for (const key of Object.keys(process.env).filter(key => key.startsWith('MYSQL_'))) process.env[key] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  process.env.IMAGE_JOB_POLL_INTERVAL_MS = '10';
  let providerResult, upstreamCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    upstreamCalls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(providerResult));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const route = { id: 'native-test', label: 'native test', transport: 'gemini-native', mode: 'sync',
    baseUrl: `http://127.0.0.1:${upstream.address().port}`, generatePath: '/native/{model}',
    upstreamModel: 'native-test', apiKey: 'test-key', pointCost: 3, isActive: true };
  const routes = require('./imageRouteStore.cjs');
  routes.getImageRouteById = async () => route;
  routes.getImageRouteCatalog = async () => ({ defaultRouteId: route.id, routes: [route] });
  const records = new Map(), recordStore = require('./generationRecordStore.cjs');
  recordStore.createGenerationRecord = async value => {
    const record = { ...value, id: `rec-${records.size}` }; records.set(record.id, record); return record;
  };
  recordStore.attachTaskToGenerationRecord = async (id, taskId) => Object.assign(records.get(id), { taskId });
  recordStore.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  const auth = require('./authStore.cjs'), billing = require('./billingStore.cjs');
  const assetsModule = require('./imageJobAssets.cjs');
  const factory = assetsModule.createImageJobAssets;
  let assets;
  assetsModule.createImageJobAssets = options => (assets = factory(options));
  const app = require('./server.cjs');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.imageJobService?.stop();
    await assets.drain();
    server.closeAllConnections();
    upstream.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    assetsModule.createImageJobAssets = factory;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  });
  const registration = await auth.registerWithPassword({ email: 'native-owner@example.com', password: 'native-pass-123' });
  const login = await auth.loginWithPassword({ email: registration.user.email, password: 'native-pass-123' });
  const account = await billing.ensureAccountForUser(registration.user);
  await billing.rechargeAccount(account.accountId, 30);
  const request = (url, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    headers: { 'content-type': 'application/json', 'x-auth-session': login.sessionToken }, ...options,
  });
  const poll = async (id, ready) => {
    for (let i = 0; i < 250; i++) {
      const state = await (await request(`/api/task/${id}`)).json();
      if (ready(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('native result did not settle');
  };
  for (const variant of ['jpeg', 'png', 'webp', 'wrapped-jpeg']) await t.test(variant, async () => {
    const format = variant === 'wrapped-jpeg' ? 'jpeg' : variant;
    const buffer = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#334455' } })[format]().toBuffer();
    const base64 = buffer.toString('base64');
    const data = variant === 'wrapped-jpeg' ? base64.match(/.{1,60}/g).join('\n') : base64;
    const part = format === 'webp' ? { inline_data: { mime_type: `image/${format}`, data } }
      : { inlineData: { mimeType: variant === 'wrapped-jpeg' ? 'image/jpg' : `image/${format}`, data } };
    providerResult = { candidates: [{ content: { parts: [part] } }] };
    const ack = await request('/api/gemini/generate', { method: 'POST', body: JSON.stringify({
      routeId: route.id, model: 'native-test', prompt: 'a pavilion', image_size: '4K', aspect_ratio: '16:9',
      asyncTask: true, clientRequestId: `native-${variant}`, clientLiveTaskIds: [`node-${variant}`],
    }) });
    assert.equal(ack.status, 202);
    const receipt = await ack.json();
    const done = await poll(receipt.task_id, state => ['succeeded', 'failed'].includes(state.status));
    assert.equal(done.status, 'succeeded');
    assert.equal(done.storage_status, 'saved', done.storage_error);
    assert.equal(done.images.length, 1, 'one provider image must not become two outputs');
    assert.match(done.images[0], /^\/api\/image-job-assets\//);
    assert.equal(JSON.stringify(done).includes(base64), false, 'base64 is never a public URL or persisted payload');
    const original = await request(done.images[0]);
    assert.equal(original.status, 200);
    assert.match(original.headers.get('content-type'), new RegExp(`^image/${format}`));
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), buffer);
    const withPreview = await poll(receipt.task_id, state => !!state.preview_url);
    const preview = await request(withPreview.preview_url);
    assert.equal(preview.status, 200);
    assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).format, 'webp');
    assert.equal(records.get(`rec-${records.size - 1}`).resultUrls.length, 1);
  });
  assert.equal(upstreamCalls, 4);
  assert.equal((await billing.getAccountSummary(account.accountId)).points, 18);
});
