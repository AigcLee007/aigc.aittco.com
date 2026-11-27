const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const test = require('node:test');
const sharp = require('sharp');

// Use Node's HTTP parser and the real Express app without opening a TCP port.
function requestInProcess(server, pathname, { method = 'GET', headers, body }) {
  const socketFor = other => Object.assign(new Duplex({
    read() {},
    write(chunk, _encoding, done) { other().push(chunk); done(); },
    final(done) { other().push(null); done(); },
  }), { remoteAddress: '127.0.0.1', setTimeout() { return this; } });
  return new Promise((resolve, reject) => {
    const request = http.request({ path: pathname, method, headers, createConnection: () => {
      const client = socketFor(() => peer);
      const peer = socketFor(() => client);
      server.emit('connection', peer);
      return client;
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('Midjourney V8.2 uses Fast Imagine, preserves task IDs, and settles points once', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midjourney-job-'));
  Object.assign(process.env, {
    MYSQL_URL: '', MYSQL_HOST: '', MYSQL_DATABASE: '',
    AUTH_STORE_FILE: path.join(root, 'auth.json'), BILLING_FILE_PATH: path.join(root, 'billing.json'),
    IMAGE_JOB_STORAGE_ROOT: root, IMAGE_JOB_POLL_INTERVAL_MS: '10',
    MOUXIHUB_MIDJOURNEY_API_KEY: '',
  });
  const submitUrl = 'https://api.mouxihub.com/mj-fast/mj/submit/imagine';
  const composite = 'https://cdn.example.com/midjourney-grid.png';
  const originals = ['red', 'blue', 'green', 'yellow'].map(color => `https://cdn.example.com/midjourney-${color}.png`);
  const taskId = '14001929738841629';
  const failedTaskId = '14001929738841630';
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  const images = await Promise.all(['red', 'blue', 'green', 'yellow'].map(background =>
    sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
  const reference = `data:image/png;base64,${image.toString('base64')}`;
  const submissions = [];
  const polls = [];
  const nativeFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.mouxihub.com/')) return nativeFetch(url, options);
    assert.equal(options.headers.Authorization, 'Bearer fixture-midjourney-key');
    if (options.method === 'POST') {
      assert.equal(url, submitUrl);
      submissions.push(JSON.parse(options.body));
      return new Response(`{"code":22,"result":${submissions.length === 1 ? taskId : failedTaskId}}`);
    }
    polls.push(url);
    return url.endsWith(`/${failedTaskId}/fetch`)
      ? Response.json({ status: 'FAILURE', failReason: 'provider refused fixture-midjourney-key' })
      : Response.json({ status: 'SUCCESS', imageUrl: composite, imageUrls: originals.map(url => ({ url })) });
  };
  const assets = require('./imageJobAssets.cjs');
  const createAssets = assets.createImageJobAssets;
  let imageAssets;
  assets.createImageJobAssets = options => (imageAssets = createAssets({ ...options, download: async url => {
    const index = originals.indexOf(url);
    assert.notEqual(index, -1, 'Only the individual results should be downloaded');
    return images[index];
  } }));
  const recordStore = require('./generationRecordStore.cjs');
  const records = new Map();
  recordStore.createGenerationRecord = async value => {
    const record = { ...value, id: `record-${records.size + 1}` };
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
    await fs.rm(root, { recursive: true, force: true });
  });
  const auth = require('./authStore.cjs');
  const billing = require('./billingStore.cjs');
  const credentials = { email: 'midjourney-owner@example.com', password: 'test-password-1' };
  const registration = await auth.registerWithPassword(credentials);
  const session = await auth.loginWithPassword(credentials);
  const account = await billing.ensureAccountForUser(registration.user);
  await billing.rechargeAccount(account.accountId, 10);
  const request = (pathname, opts = {}) => requestInProcess(server, pathname, {
    headers: { 'content-type': 'application/json', 'x-auth-session': session.sessionToken }, ...opts,
  });
  const modelId = 'midjourney-v8.2-tehui';
  const routeId = 'midjourney-v8.2-mouxihub-fast';
  const requestBody = { modelId, routeId, prompt: 'A winter evening --version 7 --relax', aspect_ratio: '3:4', n: 1, clientRequestId: 'mj-success' };
  const submit = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) });
  const catalogBefore = await (await request('/api/image-routes/catalog')).json();
  assert.equal(catalogBefore.routes.some(route => route.id === routeId), false);
  assert.equal(catalogBefore.routes.some(route => route.id === 'midjourney-v8.2-osodm-wending'), true);
  assert.equal((await submit('/api/generate', requestBody)).status, 503);
  process.env.MOUXIHUB_MIDJOURNEY_API_KEY = 'fixture-midjourney-key';
  const catalog = await (await request('/api/image-routes/catalog')).json();
  const selectedRoute = catalog.routes.find(route => route.id === routeId);
  assert.equal(selectedRoute.pointCost, 8);
  assert.equal(selectedRoute.label, '官转特价线路');
  assert.equal(selectedRoute.modelFamily, modelId);
  assert.equal(selectedRoute.isDefaultRoute, false);
  assert.doesNotMatch(JSON.stringify(catalog), /fixture-midjourney-key/);
  assert.equal((await submit('/api/generate', { ...requestBody, n: 2 })).status, 400);

  const body = { ...requestBody, images: [reference] };
  const accepted = await submit('/api/generate', body);
  assert.equal(accepted.status, 202);
  const job = await accepted.json();
  assert.equal((await (await submit('/api/generate', body)).json()).task_id, job.task_id);
  const waitFor = async (id, ready) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const state = await (await request(`/api/task/${id}`)).json();
      if (ready(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Image job did not settle');
  };
  const result = await waitFor(job.task_id, state => state.storage_status === 'saved' && records.get('record-1')?.status === 'SUCCESS');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.results.length, 4);
  for (const [index, resultUrl] of result.results.entries()) {
    assert.match(resultUrl, /\/api\/image-job-assets\//);
    assert.deepEqual(Buffer.from(await (await request(resultUrl)).arrayBuffer()), images[index]);
  }
  assert.equal(records.get('record-1').resultUrls.length, 4);
  assert.deepEqual(submissions, [{ prompt: 'A winter evening --ar 3:4 --v 8.2', base64Array: [reference] }]);
  assert.deepEqual(polls, [`https://api.mouxihub.com/mj-fast/mj/task/${taskId}/fetch`]);
  assert.equal((await billing.getAccountSummary(account.accountId)).points, 2);

  await billing.rechargeAccount(account.accountId, 8);
  const rejected = await submit('/api/generate', { ...requestBody, clientRequestId: 'mj-failure' });
  assert.equal(rejected.status, 202);
  const failed = await waitFor((await rejected.json()).task_id, state => state.status === 'failed' && records.get('record-2')?.status === 'FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /fixture-midjourney-key/);
  assert.equal((await billing.getAccountSummary(account.accountId)).points, 10);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].base64Array.length, 0);
});

test('Midjourney accepts JSON-string image lists and falls back to a single-image response', async t => {
  const { pollMidjourneyImage } = require('./mouxihubMidjourneyApi.cjs');
  const url = 'https://api.mouxihub.com/mj-fast/mj/task/123/fetch';
  const first = 'https://cdn.example.com/first.png';
  const second = 'https://cdn.example.com/second.png';
  const composite = 'https://cdn.example.com/grid.png';
  const fetch = t.mock.method(global, 'fetch');
  fetch.mock.mockImplementationOnce(async () => Response.json({
    status: 'SUCCESS', image_url: composite,
    image_urls: JSON.stringify([{ url: first }, { url: 'invalid' }, { url: first }, { url: second }]),
  }));
  fetch.mock.mockImplementationOnce(async () => Response.json({ status: 'SUCCESS', imageUrl: composite, imageUrls: [] }), 1);
  assert.deepEqual(await pollMidjourneyImage(url, 'fixture-key'), { status: 'success', results: [first, second] });
  assert.deepEqual(await pollMidjourneyImage(url, 'fixture-key'), { status: 'success', results: [composite] });
});
