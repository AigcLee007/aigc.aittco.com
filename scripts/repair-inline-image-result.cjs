const path = require('node:path');

// Repairs bytes already returned by the provider. This tool never submits a
// generation request or changes charge/refund fields.
async function repairInlineImageResult({ store, createAssets, taskId, apply = false, now = Date.now }) {
  if (!/^job-[a-zA-Z0-9_-]+$/.test(String(taskId || ''))) throw new Error('A valid --task job-ID is required');
  const job = await store.get(taskId);
  if (!job) throw new Error('Task not found');
  const sources = job.resultUrls || [];
  const eligible = job.status === 'succeeded' && sources.length > 0 && sources.every(source =>
    typeof source === 'string' && /^\/9j\/[A-Za-z0-9+/=\s]+$/.test(source.trim()));
  const summary = { taskId, status: job.status, storageStatus: job.storageStatus, resultCount: sources.length, eligible, repaired: false };
  if (!eligible) return { ...summary, reason: 'no-malformed-inline-result' };
  const completedAt = Date.parse(job.completedAt);
  const configuredTtl = Number(process.env.IMAGE_JOB_RETENTION_MS);
  const ttlMs = Number.isFinite(configuredTtl) && configuredTtl > 0 ? Math.min(configuredTtl, 5 * 3600000) : 5 * 3600000;
  if (!Number.isFinite(completedAt) || completedAt > now()) return { ...summary, eligible: false, reason: 'unknown-completion-time' };
  if (now() >= completedAt + ttlMs) return { ...summary, eligible: false, reason: 'expired' };
  if (!apply) return { ...summary, reason: 'dry-run' };

  // Sign against the original completion time; repair must not restart the TTL.
  const assets = createAssets({ now: () => completedAt, ttlMs });
  let latest;
  const prepared = await assets.prepare({
    resultUrls: [...new Set(sources.map(source => `data:image/jpeg;base64,${source.replace(/\s+/g, '')}`))],
    context: { userId: job.userId, taskId }, onSaved: update => { latest = update; },
  });
  await assets.drain();
  const result = latest || prepared;
  if (result.storageStatus !== 'saved') throw new Error('Original image could not be saved');
  const urls = result.resultUrls;
  await store.update(taskId, current => {
    if (current.status !== 'succeeded' || JSON.stringify(current.resultUrls) !== JSON.stringify(sources)) throw new Error('Task changed during repair; no metadata was overwritten');
    return { resultUrls: urls, previewUrl: result.previewUrl || null, storageStatus: 'saved', storageError: null,
      payload: { images: urls, results: urls, data: urls.map(url => ({ url })) }, settlementPending: true };
  });
  return { ...summary, storageStatus: 'saved', resultCount: urls.length, repaired: true,
    reason: 'restored-existing-image', images: urls, previewUrl: result.previewUrl || null };
}

async function main() {
  const fs = require('node:fs');
  const envFile = path.join(__dirname, '..', '.env');
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const args = process.argv.slice(2), taskIndex = args.indexOf('--task');
  const taskId = args[taskIndex + 1];
  if (taskIndex < 0 || !taskId) throw new Error('Usage: node scripts/repair-inline-image-result.cjs --task job-ID [--apply]');
  const { createImageJobStore } = require('../imageJobStore.cjs');
  const { createImageJobAssets, STORAGE_ROOT } = require('../imageJobAssets.cjs');
  const root = path.resolve(process.env.IMAGE_JOB_STORAGE_ROOT || STORAGE_ROOT);
  const store = createImageJobStore({ root });
  try {
    const result = await repairInlineImageResult({ store, createAssets: options => createImageJobAssets({ root, ...options }),
      taskId, apply: args.includes('--apply') });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    const db = require('../db.cjs');
    if (db.isMySqlConfigured()) await (await db.getPool()).end();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { repairInlineImageResult };
