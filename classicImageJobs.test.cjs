const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const clientSource = fs.readFileSync('public/classic-app/image-job-client.js', 'utf8');
const bridgeSource = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
function client(fetch, extra = {}) {
  const scope = { fetch, AbortController, setTimeout, clearTimeout, crypto: { randomUUID: () => 'stable' }, ...extra };
  vm.runInNewContext(clientSource, scope);
  return scope.ClassicImageJobs;
}
test('VIP admission recovers a lost acknowledgement without repeating a paid request', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ task_id: 'job-existing', status: 'succeeded', images: ['/image.png'] }));
  });
  assert.equal((await api.submit('/api/edit', { prompt: 'same' }, {}, 'stable')).task_id, 'job-existing');
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[1].url, '/api/image-jobs/request/stable');
});
test('VIP safely retries the identical body after confirmed missing admission', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    if (calls.length === 2) return new Response('{}', { status: 404 });
    return new Response('{"task_id":"job-new"}', { status: 202 });
  });
  assert.equal((await api.submit('/api/gemini/generate', { prompt: 'same' }, {}, 'stable')).task_id, 'job-new');
  assert.equal(calls[0].options.body, calls[2].options.body);
});
test('VIP reload recovers a never-admitted request from IndexedDB with the same payload', async () => {
  const { indexedDB } = require('fake-indexeddb');
  const extra = { indexedDB, classicImageJobOwner: 'vip-reload-owner', localStorage: { getItem: () => 'vip-reload-session' } };
  const header = { 'X-Auth-Session': 'vip-reload-session' };
  const original = client(async () => { throw new TypeError('Failed to fetch'); }, extra);
  const payload = { uiMode: 'classic', prompt: 'reference', images: ['data:image/png;base64,AA=='] };
  assert.equal((await original.submit('/api/edit', payload, header, 'vip-reload-req', extra.classicImageJobOwner)).connection_status, 'recovering');
  const calls = [];
  const reloaded = client(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/image-jobs/request/')) return new Response('{}', { status: 404 });
    if (url.includes('/auth/session')) return new Response(JSON.stringify({ user: { userId: extra.classicImageJobOwner } }));
    return new Response('{"task_id":"job-reloaded"}', { status: 202 });
  }, extra);
  assert.equal((await reloaded.query('request-vip-reload-req', header, '', extra.classicImageJobOwner)).task_id, 'job-reloaded');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { ...payload, asyncTask: true, clientRequestId: 'vip-reload-req' });
});
test('VIP cached owner cannot resend an old upload with a new account session', async () => {
  const { indexedDB } = require('fake-indexeddb');
  const posts = [];
  const api = client(async (url, options) => {
    if (options.method === 'POST') posts.push(options);
    if (url.includes('/auth/session')) return new Response('{"user":{"userId":"vip-owner-B"}}');
    return new Response('{}', { status: 404 });
  }, { indexedDB, classicImageJobOwner: 'vip-owner-A', localStorage: { getItem: () => 'vip-session-B' } });
  await assert.rejects(api.query('request-old', { 'X-Auth-Session': 'vip-session-B' }, '', 'vip-owner-A'), error => error.status === 401);
  assert.equal(posts.length, 0);
});
function pollHarness(query) {
  const pending = [], failed = [], completed = [], updates = [], history = [], uiSettles = [];
  const tasks = [];
  let session = 'owner-a';
  const scope = {
    window: { ClassicImageJobs: { query }, updateClassicLiveTask: (...args) => updates.push(args), failClassicLiveTask: (...args) => failed.push(args), completeClassicLiveTask: (...args) => {
      completed.push(args);
      const task = tasks.find(item => item.id === args[0]);
      if (task) Object.assign(task, { status: 'success', originalUrl: args[1] });
    } },
    classicLiveTasks: tasks,
    document: { getElementById: () => null }, Date, console: { warn() {} },
    activeTaskPollers: new Map(), remotePendingPollRegistry: new Set(), TASK_POLL_MAX_MS: 1800000,
    getStoredSessionToken: () => session, isSessionAuthenticated: () => true, buildSessionHeaders: () => ({}),
    buildApiKeyHeaders: () => ({}), CONFIG: { queryUrl: '/api/task/{id}' },
    setTimeout: fn => { pending.push(fn); return pending.length; }, clearTimeout() {},
    getTaskPollDelayMs: () => 5000, canUpdateMainUi: () => false,
    loadedImageCount: 0, completedTasksCount: 0, activeTasksCount: 1,
    checkAllDone: (...args) => uiSettles.push(args),
    appendImageToGrid: (...args) => {
      history.push(args);
      scope.loadedImageCount++; scope.completedTasksCount++; scope.activeTasksCount--;
      scope.checkAllDone(args[1]);
    },
    removePendingTask() {}, removePendingTaskFromGallery() {}, saveToHistory: (...args) => history.push(args),
    extractClassicApiError: (data, fallback) => data.error || fallback,
    extractImmediateImageUrls: data => data.images || [],
  };
  const start = bridgeSource.indexOf('  pollSingleTask = async function');
  const end = bridgeSource.indexOf('  runGen = async function', start);
  vm.runInNewContext(bridgeSource.slice(start, end), scope);
  return { scope, pending, failed, completed, updates, history, tasks, uiSettles, switchAccount: () => { session = 'owner-b'; } };
}

