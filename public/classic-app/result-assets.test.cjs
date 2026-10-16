const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { Blob } = require('node:buffer');
function harness(db = new IDBFactory(), configure) {
  const dom = new JSDOM('<div id="historyGrid"></div>', { url: 'https://example.test', runScripts: 'outside-only' });
  const w = dom.window;
  Object.assign(w, { indexedDB: db, IDBKeyRange, Blob, AbortController, classicImageJobOwner: 'owner-a', getClassicLine4ThumbUrl: () => '', readClassicImageCache: async () => null,
    readHistoryRecordsFromDB: async () => [], HISTORY_CACHE_STORE: 'images', HISTORY_PREVIEW_STORE: 'previews', classicImageBindings: new Map(),
    getClassicImageReader() {}, showSoftToast() {}, setClassicImageState() {}, setHistoryCacheBadge() {}, classicAssetIdsBySource: new Map(),
  });
  const calls = [], downloads = [];
  w.fetchClassicImageBlob = async src => { calls.push(src); return new Blob(['original'], { type: 'image/png' }); };
  w.URL.createObjectURL = () => 'blob:download'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.eval(fs.readFileSync('public/shared/image-result-store.js', 'utf8'));
  w.eval(fs.readFileSync('public/classic-app/image-runtime.js', 'utf8'));
  w.ClassicImageRuntime.makeBrowserPreview = async () => ({ blob: new Blob(['preview'], { type: 'image/webp' }), width: 720, height: 360, originalWidth: 4000, originalHeight: 2000 });
  configure?.(w, calls);
  if (fs.existsSync('public/classic-app/result-assets.js')) w.eval(fs.readFileSync('public/classic-app/result-assets.js', 'utf8'));
  return { w, calls, downloads, close: () => { w.ImageResultStore.close(); w.close(); } };
}
const record = { ownerId: 'owner-a', jobId: 'job-one', outputIndex: 0, fullUrl: '/full.png', previewUrl: '', prompt: '动物运动会', createdAt: '2026-10-15T01:00:00Z' };
async function seedCanvas(w, entries) {
  const request = w.indexedDB.open('keyval-store');
  const db = await new Promise((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore('keyval');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      entries.forEach(([key, value]) => tx.objectStore('keyval').put(value, key));
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function realLegacyCache(w) {
  w.openHistoryCacheDB = () => new Promise((resolve, reject) => {
    const req = w.indexedDB.open('nb_history_cache_db', 3);
    req.onupgradeneeded = () => ['images', 'previews'].forEach(name => req.result.createObjectStore(name, { keyPath: 'id' }));
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const script = fs.readFileSync('public/classic-app/script.js', 'utf8');
  w.eval(script.slice(script.indexOf('async function readClassicImageCache('), script.indexOf('async function fetchClassicImageBlob(')));
}
test('successful classic results cache originals when gallery is closed and download once', async () => {
  const h = harness();
  assert.ok(h.w.ClassicResultAssets, 'classic durable original lifecycle must be installed');
  await Promise.all([h.w.ClassicResultAssets.cacheResult(record), h.w.ClassicResultAssets.cacheResult(record)]);
  const id = h.w.ImageResultStore.resultId('owner-a', 'job-one', 0);
  const state = await h.w.ImageResultStore.getState(id);
  assert.equal(state.originalCached, true); assert.equal(state.downloadState, 'started');
  assert.equal(h.calls.length, 1); assert.equal(h.downloads.length, 1);
  await h.w.ClassicResultAssets.cacheResult(record);
  assert.equal(h.calls.length, 1); assert.equal(h.downloads.length, 1);
  h.close();
});
test('URL replacement and disabled auto-download reuse the same original', async () => {
  const h = harness();
  assert.ok(h.w.ClassicResultAssets, 'classic durable original lifecycle must be installed');
  h.w.ImageResultStore.setAutoDownloadPreference(false);
  await h.w.ClassicResultAssets.cacheResult(record);
  await h.w.ClassicResultAssets.cacheResult({ ...record, fullUrl: '/generated-assets/site.png' });
  assert.equal(h.calls.length, 1); assert.equal(h.downloads.length, 0);
  const original = await h.w.ClassicResultAssets.readOriginal('/generated-assets/site.png');
  assert.equal(await original.text(), 'original');
  h.close();
});
test('preview-only success never advertises original cached and local recovery adds original', async () => {
  const h = harness();
  assert.ok(h.w.ClassicResultAssets, 'classic durable original lifecycle must be installed');
  const info = await h.w.ImageResultStore.register({ ...record, originalUrl: record.fullUrl });
  await h.w.ImageResultStore.putPreview(info.id, new Blob(['preview'], { type: 'image/webp' }), { previewVersion: 1 });
  const card = h.w.document.createElement('div'); card.innerHTML = '<span class="history-cache-badge"></span>'; h.w.document.body.appendChild(card);
  await h.w.ClassicResultAssets.refreshBadge(card, info.id);
  assert.match(card.textContent, /仅预览已缓存/); assert.doesNotMatch(card.textContent, /原图已缓存/);
  await h.w.ClassicResultAssets.restoreFile(info.id, new Blob(['restored original'], { type: 'image/png' }));
  assert.equal(await (await h.w.ImageResultStore.getOriginal(info.id)).text(), 'restored original');
  assert.equal((await h.w.ImageResultStore.getState(info.id)).width, 4000, 'shared original dimensions must not be replaced by thumbnail dimensions');
  await h.w.ClassicResultAssets.refreshBadge(card, info.id);
  assert.match(card.textContent, /原图已缓存/);
  h.close();
});

test('local file original survives unavailable preview encoding', async () => {
  const h = harness();
  const info = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-restore', originalUrl: '/expired.png' });
  h.w.ClassicImageRuntime.makeBrowserPreview = async () => { throw new Error('preview unavailable'); };
  await assert.rejects(h.w.ClassicResultAssets.restoreFile(info.id, new Blob(['safe original'], { type: 'image/png' })), /preview unavailable/);
  assert.equal(await (await h.w.ImageResultStore.getOriginal(info.id)).text(), 'safe original');
  h.close();
});

test('two browser tabs recovering the same result trigger one automatic download', async () => {
  const db = new IDBFactory(), a = harness(db), b = harness(db);
  await Promise.all([a.w.ClassicResultAssets.cacheResult(record), b.w.ClassicResultAssets.cacheResult(record)]);
  assert.equal(a.downloads.length + b.downloads.length, 1);
  a.close(); b.close();
});
test('disabling automatic download after claim does not trigger a queued file download', async () => {
  const h = harness(), store = h.w.ImageResultStore;
  const claim = store.claimDownload;
  store.claimDownload = async (...args) => { const token = await claim(...args); store.setAutoDownloadPreference(false); return token; };
  await h.w.ClassicResultAssets.cacheResult(record);
  assert.equal(h.downloads.length, 0);
  h.close();
});
test('account switch during an original read never downloads it for the next account', async () => {
  const h = harness(); let finish;
  h.w.fetchClassicImageBlob = async () => { throw new Error('captured fetch is intentional'); };
  const info = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-switch', originalUrl: '/switch.png' });
  const get = h.w.ImageResultStore.getOriginal;
  h.w.ImageResultStore.getOriginal = async (...args) => { if (args[0] === info.id) return new Promise(resolve => { finish = resolve; }); return get(...args); };
  const work = h.w.ClassicResultAssets.cacheResult({ ...record, jobId: 'job-switch', fullUrl: '/switch.png' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  h.w.classicImageJobOwner = 'owner-b'; finish(new Blob(['cached'], { type: 'image/png' }));
  await assert.rejects(work, /账号已切换/);
  assert.equal(h.downloads.length, 0);
  h.close();
});

test('source-only original consumers report the committed shared original accurately', async () => {
  const h = harness();
  await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-source', originalUrl: '/source.png' });
  const lease = await h.w.getClassicImageReader().acquire({ src: '/source.png', variant: 'original' });
  assert.equal(lease.status, 'ready');
  assert.equal(lease.originalCached, true);
  assert.equal(lease.cacheError, null);
  lease.release(); h.close();
});

test('a newer site URL survives deduplication while its provider original is still pending', async () => {
  const h = harness(); let reject;
  const info = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-one', originalUrl: '/full.png' });
  const originalGet = h.w.ImageResultStore.getOriginal; let paused = true;
  h.w.ImageResultStore.getOriginal = async (...args) => {
    if (paused) { paused = false; return new Promise((resolve, fail) => { reject = fail; }); }
    return originalGet(...args);
  };
  const first = h.w.ClassicResultAssets.cacheResult(record);
  while (!reject) await new Promise(resolve => setTimeout(resolve, 0));
  const next = h.w.ClassicResultAssets.cacheResult({ ...record, fullUrl: '/site.png' });
  // Releasing the local read simulates the initially attempted provider path failing.
  reject(new Error('temporary local read error'));
  await Promise.allSettled([first, next]);
  assert.equal((await h.w.ImageResultStore.getState(info.id)).originalUrl, '/site.png');
  h.close();
});

test('manual download-unprocessed works with automatic download disabled', async () => {
  const h = harness(); h.w.ImageResultStore.setAutoDownloadPreference(false);
  await h.w.ClassicResultAssets.cacheResult(record);
  h.w.readHistoryRecordsFromDB = async () => [{ ...record, assetId: h.w.ImageResultStore.resultId('owner-a', 'job-one', 0) }];
  await h.w.downloadClassicUnprocessed();
  assert.equal(h.downloads.length, 1); h.close();
});

test('manual single download uses shared original bytes and records the download intent', async () => {
  const h = harness(); h.w.ImageResultStore.setAutoDownloadPreference(false);
  try {
    await h.w.ClassicResultAssets.cacheResult(record);
    await h.w.downloadSingleImg('/full.png');
    assert.equal(h.calls.length, 1);
    assert.equal(h.downloads.length, 1);
    assert.equal((await h.w.ImageResultStore.getState(h.w.ImageResultStore.resultId('owner-a', 'job-one', 0))).downloadState, 'started');
  } finally { h.close(); }
});

test('public original reads reject account changes during local cache access', async () => {
  const h = harness();
  const info = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-one', originalUrl: '/full.png' });
  let finish;
  h.w.ImageResultStore.getOriginal = async () => new Promise(resolve => { finish = resolve; });
  const read = h.w.ClassicResultAssets.readOriginal('/full.png');
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  h.w.classicImageJobOwner = 'owner-b'; finish(new Blob(['a-private'], { type: 'image/png' }));
  await assert.rejects(read, /账号已切换/); h.close();
});

test('local recovery uses one preview decoder across simultaneous files', async () => {
  const h = harness(); let active = 0, peak = 0;
  h.w.ClassicImageRuntime.makeBrowserPreview = async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return { blob: new Blob(['preview'], { type: 'image/webp' }), width: 720, height: 360 };
  };
  const a = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'restore-a', originalUrl: '/a.png' });
  const b = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'restore-b', originalUrl: '/b.png' });
  await Promise.all([a,b].map(info => h.w.ClassicResultAssets.restoreFile(info.id, new Blob(['original'], { type: 'image/png' }))));
  assert.equal(peak, 1); h.close();
});

test('an unavailable local cache still allows the cloud original to be read', async () => {
  const h = harness();
  await h.w.ClassicResultAssets.registerResult(record);
  h.w.ImageResultStore.getOriginal = async () => { throw new Error('cache temporarily unavailable'); };
  try {
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal('/full.png')).text(), 'original');
    assert.deepEqual(h.calls, ['/full.png']);
  } finally { h.close(); }
});

