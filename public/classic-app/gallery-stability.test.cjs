const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('public/classic-app/script.js', 'utf8');
const between = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

function tasksHarness(tasks = []) {
  const scope = { classicLiveTasks: tasks, window: {}, Date, localStorage: { setItem() {} }, CLASSIC_LIVE_MAX_TASKS: 30,
    normalizeClassicLiveTask: x => ({ ...x }), getClassicLiveStorageKey: () => 'owner-tasks',
    cleanClassicLiveMeta: x => ({ ...x }), getClassicLine4ThumbUrl: () => '', makeClassicLiveId: () => 'created',
    renderClassicLiveTasks() { scope.renders++; }, renders: 0,
    findClassicLiveTaskIndex: id => scope.classicLiveTasks.findIndex(task => task.id === id || task.taskId === id),
  };
  vm.createContext(scope);
  vm.runInContext(between('function normalizeClassicLiveTask(', 'function readClassicLiveTasks('), scope);
  scope.classicLiveTasks = tasks.map(scope.normalizeClassicLiveTask);
  vm.runInContext(between('function findClassicLiveTaskIndex(', 'function getClassicLiveFullUrl('), scope);
  vm.runInContext(between('function persistClassicLiveTasks()', 'function getClassicLiveStorageKey()'), scope);
  vm.runInContext(between('function createClassicLiveTask(', 'function removeClassicLiveTask('), scope);
  vm.runInContext(between('function completeClassicLiveTask(', 'function failClassicLiveTask('), scope);
  return scope;
}

test('updating an old task cannot reorder immutable submission positions', () => {
  const scope = tasksHarness([{ id: 'animal', createdAt: 200, updatedAt: 200 }, { id: 'calligraphy', createdAt: 100, updatedAt: 100 }]);
  scope.updateClassicLiveTask('calligraphy', { connectionMessage: '联网后恢复' });
  assert.deepEqual(Array.from(scope.classicLiveTasks, x => x.id), ['animal', 'calligraphy']);
});

test('repeat completion preserves first completion/submission time and does not render', () => {
  const scope = tasksHarness([{ id: 'same', taskId: 'job-same', status: 'success', originalUrl: '/same.png', previewUrl: '', errorMessage: '', createdAt: 100, completedAt: 200 }]);
  scope.completeClassicLiveTask('same', '/same.png', { taskId: 'job-same', createdAt: 999 });
  assert.equal(scope.classicLiveTasks[0].createdAt, 100);
  assert.equal(scope.classicLiveTasks[0].completedAt, 200);
  assert.equal(scope.renders, 0);
});

test('restored tasks retain original server submission timestamps', () => {
  const scope = tasksHarness();
  scope.createClassicLiveTask({ id: 'restore', createdAt: 100 });
  assert.equal(scope.classicLiveTasks[0].createdAt, 100);
});

test('updating a different VIP task leaves the completed card connected', () => {
  const dom = new JSDOM('<div id="classicLiveGrid"></div>');
  const scope = { window: dom.window, document: dom.window.document, Date, Map, Set,
    CLASSIC_VIP_MODE: true, classicLiveSelectedId: '', classicLiveRenderSignature: '',
    classicImageBinder: null, classicImageBindings: new Map(),
    classicLiveTasks: [{ id: 'done', status: 'success', originalUrl: '/full.png', createdAt: 2 }, { id: 'running', status: 'running', createdAt: 1 }],
    getClassicLiveFullUrl: task => task.originalUrl || '', getClassicLivePreviewUrl: task => task.previewUrl || '',
    getClassicImageDisplayUrl: (full, preview) => preview || full, getClassicLiveStatusLabel: status => status,
    formatClassicLiveClock: () => '12:00', escapeHtml: x => String(x), bindClassicPreviewImage() {}, releaseClassicImageTree() {},
  };
  scope.window.matchMedia = () => ({ matches: false });
  vm.createContext(scope);
  vm.runInContext(between('function renderClassicLiveTasks()', 'function createClassicLiveTask('), scope);
  scope.renderClassicLiveTasks();
  const grid = scope.document.getElementById('classicLiveGrid');
  const card = grid.firstElementChild;
  const observer = new dom.window.MutationObserver(() => {});
  observer.observe(grid, { childList: true, subtree: true });
  scope.classicLiveTasks[1].status = 'failed';
  scope.renderClassicLiveTasks();
  const detached = observer.takeRecords().some(record => Array.from(record.removedNodes).some(node => node === card || node.contains?.(card)));
  assert.equal(grid.firstElementChild, card);
  assert.equal(detached, false, 'an unchanged card must never be detached during reconciliation');
});

