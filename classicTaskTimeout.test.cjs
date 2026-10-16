const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeTest = require('node:test');
const test = globalThis.test || nodeTest.test;

const source = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
const submitSource = source.slice(source.indexOf('  submitSingleTask = async function'), source.indexOf('  pollSingleTask = async function'));
const pollSource = source.slice(source.indexOf('  pollSingleTask = async function'), source.indexOf('  runGen = async function'));
const helperSource = source.slice(source.indexOf('  const TASK_POLL_MAX_MS'), source.indexOf('  let remoteHistoryRecordsCache'));

function harness(fetchImpl = () => new Promise(() => {})) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const failures = [];
  const requests = [];
  let submitted = 0;
  const context = {
    Date: { now: () => now }, console: { warn() {}, error() {} }, AbortController, Error,
    document: { getElementById: () => ({ value: 'test' }) },
    window: { failClassicLiveTask: (_id, message) => failures.push(message) },
    CONFIG: { submitUrl: '/api/generate', queryUrl: '/api/task/{id}' },
    activeTaskPollers: new Map(), remotePendingPollRegistry: new Set(),
    getTaskPollDelayMs: () => 5000, getCurrentRoute: () => ({ id: 'gpt-image-2-line2', mode: 'sync' }),
    isSessionAuthenticated: () => true, buildSessionHeaders: () => ({}), buildApiKeyHeaders: () => ({}), buildGenerateHeaders: () => ({}),
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout: (timerId) => timers.delete(timerId),
    removePendingTask() {}, removePendingTaskFromGallery() {}, canUpdateMainUi: () => true,
    handleSingleError: (message) => failures.push(message),
    extractClassicApiError: (error, fallback) => error?.message || fallback || 'error',
    extractImmediateImageUrls: (data) => data.url ? [data.url] : [],
  };
  vm.createContext(context);
  vm.runInContext(helperSource + submitSource + pollSource, context);
  return {
    context, failures, requests, timers,
    submit: () => context.submitSingleTask({}, '', '1K', 1, { liveTaskId: 'live', onSubmitSettled: () => submitted++ }),
    settled: () => submitted,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = end;
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

test('classic submission stops waiting after the acknowledgement deadline, without resubmitting', async () => {
  const h = harness();
  h.submit();
  await h.advance(120001);
  assert.equal(h.settled(), 1);
  assert.match(h.failures[0], /结果未确认/);
  assert.equal(h.requests.length, 1);
});

test('classic submission also bounds a stalled JSON response body', async () => {
  const h = harness(async () => ({ ok: true, json: () => new Promise(() => {}) }));
  h.submit();
  await h.advance(120001);
  assert.equal(h.settled(), 1);
  assert.match(h.failures[0], /结果未确认/);
});

test('classic query has a deadline even when fetch never completes', async () => {
  const h = harness();
  await h.context.pollSingleTask('task', '', '1K', 1, { liveTaskId: 'live' });
  await h.advance(31 * 60000);
  assert.equal(h.context.activeTaskPollers.size, 0);
  assert.ok(h.failures.length > 0);
});

test('classic query ignores a response arriving after its total deadline', async () => {
  let resolveRequest;
  const h = harness(() => new Promise((resolve) => { resolveRequest = resolve; }));
  let completed = 0;
  h.context.window.completeClassicLiveTask = () => completed++;
  await h.context.pollSingleTask('task', '', '1K', 1, { liveTaskId: 'live' });
  await h.advance(31 * 60000);
  resolveRequest({ ok: true, json: async () => ({ status: 'succeeded', url: 'https://example.com/image.png' }) });
  await h.advance(0);
  assert.equal(completed, 0);
});
