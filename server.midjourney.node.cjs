const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('Midjourney async groups return four outputs and settle each route at its own price', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midjourney-http-'));
  for (const key of Object.keys(process.env).filter(key => key.startsWith('MYSQL_'))) process.env[key] = '';
  Object.assign(process.env, { AUTH_STORE_FILE: path.join(root, 'auth.json'), BILLING_FILE_PATH: path.join(root, 'billing.json'), IMAGE_JOB_STORAGE_ROOT: root, IMAGE_JOB_POLL_INTERVAL_MS: '10' });
  const calls = [], taskPolls = new Map();
  let providerFailure = false;
  const imageUrls = Array.from({ length: 4 }, (_, i) => `https://images.example.test/mj-${i}.png`);
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      calls.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString()), authorization: req.headers.authorization });
      return res.end(JSON.stringify({ task_id: `mj-${calls.length}`, status: 'SUBMITTED' }));
    }
    assert.match(req.url, /^\/v1\/images\/midjourney\/tasks\/mj-\d+$/);
    const submission = calls[Number(req.url.split('-').at(-1)) - 1];
    assert.equal(req.headers.authorization, submission.authorization);
    const count = (taskPolls.get(req.url) || 0) + 1; taskPolls.set(req.url, count);
    res.end(JSON.stringify(providerFailure ? { task_id: 'failed', status: 'FAILED', error: 'provider failed' }
      : count === 1 ? { task_id: 'pending', status: 'PROCESSING', progress: '50%' }
      : { task_id: 'done', status: 'SUCCESS', progress: '100%', image_url: 'https://images.example.test/grid.png', result: { data: imageUrls.map(url => ({ url })) } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const modelId = 'midjourney-v8.2-tehui';
  const routes = require('./config/imageRoutes.json').routes.filter(route => route.modelFamily === modelId)
    .map(route => ({ ...route, baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: `key-${route.id}` }));
  const route = routes.find(route => route.isDefaultRoute);
  const stableRouteId = 'midjourney-v8.2-osodm-wending';
  const routeStore = require('./imageRouteStore.cjs');
  routeStore.getImageRouteById = async id => routes.find(route => route.id === id) || null;
  routeStore.getImageRouteCatalog = async () => ({ defaultRouteId: route.id, routes });
  const records = new Map(), recordStore = require('./generationRecordStore.cjs');
  recordStore.createGenerationRecord = async value => { const record = { ...value, id: `record-${records.size}` }; records.set(record.id, record); return record; };
  recordStore.attachTaskToGenerationRecord = async (id, taskId) => Object.assign(records.get(id), { taskId });
  recordStore.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  recordStore.getGenerationRecordByTaskId = async taskId => [...records.values()].find(record => record.taskId === taskId) || null;
  recordStore.completeGenerationRecordByTaskId = async (taskId, value) => { const record = [...records.values()].find(record => record.taskId === taskId); if (record) Object.assign(record, value); };
  const assets = require('./imageJobAssets.cjs');
  assets.createImageJobAssets = () => ({ prepare: async ({ payload, resultUrls }) => ({ payload, resultUrls, storageStatus: 'saved' }), cleanup: async () => {} });
  const auth = require('./authStore.cjs'), billing = require('./billingStore.cjs');
  const app = require('./server.cjs'), server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.imageJobService?.stop(); server.closeAllConnections(); upstream.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  });
  const registration = await auth.registerWithPassword({ email: 'mj@example.test', password: 'midjourney-test-pass' });
  const login = await auth.loginWithPassword({ email: registration.user.email, password: 'midjourney-test-pass' });
  const account = await billing.ensureAccountForUser(registration.user); await billing.rechargeAccount(account.accountId, 100);
  const request = (endpoint, body) => fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { headers: { 'content-type': 'application/json', 'x-auth-session': login.sessionToken }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const payload = (id, patch = {}) => ({ modelId, model: 'Midjourney v8.2-特惠', routeId: route.id, prompt: 'a pavilion', size: '1k', aspect_ratio: '16:9', n: 1, asyncTask: true, clientRequestId: id, clientLiveTaskIds: [1, 2, 3, 4].map(slot => `${id}-${slot}`), ...patch });
  const poll = async taskId => {
    for (let i = 0; i < 300; i++) {
      const result = await (await request(`/api/task/${taskId}`)).json();
      if (['succeeded', 'failed'].includes(result.status) && result.settlementPending !== true) return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Midjourney task did not settle');
  };
  const waitForPoints = async expected => {
    for (let i = 0; i < 300; i++) {
      if ((await billing.getAccountByUserId(registration.user.userId)).points === expected) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal((await billing.getAccountByUserId(registration.user.userId)).points, expected);
  };
  for (const [size, quality] of [['1k', '0.25'], ['2k', '2']]) await t.test(`${size}/${quality}`, async () => {
    const response = await request('/api/generate', payload(size, { size, quality, image: 'data:image/png;base64,YQ==' }));
    assert.equal(response.status, 202); const receipt = await response.json();
    const result = await poll(receipt.task_id);
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.deepEqual(result.images, imageUrls); assert.equal(JSON.stringify(result).includes('grid.png'), false);
    assert.equal(calls.at(-1).path, '/v1/images/midjourney/generations');
    assert.deepEqual(calls.at(-1).body, { model: 'Midjourney v8.2-特惠', prompt: 'a pavilion', size: '16:9', n: 1, hd: size === '2k', quality, stream: false, response_format: 'url', image: 'data:image/png;base64,YQ==' });
    assert.equal((await billing.getAccountByUserId(registration.user.userId)).points, size === '1k' ? 92 : 84);
  });
  await t.test('the stable route uses mj-v8.2 and its own key, returning four images for 16 points', async () => {
    const response = await request('/api/generate', payload('stable', { routeId: stableRouteId, size: '2k' }));
    assert.equal(response.status, 202);
    const result = await poll((await response.json()).task_id);
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.deepEqual(result.images, imageUrls);
    assert.equal(calls.at(-1).body.model, 'mj-v8.2');
    assert.equal(calls.at(-1).body.hd, true);
    assert.equal(calls.at(-1).authorization, `Bearer key-${stableRouteId}`);
    await waitForPoints(68);
  });
  await t.test('invalid requests do not call the provider or deduct points', async () => {
    for (const patch of [{ n: 4 }, { size: '4k' }, { quality: 'max' }, { aspect_ratio: '9:21' }, { images: ['https://a.test/1', 'https://a.test/2'] }]) {
      const response = await request('/api/generate', payload(`invalid-${JSON.stringify(patch)}`, patch));
      assert.equal(response.status, 400);
    }
    assert.equal((await request('/api/edit', payload('invalid-edit', { image: 'data:image/png;base64,YQ==' }))).status, 400);
    assert.equal(calls.length, 3); assert.equal((await billing.getAccountByUserId(registration.user.userId)).points, 68);
  });
  await t.test('provider failure refunds the entire 16-point stable group', async () => {
    providerFailure = true;
    const receipt = await (await request('/api/generate', payload('failure', { routeId: stableRouteId }))).json();
    const result = await poll(receipt.task_id); assert.equal(result.status, 'failed');
    await waitForPoints(68);
  });
});