function historyHarness(extra = {}) {
  const { IDBFactory } = require('fake-indexeddb');
  const indexedDB = new IDBFactory();
  const scope = { window: { classicImageJobOwner: 'owner-a', ImageResultStore: { resultId: (owner, job, slot) => `result:${owner}:${job}:${slot}` } },
    Date, Map, Set, Promise, console, HISTORY_RECORD_STORE: 'records', HISTORY_MAX_RECORDS: 200,
    removeCachedHistoryImage() {}, getHistoryFullUrl: x => x.fullUrl || x.url || '', getClassicLine4ThumbUrl: () => '', genHistoryId: () => 'legacy-new',
    openHistoryCacheDB: () => new Promise((resolve, reject) => { const req = indexedDB.open('history', 1); req.onupgradeneeded = () => req.result.createObjectStore('records', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }),
    ...extra,
  };
  vm.createContext(scope);
  vm.runInContext(between('function normalizeHistoryRecord(', 'async function getHistoryMeta('), scope);
  vm.runInContext(between('async function readHistoryRecordsFromDB(', 'async function migrateLocalStorageHistoryToIndexedDB('), scope);
  return scope;
}

test('parallel history upserts retain both completions and another account', async () => {
  const h = historyHarness();
  await h.writeHistoryRecordsToDB([{ id: 'other', ownerId: 'owner-b', fullUrl: '/other.png' }]);
  await Promise.all([
    h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'job-a', outputIndex: 0, fullUrl: '/a.png', createdAt: 100 }]),
    h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'job-b', outputIndex: 0, fullUrl: '/b.png', createdAt: 200 }]),
  ]);
  assert.equal((await h.readHistoryRecordsFromDB()).length, 2);
  assert.equal((await h.readHistoryRecordsFromDB({ ownerId: 'owner-b' })).length, 1);
});

test('site URL and late preview replace same output without changing immutable times or legacy bytes', async () => {
  const h = historyHarness();
  await h.writeHistoryRecordsToDB([{ id: 'old-record', fullUrl: '/provider.png', createdAt: 50 }]);
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'job-a', outputIndex: 0, fullUrl: '/provider.png', createdAt: 100, completedAt: 200, allowLegacyAssociation: true }]);
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'job-a', outputIndex: 0, fullUrl: '/site.png', previewUrl: '/preview.webp', createdAt: 999, completedAt: 999 }]);
  const records = await h.readHistoryRecordsFromDB();
  assert.equal(records.length, 1);
  assert.equal(records[0].fullUrl, '/site.png');
  assert.equal(records[0].previewUrl, '/preview.webp');
  assert.equal(Date.parse(records[0].createdAt), 100);
  assert.equal(Date.parse(records[0].completedAt), 200);
  assert.equal(records[0].legacyId, 'old-record');
  assert.equal((await h.readHistoryRecordsFromDB({ allOwners: true })).length, 2, 'ownerless legacy bytes remain associated only explicitly');
});

test('normalizing an owned pre-upgrade history row retains its original cache key', () => {
  const h = historyHarness();
  const row = h.normalizeHistoryRecord({ id: 'old-owned-row', ownerId: 'owner-a', jobId: 'job-a', fullUrl: '/a.png' });
  assert.equal(row.id, 'result:owner-a:job-a:0');
  assert.equal(row.legacyId, 'old-owned-row');
  assert.equal(h.normalizeHistoryRecord(row).legacyId, 'old-owned-row');
});

function keyedHistoryHarness() {
  const dom = new JSDOM('<div id="historyGrid"></div>');
  const binds = [], released = [];
  const h = historyHarness({ window: dom.window, document: dom.window.document,
    bindClassicPreviewImage: (img, input) => binds.push({ img, input }),
    releaseClassicImageTree: card => released.push(card), setHistoryCacheBadge() {}, escapeHtml: x => String(x),
    isClassicMobileViewport: () => false,
  });
  h.window.classicImageJobOwner = 'owner-a';
  vm.runInContext(between('function renderClassicHistoryRecords(', 'async function loadHistory('), h);
  return { h, dom, binds, released };
}

test('cold gallery binding registers legacy identity before the first image read', async () => {
  const dom = new JSDOM('<img id="test">');
  let finish;
  const registered = new Promise(resolve => { finish = resolve; });
  const bindings = new Map(), calls = [];
  Object.assign(dom.window, { classicImageJobOwner: 'owner-a', ClassicResultAssets: { registerResult: record => { calls.push(['register', record.legacyId]); return registered; } } });
  const scope = { window: dom.window, document: dom.window.document, classicImageBindings: bindings,
    classicImageBinder: { bind: (img, input) => calls.push(['bind', input.id]) },
    registerClassicImageAsset() {}, getClassicImageReader() {}, setClassicImageState() {}, console,
  };
  vm.createContext(scope);
  vm.runInContext(between('function bindClassicPreviewImage(', 'function releaseClassicImageTree('), scope);
  const img = dom.window.document.getElementById('test');
  scope.bindClassicPreviewImage(img, { id: 'stable', src: '/expired', record: { ownerId: 'owner-a', jobId: 'job', legacyId: 'old' } });
  assert.deepEqual(calls, [['register', 'old']]);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['register', 'old'], ['bind', 'stable']]);
  calls.length = 0;
  scope.bindClassicPreviewImage(img, { id: 'stale', record: { ownerId: 'owner-a' } });
  dom.window.classicImageJobOwner = 'owner-b';
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.some(call => call[0] === 'bind'), false);
  dom.window.close();
});

test('gallery merge leaves unchanged cards and previews connected while patching a late preview', () => {
  const { h, dom, binds } = keyedHistoryHarness();
  const a = { id: 'a', ownerId: 'owner-a', fullUrl: '/a.png', previewUrl: '/a.webp', createdAt: 200 };
  const b = { id: 'b', ownerId: 'owner-a', fullUrl: '/b.png', previewUrl: '/b.webp', createdAt: 100 };
  h.renderClassicHistoryRecords([a, b]);
  const grid = dom.window.document.getElementById('historyGrid'), first = grid.firstElementChild;
  const image = first.querySelector('img');
  const observer = new dom.window.MutationObserver(() => {}); observer.observe(grid, { childList: true, subtree: true });
  h.renderClassicHistoryRecords([a, { ...b, previewUrl: '/b-late.webp' }]);
  assert.equal(grid.firstElementChild, first); assert.equal(first.querySelector('img'), image);
  assert.equal(observer.takeRecords().some(r => Array.from(r.removedNodes).some(n => n === first || n.contains?.(first))), false);
  assert.equal(binds.length, 3, 'only the changed preview is rebound');
});