test('VIP a recovered managed success acknowledgement joins polling instead of completing twice', async () => {
  const h = pollHarness(async () => ({ status: 'succeeded', images: ['/original.png'] }));
  const polled = [];
  Object.assign(h.scope, {
    bridgeAuthState: { user: { userId: 'owner-a' } },
    getCurrentRoute: () => ({}), buildGenerateHeaders: () => ({}),
    shouldUseDirectApiKeyForRoute: () => false,
    savePendingTask() {}, addPendingTaskToGallery() {},
    pollSingleTask: (...args) => polled.push(args),
  });
  Object.assign(h.scope.window.ClassicImageJobs, {
    newId: () => 'same-request',
    request: async () => ({ user: { userId: 'owner-a' } }),
    submit: async () => ({ task_id: 'job-test', status: 'succeeded', images: ['/original.png'] }),
  });
  const start = bridgeSource.indexOf('  submitSingleTask = async function');
  const end = bridgeSource.indexOf('  pollSingleTask = async function', start);
  vm.runInNewContext(bridgeSource.slice(start, end), h.scope);
  await h.scope.submitSingleTask({ prompt: 'same' }, '', '1K', 1, { liveTaskId: 'live-test' });
  assert.equal(h.completed.length, 0);
  assert.equal(polled.length, 1);
});

test('VIP real and synthetic pollers record one completed live card only once', async () => {
  const h = pollHarness(async () => ({ task_id: 'job-test', status: 'succeeded', images: ['/original.png'] }));
  h.tasks.push({ id: 'live-test', taskId: 'job-test', status: 'running' });
  await h.scope.pollSingleTask('job-test', '', '1K', 1, { liveTaskId: 'live-test' });
  await h.scope.pollSingleTask('request-same-request', '', '1K', 1, { liveTaskId: 'live-test' });
  await h.pending.shift()();
  await h.pending.shift()();
  assert.equal(h.history.length, 1);
});

test('VIP background-first completion settles the active run without recording another result', async () => {
  const h = pollHarness(async () => ({ task_id: 'job-test', status: 'succeeded', images: ['/original.png'] }));
  h.scope.canUpdateMainUi = (_token, tracked) => tracked;
  h.tasks.push({ id: 'live-test', taskId: 'job-test', status: 'running' });
  await h.scope.pollSingleTask('request-same-request', '', '1K', 1, { liveTaskId: 'live-test', trackUi: false });
  await h.scope.pollSingleTask('job-test', '', '1K', 1, { liveTaskId: 'live-test', trackUi: true, runToken: 1 });
  await h.pending.shift()();
  await h.pending.shift()();
  assert.equal(h.history.length, 1);
  assert.equal(h.scope.activeTasksCount, 0);
  assert.equal(h.uiSettles.length, 1);
});

