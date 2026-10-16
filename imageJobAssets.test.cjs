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

test('previews survive original expiry, physical cleanup and a server restart a year later', async t => {
  let now = Date.now();
  const f = await fixture(t, { now: () => now, ttlMs: 100 });
  let saved;
  const result = await f.service.prepare({ resultUrls: [f.source], context, onSaved: value => { saved = value; } });
  await f.service.drain();
  const original = await f.service.resolveAsset(assetArgs(result.resultUrls[0]));
  const preview = await f.service.resolveAsset(assetArgs(saved.previewUrl));
  const expected = await fs.readFile(preview);
  now += 365 * 24 * 3600000;
  await f.service.cleanup();
  await assert.rejects(fs.access(original));
  await assert.rejects(f.service.resolveAsset(assetArgs(result.resultUrls[0])), error => error.status === 410);
  const restarted = api.createImageJobAssets({ root: f.root, now: () => now });
  assert.deepEqual(await fs.readFile(await restarted.resolveAsset(assetArgs(saved.previewUrl))), expected);
  // A permanent preview capability never authorizes an original or another file.
  await assert.rejects(restarted.resolveAsset({ ...assetArgs(result.resultUrls[0]), token: assetArgs(saved.previewUrl).token }));
  await assert.rejects(restarted.resolveAsset({ ...assetArgs(saved.previewUrl), userId: 'usr_other' }));
});

test('each output publishes its own preview in result order', async t => {
  const f = await fixture(t);
  const second = await sharp({ create: { width: 3, height: 7, channels: 3, background: '#ff0000' } }).png().toBuffer();
  let saved;
  await f.service.prepare({ resultUrls: [f.source, `data:image/png;base64,${second.toString('base64')}`], context, onSaved: value => { saved = value; } });
  await f.service.drain();
  assert.equal(saved.previewUrls.length, 2);
  assert.notEqual(saved.previewUrls[0], saved.previewUrls[1]);
  assert.equal(saved.previewUrl, saved.previewUrls[0]);
  for (const [index, url] of saved.previewUrls.entries()) {
    const meta = await sharp(await f.service.resolveAsset(assetArgs(url))).metadata();
    assert.equal(meta.width, index ? 3 : 8);
  }
});

test('partial multi-output preview publication stays pending so restart recovery still owns unfinished previews', async t => {
  const f = await fixture(t);
  const second = await sharp(f.buffer).jpeg().toBuffer();
  const updates = [];
  await f.service.prepare({ resultUrls: [f.source, `data:image/jpeg;base64,${second.toString('base64')}`], context, onSaved: value => { updates.push(value); } });
  assert.equal(updates[0].storageStatus, 'pending');
  assert.equal(updates.at(-1).storageStatus, 'saved');
});

test('preview write failure is observable and never advertises complete saving or loses the original', async t => {
  const warnings = [];
  const f = await fixture(t, { logger: { warn: event => warnings.push(event) } });
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination.endsWith('.preview.webp')) throw new Error('preview disk unavailable');
    return rename(source, destination);
  });
  const result = await f.service.prepare({ resultUrls: [f.source], context });
  assert.equal(result.storageStatus, 'failed');
  assert.equal(result.previewUrl, null);
  assert.equal(warnings[0].type, 'Image preview save failed');
  assert.deepEqual(await fs.readFile(await f.service.resolveAsset(assetArgs(result.resultUrls[0]))), f.buffer);
});

test('last inline preview failure publishes the terminal state after a partial pending update', async t => {
  const f = await fixture(t);
  const second = await sharp(f.buffer).jpeg().toBuffer();
  const rename = fs.rename;
  let previewWrites = 0;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination.endsWith('.preview.webp') && ++previewWrites > 1) throw new Error('last preview disk unavailable');
    return rename(source, destination);
  });
  const updates = [];
  const result = await f.service.prepare({ resultUrls: [f.source, `data:image/jpeg;base64,${second.toString('base64')}`], context,
    onSaved: value => { updates.push(value); } });
  assert.equal(result.storageStatus, 'failed');
  assert.equal(updates[0].storageStatus, 'pending');
  assert.equal(updates.at(-1).storageStatus, 'failed');
  assert.deepEqual(updates.at(-1).previewUrls, result.previewUrls);
  assert.ok(result.previewUrls[0]);
  assert.equal(result.previewUrls[1], null);
  assert.deepEqual(await fs.readFile(await f.service.resolveAsset(assetArgs(result.resultUrls[1]))), second);
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

test('default cloud storage leaves a buffer after four hours and expires at five hours', async t => {
  const previous = process.env.IMAGE_JOB_RETENTION_MS;
  delete process.env.IMAGE_JOB_RETENTION_MS;
  t.after(() => { if (previous === undefined) delete process.env.IMAGE_JOB_RETENTION_MS; else process.env.IMAGE_JOB_RETENTION_MS = previous; });
  const started = Date.now();
  let now = started;
  const f = await fixture(t, { now: () => now });
  const result = await f.service.prepare({ resultUrls: [f.source], context });
  await f.service.drain();
  const args = assetArgs(result.resultUrls[0]);
  const file = await f.service.resolveAsset(args);
  now = started + 4.5 * 60 * 60 * 1000;
  assert.deepEqual(await fs.readFile(await f.service.resolveAsset(args)), f.buffer);
  now = started + 5 * 60 * 60 * 1000;
  await assert.rejects(f.service.resolveAsset(args), error => error.status === 410);
  now += 60 * 1000;
  await f.service.cleanup();
  await assert.rejects(fs.access(file));
});

test('asset links and physical cleanup obey the configured job retention', async t => {
  const previous = process.env.IMAGE_JOB_RETENTION_MS;
  process.env.IMAGE_JOB_RETENTION_MS = String(60 * 60 * 1000);
  t.after(() => { if (previous === undefined) delete process.env.IMAGE_JOB_RETENTION_MS; else process.env.IMAGE_JOB_RETENTION_MS = previous; });
  let now = Date.now();
  const f = await fixture(t, { now: () => now });
  const result = await f.service.prepare({ resultUrls: [f.source], context });
  await f.service.drain();
  const args = assetArgs(result.resultUrls[0]);
  const file = await f.service.resolveAsset(args);
  now += 60 * 60 * 1000 + 60 * 1000;
  await assert.rejects(f.service.resolveAsset(args), error => error.status === 410);
  await f.service.cleanup();
  await assert.rejects(fs.access(file));
});

test('malformed images and private remote addresses are not cached as valid results', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.prepare({ resultUrls: ['data:image/png;base64,bm90LWltYWdl'], context }));
  for (const url of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd']) {
    assert.equal(api.isPublicImageUrl(url), false);
  }
});