test('gallery uses bounded pages and owner changes never expose the previous account', () => {
  const { h, dom } = keyedHistoryHarness();
  const records = Array.from({ length: 100 }, (_, i) => ({ id: String(i), ownerId: 'owner-a', fullUrl: `/${i}.png`, createdAt: 1000 - i }));
  h.renderClassicHistoryRecords(records);
  assert.equal(dom.window.document.querySelectorAll('.history-item').length, 24);
  h.window.classicImageJobOwner = 'owner-b'; h.renderClassicHistoryRecords(records);
  assert.equal(dom.window.document.querySelectorAll('.history-item').length, 0);
});


const bridgeSource = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
const bridgeBetween = (a, b) => bridgeSource.slice(bridgeSource.indexOf(a), bridgeSource.indexOf(b, bridgeSource.indexOf(a)));
function bridgeHistoryHarness() {
  const h = historyHarness();
  const rendered = [], network = [];
  let session = 'session-a';
  Object.assign(h, { document: { getElementById: () => null }, URLSearchParams,
    remoteHistoryRecordsCache: [], remoteHistoryCursor: {}, historyLoadInFlight: null, historyRequestGeneration: 0, historyClearGeneration: 0, historyClearInFlight: null, historyCacheSession: '', lastHistoryRefreshAt: 0, remoteHistoryNextPage: 1, remoteHistoryTotalPages: 1,
    getStoredSessionToken: () => session, isSessionAuthenticated: () => true, getBridgeHistoryPageSize: () => 24,
    fetchGenerationRecords: () => new Promise((resolve, reject) => network.push({ resolve, reject })),
    migrateLocalStorageHistoryToIndexedDB: async () => {}, renderClassicHistoryRecords: rows => rendered.push(rows),
    legacyLoadHistory: async () => [], console: { warn() {} },
  });
  vm.runInContext(bridgeBetween('  const expandRemoteHistoryRecords =', '  const renderRemotePendingTasks =') + '\n globalThis.expandRemoteHistoryRecords = expandRemoteHistoryRecords;', h);
  vm.runInContext(bridgeBetween('  loadHistory = async function', '  savePendingTask = function'), h);
  return { h, rendered, network, switchAccount: () => { session = 'session-b'; h.window.classicImageJobOwner = 'owner-b'; } };
}

function clearHistoryHarness() {
  const fixture = bridgeHistoryHarness();
  const { h } = fixture;
  const deletes = [], modals = [], removedKeys = [];
  Object.assign(h, { historyRefreshTimer: null, assetFinalizationPollers: new Map(),
    deleteGenerationRecords: async options => { deletes.push(options); },
    showApiGuideModal: config => modals.push(config), closeApiGuideModal() {},
    legacyClearHistory() { throw new Error('authenticated clear must not use the local-only handler'); },
    localStorage: { removeItem: key => removedKeys.push(key) }, clearHistoryObjectUrlRefs() {},
  });
  vm.runInContext(bridgeBetween('  clearHistory = function', '  loadHistory = async function'), h);
  return { ...fixture, deletes, modals, removedKeys };
}

test('confirmed clear deletes account image history and both caches without deleting another owner', async () => {
  const { h, rendered, deletes, modals } = clearHistoryHarness();
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'old', fullUrl: '/old.png' }, { ownerId: 'owner-b', jobId: 'other', fullUrl: '/other.png' }]);
  h.remoteHistoryRecordsCache = [{ id: 'remote-old', resultUrls: ['/old.png'] }];
  h.clearHistory();
  assert.equal(deletes.length, 0, 'opening/cancelling the confirmation must not delete');
  assert.ok(modals[0]?.onPrimary, 'the confirmed handler must own account deletion');
  await modals[0].onPrimary();
  assert.equal(deletes[0].mediaType, 'image');
  assert.equal(h.remoteHistoryRecordsCache.length, 0);
  assert.equal((await h.readHistoryRecordsFromDB({ ownerId: 'owner-a' })).length, 0);
  assert.equal((await h.readHistoryRecordsFromDB({ ownerId: 'owner-b' })).length, 1);
  assert.equal(rendered.at(-1).length, 0);
});

test('failed account deletion keeps records and shows an error instead of claiming clear succeeded', async () => {
  const { h, modals } = clearHistoryHarness();
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'old', fullUrl: '/old.png' }]);
  h.deleteGenerationRecords = async () => { throw new Error('network unavailable'); };
  h.clearHistory();
  assert.ok(modals[0]?.onPrimary);
  await modals[0].onPrimary();
  assert.equal((await h.readHistoryRecordsFromDB()).length, 1);
  assert.equal(modals.at(-1).title, '清空失败');
});