test('VIP a tracked run joins an already polling recovery task and settles its counters', async () => {
  const h = pollHarness(async () => ({ task_id: 'job-test', status: 'succeeded', images: ['/original.png'] }));
  h.scope.canUpdateMainUi = (_token, tracked) => tracked;
  h.tasks.push({ id: 'live-test', taskId: 'job-test', status: 'running' });
  await h.scope.pollSingleTask('job-test', '', '1K', 1, { liveTaskId: 'live-test', trackUi: false });
  await h.scope.pollSingleTask('job-test', '', '1K', 1, { liveTaskId: 'live-test', trackUi: true, runToken: 1 });
  assert.equal(h.pending.length, 1);
  await h.pending.shift()();
  assert.equal(h.scope.activeTasksCount, 0);
  assert.equal(h.uiSettles.length, 1);
});

test('VIP a late acknowledgement cannot move an already completed card back to running', () => {
  const task = { id: 'live-test', taskId: 'request-same-request', status: 'success', originalUrl: '/original.png' };
  const scope = { classicLiveTasks: [task], Date, findClassicLiveTaskIndex: () => 0, normalizeClassicLiveTask: value => value, persistClassicLiveTasks() {}, renderClassicLiveTasks() {} };
  const source = fs.readFileSync('public/classic-app/script.js', 'utf8');
  const start = source.indexOf('function promoteClassicLiveTask(');
  const end = source.indexOf('function completeClassicLiveTask(', start);
  vm.runInNewContext(source.slice(start, end), scope);
  scope.promoteClassicLiveTask('live-test', 'job-test', { status: 'running' });
  assert.equal(scope.classicLiveTasks[0].status, 'success');
  assert.equal(scope.classicLiveTasks[0].taskId, 'job-test');
});
test('VIP repeated poll disconnections remain recoverable and eventually receive the preview', async () => {
  let calls = 0;
  const h = pollHarness(async () => { if (++calls <= 6) throw new TypeError('Failed to fetch'); return { status: 'succeeded', images: ['/original.png'], preview_url: '/preview.webp' }; });
  await h.scope.pollSingleTask('job-test', '', '1K', 1);
  for (let i = 0; i < 7; i++) await h.pending.shift()();
  assert.equal(h.failed.length, 0);
  assert.equal(h.completed.length, 1);
  assert.equal(h.completed[0][2].previewUrl, '/preview.webp');
});
test('VIP confirmed backend failure still finishes the card as failed', async () => {
  const h = pollHarness(async () => ({ status: 'failed', error: 'upstream504' }));
  await h.scope.pollSingleTask('job-test', '', '1K', 1);
  await h.pending.shift()();
  assert.equal(h.failed[0][1], 'upstream504');
});
test('VIP completed generation with failed storage is distinct from a failed generation', async () => {
  const h = pollHarness(async () => ({ status: 'succeeded', images: [], storage_status: 'failed' }));
  await h.scope.pollSingleTask('job-test', '', '1K', 1);
  await h.pending.shift()();
  assert.equal(h.failed.length, 0);
  assert.equal(h.updates.at(-1)[1].status, 'result-unavailable');
});
test('VIP poll ignores results from an account that has been switched out', async () => {
  const h = pollHarness(async () => { h.switchAccount(); return { status: 'succeeded', images: ['/other-account.png'] }; });
  await h.scope.pollSingleTask('job-test', '', '1K', 1);
  await h.pending.shift()();
  assert.equal(h.completed.length, 0);
  assert.equal(h.scope.activeTaskPollers.size, 0);
});
