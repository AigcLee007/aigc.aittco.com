const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(filename, replacements) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, filename), 'utf8'), {
    module: mod, exports: mod.exports, __dirname, process, console, Buffer,
    require: name => replacements[name] || require(name),
  }, { filename });
  return mod.exports;
}

test('MySQL expiry preserves successful images while retaining the previous video and failure policies', async () => {
  const queries = [];
  const records = load('generationRecordStore.mysql.cjs', {
    './db.cjs': { getPool: async () => ({ execute: async (sql, args) => { queries.push({ sql, args }); return [{ affectedRows: 0 }]; } }) },
  });
  const result = await records.cleanupExpiredGenerationRecords();
  const cleanup = queries.find(query => /DELETE FROM generation_records/.test(query.sql));
  assert.match(cleanup.sql, /status = 'SUCCESS' AND media_type <> 'IMAGE'/);
  assert.match(cleanup.sql, /status = 'FAILED'/);
  assert.equal(result.imageSuccessRetentionDays, null);
});

test('file store reads never evict old successful images at the global record limit', async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => ({
    id: `record-${i}`, userId: 'owner', mediaType: 'IMAGE', status: 'SUCCESS',
    createdAt: new Date(2020, 0, 1, 0, 0, i).toISOString(), resultUrls: ['/original'],
  }));
  let contents = JSON.stringify({ records: rows });
  const records = load('generationRecordStore.file.cjs', {
    fs: { existsSync: () => true, readFileSync: () => contents, writeFileSync: (_, value) => { contents = value; } },
  });
  await records.listGenerationRecordsForUser('owner', { pageSize: 1 });
  assert.equal(JSON.parse(contents).records.length, 10001);
});

test('corrupt file records are reported without replacing the file with an empty history', async () => {
  let writes = 0;
  const records = load('generationRecordStore.file.cjs', {
    fs: { existsSync: () => true, readFileSync: () => '{invalid', writeFileSync: () => { writes++; } },
  });
  await assert.rejects(records.listGenerationRecordsForUser('owner'), /original file retained/);
  assert.equal(writes, 0);
});

test('canvas preview lookup filters requested jobs within the authenticated account', async () => {
  let contents = JSON.stringify({ records: [
    { id: 'matching', userId: 'owner', taskId: 'job-requested', status: 'SUCCESS', mediaType: 'IMAGE' },
    { id: 'unrequested', userId: 'owner', taskId: 'job-other', status: 'SUCCESS', mediaType: 'IMAGE' },
    { id: 'foreign', userId: 'other', taskId: 'job-requested', status: 'SUCCESS', mediaType: 'IMAGE' },
  ] });
  const records = load('generationRecordStore.file.cjs', {
    fs: { existsSync: () => true, readFileSync: () => contents, writeFileSync: (_, value) => { contents = value; } },
  });
  const result = await records.listGenerationRecordsForUser('owner', { taskIds: ['job-requested'] });
  assert.deepEqual(Array.from(result.records, record => record.id), ['matching']);
});

test('MySQL canvas lookup binds job identifiers and keeps the account restriction', async () => {
  const queries = [];
  const records = load('generationRecordStore.mysql.cjs', {
    './db.cjs': { getPool: async () => ({ execute: async (sql, args) => { queries.push({ sql, args }); return [/COUNT/.test(sql) ? [{ total: 0 }] : []]; } }) },
  });
  await records.listGenerationRecordsForUser('owner', { taskIds: ['job-requested'] });
  const query = queries.find(item => /SELECT COUNT/.test(item.sql));
  assert.match(query.sql, /user_id = \?/);
  assert.match(query.sql, /task_id IN \(\?\)/);
  assert.ok(!query.sql.includes('job-requested'));
  assert.equal(query.args[0], 'owner');
  assert.equal(query.args[1], 'job-requested');
});

test('legacy image maintenance expires originals after hours and thumbnails after 30 days', async () => {
  const removed = [];
  let ageMs = 0;
  const assets = load('generatedAssetService.cjs', {
    fs: { existsSync: () => true, promises: {
      readdir: async () => [{ name: 'image.webp', isDirectory: () => false, isFile: () => true }],
      stat: async () => ({ mtimeMs: Date.now() - ageMs }), unlink: async file => { removed.push(file); },
    } },
  });
  ageMs = 29 * 24 * 3600000;
  await assets.cleanupExpiredLocalAssets();
  assert.equal(removed.length, 1);
  assert.ok(removed[0].includes(`${path.sep}original${path.sep}`));
  removed.length = 0;
  ageMs = 31 * 24 * 3600000;
  await assets.cleanupExpiredLocalAssets();
  assert.ok(removed.some(file => file.includes(`${path.sep}thumb${path.sep}`)));
});