test('late history responses cannot refill records after confirmed clear', async () => {
  const { h, network, modals } = clearHistoryHarness();
  const oldLoad = h.loadHistory();
  for (let i = 0; i < 20 && !network.length; i++) await new Promise(resolve => setImmediate(resolve));
  h.clearHistory();
  assert.ok(modals[0]?.onPrimary);
  await modals[0].onPrimary();
  network[0].resolve({ records: [{ id: 'deleted', status: 'SUCCESS', resultUrls: ['/deleted.png'] }] });
  await oldLoad;
  assert.equal((await h.readHistoryRecordsFromDB()).length, 0);
  assert.equal(h.remoteHistoryRecordsCache.length, 0);
});

test('account switch during deletion cannot clear the new account local history', async () => {
  const { h, modals, switchAccount, deletes } = clearHistoryHarness();
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-b', jobId: 'private', fullUrl: '/private.png' }]);
  let finish;
  h.deleteGenerationRecords = () => new Promise(resolve => { finish = resolve; });
  h.clearHistory();
  assert.ok(modals[0]?.onPrimary);
  const clearing = modals[0].onPrimary();
  switchAccount(); finish(); await clearing;
  assert.equal((await h.readHistoryRecordsFromDB({ ownerId: 'owner-b' })).length, 1);
  assert.equal(deletes.length, 0);
});

test('an invalidated IndexedDB writer cannot reinsert cleared rows after waiting to open the database', async () => {
  const h = historyHarness();
  const open = h.openHistoryCacheDB;
  let resume, current = true;
  h.openHistoryCacheDB = async () => { await new Promise(resolve => { resume = resolve; }); return open(); };
  const write = h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'deleted', fullUrl: '/deleted.png' }], { isCurrent: () => current });
  current = false; resume(); await write;
  h.openHistoryCacheDB = open;
  assert.equal((await h.readHistoryRecordsFromDB()).length, 0);
});

test('an account switch before confirmation never sends the deletion request', async () => {
  const { h, modals, switchAccount, deletes } = clearHistoryHarness();
  h.clearHistory(); switchAccount();
  await modals[0].onPrimary();
  assert.equal(deletes.length, 0);
});

function historyPollHarness() {
  const fixture = clearHistoryHarness();
  const { h } = fixture;
  const timers = [], queries = [], writes = [], completions = [], finalizations = [];
  Object.assign(h, { activeTaskPollers: new Map(), remotePendingPollRegistry: new Set(),
    TASK_POLL_MAX_MS: 100000, CONFIG: { queryUrl: '/query/{id}' }, classicLiveTasks: [],
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, getTaskPollDelayMs: () => 1,
    buildSessionHeaders: () => ({}), canUpdateMainUi: () => false,
    removePendingTask() {}, removePendingTaskFromGallery() {}, isClassicHistoryTabActive: () => false,
    scheduleClassicAssetFinalization: (...args) => finalizations.push(args),
  });
  h.window.ClassicImageJobs = { query: () => new Promise(resolve => queries.push(resolve)) };
  h.window.completeClassicLiveTask = (...args) => completions.push(args);
  vm.runInContext(between('async function saveToHistory(', 'function clearHistory()'), h);
  const save = h.saveToHistory;
  h.saveToHistory = (...args) => { const promise = save(...args); writes.push(promise); return promise; };
  vm.runInContext(bridgeBetween('  pollSingleTask = async function', '  runGen = async function'), h);
  return { ...fixture, timers, queries, writes, completions, finalizations };
}

test('a successful task response sent before clear cannot recreate history or start storage recovery', async () => {
  const { h, modals, timers, queries, writes, completions, finalizations } = historyPollHarness();
  await h.pollSingleTask('job-deleted', '', '1K', 1, { trackUi: false });
  const poll = timers.shift()();
  h.clearHistory(); await modals[0].onPrimary();
  queries.shift()({ status: 'succeeded', images: ['/deleted.png'], storage_status: 'pending' });
  await poll; await Promise.all(writes);
  assert.equal((await h.readHistoryRecordsFromDB()).length, 0);
  assert.equal(finalizations.length, 0, 'late results must not create a fresh recovery poller after clear');
  assert.equal(completions.length, 1, 'clearing history does not cancel task UI completion');
});

test('an unfinished task keeps polling and can save a new result queried after clear', async () => {
  const { h, modals, timers, queries, writes, completions } = historyPollHarness();
  await h.pollSingleTask('job-running', '', '1K', 1, { trackUi: false });
  const oldPoll = timers.shift()();
  h.clearHistory(); await modals[0].onPrimary();
  queries.shift()({ status: 'running', images: [] }); await oldPoll;
  assert.equal(h.activeTaskPollers.has('job-running'), true);
  const newPoll = timers.shift()();
  queries.shift()({ status: 'succeeded', images: ['/new.png'], storage_status: 'saved' });
  await newPoll; await Promise.all(writes);
  assert.equal((await h.readHistoryRecordsFromDB()).length, 1);
  assert.equal(completions.length, 1);
});

test('restoring completed jobs does not recreate explicitly deleted account history', async () => {
  const { h } = bridgeHistoryHarness();
  const applied = [];
  Object.assign(h, { confirmClassicImageOwner() {}, bridgeAuthState: {}, legacyRestorePendingTasks() {},
    buildSessionHeaders: () => ({}), classicLiveTasks: [],
    fetchGenerationRecords: async () => ({ records: [] }), renderRemotePendingTasks() {},
    applyManagedJobResults: async job => applied.push(job), scheduleClassicAssetFinalization() {},
  });
  h.window.ClassicImageJobs = { request: async url => url === '/api/auth/session'
    ? { user: { userId: 'owner-a' } } : { jobs: [{ task_id: 'job-deleted', status: 'succeeded', images: ['/deleted.png'] }] } };
  vm.runInContext(bridgeBetween('  restorePendingTasks = async function', '  submitSingleTask = async function'), h);
  await h.restorePendingTasks();
  assert.equal(applied.length, 0, 'server job recovery is not an authoritative history source after deletion');
});