test('public original reads reject an account change during the durable write', async () => {
  const h = harness();
  await h.w.ClassicResultAssets.registerResult(record);
  const put = h.w.ImageResultStore.putOriginal;
  h.w.ImageResultStore.putOriginal = async (...args) => {
    const result = await put(...args); h.w.classicImageJobOwner = 'owner-b'; return result;
  };
  try { await assert.rejects(h.w.ClassicResultAssets.readOriginal('/full.png'), /账号已切换/); }
  finally { h.close(); }
});

test('account changes during metadata lookup cannot fall through to a raw URL read', async () => {
  const h = harness();
  const find = h.w.ImageResultStore.find;
  h.w.ImageResultStore.find = async (...args) => {
    const result = await find(...args); h.w.classicImageJobOwner = 'owner-b'; return result;
  };
  try {
    await assert.rejects(h.w.ClassicResultAssets.readOriginal('/full.png'), /账号已切换/);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('failed provider fetch retries a newer registered site URL and commits its bytes', async () => {
  let rejectProvider;
  const h = harness(undefined, (w, calls) => {
    w.fetchClassicImageBlob = async src => {
      calls.push(src);
      if (src === '/full.png') return new Promise((_, reject) => { rejectProvider = reject; });
      return new Blob(['site original'], { type: 'image/png' });
    };
  });
  h.w.ImageResultStore.setAutoDownloadPreference(false);
  try {
    const first = h.w.ClassicResultAssets.cacheResult(record);
    while (!rejectProvider) await new Promise(resolve => setTimeout(resolve, 0));
    await h.w.ClassicResultAssets.registerResult({ ...record, fullUrl: '/site.png' });
    rejectProvider(new Error('provider link expired'));
    await first;
    assert.deepEqual(h.calls, ['/full.png', '/site.png']);
    assert.equal(await (await h.w.ImageResultStore.getOriginal(h.w.ImageResultStore.resultId('owner-a', 'job-one', 0))).text(), 'site original');
  } finally { h.close(); }
});

test('explicit legacy records read their original bytes without copying or scanning them on registration', async () => {
  const h = harness(); let active = 0, peak = 0;
  h.w.readClassicImageCache = async (kind, id) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return { blob: new Blob([id], { type: 'image/png' }) };
  };
  try {
    await Promise.all(Array.from({ length: 5 }, (_, index) => h.w.ClassicResultAssets.registerResult({ ...record, jobId: 'legacy-' + index, legacyId: 'old-' + index })));
    assert.equal(peak, 0);
    const id = h.w.ImageResultStore.resultId('owner-a', 'legacy-3', 0);
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal('/full.png', id)).text(), 'old-3');
    assert.equal(peak, 1);
    h.w.classicImageJobOwner = 'owner-b';
    assert.equal(await h.w.ClassicResultAssets.registerResult({ ...record, legacyId: 'old-3' }), undefined);
  } finally { h.close(); }
});

