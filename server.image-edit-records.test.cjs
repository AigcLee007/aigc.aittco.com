const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeTest = require('node:test');
const test = globalThis.test || nodeTest.test;

const source = fs.readFileSync('server.cjs', 'utf8');
const handlerSource = source.slice(source.indexOf('app.post("/api/edit"'), source.indexOf('app.get("/api/proxy/image"'));

function harness({ background = true, response = { data: [{ url: 'https://example.com/image.png' }] }, fail = false } = {}) {
  const records = [];
  const jobs = new Map();
  let handler;
  let finishUpstream;
  const upstream = new Promise((resolve, reject) => { finishUpstream = () => fail ? reject(new Error('upstream failed')) : resolve({ data: response }); });
  const route = { id: 'gpt-image-2-line2', editPath: '/v1/images/edits', mode: background ? 'sync' : 'async', transport: 'openai-image' };
  const context = {
    app: { post: (_path, _limiter, fn) => { handler = fn; } }, generateLimiter() {},
    console: { log() {}, error() {} }, logger: { error() {}, info() {} }, Buffer,
    FormData: class { append() {} getHeaders() { return {}; } },
    resolveImageRoute: async () => route, resolveRequestedImageModel: async () => ({ id: 'gpt-image-2', label: 'GPT Image 2' }),
    shouldUseUserProvidedApiKey: () => false, getRoutePointCost: () => 3,
    requireBillingAccount: async () => ({ accountId: 'account' }), getRouteModelName: () => 'gpt-image-2',
    isGptImage2RequestModel: () => true, normalizeGptImage2RequestSize: () => '1024x1024', getRouteAuthorization: () => 'test',
    reservePoints: async () => ({ chargeId: 'charge', account: { points: 10 } }), refundPoints: async () => {},
    shouldRunGptImage2SyncRouteInBackground: () => background,
    createLocalImageJobId: () => 'local-job', buildImageTaskToken: (_route, id) => `token-${id}`,
    setLocalImageJob: (id, data) => jobs.set(id, { ...jobs.get(id), ...data }), scheduleLocalImageJobCleanup() {},
    registerPendingTask: async () => {}, settlePendingTask: async () => {},
    axios: { post: () => upstream }, requestWithRetry: (fn) => fn(), buildRouteUrl: () => 'http://upstream.test',
    createTransientHttpsAgent() {}, SHARED_HTTPS_AGENT: {},
    extractResultUrlsFromPayload: (data) => data.data?.map(x => x.url).filter(Boolean) || [],
    extractResultStatus: (data) => data.status || '', isTaskFailureStatus: (status) => status === 'failed',
    isImmediateImageResultPayload: (_data, urls) => urls.length > 0,
    toImmediateImagePayload: (data) => data,
    persistImageResultPayloadSafe: async ({ payload, resultUrls }) => ({ payload, resultUrls, previewUrl: resultUrls[0] }),
    normalizeGenerationError: (error) => ({ error: error.message }), respondWithUserFacingGenerationError: (res, error) => res.status(500).json({ error: error.message }),
    normalizeGenerationUiMode: (mode) => mode || 'canvas', normalizeClientLiveTaskIds: (ids) => Array.isArray(ids) ? ids : [ids].filter(Boolean),
    buildGenerationRecordPayload: async (data) => { const record = { id: 'record', ...data }; records.push(record); return record; },
    attachTaskToGenerationRecord: async (_id, taskId) => { records[0].taskId = taskId; },
    completeGenerationRecordSuccessSafe: async (data) => Object.assign(records[0], data, { status: 'SUCCESS' }),
    completeGenerationRecordFailureSafe: async (data) => Object.assign(records[0], data, { status: 'FAILED' }),
    mergeGeneratedAssetMeta: (meta) => meta,
  };
  vm.createContext(context);
  vm.runInContext(handlerSource, context);
  return {
    records, jobs, finishUpstream,
    async submit() {
      let payload;
      const res = { status() { return this; }, json(data) { payload = data; return this; } };
      await handler({ headers: {}, authUser: { userId: 'user' }, body: { prompt: 'edit', model: 'gpt-image-2', uiMode: 'classic', clientLiveTaskId: 'live', images: ['data:image/png;base64,YQ=='] } }, res);
      return payload;
    },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
  };
}

test('background edits persist task acknowledgement and successful image for later recovery', async () => {
  const h = harness();
  const response = await h.submit();
  assert.equal(response.task_id, 'token-local-job');
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].status, 'PENDING');
  assert.equal(h.records[0].taskId, response.task_id);
  assert.deepEqual(Array.from(h.records[0].meta.clientLiveTaskIds), ['live']);
  h.finishUpstream();
  await h.flush();
  assert.equal(h.records[0].status, 'SUCCESS');
  assert.equal(h.records[0].resultUrls[0], 'https://example.com/image.png');
});

test('background edit failures persist a final error', async () => {
  const h = harness({ fail: true });
  await h.submit();
  h.finishUpstream();
  await h.flush();
  assert.equal(h.records[0]?.status, 'FAILED');
  assert.equal(h.records[0]?.errorMessage, 'upstream failed');
});

test('upstream async edits attach the returned task ID to their recovery record', async () => {
  const h = harness({ background: false, response: { task_id: 'upstream-task', status: 'processing' } });
  h.finishUpstream();
  const response = await h.submit();
  assert.equal(response.task_id, 'token-upstream-task');
  assert.equal(h.records[0]?.taskId, response.task_id);
});

test('immediate edit results persist in generation history', async () => {
  const h = harness({ background: false });
  h.finishUpstream();
  await h.submit();
  assert.equal(h.records[0]?.status, 'SUCCESS');
  assert.equal(h.records[0]?.resultUrls[0], 'https://example.com/image.png');
});