test('restoring completed jobs still fills results whose account history exists', async () => {
  const { h } = bridgeHistoryHarness();
  const applied = [], queries = [];
  Object.assign(h, { confirmClassicImageOwner() {}, bridgeAuthState: {}, legacyRestorePendingTasks() {},
    buildSessionHeaders: () => ({}), classicLiveTasks: [], renderRemotePendingTasks() {},
    fetchGenerationRecords: async options => { queries.push(options); return { records: options.taskIds ? [{ taskId: 'job-retained' }] : [] }; },
    applyManagedJobResults: async job => applied.push(job), scheduleClassicAssetFinalization() {},
  });
  h.window.ClassicImageJobs = { request: async url => url === '/api/auth/session'
    ? { user: { userId: 'owner-a' } } : { jobs: [{ task_id: 'job-retained', status: 'succeeded', images: ['/retained.png'] }] } };
  vm.runInContext(bridgeBetween('  restorePendingTasks = async function', '  submitSingleTask = async function'), h);
  await h.restorePendingTasks();
  assert.equal(applied.length, 1);
  assert.deepEqual(Array.from(queries[0].taskIds), ['job-retained']);
});

test('clear during completed job restoration cannot start a new storage recovery poller', async () => {
  const { h, modals } = clearHistoryHarness();
  const finalizations = [];
  let resume;
  Object.assign(h, { confirmClassicImageOwner() {}, bridgeAuthState: {}, classicLiveTasks: [], renderRemotePendingTasks() {},
    buildSessionHeaders: () => ({}), fetchGenerationRecords: async () => ({ records: [{ taskId: 'job-deleted' }] }),
    applyManagedJobResults: () => new Promise(resolve => { resume = resolve; }),
    scheduleClassicAssetFinalization: (...args) => finalizations.push(args),
  });
  h.window.ClassicImageJobs = { request: async url => url === '/api/auth/session'
    ? { user: { userId: 'owner-a' } } : { jobs: [{ task_id: 'job-deleted', status: 'succeeded', images: ['/deleted.png'], storage_status: 'pending' }] } };
  vm.runInContext(bridgeBetween('  restorePendingTasks = async function', '  submitSingleTask = async function'), h);
  const restoring = h.restorePendingTasks();
  for (let i = 0; i < 20 && !resume; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resume, 'function');
  h.clearHistory(); await modals[0].onPrimary();
  resume(); await restoring;
  assert.equal(finalizations.length, 0);
});

test('multi-output history has stable distinct identities even when provider URLs change', () => {
  const { h } = bridgeHistoryHarness();
  const first = h.expandRemoteHistoryRecords([{ id: 'record', status: 'SUCCESS', meta: { imageJobId: 'job-one' }, resultUrls: ['/one.png', '/two.png'], createdAt: 100 }]);
  const next = h.expandRemoteHistoryRecords([{ id: 'record', status: 'SUCCESS', meta: { imageJobId: 'job-one', storageStatus: 'saved' }, resultUrls: ['/site-one.png', '/site-two.png'], previewUrl: '/late.webp', createdAt: 100 }]);
  assert.equal(first.length, 2); assert.notEqual(first[0].id, first[1].id);
  assert.equal(first[0].id, next[0].id); assert.equal(first[1].id, next[1].id);
  assert.equal(next[0].previewUrl, '/late.webp');
});

test('account history uses every retained preview and preserves metadata without an original URL', () => {
  const { h } = bridgeHistoryHarness();
  const outputs = h.expandRemoteHistoryRecords([{ id: 'record', prompt: 'keep this record', status: 'SUCCESS',
    meta: { imageJobId: 'job-one', previewUrls: ['/permanent-one.webp', '/permanent-two.webp'] }, resultUrls: [], createdAt: 100 }]);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].previewUrl, '/permanent-one.webp');
  assert.equal(outputs[1].previewUrl, '/permanent-two.webp');
  assert.equal(outputs[0].prompt, 'keep this record');
});

test('history paints local cards before slow remote query, coalesces refresh, and retains cards offline', async () => {
  const { h, rendered, network } = bridgeHistoryHarness();
  await h.writeHistoryRecordsToDB([{ ownerId: 'owner-a', jobId: 'local', fullUrl: '/local.png' }]);
  const first = h.loadHistory(); const second = h.loadHistory();
  for (let i = 0; i < 20 && !network.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered[0]?.[0]?.fullUrl, '/local.png'); assert.equal(network.length, 1);
  network[0].reject(new Error('offline')); await Promise.all([first, second]);
  assert.equal(rendered.at(-1)[0].fullUrl, '/local.png');
});

test('late response from previous account never persists or paints previous-account cards', async () => {
  const { h, rendered, network, switchAccount } = bridgeHistoryHarness();
  const pending = h.loadHistory();
  for (let i = 0; i < 20 && !network.length; i++) await new Promise(resolve => setImmediate(resolve));
  switchAccount();
  network[0].resolve({ records: [{ id: 'old-owner-record', status: 'SUCCESS', resultUrls: ['/private.png'] }] });
  await pending;
  assert.equal((await h.readHistoryRecordsFromDB({ allOwners: true })).length, 0);
  assert.equal(rendered.some(rows => rows.some(row => row.fullUrl === '/private.png')), false);
});

