const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeTest = require('node:test');
const test = globalThis.test || nodeTest.test;
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('public/classic-app/script.js', 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function domHarness(html) {
  const dom = new JSDOM(html);
  const { window } = dom;
  window.matchMedia = () => ({ matches: false });
  return { window, document: window.document, console, setTimeout, clearTimeout, URL, Date, Map, Set };
}

test('VIP completed card survives another task status refresh without reloading its preview', () => {
  const context = domHarness('<div id="classicLiveGrid"></div>');
  Object.assign(context, {
    CLASSIC_VIP_MODE: true,
    classicLiveSelectedId: '',
    classicLiveRenderSignature: '',
    classicImageBinder: null,
    classicImageBindings: new Map(),
    classicLiveTasks: [
      { id: 'completed', status: 'success', originalUrl: '/full.png', previewUrl: '/preview.webp', prompt: 'test', index: 1 },
      { id: 'running', status: 'running', index: 2 },
    ],
    classicLiveCardCache: new Map(),
    getClassicLiveFullUrl: (task) => task.originalUrl || '',
    getClassicLivePreviewUrl: (task) => task.previewUrl || '',
    getClassicImageDisplayUrl: (full, preview) => preview || full,
    getClassicLiveStatusLabel: (status) => status,
    formatClassicLiveClock: () => '12:00',
    escapeHtml: (value) => String(value),
    bindClassicPreviewImage() {},
    releaseClassicImageTree() {},
  });
  vm.createContext(context);
  vm.runInContext(slice('function renderClassicLiveTasks()', 'function createClassicLiveTask('), context);
  context.renderClassicLiveTasks();
  const firstCard = context.document.getElementById('classicLiveGrid').firstElementChild;
  const firstImg = firstCard.querySelector('img');
  context.classicLiveTasks[1].status = 'failed';
  context.renderClassicLiveTasks();
  assert.equal(context.document.getElementById('classicLiveGrid').firstElementChild, firstCard);
  assert.equal(firstCard.querySelector('img'), firstImg);
});

test('closing lightbox clears decoded original src and releases its lease', () => {
  const context = domHarness('<div id="lightbox"><img id="lbImg" src="blob:original"></div>');
  let releases = 0;
  Object.assign(context, { classicLightboxGeneration: 0, classicLightboxLease: { release: () => releases++ } });
  vm.createContext(context);
  vm.runInContext(slice('function closeLightbox()', 'async function downloadSingleImg('), context);
  context.closeLightbox();
  assert.equal(context.document.getElementById('lbImg').getAttribute('src'), null);
  assert.equal(releases, 1);
});

test('single download releases its original URL after the download starts', async () => {
  const context = domHarness('<body></body>');
  let releases = 0;
  const revoked = [];
  context.window.HTMLAnchorElement.prototype.click = () => {};
  Object.assign(context, {
    fetch: async () => ({ ok: true, blob: async () => new Blob(['original'], { type: 'image/png' }) }),
    URL: { createObjectURL: () => 'blob:download', revokeObjectURL: (url) => revoked.push(url) },
    getClassicOriginalAsset: async () => ({ status: 'ready', url: 'blob:download', blob: { type: 'image/png' }, release: () => { releases++; revoked.push('blob:download'); } }),
    setTimeout: (work) => { work(); return 1; },
  });
  vm.createContext(context);
  vm.runInContext(slice('async function downloadSingleImg(', '// --- Mobile Navigation Logic'), context);
  await context.downloadSingleImg('/full.png');
  assert.equal(releases, 1);
  assert.deepEqual(revoked, ['blob:download']);
});

test('local history binds previews without replacing thumbnails with cached originals', async () => {
  const context = domHarness('<div id="historyGrid"></div>');
  let originalReads = 0;
  let binds = 0;
  Object.assign(context, {
    classicHistoryRenderGeneration: 0,
    clearHistoryObjectUrlRefs() {},
    migrateLocalStorageHistoryToIndexedDB: async () => {},
    readHistoryRecordsFromDB: async () => [{ id: 'local', fullUrl: '/full.png', previewUrl: '/preview.webp', prompt: 'test' }],
    getHistoryFullUrl: (item) => item.fullUrl,
    getHistoryDisplayUrl: (item) => item.previewUrl,
    getClassicLine4ThumbUrl: () => '',
    writeHistoryRecordsToDB: async () => {},
    getClassicHistoryRenderLimit: () => 10,
    escapeHtml: (value) => value,
    setHistoryCacheBadge() {},
    bindClassicPreviewImage: (img, input) => { binds++; assert.equal(input.src, '/full.png'); assert.equal(input.previewSrc, '/preview.webp'); },
    getCachedHistoryImage: async () => { originalReads++; return { size: 10000, type: 'image/png' }; },
    historyObjectUrls: [],
    URL: { createObjectURL: () => 'blob:full-original' },
  });
  vm.createContext(context);
  vm.runInContext(slice('async function loadHistory()', 'function regenerateFromHistory('), context);
  await context.loadHistory();
  await Promise.resolve();
  assert.equal(originalReads, 0);
  assert.equal(binds, 1);
  assert.notEqual(context.document.querySelector('img').src, 'blob:full-original');
});

test('remote history binds preview reader without allocating full-original object URLs', async () => {
  const bridge = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
  const render = bridge.slice(bridge.indexOf('  const renderRemoteHistoryGrid = async'), bridge.indexOf('  const persistRemoteSuccessRecordsToLocalHistory'));
  const context = domHarness('<div id="historyGrid"></div>');
  let originalReads = 0;
  let binds = 0;
  Object.assign(context, {
    classicHistoryRenderGeneration: 0,
    clearHistoryObjectUrlRefs() {},
    mergeRemoteAndLocalHistoryRecords: async (records) => records,
    getBridgeHistoryPageSize: () => 10,
    formatHistoryClock: () => '12:00',
    escapeHtml: (value) => value,
    setHistoryCacheBadge() {},
    shouldBridgeCacheHistoryImages: () => true,
    getCachedHistoryImage: async () => { originalReads++; return { size: 10000, type: 'image/png' }; },
    bindClassicPreviewImage: (img, input) => { binds++; assert.equal(input.src, '/full.png'); },
    historyObjectUrls: [],
    URL: { createObjectURL: () => 'blob:full-original' },
  });
  vm.createContext(context);
  vm.runInContext(`${render}\n globalThis.renderRemoteHistoryGrid = renderRemoteHistoryGrid`, context);
  await context.renderRemoteHistoryGrid([{ id: 'remote', resultUrls: ['/full.png'], previewUrl: '/thumb.webp' }]);
  await Promise.resolve();
  assert.equal(originalReads, 0);
  assert.equal(binds, 1);
});

test('reference compression resizes the File directly before converting only its small output to Base64', async () => {
  const file = { size: 10000000, type: 'image/png', original: true };
  let originalReads = 0;
  let previews = 0;
  class Reader {
    readAsDataURL(input) {
      if (input.original) originalReads++;
      this.onload({ target: { result: 'data:image/jpeg;base64,preview' } });
    }
  }
  class FakeImage {
    width = 4000;
    height = 2000;
    set src(_src) { this.onload(); }
  }
  const runtime = fs.readFileSync('public/classic-app/image-runtime.js', 'utf8');
  const context = {
    window: { ClassicImageRuntime: {
      createPreviewDecodeQueue: () => ({ run: (work) => work() }),
      withTimeout: async (work) => work(),
      makeBrowserPreview: async (input, options) => { previews++; assert.equal(input, file); assert.equal(options.maxEdge, 1024); return { blob: { size: 100, type: 'image/jpeg' } }; },
    } },
    FileReader: Reader, Image: FakeImage, setTimeout, clearTimeout,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,preview' }) },
    classicReferenceDecodeQueue: null,
  };
  vm.createContext(context);
  vm.runInContext(slice('async function compressImage(', 'async function buildGrokReferenceFusionImage('), context);
  await context.compressImage(file);
  assert.equal(originalReads, 0);
  assert.equal(previews, 1);
});

test('using history as reference reads cached original and releases it after compression', async () => {
  let compressed;
  let releases = 0;
  const original = { size: 12345, type: 'image/png' };
  const context = {
    getClassicOriginalAsset: async (src) => { assert.equal(src, '/expired.png'); return { status: 'ready', blob: original, release: () => releases++ }; },
    compressImage: async (blob) => { compressed = blob; return 'data:image/jpeg;base64,small'; },
    Image: class { set src(_src) { this.onerror(); } },
  };
  vm.createContext(context);
  vm.runInContext(slice('async function urlToBase64(', '// --- 新功能：一键设为参考图'), context);
  assert.equal(await context.urlToBase64('/expired.png'), 'data:image/jpeg;base64,small');
  assert.equal(compressed, original);
  assert.equal(releases, 1);
});
