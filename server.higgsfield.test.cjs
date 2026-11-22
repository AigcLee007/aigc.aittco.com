const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

test('Higgsfield generation uses the authenticated durable job and stores the original on the server', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'higgsfield-job-'));
  for (const name of ['MYSQL_URL', 'MYSQL_HOST', 'MYSQL_DATABASE']) process.env[name] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  process.env.IMAGE_JOB_POLL_INTERVAL_MS = '10';
  process.env.HIGGSFIELD_API_KEY = 'fixture-id:fixture-secret';
  const upstreamImage = 'https://cdn.example.com/result.png';
  const calls = [];
  const nativeFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.higgsfield.ai/')) return nativeFetch(url, options);
    calls.push({ url, options });
    return options.method === 'POST'
      ? Response.json({ status: 'queued', request_id: 'provider-test' })
      : Response.json({ status: 'completed', images: [{ url: upstreamImage }] });
  };
  const assets = require('./imageJobAssets.cjs');
  const createAssets = assets.createImageJobAssets;
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  let imageAssets;
  assets.createImageJobAssets = options => (imageAssets = createAssets({
    ...options, download: async url => {
      assert.equal(url, upstreamImage);
      return image;
    },
  }));
  const recordStore = require('./generationRecordStore.cjs');
  const records = new Map();
  recordStore.createGenerationRecord = async value => {
    const record = { ...value, id: 'higgsfield-test-record' };
    records.set(record.id, record);
    return record;
  };
  recordStore.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  const app = require('./server.cjs');
  const server = http.createServer(app);
  t.after(async () => {
    await app.imageJobService.stop();
    await imageAssets?.drain();
    global.fetch = nativeFetch;
    assets.createImageJobAssets = createAssets;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const auth = require('./authStore.cjs');
  const billing = require('./billingStore.cjs');
  const registration = await auth.registerWithPassword({ email: 'higgsfield-owner@example.com', password: 'test-password-1' });
  const session = await auth.loginWithPassword({ email: registration.user.email, password: 'test-password-1' });
  const account = await billing.ensureAccountForUser(registration.user);
  await billing.rechargeAccount(account.accountId, 10);
  const request = (pathname, opts = {}) => nativeFetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
    headers: { 'content-type': 'application/json', 'x-auth-session': session.sessionToken },
    ...opts,
  });
  const catalog = await (await request('/api/image-routes/catalog')).json();
  const cinema = catalog.routes.find(route => route.id === 'higgsfield-soul-cinema');
  assert.equal(cinema?.sizeOverrides?.['1080p']?.pointCost, 2);
  assert.doesNotMatch(JSON.stringify(catalog), /fixture-secret|HIGGSFIELD_API_KEY/);
  const requestBody = {
    modelId: 'higgsfield-soul-cinema', prompt: 'A winter evening', aspect_ratio: '3:4',
    size: '1080p', n: 1, storageMode: 'speed', clientRequestId: 'higgsfield-request',
  };
  const denied = await request('/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer browser-key' },
    body: JSON.stringify(requestBody),
  });
  assert.equal(denied.status, 401);
  const response = await request('/api/generate', { method: 'POST', body: JSON.stringify(requestBody) });
  assert.equal(response.status, 202);
  const ack = await response.json();
  let result;
  for (let attempt = 0; attempt < 150; attempt++) {
    result = await (await request(`/api/task/${ack.task_id}`)).json();
    if (result.storage_status === 'saved' || result.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(result.status, 'succeeded', result.error);
  assert.equal(result.storage_status, 'saved');
  assert.match(result.results[0], /\/api\/image-job-assets\//);
  assert.deepEqual(Buffer.from(await (await request(result.results[0])).arrayBuffer()), image);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[0].url, 'https://api.higgsfield.ai/higgsfield-ai/soul/cinema');
  assert.equal(calls[0].options.headers.Authorization, 'Key fixture-id:fixture-secret');
  assert.equal((await billing.getAccountSummary(account.accountId)).points, 8);
  assert.equal(records.get('higgsfield-test-record').status, 'SUCCESS');
});