test('asset finalization updates saved URLs/previews for every output without settling generation counters twice', async () => {
  const { h } = bridgeHistoryHarness();
  const pending = [], completed = [], history = [];
  Object.assign(h, { assetFinalizationPollers: new Map(), assetFinalizationInFlight: 0, classicLiveTasks: [], recoveredResultSignatures: new Map(),
    setTimeout: work => { pending.push(work); return pending.length; }, clearTimeout() {},
    saveToHistory: async (...args) => { history.push(args); },
    loadedImageCount: 7, completedTasksCount: 7, activeTasksCount: 0, buildSessionHeaders: () => ({}),
  });
  Object.assign(h.window, { completeClassicLiveTask: (...args) => completed.push(args), ClassicImageJobs: {
    query: async () => ({ task_id: 'job-one', status: 'succeeded', storage_status: 'saved', images: ['/site-0.png', '/site-1.png'], preview_url: '/site.webp', completed_at: new Date().toISOString() }),
  } });
  vm.runInContext(bridgeBetween('  const retryMissingClassicResultAssets =', '  restorePendingTasks = async function') + '\n globalThis.scheduleClassicAssetFinalization = scheduleClassicAssetFinalization;', h);
  h.scheduleClassicAssetFinalization('job-one', { ownerId: 'owner-a', session: 'session-a', prompt: 'same' });
  await pending.shift()();
  assert.equal(history.length, 2); assert.equal(completed.length, 2);
  assert.equal(completed[0][2].previewUrl, '/site.webp'); assert.equal(completed[1][2].outputIndex, 1);
  assert.equal(h.assetFinalizationPollers.size, 0);
  assert.equal(h.loadedImageCount, 7); assert.equal(h.completedTasksCount, 7); assert.equal(h.activeTasksCount, 0);
});


test('two explicitly allocated live placeholders are filled separately for a multi-output job', () => {
  const h = tasksHarness([{ id: 'placeholder-0', taskId: 'job-many', status: 'running', createdAt: 100 }, { id: 'placeholder-1', taskId: 'job-many', status: 'running', createdAt: 100 }]);
  h.completeClassicLiveTask('placeholder-0', '/zero.png', { taskId: 'job-many', ownerId: 'owner-a', outputIndex: 0 });
  h.completeClassicLiveTask('placeholder-1', '/one.png', { taskId: 'job-many', ownerId: 'owner-a', outputIndex: 1 });
  assert.equal(h.classicLiveTasks.length, 2);
  assert.equal(h.classicLiveTasks.find(task => task.id === 'placeholder-1').status, 'success');
  assert.equal(h.classicLiveTasks.find(task => task.id === 'placeholder-1').outputIndex, 1);
});

test('logout removes persisted session before notifying recovery listeners', () => {
  const storage = new Map([['auth-session-v1', 'session-a']]);
  let tokenAtEvent;
  const scope = { AUTH_SESSION_STORAGE_KEY: 'auth-session-v1', Event: class {}, getStoredSessionToken: () => storage.get('auth-session-v1') || '', CLASSIC_CONFIRMED_OWNER_KEY: 'classic-confirmed-owner-v1', localStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, window: { dispatchEvent: () => { tokenAtEvent = storage.get('auth-session-v1'); } } };
  vm.runInNewContext(bridgeBetween('  const setStoredSessionToken =', '  const getStoredApiKey =') + '\n clearStoredSessionToken();', scope);
  assert.equal(storage.has('auth-session-v1'), false); assert.equal(tokenAtEvent, undefined);
});

function cachedOwnerHarness(receipt, session = 'session-a', fetchJson = async () => { throw new TypeError('offline'); }) {
  const storage = new Map([['auth-session-v1', session], ['classic-confirmed-owner-v1', JSON.stringify(receipt)]]);
  const restored = [], paints = [];
  const h = { AUTH_SESSION_STORAGE_KEY: 'auth-session-v1', CLASSIC_CONFIRMED_OWNER_KEY: 'classic-confirmed-owner-v1',
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    bridgeAuthState: { user: null }, window: { setClassicImageJobOwner: owner => { h.window.classicImageJobOwner = owner; restored.push(owner); }, dispatchEvent() {}, ClassicImageJobs: { transient: error => error instanceof TypeError } },
    Event: class {}, console: { warn() {} }, fetchJson, buildSessionHeaders: () => ({}),
    renderAuthState() {}, renderCatalogUi() {}, updateApiGuidePrompt() {}, restorePendingTasks() {},
    loadHistory: async () => { paints.push(h.window.classicImageJobOwner); },
  };
  vm.createContext(h);
  vm.runInContext(bridgeBetween('  const getStoredSessionToken =', '  const getStoredApiKey =') + '\n globalThis.restoreConfirmedClassicOwner = restoreConfirmedClassicOwner; globalThis.confirmClassicImageOwner = confirmClassicImageOwner;', h);
  vm.runInContext(bridgeBetween('  const isSessionAuthenticated =', '  const isApiKeyCompatibilityMode =') + '\n globalThis.isSessionAuthenticated = isSessionAuthenticated;', h);
  vm.runInContext(bridgeBetween('  refreshClassicSession = async function', '  requestClassicPasswordResetCode = async function'), h);
  return { h, storage, restored, paints };
}

