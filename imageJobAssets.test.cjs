const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
sharp.cache(false);

let api = {};
try { api = require('./imageJobAssets.cjs'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const context = { userId: 'usr_test', taskId: 'job-12345678901234567890123456789012' };
async function fixture(t, options = {}) {
  assert.equal(typeof api.createImageJobAssets, 'function', 'asset service must exist');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-job-assets-'));
  const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#334455' } }).png().toBuffer();
  const service = api.createImageJobAssets({ root, retryDelayMs: 1, ...options });
  t.after(async () => { await service.drain(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); });
  return { root, buffer, service, source: `data:image/png;base64,${buffer.toString('base64')}` };
}
async function settleUntil(predicate) {
  for (let i = 0; i < 150 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), 'background save must settle');
}
function assetArgs(url) {
  const parsed = new URL(url, 'https://site.example');
  const [, , , userId, taskId, filename] = parsed.pathname.split('/');
  return { userId, taskId, filename, token: parsed.searchParams.get('token') };
}

test('inline result is durable before returning and is compact instead of base64', async t => {
  const f = await fixture(t);
  const result = await f.service.prepare({ payload: { images: [f.source], data: [{ b64_json: f.source.split(',')[1] }], model: 'test' }, resultUrls: [f.source], context });
  assert.equal(result.storageStatus, 'saved');
  assert.equal(result.resultUrls.length, 1);
  assert.ok(result.resultUrls[0].startsWith('/api/image-job-assets/'));
  assert.ok(!JSON.stringify(result.payload).includes('base64'));
  const file = await f.service.resolveAsset(assetArgs(result.resultUrls[0]));
  assert.deepEqual(await fs.readFile(file), f.buffer);
  const fresh = api.createImageJobAssets({ root: f.root });
  assert.equal(await fresh.resolveAsset(assetArgs(result.resultUrls[0])), file);
});

test('valid AVIF results are saved using their AV1 HEIF metadata', async t => {
  const f = await fixture(t);
  const buffer = await sharp(f.buffer).avif().toBuffer();
  const result = await f.service.prepare({ resultUrls: [`data:image/avif;base64,${buffer.toString('base64')}`], context });
  assert.match(result.resultUrls[0], /\.avif\?/);
  assert.deepEqual(await fs.readFile(await f.service.resolveAsset(assetArgs(result.resultUrls[0]))), buffer);
});

test('site-local IPv6 cannot be used as image sources', () => {
  assert.equal(api.isPublicImageUrl('http://[fec0::1]/image.png'), false);
});

test('preview finishes separately and callback publishes a usable small image', async t => {
  const f = await fixture(t);
  let saved;
  const result = await f.service.prepare({ resultUrls: [f.source], context, onSaved: value => { saved = value; } });
  await settleUntil(() => saved?.previewUrl);
  assert.notEqual(saved.previewUrl, result.resultUrls[0]);
  const preview = await f.service.resolveAsset(assetArgs(saved.previewUrl));
  assert.equal((await sharp(preview).metadata()).format, 'webp');
});

test('a notification error cannot mark a saved original failed or stop its preview', async t => {
  const f = await fixture(t, { download: async () => f.buffer });
  const states = [];
  await f.service.prepare({ resultUrls: ['https://images.example/result.png'], context, onSaved: value => {
    states.push(value);
    if (states.length === 1) throw new Error('metadata temporarily unavailable');
  } });
  await f.service.drain();
  assert.deepEqual(states.map(value => value.storageStatus), ['saved', 'saved']);
  assert.ok(states[1].previewUrl);
});

test('remote URL displays without waiting for original download then switches to stored URL', async t => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { download: () => delayed });
  let saved;
  const result = await f.service.prepare({ resultUrls: ['https://images.example/result.png'], context, onSaved: value => { saved = value; } });
  assert.equal(result.storageStatus, 'pending');
  assert.equal(result.resultUrls[0], 'https://images.example/result.png');
  release(f.buffer);
  await settleUntil(() => saved?.storageStatus === 'saved');
  assert.ok(saved.resultUrls[0].startsWith('/api/image-job-assets/'));
});

test('failed remote save keeps successful result usable and retrying storage does not generate', async t => {
  let attempts = 0;
  const f = await fixture(t, { retries: 1, download: async () => { attempts++; throw new Error('download interrupted'); } });
  let saved;
  const result = await f.service.prepare({ resultUrls: ['https://images.example/result.png'], context, onSaved: value => { saved = value; } });
  await settleUntil(() => saved?.storageStatus === 'failed');
  assert.equal(attempts, 2);
  assert.equal(saved.resultUrls[0], result.resultUrls[0]);
  assert.equal(saved.payload.status, 'succeeded');
});

test('download concurrency is bounded when many results are queued', async t => {
  let active = 0, peak = 0;
  let f;
  const finished = [];
  f = await fixture(t, { downloadConcurrency: 2, download: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; return f.buffer;
  } });
  for (let i = 0; i < 6; i++) await f.service.prepare({ resultUrls: [`https://images.example/${i}.png`], context: { ...context, taskId: `job-${String(i).padStart(32, '0')}` }, onSaved: value => { if (value.storageStatus === 'saved') finished.push(i); } });
  await settleUntil(() => finished.length >= 6);
  assert.equal(peak, 2);
});

test('tampered capability or path cannot read another task or escape storage', async t => {
  const f = await fixture(t);
  const result = await f.service.prepare({ resultUrls: [f.source], context });
  await f.service.drain();
  const args = assetArgs(result.resultUrls[0]);
  await assert.rejects(f.service.resolveAsset({ ...args, userId: 'usr_other' }));
  await assert.rejects(f.service.resolveAsset({ ...args, filename: '../key' }));
  await assert.rejects(f.service.resolveAsset({ ...args, token: `${args.token}x` }));
});

test('expired files are removed and never served as infinite loading', async t => {
  let now = Date.now();
  const f = await fixture(t, { now: () => now, ttlMs: 100 });
  const result = await f.service.prepare({ resultUrls: [f.source], context });
  await f.service.drain();
  const args = assetArgs(result.resultUrls[0]);
  const file = await f.service.resolveAsset(args);
  await fs.utimes(file, new Date(now - 1000), new Date(now - 1000));
  now += 200;
  await f.service.cleanup();
  await assert.rejects(f.service.resolveAsset(args), error => error.status === 410);
  await assert.rejects(fs.access(file));
});

test('malformed images and private remote addresses are not cached as valid results', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.prepare({ resultUrls: ['data:image/png;base64,bm90LWltYWdl'], context }));
  for (const url of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd']) {
    assert.equal(api.isPublicImageUrl(url), false);
  }
});