test('a cross-tab owner change cannot reuse the previous owners ready preview entry', async () => {
  const h = harness();
  h.w.ClassicImageRuntime.decodeBrowserBlob = async () => ({ width: 720, height: 405, close() {} });
  try {
    const a = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'job-same-url', originalUrl: '/same.png' });
    const b = await h.w.ImageResultStore.register({ ownerId: 'owner-b', jobId: 'job-same-url', originalUrl: '/same.png' });
    await h.w.ImageResultStore.putPreview(a.id, new Blob(['preview-A'], { type: 'image/webp' }), { previewVersion: 1 });
    await h.w.ImageResultStore.putPreview(b.id, new Blob(['preview-B'], { type: 'image/webp' }), { previewVersion: 1 });
    const readerA = h.w.getClassicImageReader();
    const first = await readerA.acquire({ id: a.id, src: '/same.png' });
    assert.equal(await first.blob.text(), 'preview-A'); first.release();
    h.w.classicImageJobOwner = ''; h.w.classicImageJobOwner = 'owner-b';
    const second = await h.w.getClassicImageReader().acquire({ id: b.id, src: '/same.png' });
    assert.equal(await second.blob.text(), 'preview-B'); second.release();
  } finally { h.close(); }
});

test('expired classic legacy originals remain readable without duplicating them into a full cache', async () => {
  const h = harness(undefined, w => {
    w.ImageResultStore = w.ImageResultStore.createStore({ budgetBytes: 12 }); realLegacyCache(w);
    w.ClassicImageRuntime.decodeBrowserBlob = async () => ({ width: 720, height: 405, close() {} });
  });
  try {
    const protectedInfo = await h.w.ImageResultStore.register({ ownerId: 'owner-a', jobId: 'protected' });
    await h.w.ImageResultStore.putOriginal(protectedInfo.id, new Blob(['protected'], { type: 'image/png' }));
    await h.w.writeClassicImageCache('images', 'old-animal', { blob: new Blob(['legacy original'], { type: 'image/png' }) });
    await h.w.writeClassicImageCache('previews', 'old-animal', { blob: new Blob(['legacy preview'], { type: 'image/webp' }), version: 1, width: 720, height: 405 });
    const info = await h.w.ClassicResultAssets.registerResult({ ...record, legacyId: 'old-animal', cloudExpiresAt: Date.now() - 1 });
    const lease = await h.w.getClassicImageReader().acquire({ id: info.id, src: record.fullUrl, previewSrc: record.previewUrl });
    assert.equal(lease.status, 'ready'); assert.equal(lease.source, 'local'); assert.equal(lease.originalCached, true);
    assert.equal(await lease.blob.text(), 'legacy preview'); lease.release();
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal(record.fullUrl, info.id)).text(), 'legacy original');
    assert.equal(await h.w.ImageResultStore.getOriginal(info.id), undefined, 'reading a legacy cache must not require a second original copy');
    const card = h.w.document.createElement('div'); card.innerHTML = '<span class="history-cache-badge"></span>'; h.w.document.body.appendChild(card);
    await h.w.ClassicResultAssets.refreshBadge(card, info.id);
    assert.match(card.textContent, /原图已缓存/); assert.doesNotMatch(card.textContent, /已过期|空间不足/);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('classic reads the exact canvas source alias after cloud expiry and reload', async () => {
  const db = new IDBFactory();
  const setup = w => {
    w.ImageResultStore = w.ImageResultStore.createStore({ budgetBytes: 12 });
    w.ClassicImageRuntime.decodeBrowserBlob = async () => ({ width: 720, height: 405, close() {} });
  };
  let h = harness(db, setup);
  const id = h.w.ImageResultStore.resultId('owner-a', 'job-one', 0);
  try {
    await seedCanvas(h.w, [
      ['asset-old-canvas', new Blob(['canvas original'], { type: 'image/png' })],
      ['asset-preview-old-canvas', new Blob(['canvas preview'], { type: 'image/webp' })],
      ['asset-meta-old-canvas', { bytes: 4096, previewBytes: 1024, previewVersion: 1, width: 3840, height: 2160 }],
      ['asset-source-/full.png', 'old-canvas'],
    ]);
    await h.w.ClassicResultAssets.registerResult({ ...record, cloudExpiresAt: Date.now() - 1 });
    h.close(); h = harness(db, setup);
    const lease = await h.w.getClassicImageReader().acquire({ id, src: '/full.png', previewSrc: '/preview.webp' });
    assert.equal(lease.status, 'ready'); assert.equal(lease.source, 'local'); assert.equal(lease.originalCached, true);
    assert.equal(await lease.blob.text(), 'canvas preview'); lease.release();
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal('/full.png', id)).text(), 'canvas original');
    assert.equal(h.calls.length, 0);
    h.w.classicImageJobOwner = 'owner-b';
    await h.w.ClassicResultAssets.registerResult({ ...record, ownerId: 'owner-b', fullUrl: '/other.png', previewUrl: '' });
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal('/other.png')).text(), 'original');
    assert.deepEqual(h.calls, ['/other.png']);
  } finally { h.close(); }
});