test('cold refresh recovers confirmed owner local views before offline auth without authorizing generation', async () => {
  const { h, paints } = cachedOwnerHarness({ session: 'session-a', ownerId: 'owner-a' });
  h.restoreConfirmedClassicOwner();
  assert.equal(h.window.classicImageJobOwner, 'owner-a');
  assert.equal(h.isSessionAuthenticated(), false, 'cached owner does not confirm authenticated generation');
  await h.refreshClassicSession();
  assert.equal(h.window.classicImageJobOwner, 'owner-a');
  assert.equal(h.bridgeAuthState.user, null);
  assert.equal(paints.includes('owner-a'), true);
});

test('a stale owner receipt from another session cannot restore private local images', () => {
  const { h, storage } = cachedOwnerHarness({ session: 'previous-session', ownerId: 'previous-owner' });
  h.restoreConfirmedClassicOwner();
  assert.notEqual(h.window.classicImageJobOwner, 'previous-owner');
  assert.equal(storage.has('classic-confirmed-owner-v1'), false);
});

test('server rejected session invalidates cached owner receipt and local account scope', async () => {
  const error = Object.assign(new Error('unauthorized'), { status: 401 });
  const { h, storage } = cachedOwnerHarness({ session: 'session-a', ownerId: 'owner-a' }, 'session-a', async () => { throw error; });
  h.restoreConfirmedClassicOwner(); await h.refreshClassicSession();
  assert.equal(storage.has('classic-confirmed-owner-v1'), false);
  assert.equal(storage.has('auth-session-v1'), false);
  assert.equal(h.window.classicImageJobOwner, '');
});

test('explicit legacy association never copies result to another task with the same prompt', () => {
  const h = tasksHarness([
    { id: 'legacy-one', taskId: 'legacy-one', status: 'success', prompt: 'same', originalUrl: '/local-one.png', createdAt: 100, completedAt: 200 },
    { id: 'legacy-two', taskId: 'legacy-two', status: 'success', prompt: 'same', originalUrl: '/local-two.png', createdAt: 100, completedAt: 200 },
  ]);
  Object.assign(h, { getClassicLiveFullUrl: task => task.originalUrl || '', document: { readyState: 'loading', addEventListener() {} } });
  h.window.addEventListener = () => {};
  vm.runInContext(between('function getGenerationRecordPrimaryUrl(', 'window.reconcileClassicLiveTasksWithGenerationRecords ='), h);
  h.reconcileClassicLiveTasksWithGenerationRecords([{ status: 'SUCCESS', prompt: 'same', resultUrls: ['/remote-one.png'], meta: { clientLiveTaskId: 'legacy-one' }, createdAt: 100, completedAt: 200 }]);
  assert.equal(h.classicLiveTasks.find(task => task.id === 'legacy-one').originalUrl, '/remote-one.png');
  assert.equal(h.classicLiveTasks.find(task => task.id === 'legacy-two').originalUrl, '/local-two.png');
});

test('remote mutable history fields preserve committed local submission order and first completion', async () => {
  const { h, rendered } = bridgeHistoryHarness();
  await h.writeHistoryRecordsToDB([
    { ownerId: 'owner-a', jobId: 'old', fullUrl: '/old-provider.png', createdAt: 100, completedAt: 200 },
    { ownerId: 'owner-a', jobId: 'new', fullUrl: '/new.png', createdAt: 300, completedAt: 400 },
  ]);
  vm.runInContext('globalThis.renderRemoteHistoryGrid = renderRemoteHistoryGrid;', h);
  await h.renderRemoteHistoryGrid([{ id: 'record-old', meta: { imageJobId: 'old' }, status: 'SUCCESS', resultUrls: ['/old-site.png'], previewUrl: '/old-site.webp', createdAt: 999, completedAt: 999 }]);
  const rows = rendered.at(-1);
  assert.equal(rows[0].jobId, 'new'); assert.equal(rows[1].jobId, 'old');
  assert.equal(Date.parse(rows[1].createdAt), 100); assert.equal(Date.parse(rows[1].completedAt), 200);
  assert.equal(rows[1].fullUrl, '/old-site.png'); assert.equal(rows[1].previewUrl, '/old-site.webp');
});


test('confirmed receipt follows exact current session and token changes clear it before notification', () => {
  const { h, storage } = cachedOwnerHarness({ session: 'session-a', ownerId: 'owner-a' });
  assert.equal(h.confirmClassicImageOwner('owner-a', 'session-a'), true);
  storage.set('auth-session-v1', 'session-b');
  assert.equal(h.confirmClassicImageOwner('owner-a', 'session-a'), false);
  h.restoreConfirmedClassicOwner();
  assert.equal(storage.has('classic-confirmed-owner-v1'), false);
  h.confirmClassicImageOwner('owner-b', 'session-b');
  vm.runInContext('setStoredSessionToken("session-c");', h);
  assert.equal(storage.has('classic-confirmed-owner-v1'), false);
});

