const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
sharp.cache(false);
const { createImageJobStore } = require('../imageJobStore.cjs');
const { createImageJobAssets } = require('../imageJobAssets.cjs');
let repairInlineImageResult;
try { ({ repairInlineImageResult } = require('./repair-inline-image-result.cjs')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('repairs the existing JPEG result without generation, billing changes, or extending retention', async t => {
  assert.equal(typeof repairInlineImageResult, 'function', 'old inline JPEG result repair is available');
  const previousRetention = process.env.IMAGE_JOB_RETENTION_MS;
  delete process.env.IMAGE_JOB_RETENTION_MS;
  t.after(() => { if (previousRetention === undefined) delete process.env.IMAGE_JOB_RETENTION_MS; else process.env.IMAGE_JOB_RETENTION_MS = previousRetention; });
  const root = await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT || os.tmpdir(), 'repair-inline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createImageJobStore({ root, useMySql: false });
  const now = Date.now(), completedAt = now - 2 * 3600000;
  const buffer = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#334455' } }).jpeg().toBuffer();
  const raw = buffer.toString('base64');
  const taskId = 'job-inline-repair';
  await store.admit({ taskId, userId: 'owner', requestId: 'request', createdAt: new Date(completedAt - 60000).toISOString() }, { body: {} });
  await store.update(taskId, { status: 'succeeded', completedAt: new Date(completedAt).toISOString(), storageStatus: 'failed',
    storageError: 'Unsupported generated image source', resultUrls: [raw], payload: { images: [raw] },
    points: 3, chargeId: 'existing-charge', billing: { deductedPoints: 3 }, compensatedAt: null });
  let assetCalls = 0;
  const options = { store, taskId, now: () => now, createAssets: options => { assetCalls++; return createImageJobAssets({ root, ...options }); } };
  const before = await store.get(taskId);
  const dry = await repairInlineImageResult(options);
  assert.equal(dry.eligible, true);
  assert.equal(dry.repaired, false);
  assert.equal(assetCalls, 0);
  assert.deepEqual(await store.get(taskId), before);
  const result = await repairInlineImageResult({ ...options, apply: true });
  assert.equal(result.repaired, true);
  const after = await store.get(taskId);
  assert.equal(after.status, 'succeeded');
  assert.equal(after.storageStatus, 'saved');
  assert.equal(after.storageError, null);
  assert.equal(after.points, 3);
  assert.equal(after.chargeId, 'existing-charge');
  assert.deepEqual(after.billing, before.billing);
  assert.equal(after.compensatedAt, null);
  assert.equal(after.completedAt, before.completedAt);
  assert.equal(after.settlementPending, true, 'existing record is reconciled through normal idempotent settlement');
  assert.ok(after.previewUrl);
  assert.equal(JSON.stringify(after).includes(raw), false);
  const url = new URL(after.resultUrls[0], 'https://site.example');
  assert.equal(Number(url.searchParams.get('token').split('.')[0]), completedAt + 5 * 3600000);
  const parts = url.pathname.split('/');
  const assets = createImageJobAssets({ root, now: () => now });
  const file = await assets.resolveAsset({ userId: parts[3], taskId: parts[4], filename: parts[5], token: url.searchParams.get('token') });
  assert.deepEqual(await fs.readFile(file), buffer);
  assert.equal((await repairInlineImageResult({ ...options, apply: true })).eligible, false);
  assert.equal(assetCalls, 1);
  await store.update(taskId, { resultUrls: [raw], completedAt: new Date(now - 6 * 3600000).toISOString() });
  assert.equal((await repairInlineImageResult({ ...options, apply: true })).reason, 'expired');
  assert.equal(assetCalls, 1);
  await store.update(taskId, { status: 'failed', completedAt: new Date(now).toISOString() });
  assert.equal((await repairInlineImageResult({ ...options, apply: true })).eligible, false);
  await store.update(taskId, { status: 'succeeded', completedAt: new Date(completedAt).toISOString() });
  process.env.IMAGE_JOB_RETENTION_MS = String(3600000);
  assert.equal((await repairInlineImageResult({ ...options, apply: true })).reason, 'expired');
  assert.equal(assetCalls, 1);
});
