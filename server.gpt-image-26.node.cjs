const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('GPT Image 2.6 forwards the 2.5 payload format and bills each size through real HTTP handlers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-26-'));
  for (const key of Object.keys(process.env).filter(key => key.startsWith('MYSQL_'))) process.env[key] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  process.env.IMAGE_JOB_POLL_INTERVAL_MS = '10';
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ url: 'https://images.example.test/result.png' }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const modelId = 'gpt-image-2.6-sunburst';
  const configured = require('./config/imageRoutes.json').routes.filter(route => route.modelFamily === modelId);
  const localRoutes = configured.map(route => ({ ...route, baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: `key-${route.id}` }));
  const routes = require('./imageRouteStore.cjs');
  routes.getImageRouteById = async id => localRoutes.find(route => route.id === id) || null;
  routes.getImageRouteCatalog = async () => ({ defaultRouteId: `${modelId}-native`, routes: localRoutes });
  const records = new Map();
  const recordStore = require('./generationRecordStore.cjs');
  recordStore.createGenerationRecord = async value => {
    const record = { ...value, id: `record-${records.size}` };
    records.set(record.id, record); return record;
  };
  recordStore.attachTaskToGenerationRecord = async (id, taskId) => Object.assign(records.get(id), { taskId });
  recordStore.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  // Keep persistence inside this temporary directory and avoid downloading fixture URLs.
  const assetsModule = require('./imageJobAssets.cjs');
  const createAssets = assetsModule.createImageJobAssets;
  assetsModule.createImageJobAssets = () => ({
    prepare: async ({ payload, resultUrls }) => ({ payload, resultUrls, storageStatus: 'saved' }),
    cleanup: async () => {},
  });
  const auth = require('./authStore.cjs');
  const billing = require('./billingStore.cjs');
  const app = require('./server.cjs');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.imageJobService?.stop();
    server.closeAllConnections(); upstream.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    assetsModule.createImageJobAssets = createAssets;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  });
  const registration = await auth.registerWithPassword({ email: 'image26@example.test', password: 'test-image26-pass' });
  const login = await auth.loginWithPassword({ email: registration.user.email, password: 'test-image26-pass' });
  const account = await billing.ensureAccountForUser(registration.user);
  await billing.rechargeAccount(account.accountId, 100);
  const request = (url, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    headers: { 'content-type': 'application/json', 'x-auth-session': login.sessionToken }, ...options,
  });
  let balance = 100;
  for (const [line, size, quality, price, pixels] of [
    ['native', '1k', 'low', 4, '1024x1024'], ['native', '2k', 'medium', 4.5, '2048x2048'],
    // The existing 2.5 size normalizer limits a square to 8,294,400 pixels.
    ['native', '4k', 'high', 5, '2880x2880'], ['native', '1k', 'auto', 4, '1024x1024'],
    ['mochiai', '1k', 'high', 2, '1024x1024'], ['mochiai', '2k', 'xhigh', 2.5, '2048x2048'],
    ['mochiai', '4k', 'max', 3, '2880x2880'],
  ]) await t.test(`${line}/${size}/${quality}`, async () => {
    const routeId = `${modelId}-${line}`;
    const response = await request('/api/generate', { method: 'POST', body: JSON.stringify({
      modelId, model: modelId, routeId, prompt: 'a pavilion', size, image_size: size,
      aspect_ratio: '1:1', quality, output_format: 'png', moderation: 'auto',
      asyncTask: true, clientRequestId: `image26-${line}-${size}-${quality}`,
    }) });
    assert.equal(response.status, 202);
    const receipt = await response.json();
    let done;
    for (let i = 0; i < 300; i++) {
      done = await (await request(`/api/task/${receipt.task_id}`)).json();
      if (['succeeded', 'failed'].includes(done.status)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(done.status, 'succeeded', JSON.stringify(done));
    const call = calls.at(-1);
    assert.equal(call.path, '/v1/images/generations');
    assert.equal(call.authorization, `Bearer key-${routeId}`);
    assert.deepEqual(JSON.parse(call.body), {
      model: modelId, prompt: 'a pavilion', size: pixels,
      quality: quality === 'auto' ? 'medium' : quality,
      output_format: 'png', moderation: 'auto',
    });
    balance -= price;
    assert.equal((await billing.getAccountByUserId(registration.user.userId)).points, balance);
  });
  assert.equal(calls.length, 7);
});