function recoveryRetryHarness() {
  const { h } = bridgeHistoryHarness();
  let now = Date.now(), cacheCalls = 0, completed = 0, persisted = 0, downloaded = 0;
  const state = { ownerId: 'owner-a', originalCached: false, downloadState: null };
  Object.assign(h, { classicLiveTasks: [], recoveredResultSignatures: new Map(), classicAssetRecoveryAttempts: new Map(),
    Date: class extends Date { static now() { return now; } },
    saveToHistory: async (url, prompt, preview, meta) => { persisted++; void h.window.cacheClassicResult({ ...meta, fullUrl: url }).catch(() => {}); },
  });
  Object.assign(h.window, { completeClassicLiveTask: () => { completed++; },
    ImageResultStore: { resultId: (owner, job, slot) => `${owner}:${job}:${slot}`, getState: async () => ({ ...state }), getAutoDownloadPreference: () => true },
    cacheClassicResult: async () => { cacheCalls++; if (cacheCalls === 1) throw new TypeError('offline'); state.originalCached = true; state.downloadState = 'started'; downloaded++; return state; },
  });
  vm.runInContext(bridgeBetween('  const retryMissingClassicResultAssets =', '  restorePendingTasks = async function') + '\n globalThis.applyManagedJobResults = applyManagedJobResults;', h);
  const job = { task_id: 'job-retry', status: 'succeeded', storage_status: 'saved', images: ['/original.png'], completed_at: new Date(now).toISOString() };
  return { h, job, state, advance: milliseconds => { now += milliseconds; }, counts: () => ({ cacheCalls, completed, persisted, downloaded }) };
}

test('identical recovered success resumes failed original cache and download without repaint or resettlement', async () => {
  const { h, job, counts } = recoveryRetryHarness();
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  assert.equal(counts().cacheCalls, 1);
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  assert.equal(counts().cacheCalls, 2); assert.equal(counts().downloaded, 1);
  assert.equal(counts().completed, 1); assert.equal(counts().persisted, 1);
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  assert.equal(counts().cacheCalls, 2);
});

test('missing-original recovery stops on quota, cloud expiry, and repeated failures respect cooldown', async () => {
  const { h, job, state, advance, counts } = recoveryRetryHarness();
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  state.cacheError = 'QUOTA'; await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve)); assert.equal(counts().cacheCalls, 1);
  delete state.cacheError;
  h.window.cacheClassicResult = async () => { throw new TypeError('offline'); };
  let retries = 0; const original = h.window.cacheClassicResult;
  h.window.cacheClassicResult = async record => { retries++; return original(record); };
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve)); await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve)); assert.equal(retries, 1);
  advance(30000); await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve)); assert.equal(retries, 2);
  advance(5 * 60 * 60 * 1000); await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve)); assert.equal(retries, 2);
});


test('identical recovery resumes unclaimed download from committed original despite unrelated preview quota', async () => {
  const { h, job, state, counts } = recoveryRetryHarness();
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  state.originalCached = true; state.cacheError = 'QUOTA'; state.previewCacheError = 'QUOTA';
  await h.applyManagedJobResults(job); await new Promise(resolve => setImmediate(resolve));
  assert.equal(counts().downloaded, 1); assert.equal(counts().completed, 1); assert.equal(counts().persisted, 1);
});

test('a stalled original retry cannot block restoring the next managed job', async () => {
  const { h, job, counts } = recoveryRetryHarness();
  await h.applyManagedJobResults(job);
  let release;
  h.window.cacheClassicResult = () => new Promise(resolve => { release = resolve; });
  let returned = false;
  const waiting = h.applyManagedJobResults(job).then(() => { returned = true; });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  const next = { ...job, task_id: 'job-next', images: ['/next.png'] };
  if (returned) await h.applyManagedJobResults(next);
  const result = counts();
  release?.({ originalCached: true }); await waiting;
  assert.equal(returned, true);
  assert.equal(result.completed, 2, 'next task restoration proceeds while previous cache fetch remains stalled');
});

test('the live area keeps running work and results from the last 4 hours only', () => {
  const now = 10 * 60 * 60 * 1000;
  const scope = { Date, window: {}, CLASSIC_LIVE_TTL_MS: 4 * 60 * 60 * 1000 };
  vm.createContext(scope);
  vm.runInContext(between('function isClassicLiveTaskCurrent(', 'function readClassicLiveTasks('), scope);
  const hour = 60 * 60 * 1000;
  assert.equal(scope.isClassicLiveTaskCurrent({ status: 'success', completedAt: now - 3 * hour }, now), true);
  assert.equal(scope.isClassicLiveTaskCurrent({ status: 'success', completedAt: now - 5 * hour }, now), false, 'older results belong to the gallery');
  assert.equal(scope.isClassicLiveTaskCurrent({ status: 'failed', completedAt: now - 5 * hour }, now), false);
  assert.equal(scope.isClassicLiveTaskCurrent({ status: 'running', createdAt: now - 9 * hour }, now), true, 'unfinished work stays visible');
});

test('server recovery and limits follow the 4-hour, 12-result live window', () => {
  const bridge = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
  assert.ok(bridge.includes("isClassicLiveTaskCurrent({ status: 'success', completedAt: finishedAt })"), 'recovered successes respect the window');
  assert.ok(bridge.includes("isClassicLiveTaskCurrent({ status: 'failed', completedAt: failedAt })"), 'recovered failures respect the window');
  assert.ok(source.includes('const CLASSIC_LIVE_TTL_MS = 4 * 60 * 60 * 1000;'));
  assert.ok(source.includes('const CLASSIC_LIVE_MAX_TASKS = 12;'));
});