test('expired originals with a retained preview advertise the preview separately', async () => {
  const h = harness();
  try {
    const info = await h.w.ClassicResultAssets.registerResult({ ...record, cloudExpiresAt: Date.now() - 1 });
    await h.w.ImageResultStore.putPreview(info.id, new Blob(['preview'], { type: 'image/webp' }), { previewVersion: 1 });
    const card = h.w.document.createElement('div'); card.innerHTML = '<span class="history-cache-badge"></span>'; h.w.document.body.appendChild(card);
    await h.w.ClassicResultAssets.refreshBadge(card, info.id);
    assert.match(card.textContent, /仅预览已缓存/); assert.match(card.textContent, /云端原图已过期/);
  } finally { h.close(); }
});

test('a completed original that exceeds cache capacity still retains an offline preview', async () => {
  const h = harness(undefined, w => {
    w.ImageResultStore = w.ImageResultStore.createStore({ budgetBytes: 4, previewBudgetBytes: 32 });
    w.ClassicImageRuntime.decodeBrowserBlob = async () => ({ width: 720, height: 405, close() {} });
  });
  h.w.ImageResultStore.setAutoDownloadPreference(false);
  try {
    const state = await h.w.ClassicResultAssets.cacheResult(record);
    assert.equal(state.originalCached, false); assert.equal(state.previewCached, true);
    h.w.fetchClassicImageBlob = async () => { throw new Error('offline'); };
    const lease = await h.w.getClassicImageReader().acquire({ id: state.id, src: record.fullUrl });
    assert.equal(lease.status, 'ready'); assert.equal(lease.source, 'local');
    lease.release(); assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test('a shared cache read failure still falls back to existing classic legacy bytes offline', async () => {
  const h = harness(undefined, w => {
    realLegacyCache(w);
    w.ClassicImageRuntime.decodeBrowserBlob = async () => ({ width: 720, height: 405, close() {} });
  });
  try {
    await h.w.writeClassicImageCache('images', 'legacy-offline', { blob: new Blob(['legacy original'], { type: 'image/png' }) });
    await h.w.writeClassicImageCache('previews', 'legacy-offline', { blob: new Blob(['legacy preview'], { type: 'image/webp' }), version: 1, width: 720, height: 405 });
    const info = await h.w.ClassicResultAssets.registerResult({ ...record, legacyId: 'legacy-offline', cloudExpiresAt: Date.now() - 1 });
    h.w.ImageResultStore.getOriginal = h.w.ImageResultStore.getPreview = async () => { throw new Error('shared cache read unavailable'); };
    h.w.fetchClassicImageBlob = async () => { throw new Error('cloud expired'); };
    const lease = await h.w.getClassicImageReader().acquire({ id: info.id, src: record.fullUrl });
    assert.equal(lease.status, 'ready'); assert.equal(await lease.blob.text(), 'legacy preview'); lease.release();
    assert.equal(await (await h.w.ClassicResultAssets.readOriginal(record.fullUrl, info.id)).text(), 'legacy original');
  } finally { h.close(); }
});

test('background caching prefers the server preview and starts original download before preview work', async () => {
  const decoded = [], events = [];
  const h = harness(undefined, (w, calls) => {
    w.fetchClassicImageBlob = async src => { calls.push(src); events.push(src); return new Blob([src.includes('preview') ? 'server preview' : 'original'], { type: 'image/png' }); };
    w.ClassicImageRuntime.makeBrowserPreview = async blob => { decoded.push(await blob.text()); return { blob: new Blob(['small preview'], { type: 'image/webp' }), width: 720, height: 405, originalWidth: 720, originalHeight: 405 }; };
    w.HTMLAnchorElement.prototype.click = () => events.push('download');
  });
  try {
    const state = await h.w.ClassicResultAssets.cacheResult({ ...record, previewUrl: '/server-preview.webp' });
    assert.deepEqual(decoded, ['server preview']);
    assert.deepEqual(events, ['/full.png', 'download', '/server-preview.webp']);
    assert.equal(state.originalCached, true); assert.equal(state.previewCached, true);
    assert.equal(state.width, undefined, 'server preview dimensions must not be advertised as original dimensions');
  } finally { h.close(); }
});
