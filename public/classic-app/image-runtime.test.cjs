const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function loadRuntime(overrides = {}) {
  if (!fs.existsSync('public/classic-app/image-runtime.js')) return {};
  const source = fs.readFileSync('public/classic-app/image-runtime.js', 'utf8');
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    ...overrides,
    URL: {
      createObjectURL: overrides.createObjectURL || (() => 'blob:test'),
      revokeObjectURL: overrides.revokeObjectURL || (() => {}),
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.ClassicImageRuntime;
}

test('shared object URL is revoked only after the final consumer releases it', () => {
  const revoked = [];
  const runtime = loadRuntime({
    createObjectURL: () => 'blob:shared',
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.equal(typeof runtime.createUrlRegistry, 'function', 'classic runtime must share URL leases');
  const registry = runtime.createUrlRegistry();

  registry.retain('history:1', 'blob:shared');
  registry.retain('lightbox:1', 'blob:shared');
  registry.release('history:1');
  assert.deepEqual(revoked, []);
  registry.release('lightbox:1');
  assert.deepEqual(revoked, ['blob:shared']);
});

test('preview decode queue never runs more than one decoder at a time', async () => {
  const runtime = loadRuntime();
  assert.equal(typeof runtime.createPreviewDecodeQueue, 'function', 'classic runtime must serialize preview decoding');
  const queue = runtime.createPreviewDecodeQueue(1);
  let active = 0;
  let peak = 0;
  const decode = () => new Promise((resolve) => {
    active += 1;
    peak = Math.max(peak, active);
    setTimeout(() => {
      active -= 1;
      resolve('preview');
    }, 5);
  });
  await Promise.all([queue.run(decode), queue.run(decode), queue.run(decode)]);
  assert.equal(peak, 1);
});

test('bounded read rejects stalled image work with a finite timeout', async () => {
  const runtime = loadRuntime();
  assert.equal(typeof runtime.withTimeout, 'function', 'classic runtime must bound image reads');
  await assert.rejects(
    runtime.withTimeout(() => new Promise(() => {}), 5),
    /timed out/i,
  );
});

function readerHarness(options = {}) {
  let urls = 0;
  const revoked = [];
  const runtime = loadRuntime({
    createObjectURL: () => `blob:asset-${++urls}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.equal(typeof runtime.createAssetReader, 'function', 'classic reader must prioritize local original/preview data');
  const reader = runtime.createAssetReader({
    readOriginal: async () => null,
    readPreview: async () => null,
    writeOriginal: async () => {},
    writePreview: async () => {},
    fetchBlob: async () => { throw new Error('Remote unavailable'); },
    makePreview: async (blob) => ({ blob: { size: 12, type: 'image/webp', from: blob }, width: 720, height: 360, version: 1 }),
    validateBlob: async (blob) => !!blob && blob.size > 0 && blob.type.startsWith('image/'),
    timeoutMs: 30,
    ...options,
  });
  return { reader, revoked, urlCount: () => urls };
}

test('local legacy original produces a bounded preview without touching expired remote URL', async () => {
  const original = { size: 8000, type: 'image/png' };
  const saved = [];
  let requests = 0;
  const h = readerHarness({
    readOriginal: async (id) => id === 'legacy' ? original : null,
    fetchBlob: async () => { requests += 1; throw new Error('404'); },
    writePreview: async (id, preview) => saved.push({ id, preview }),
  });
  const asset = await h.reader.acquire({ id: 'legacy', src: 'https://expired/image.png', variant: 'preview' });
  assert.equal(asset.status, 'ready');
  assert.equal(asset.source, 'local');
  assert.notEqual(asset.blob, original);
  assert.equal(asset.width, 720);
  assert.equal(saved[0].id, 'legacy');
  assert.equal(requests, 0);
  asset.release();
});

test('two preview consumers share one read and URL until both release', async () => {
  let reads = 0;
  const h = readerHarness({ readPreview: async () => { reads += 1; return { blob: { size: 100, type: 'image/webp' }, width: 720, height: 480, version: 1 }; } });
  const input = { id: 'one', src: '/one.png', variant: 'preview' };
  const [a, b] = await Promise.all([h.reader.acquire(input), h.reader.acquire(input)]);
  assert.equal(reads, 1);
  assert.equal(h.urlCount(), 1);
  assert.equal(a.url, b.url);
  a.release();
  assert.deepEqual(h.revoked, []);
  b.release();
  assert.deepEqual(h.revoked, [a.url]);
});

test('original reads preserve original bytes and never use a thumbnail for downloads', async () => {
  const original = { size: 12345, type: 'image/png' };
  const h = readerHarness({ readOriginal: async () => original });
  const asset = await h.reader.acquire({ id: 'one', src: '/full.png', previewSrc: '/thumb.webp', variant: 'original' });
  assert.equal(asset.blob, original);
  asset.release();
  assert.deepEqual(h.revoked, [asset.url]);
});

test('corrupt local original falls back to remote without deleting persisted data', async () => {
  const original = { size: 10, type: 'text/html' };
  let requests = 0;
  const remote = { size: 1000, type: 'image/png' };
  const h = readerHarness({ readOriginal: async () => original, fetchBlob: async () => { requests += 1; return remote; } });
  const asset = await h.reader.acquire({ id: 'one', src: '/full.png', variant: 'original' });
  assert.equal(asset.blob, remote);
  assert.equal(requests, 1);
  asset.release();
});

test('stalled reads settle as failed and explicit retry rereads without generating a task', async () => {
  let requests = 0;
  const h = readerHarness({
    timeoutMs: 5,
    fetchBlob: () => {
      requests += 1;
      return requests === 1 ? new Promise(() => {}) : Promise.resolve({ size: 100, type: 'image/png' });
    },
  });
  const input = { id: 'one', src: '/full.png', variant: 'preview' };
  assert.equal((await h.reader.acquire(input)).status, 'failed');
  const asset = await h.reader.acquire({ ...input, retry: true });
  assert.equal(asset.status, 'ready');
  assert.equal(requests, 2);
  asset.release();
});

test('empty image candidates settle as missing immediately', async () => {
  const h = readerHarness();
  assert.equal((await h.reader.acquire({ variant: 'preview' })).status, 'missing');
});

test('browser previews keep the longest edge at 720 and close the original bitmap', async () => {
  let closed = 0;
  let canvas;
  const runtime = loadRuntime({
    createImageBitmap: async () => ({ width: 4096, height: 2048, close: () => closed++ }),
    document: {
      createElement: () => (canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (callback) => callback({ size: 100, type: 'image/webp' }),
      }),
    },
  });
  assert.equal(typeof runtime.makeBrowserPreview, 'function', 'browser previews must resize and free the bitmap');
  const preview = await runtime.makeBrowserPreview({ size: 5000, type: 'image/png' });
  assert.equal(preview.width, 720);
  assert.equal(preview.height, 360);
  assert.equal(closed, 1);
  assert.equal(canvas.width, 1, 'the temporary canvas pixels must be released');
});

test('preview result arriving after card removal releases its lease without writing src', async () => {
  let resolve;
  let releases = 0;
  const reader = { acquire: () => new Promise((done) => { resolve = done; }) };
  const runtime = loadRuntime();
  assert.equal(typeof runtime.createImageBinder, 'function', 'classic cards must guard late image results');
  const img = { isConnected: true, src: '', dataset: {}, removeAttribute(name) { delete this[name]; }, addEventListener() {}, removeEventListener() {} };
  const states = [];
  const binder = runtime.createImageBinder({ reader, onState: (_, state) => states.push(state) });
  binder.bind(img, { id: 'one', src: '/one.png' });
  await Promise.resolve();
  binder.unbind(img);
  img.isConnected = false;
  resolve({ status: 'ready', url: 'blob:late', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, undefined);
  assert.equal(releases, 1);
  assert.deepEqual(states, ['reading']);
});

test('offscreen cards wait for intersection and release previews on leaving the viewport', async () => {
  let intersection;
  let requests = 0;
  let releases = 0;
  class Observer {
    constructor(callback) { intersection = callback; }
    observe() {}
    unobserve() {}
  }
  const runtime = loadRuntime();
  assert.equal(typeof runtime.createImageBinder, 'function', 'classic lists must load only visible previews');
  const reader = { acquire: async () => { requests++; return { status: 'ready', url: 'blob:preview', release: () => releases++ }; } };
  const img = { isConnected: true, src: '', dataset: {}, complete: false, removeAttribute(name) { delete this[name]; }, addEventListener() {}, removeEventListener() {} };
  const binder = runtime.createImageBinder({ reader, IntersectionObserver: Observer, onState() {} });
  binder.bind(img, { id: 'one', src: '/one.png' });
  assert.equal(requests, 0);
  intersection([{ target: img, isIntersecting: true }]);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, 'blob:preview');
  intersection([{ target: img, isIntersecting: false }]);
  assert.equal(img.src, undefined);
  assert.equal(releases, 1);
  binder.unbind(img);
});

test('scrolling away while a preview read is pending discards the late result', async () => {
  let intersection;
  let resolve;
  let releases = 0;
  class Observer { constructor(callback) { intersection = callback; } observe() {} unobserve() {} }
  const runtime = loadRuntime();
  const reader = { acquire: () => new Promise((done) => { resolve = done; }) };
  const img = { isConnected: true, dataset: {}, src: '', removeAttribute(name) { delete this[name]; } };
  const binder = runtime.createImageBinder({ reader, IntersectionObserver: Observer });
  binder.bind(img, { src: '/one.png' });
  intersection([{ target: img, isIntersecting: true }]);
  intersection([{ target: img, isIntersecting: false }]);
  resolve({ status: 'ready', url: 'blob:late', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, undefined);
  assert.equal(releases, 1);
});

test('preview encoder failure still closes bitmap and resets canvas pixels', async () => {
  let closed = 0;
  let canvas;
  const runtime = loadRuntime({
    createImageBitmap: async () => ({ width: 4096, height: 2048, close: () => closed++ }),
    document: { createElement: () => (canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { throw new Error('encode failure'); } }) }) },
  });
  await assert.rejects(runtime.makeBrowserPreview({ size: 5000, type: 'image/png' }), /encode failure/);
  assert.equal(closed, 1);
  assert.equal(canvas.width, 1);
});

test('late image bitmap after decode timeout is closed and does not block future work', async () => {
  let finish;
  let closed = 0;
  const runtime = loadRuntime({ createImageBitmap: () => new Promise((resolve) => { finish = resolve; }) });
  assert.equal(typeof runtime.decodeBrowserBlob, 'function', 'browser decoding must have a deadline and late cleanup');
  await assert.rejects(runtime.decodeBrowserBlob({ size: 100, type: 'image/png' }, 5), /timed out/i);
  finish({ width: 4000, height: 2000, close: () => closed++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(closed, 1);
});

test('shared preview keys normalize original URL passed as redundant thumbnail source', async () => {
  let reads = 0;
  const h = readerHarness({ readPreview: async () => { reads++; return { blob: { size: 100, type: 'image/webp' }, width: 720, height: 480, version: 1 }; } });
  const [a, b] = await Promise.all([
    h.reader.acquire({ src: '/one.png', variant: 'preview' }),
    h.reader.acquire({ src: '/one.png', previewSrc: '/one.png', variant: 'preview' }),
  ]);
  assert.equal(reads, 1);
  assert.equal(a.url, b.url);
  a.release();
  b.release();
});

test('original and preview consumers share the same in-flight local original read', async () => {
  let reads = 0;
  let finish;
  const h = readerHarness({ readOriginal: () => { reads++; return new Promise((resolve) => { finish = resolve; }); } });
  const a = h.reader.acquire({ id: 'one', src: '/one.png', variant: 'original' });
  const b = h.reader.acquire({ id: 'one', src: '/one.png', variant: 'preview' });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(reads, 1);
  finish({ size: 12345, type: 'image/png' });
  const assets = await Promise.all([a, b]);
  assets.forEach((asset) => asset.release());
});

test('image element decode error settles the card as failed and releases its URL', async () => {
  const states = [];
  let releases = 0;
  const events = {};
  const runtime = loadRuntime();
  const reader = { acquire: async () => ({ status: 'ready', url: 'blob:preview', release: () => releases++ }) };
  const img = { isConnected: true, src: '', dataset: {}, removeAttribute(name) { delete this[name]; }, addEventListener(type, handler) { events[type] = handler; }, removeEventListener(type) { delete events[type]; } };
  const binder = runtime.createImageBinder({ reader, onState: (_, state) => states.push(state) });
  binder.bind(img, { src: '/one.png' });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(typeof events.error, 'function', 'native decoder failures must have an explicit error state');
  events.error();
  assert.equal(states.at(-1), 'failed');
  assert.equal(releases, 1);
  binder.unbind(img);
});

test('preview preparation retains at most one downloaded original while decoding', async () => {
  let residentOriginals = 0;
  let peak = 0;
  const h = readerHarness({
    timeoutMs: 1000,
    fetchBlob: async () => {
      residentOriginals++;
      peak = Math.max(peak, residentOriginals);
      return { size: 10000000, type: 'image/png' };
    },
    makePreview: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      residentOriginals--;
      return { blob: { size: 100, type: 'image/webp' }, width: 720, height: 480, version: 1 };
    },
  });
  const assets = await Promise.all(['/a.png', '/b.png', '/c.png'].map((src) => h.reader.acquire({ src, variant: 'preview' })));
  assert.equal(peak, 1);
  assets.forEach((asset) => asset.release());
});

test('cancelled last consumer skips decoding an original that arrives after scrolling away', async () => {
  let finish;
  let decoded = 0;
  const h = readerHarness({
    timeoutMs: 1000,
    fetchBlob: () => new Promise((resolve) => { finish = resolve; }),
    makePreview: async () => { decoded++; return { blob: { size: 100, type: 'image/webp' }, width: 720, height: 480, version: 1 }; },
  });
  const controller = new AbortController();
  const pending = h.reader.acquire({ src: '/one.png', variant: 'preview', signal: controller.signal });
  await new Promise((done) => setTimeout(done, 0));
  controller.abort();
  finish({ size: 10000000, type: 'image/png' });
  const asset = await pending;
  assert.notEqual(asset.status, 'ready');
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(decoded, 0);
  assert.equal(h.urlCount(), 0);
});

test('cancelling one shared preview consumer keeps the other consumer alive', async () => {
  let finish;
  let requests = 0;
  const h = readerHarness({ timeoutMs: 1000, fetchBlob: () => { requests++; return new Promise((resolve) => { finish = resolve; }); } });
  const controller = new AbortController();
  const a = h.reader.acquire({ src: '/one.png', signal: controller.signal });
  const b = h.reader.acquire({ src: '/one.png' });
  await new Promise((done) => setTimeout(done, 0));
  controller.abort();
  finish({ size: 12345, type: 'image/png' });
  assert.notEqual((await a).status, 'ready');
  const live = await b;
  assert.equal(live.status, 'ready');
  assert.equal(requests, 1);
  live.release();
});

test('rebinding an image cannot accept the previous image read', async () => {
  const pending = [];
  let releases = 0;
  const runtime = loadRuntime();
  const reader = { acquire: () => new Promise((resolve) => pending.push(resolve)) };
  const img = { isConnected: true, src: '', dataset: {}, removeAttribute(name) { delete this[name]; } };
  const binder = runtime.createImageBinder({ reader });
  binder.bind(img, { src: '/old.png' });
  binder.bind(img, { src: '/new.png' });
  pending[1]({ status: 'ready', url: 'blob:new', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  pending[0]({ status: 'ready', url: 'blob:old', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, 'blob:new');
  assert.equal(releases, 1);
  binder.unbind(img);
});

test('rapid viewport reentry starts a fresh read before the cancelled attempt settles', async () => {
  let intersection;
  const pending = [];
  const states = [];
  let releases = 0;
  class Observer {
    constructor(callback) { intersection = callback; }
    observe() {}
    unobserve() {}
  }
  const runtime = loadRuntime();
  const reader = { acquire: () => new Promise((resolve) => pending.push(resolve)) };
  const img = { isConnected: true, src: '', dataset: {}, removeAttribute(name) { delete this[name]; } };
  const binder = runtime.createImageBinder({ reader, IntersectionObserver: Observer, onState: (_, state) => states.push(state) });
  binder.bind(img, { src: '/card.png' });
  intersection([{ target: img, isIntersecting: true }]);
  intersection([{ target: img, isIntersecting: false }]);
  intersection([{ target: img, isIntersecting: true }]);
  assert.equal(pending.length, 2, 'viewport reentry must immediately start the replacement read');

  pending[0]({ status: 'ready', url: 'blob:cancelled', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, undefined, 'the cancelled attempt must not write its late URL');
  assert.equal(releases, 1);
  intersection([{ target: img, isIntersecting: true }]);
  assert.equal(pending.length, 2, 'the old finally must not clear the current loading flag');

  pending[1]({ status: 'ready', url: 'blob:current', release: () => releases++ });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(img.src, 'blob:current');
  assert.deepEqual(states, ['reading', 'reading', 'ready']);
  binder.unbind(img);
  assert.equal(releases, 2);
});
