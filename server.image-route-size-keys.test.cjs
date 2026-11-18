const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('GPT Image route selects size-specific keys for generation, edit, and async polling', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-route-size-keys-'));
  for (const key of Object.keys(process.env).filter((name) => name.startsWith('MYSQL_'))) process.env[key] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  process.env.IMAGE_JOB_POLL_INTERVAL_MS = '10';
  const smallKeyEnv = 'TEST_GPT_IMAGE_26_MOUXIHUB_1K2K';
  const largeKeyEnv = 'TEST_GPT_IMAGE_26_MOUXIHUB_4K';
  process.env[smallKeyEnv] = 'mouxihub-small-test-key';
  process.env[largeKeyEnv] = 'mouxihub-4k-test-key';

  const auth = require('./authStore.cjs');
  const billing = require('./billingStore.cjs');
  const routeStore = require('./imageRouteStore.cjs');
  const submissions = [];
  const polls = [];
  let taskNumber = 0;
  const upstream = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      polls.push(req.headers.authorization);
      return res.end(JSON.stringify({ status: 'succeeded', results: ['https://images.example/result.png'] }));
    }

    for await (const _chunk of req) {}
    submissions.push(req.headers.authorization);
    return res.end(JSON.stringify({ task_id: `mouxihub-size-${++taskNumber}`, status: 'processing' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  const route = {
    id: 'mouxihub-size-key-test',
    label: '稳定线路',
    modelFamily: 'gpt-image-2.6-sunburst',
    line: '稳定线路',
    transport: 'openai-image',
    mode: 'async',
    baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    generatePath: '/v1/images/generations?async=true',
    editPath: '/v1/images/edits?async=true',
    taskPath: '/v1/images/tasks/{taskId}',
    upstreamModel: 'gpt-image-2.6-sunburst',
    apiKeyEnv: smallKeyEnv,
    pointCost: 4,
    sizeOverrides: {
      '1k': { pointCost: 4 },
      '2k': { pointCost: 4 },
      '4k': { pointCost: 6, apiKeyEnv: largeKeyEnv },
    },
    supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
    isActive: true,
  };
  routeStore.getImageRouteById = async (id) => id === route.id ? route : null;
  routeStore.getImageRouteCatalog = async () => ({ defaultRouteId: route.id, routes: [route] });

  const recordStore = require('./generationRecordStore.cjs');
  const records = new Map();
  recordStore.createGenerationRecord = async (value) => {
    const record = { ...value, id: `record-${records.size}` };
    records.set(record.id, record);
    return record;
  };
  recordStore.attachTaskToGenerationRecord = async (id, taskId) => Object.assign(records.get(id), { taskId });
  recordStore.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  recordStore.completeGenerationRecordByTaskId = async (taskId, value) => {
    for (const record of records.values()) if (record.taskId === taskId) Object.assign(record, value);
  };
  recordStore.getGenerationRecordByTaskId = async (taskId) => [...records.values()].find((record) => record.taskId === taskId) || null;

  const assets = require('./imageJobAssets.cjs');
  const createAssets = assets.createImageJobAssets;
  const realAssets = createAssets({ root });
  assets.createImageJobAssets = () => ({
    prepare: async ({ resultUrls }) => ({ payload: { images: resultUrls }, resultUrls, storageStatus: 'pending' }),
    resolveAsset: realAssets.resolveAsset,
    cleanup: async () => {},
  });

  const app = require('./server.cjs');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const user = await auth.registerWithPassword({ email: 'route-size-keys@example.com', password: 'test-pass-123' });
  const session = await auth.loginWithPassword({ email: user.user.email, password: 'test-pass-123' });
  const account = await billing.ensureAccountForUser(user.user);
  await billing.rechargeAccount(account.accountId, 20);
  const request = (url, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    headers: { 'content-type': 'application/json', 'x-auth-session': session.sessionToken },
    ...options,
  });
  const pollUntilDone = async (taskId) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const state = await (await request(`/api/task/${taskId}`)).json();
      if (['succeeded', 'failed'].includes(state.status)) return state;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`image task ${taskId} did not settle`);
  };

  const catalogResponse = await request('/api/image-routes/catalog');
  assert.equal(catalogResponse.status, 200);
  const publicRoute = (await catalogResponse.json()).routes.find((item) => item.id === route.id);
  assert.ok(publicRoute);
  assert.equal(publicRoute.sizeOverrides['4k'].apiKeyEnv, undefined, 'the environment variable name stays server-side');

  t.after(async () => {
    await app.imageJobService?.stop();
    await realAssets.drain();
    assets.createImageJobAssets = createAssets;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const imageSize of ['1K', '2K', '4K']) {
    const response = await request('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        routeId: route.id,
        model: route.modelFamily,
        prompt: 'a tree',
        asyncTask: true,
        image_size: imageSize,
        size: imageSize.toLowerCase(),
        clientRequestId: `mouxihub-size-${imageSize}`,
      }),
    });
    assert.equal(response.status, 202);
    assert.equal((await pollUntilDone((await response.json()).task_id)).status, 'succeeded');
  }

  const editResponse = await request('/api/edit', {
    method: 'POST',
    body: JSON.stringify({
      routeId: route.id,
      model: route.modelFamily,
      prompt: 'edit this image',
      images: ['data:image/png;base64,AAAA'],
      asyncTask: true,
      image_size: '4K',
      size: '4k',
      clientRequestId: 'mouxihub-size-edit-4k',
    }),
  });
  assert.equal(editResponse.status, 202);
  assert.equal((await pollUntilDone((await editResponse.json()).task_id)).status, 'succeeded');

  assert.deepEqual(submissions, [
    'Bearer mouxihub-small-test-key',
    'Bearer mouxihub-small-test-key',
    'Bearer mouxihub-4k-test-key',
    'Bearer mouxihub-4k-test-key',
  ]);
  assert.deepEqual(polls, submissions, 'each asynchronous poll must reuse the generation key for that size');
  assert.equal((await billing.getAccountSummary(account.accountId)).points, 0, '1K/2K charge 4 points and 4K generation/edit charge 6 each');

  delete process.env[largeKeyEnv];
  const missingKeyResponse = await request('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      routeId: route.id,
      model: route.modelFamily,
      prompt: 'a tree',
      asyncTask: true,
      image_size: '4K',
      size: '4k',
      clientRequestId: 'mouxihub-size-4k-missing-key',
    }),
  });
  assert.equal(missingKeyResponse.status, 202);
  assert.equal((await pollUntilDone((await missingKeyResponse.json()).task_id)).status, 'failed');
  assert.equal(submissions.length, 4, 'a missing 4K key must fail without falling back to the 1K/2K key');
});
