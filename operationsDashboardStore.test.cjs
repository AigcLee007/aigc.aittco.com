const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createOperationsDashboardStore, sanitizeSummary, normalizeFailure } = require('./operationsDashboardStore.cjs');

const NOW = new Date('2026-10-19T08:00:00.000Z');
const fakePool = (respond = () => []) => ({
  calls: [], timestamps: new Map(),
  async execute(sql, params = []) {
    this.calls.push({ sql, params });
    const result = await respond(sql, params);
    const statement = sql.replace(/^\/\*\s*ops:[^*]+\*\/\s*/, '');
    if (statement.startsWith('INSERT INTO ops_task_facts')) {
      const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(', ');
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      const previous = this.timestamps.get(row.task_id);
      if (!previous) this.timestamps.set(row.task_id, row);
      else if (new Date(row.updated_at).getTime() >= new Date(previous.updated_at).getTime()) this.timestamps.set(row.task_id, { ...previous, ...row, created_at: previous.created_at, completed_at: previous.completed_at || row.completed_at });
    }
    if (/ops:fact-timestamps/.test(sql) && Array.isArray(result) && !result.length) return [[this.timestamps.get(params[0])].filter(Boolean), []];
    return [result, []];
  },
});
const setup = async respond => { const pool = fakePool(respond); const store = createOperationsDashboardStore({ pool, now: () => NOW, logger: { warn() {} } }); await store.init(); pool.calls.length = 0; return { pool, store }; };
const fact = (patch = {}) => ({ taskId: 'task-1', requestId: 'req-1', userId: 'user-1', status: 'queued', phase: 'queued', createdAt: new Date('2026-10-19T07:00:00Z'), updatedAt: NOW, ...patch });

test('disabled telemetry reports unavailable history and performs no queries', async () => {
  const pool = fakePool();
  const store = createOperationsDashboardStore({ pool, enabled: false });
  assert.equal((await store.init()).available, false);
  assert.equal(store.getCoverage().history, 'unavailable');
  assert.equal(await store.upsertTaskFact('task-1', fact()), false);
  assert.deepEqual(await store.listTaskFacts({}), { items: [], nextCursor: null });
  assert.deepEqual(await store.getTrends({}), { items: [], window: '1h' });
  assert.equal((await store.getFailureSummary({})).successRate, null);
  assert.equal(pool.calls.length, 0);
});

test('initialization creates five indexed telemetry tables without accessing business tables', async () => {
  const pool = fakePool(); const store = createOperationsDashboardStore({ pool, now: () => NOW });
  await store.init(); await store.init();
  const ddl = pool.calls.filter(call => /CREATE TABLE/i.test(call.sql));
  assert.equal(ddl.length, 5);
  for (const table of ['ops_task_facts', 'ops_task_events', 'ops_metric_buckets', 'ops_incidents', 'ops_admin_audit']) assert.ok(ddl.some(call => call.sql.includes(table) && /(?:INDEX|KEY) /i.test(call.sql)));
  assert.match(ddl[0].sql, /completed_at/);
  assert.ok(pool.calls.every(call => !/image_jobs|billing|ledger|auth_sessions/.test(call.sql)));
  assert.equal(store.getCoverage().history, 'not_collected');
});

test('initialization failures are unavailable and redact driver errors', async () => {
  const store = createOperationsDashboardStore({ pool: fakePool(() => { throw Object.assign(new Error('Bearer secret database=password'), { code: 'ECONNREFUSED' }); }), logger: { warn() {} } });
  const coverage = await store.init();
  assert.equal(coverage.available, false); assert.equal(coverage.history, 'unavailable');
  assert.ok(!coverage.error.includes('secret')); assert.ok(!coverage.error.includes('password'));
});

test('summary sanitization removes credentials, URLs, inline images and sensitive free text', () => {
  const secret = 'Bearer abc123 sk-secret123 https://host/session/session-secret?token=token-secret https://cdn/x?X-Amz-Signature=signed-secret data:image/png;base64,aGVsbG8= api_key=api-secret sessionToken=session-secret password=pw-secret prompt=private-prompt';
  const safe = sanitizeSummary(secret);
  for (const value of ['abc123', 'sk-secret123', 'session-secret', 'token-secret', 'signed-secret', 'aGVsbG8', 'api-secret', 'pw-secret', 'private-prompt', 'https://']) assert.ok(!safe.includes(value), value);
  assert.ok(safe.length <= 1000); assert.equal(sanitizeSummary('normal sentence '.repeat(200)).length, 1000);
  const failure = normalizeFailure({ message: 'Bearer hidden', stage: 'upstream', category: 'auth', code: 'UNAUTHORIZED', httpStatus: 401, body: 'private' });
  assert.deepEqual(Object.keys(failure).sort(), ['category', 'code', 'httpStatus', 'message', 'stage']);
  assert.ok(!JSON.stringify(failure).includes('hidden'));
});

test('task writes allowlisted fields, UTC Dates and update-order protection', async () => {
  const { store, pool } = await setup();
  await store.upsertTaskFact('task-1', fact({ errorSummary: 'failed Bearer credential', prompt: 'private prompt', authorization: 'Bearer secret', url: 'https://host/private' }));
  const write = pool.calls.find(call => /INSERT INTO ops_task_facts/.test(call.sql));
  assert.ok(write); assert.match(write.sql, /ON DUPLICATE KEY UPDATE/); assert.match(write.sql, /VALUES[(]updated_at[)] >= updated_at/);
  for (const value of ['credential', 'private prompt', 'Bearer secret', 'https://host/private']) assert.ok(!JSON.stringify(write.params).includes(value), value);
  assert.ok(write.params.some(value => value instanceof Date && value.toISOString() === NOW.toISOString()));
  assert.equal(store.getCoverage().history, 'collected'); assert.equal(store.getCoverage().lastCollectedAt, NOW.toISOString());
});

test('events persist an explicit safe payload and detail reads redact unsafe database values', async () => {
  const { store, pool } = await setup(sql => {
    if (/ops:task-detail/.test(sql)) return [{ task_id: 'task-1', user_id: 'user-1', status: 'failed', created_at: '2026-10-19 07:00:00.000', error_summary: 'Bearer stolen', prompt: 'private' }];
    if (/ops:task-events/.test(sql)) return [{ event_id: 'ev-1', task_id: 'task-1', event_type: 'failed', created_at: '2026-10-19 08:00:00.000', payload_json: JSON.stringify({ status: 'failed', errorSummary: 'Bearer hidden', prompt: 'private', token: 'hidden' }) }];
    return [];
  });
  await store.appendEvent({ taskId: 'task-1', type: 'failed', createdAt: NOW, status: 'failed', errorSummary: 'Bearer hidden', body: { secret: true }, prompt: 'private', resultUrl: 'https://private' });
  const write = pool.calls.find(call => /INSERT(?: IGNORE)? INTO ops_task_events/.test(call.sql));
  const payload = JSON.parse(write.params.find(value => typeof value === 'string' && value.startsWith('{')));
  assert.deepEqual(Object.keys(payload).sort(), ['errorSummary', 'status']); assert.ok(!JSON.stringify(write.params).includes('hidden'));
  const detail = await store.getTaskFact('task-1');
  assert.equal(detail.task.taskId, 'task-1'); assert.equal(detail.task.createdAt, '2026-10-19T07:00:00.000Z'); assert.equal(detail.events[0].type, 'failed');
  assert.ok(!JSON.stringify(detail).includes('private')); assert.ok(!JSON.stringify(detail).includes('stolen'));
});

test('task filters are bound, limits clamped, and equal timestamps paginate by task id', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ task_id: 'task-' + String(99 - i).padStart(3, '0'), created_at: '2026-10-19 07:00:00.000', status: 'failed' }));
  const { store, pool } = await setup(sql => /ops:task-list/.test(sql) ? rows : []);
  const filters = { window: '7d', status: 'failed', userId: "u' OR 1=1", routeId: 'route-a', taskId: 'task-1', requestId: 'req-1', failureCategory: 'auth', storageStatus: 'failed', settlementStatus: 'pending', limit: 10000 };
  const first = await store.listTaskFacts(filters);
  assert.equal(first.items.length, 50); assert.ok(first.nextCursor);
  const query = pool.calls.at(-1);
  assert.ok(query.params.includes(filters.userId)); assert.ok(!query.sql.includes(filters.userId)); assert.match(query.sql, /ORDER BY created_at DESC, task_id DESC/); assert.equal(query.params.at(-1), 51);
  assert.ok(query.params.filter(value => value instanceof Date).length >= 2);
  await store.listTaskFacts({ ...filters, cursor: first.nextCursor });
  assert.ok(pool.calls.at(-1).sql.includes('created_at < ? OR (created_at = ? AND task_id < ?)'));
  await assert.rejects(() => store.listTaskFacts({ cursor: 'bad cursor' }), /cursor/i);
});

test('event retries deduplicate on task state rather than collector invocation timestamp', async () => {
  const { store, pool } = await setup();
  const base = { ...fact({ status: 'succeeded', storageStatus: 'pending', settlementStatus: 'pending' }), type: 'archived', createdAt: NOW };
  const first = await store.appendEvent(base);
  const retry = await store.appendEvent({ ...base, createdAt: new Date(NOW.getTime() + 120000), prompt: 'not part of event state' });
  assert.equal(retry, first);
  const saved = await store.appendEvent({ ...base, storageStatus: 'saved' });
  const settled = await store.appendEvent({ ...base, settlementStatus: 'settled' });
  const newer = await store.appendEvent({ ...base, updatedAt: new Date(NOW.getTime() + 1) });
  assert.equal(new Set([first, saved, settled, newer]).size, 4);
  for (const call of pool.calls) assert.ok(call.sql.includes('INSERT IGNORE INTO ops_task_events'));
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});

test('explicit event ids survive retry and invalid ids are rejected without persistence', async () => {
  const { store, pool } = await setup();
  const eventId = 'baf0ea9b-4b6c-461c-a401-46fd139fc26f';
  assert.equal(await store.appendEvent({ ...fact(), type: 'storage', eventId }), eventId);
  assert.equal(pool.calls.at(-1).params[0], eventId);
  const count = pool.calls.length;
  await assert.rejects(() => store.appendEvent({ ...fact(), type: 'storage', eventId: 'Bearer secret' }), error => error.status === 400);
  assert.equal(pool.calls.length, count);
});

test('dirty bucket repair reads stored immutable times across a later completion minute boundary', async () => {
  const { store, pool } = await setup();
  const original = fact({ status: 'succeeded', createdAt: new Date('2026-10-19T05:58:05Z'), completedAt: new Date('2026-10-19T06:59:59.900Z'), updatedAt: new Date('2026-10-19T07:00:01Z') });
  await store.upsertTaskFact('task-1', original);
  await store.refreshAggregates();
  pool.calls.length = 0;
  await store.upsertTaskFact('task-1', { ...original, routeId: 'resolved-route', createdAt: new Date('2026-10-19T07:30:00Z'), completedAt: new Date('2026-10-19T07:00:00.100Z'), updatedAt: new Date('2026-10-19T07:01:00Z') });
  await store.refreshAggregates();
  const query = pool.calls.find(call => /ops:aggregate-buckets/.test(call.sql));
  const times = query.params.filter(value => value instanceof Date).map(date => date.toISOString());
  assert.ok(times.includes('2026-10-19T05:58:00.000Z'));
  assert.ok(times.includes('2026-10-19T06:59:00.000Z'));
  assert.ok(!times.includes('2026-10-19T07:30:00.000Z'));
  assert.ok(pool.calls.some(call => /ops:fact-timestamps/.test(call.sql) && call.sql.includes('WHERE task_id = ? LIMIT 1')));
  pool.calls.length = 0;
  await store.upsertTaskFact('task-1', { ...original, updatedAt: new Date('2026-10-19T06:00:00Z') });
  await store.refreshAggregates();
  const ignored = pool.calls.find(call => /ops:aggregate-buckets/.test(call.sql));
  assert.ok(!ignored.params.some(value => value instanceof Date && value.toISOString() === '2026-10-19T06:59:00.000Z'), 'older no-op updates do not enqueue retained history buckets');
});

test('task detail returns null for unknown ids', async () => {
  const { store, pool } = await setup(); assert.equal(await store.getTaskFact('unknown'), null);
  assert.match(pool.calls.at(-1).sql, /task_id = ?/); assert.ok(pool.calls.at(-1).params.includes('unknown'));
});

test('enabled write failures mark a coverage gap and rethrow sanitized errors', async () => {
  const { store, pool } = await setup();
  pool.execute = async () => { throw Object.assign(new Error('Authorization: Bearer private credential'), { code: 'ER_LOCK_WAIT_TIMEOUT' }); };
  await assert.rejects(() => store.upsertTaskFact('task-1', fact()), error => !error.message.includes('private') && /telemetry/i.test(error.message));
  assert.match(store.getCoverage().error, /ER_LOCK_WAIT_TIMEOUT/);
});

test('telemetry write failures expose a safe operation label without SQL values', async () => {
  const { store, pool } = await setup();
  pool.execute = async sql => {
    if (sql.includes('ops:task-event-write')) throw Object.assign(new Error('Bearer private credential'), { code: 'ER_WRONG_ARGUMENTS' });
    return [[], []];
  };
  await assert.rejects(
    () => store.appendEvent({ taskId: 'task-1', type: 'terminal', status: 'failed', userId: 'private-user' }),
    error => error.message.includes('task-event-write') && error.message.includes('ER_WRONG_ARGUMENTS') && !error.message.includes('private'),
  );
  assert.match(store.getCoverage().error, /task-event-write/);
  assert.ok(!store.getCoverage().error.includes('private'));
});

test('background refresh fills shared cached terminal summaries and percentile distributions', async () => {
  const { store, pool } = await setup(sql => {
    if (/ops:summary/.test(sql)) return [{ total: 12, succeeded: 9, failed: 3, affected_users: 2, storage_failures: 1, settlement_pending: 2 }];
    if (/ops:causes/.test(sql)) return [{ category: 'upstream_auth', count: 3, affected_users: 2 }];
    if (/ops:failed-users/.test(sql)) return [{ user_id: 'u1', category: 'upstream_auth' }, { user_id: 'u2', category: 'upstream_auth' }];
    if (/ops:route-summary/.test(sql)) return [{ route_id: 'r1', total: 12, succeeded: 9, failed: 3, affected_users: 2 }];
    if (/ops:latency/.test(sql)) return [{ queue_bin: 0, total_bin: 10, sample_count: 1 }, { queue_bin: 5, total_bin: 12, sample_count: 11 }];
    if (/ops:trend-cache/.test(sql)) return [{ bucket_type: 'minute', bucket_start: '2026-10-19 07:59:00.000', submissions: 14, completed: 12, succeeded: 9, failed: 3, runtime_active: 2, runtime_local_queued: 4, runtime_upstream_queued: 1 }];
    return [];
  });
  await store.refreshAggregates();
  const aggregateCalls = [...pool.calls]; const count = pool.calls.length;
  const summary = await store.getFailureSummary({ window: '15m' });
  assert.equal(summary.total, 12); assert.equal(summary.successRate, 75); assert.deepEqual(summary.failedUserIds, ['u1', 'u2']); assert.deepEqual(summary.causes[0].userIds, ['u1', 'u2']);
  assert.ok(summary.p50QueueMs >= 16 && summary.p50QueueMs <= 32); assert.ok(summary.p95TotalMs >= 2048 && summary.p95TotalMs <= 4096);
  assert.equal((await store.getTrends({ window: '1h' })).items[0].submissions, 14);
  summary.causes[0].count = 999; assert.equal((await store.getFailureSummary({ window: '15m' })).causes[0].count, 3);
  assert.equal(pool.calls.length, count, 'summary/trends reads must only access caches');
  for (const call of aggregateCalls.filter(call => /ops:(summary|causes|failed-users|route-summary|latency)/.test(call.sql))) {
    assert.ok(call.sql.includes('completed_at >= ? AND completed_at <= ?'));
    assert.ok(call.params.filter(value => value instanceof Date).length >= 2);
    assert.match(call.sql, /(?:GROUP BY|COUNT[(])/);
  }
  const bucketQuery = aggregateCalls.find(call => /ops:aggregate-buckets/.test(call.sql));
  assert.ok(bucketQuery.sql.includes('created_at >= ?')); assert.ok(bucketQuery.sql.includes('completed_at >= ?'));
  assert.ok(!aggregateCalls.some(call => /SELECT [*]|image_jobs|billing/i.test(call.sql)));
});

test('no completed samples retains null success rate and latency', async () => {
  const { store } = await setup(); await store.refreshAggregates();
  const summary = await store.getFailureSummary({ window: '24h' });
  assert.equal(summary.successRate, null); assert.equal(summary.p95TotalMs, null); assert.deepEqual(summary.causes, []);
});

test('per-route P95 merges bounded route latency histograms rather than averaging percentiles', async () => {
  const { store, pool } = await setup(sql => {
    if (/ops:route-summary/.test(sql)) return [{ route_id: 'r1', succeeded: 19, failed: 1 }, { route_id: 'empty', succeeded: 0, failed: 0 }];
    if (/ops:route-latency/.test(sql)) return [{ route_id: 'r1', total_bin: 10, sample_count: 1 }, { route_id: 'r1', total_bin: 16, sample_count: 19 }];
    return [];
  });
  await store.refreshAggregates();
  const summary = store.getFailureSummary({ window: '15m' });
  assert.equal(summary.routes[0].p95TotalMs, 65536);
  assert.equal(summary.routes[1].p95TotalMs, null);
  const query = pool.calls.find(call => /ops:route-latency/.test(call.sql));
  assert.ok(query.sql.includes('completed_at >= ? AND completed_at <= ?'));
  assert.ok(query.sql.includes('route_id IN ('));
  assert.ok(query.sql.includes('GROUP BY route_id, total_bin'));
  const queries = pool.calls.length;
  store.getFailureSummary({ window: '15m' });
  assert.equal(pool.calls.length, queries);
});

test('summary generatedAt records each window refresh independently', async () => {
  let timestamp = NOW;
  const store = createOperationsDashboardStore({ pool: fakePool(), now: () => timestamp });
  await store.init();
  assert.equal(store.getFailureSummary({ window: '24h' }).generatedAt, null);
  await store.refreshAggregates();
  assert.equal(store.getFailureSummary({ window: '24h' }).generatedAt, NOW.toISOString());
  timestamp = new Date(NOW.getTime() + 2 * 60000);
  await store.refreshAggregates();
  assert.equal(store.getFailureSummary({ window: '15m' }).generatedAt, timestamp.toISOString());
  assert.equal(store.getFailureSummary({ window: '24h' }).generatedAt, NOW.toISOString());
  assert.equal(store.getFailureSummary({ window: '7d' }).generatedAt, NOW.toISOString());
  timestamp = new Date(NOW.getTime() + 16 * 60000);
  await store.refreshAggregates();
  assert.equal(store.getFailureSummary({ window: '24h' }).generatedAt, timestamp.toISOString());
});

test('unknown-route terminal samples retain a route P95 without an empty SQL IN list', async () => {
  const { store, pool } = await setup(sql => {
    if (/ops:route-summary/.test(sql)) return [{ route_id: null, succeeded: 1, failed: 0 }];
    if (/ops:route-latency/.test(sql)) return [{ route_id: null, total_bin: 10, sample_count: 1 }];
    return [];
  });
  await store.refreshAggregates();
  assert.equal(store.getFailureSummary({ window: '15m' }).routes[0].p95TotalMs, 1024);
  const query = pool.calls.find(call => /ops:route-latency/.test(call.sql));
  assert.ok(query.sql.includes('route_id IS NULL')); assert.ok(!query.sql.includes('IN ()'));
});

test('runtime sample writes once per minute and aggregate refresh preserves runtime values', async () => {
  const { store, pool } = await setup(sql => /ops:aggregate-buckets/.test(sql) ? [{ bucket_start: '2026-10-19 07:59:00.000', dimension_type: 'global', dimension_id: '', submissions: 1, completed: 1, succeeded: 1, failed: 0 }] : []);
  await store.recordRuntimeSample({ timestamp: NOW, active: 2, localQueued: 5, upstreamQueued: 1 });
  await store.recordRuntimeSample({ timestamp: NOW, active: 3, localQueued: 9, upstreamQueued: 2 });
  assert.equal(pool.calls.filter(call => /ops:runtime-sample/.test(call.sql)).length, 1);
  await store.refreshAggregates();
  const writes = pool.calls.filter(call => /ops:write-buckets/.test(call.sql)); assert.ok(writes.length > 0);
  for (const write of writes) assert.ok(!write.sql.split('ON DUPLICATE KEY UPDATE')[1].includes('runtime_'));
});

test('incidents are sanitized, deduplicated and exposed through bounded reads', async () => {
  const { store, pool } = await setup(sql => /ops:incident-list/.test(sql) ? [{ fingerprint: 'route-auth:r1', category: 'auth', message: 'Bearer credential', sample_count: 12, status: 'open', updated_at: '2026-10-19 08:00:00.000', secret: 'private' }] : []);
  await store.upsertIncident({ fingerprint: 'route-auth:r1', category: 'auth', severity: 'warning', message: 'Bearer credential', routeId: 'r1', sampleCount: 12, affectedUsers: 2, status: 'open', secret: 'private' });
  const write = pool.calls.find(call => /INSERT INTO ops_incidents/.test(call.sql));
  assert.match(write.sql, /ON DUPLICATE KEY UPDATE/); assert.ok(!JSON.stringify(write.params).includes('credential'));
  await store.refreshAggregates();
  const beforeRead = pool.calls.length;
  const result = await store.listIncidents();
  assert.equal(result.items[0].sampleCount, 12); assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(pool.calls.length, beforeRead, 'incident reads must use the shared background cache');
  const read = pool.calls.find(call => /ops:incident-list/.test(call.sql));
  assert.match(read.sql, /LIMIT 50\b/); assert.ok(!read.sql.includes('LIMIT ?'));
  assert.equal(read.params.length, 1); assert.ok(read.params[0] instanceof Date);
});

test('initialization retries a transient database error and retains existing telemetry start', async () => {
  let fail = true;
  const pool = fakePool(sql => {
    if (fail) throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
    return /ops:history-start/.test(sql) ? [{ started_at: '2026-10-16 01:00:00.000' }] : [];
  });
  const store = createOperationsDashboardStore({ pool, now: () => NOW, logger: { warn() {} } });
  assert.equal((await store.init()).available, false);
  fail = false;
  const coverage = await store.init();
  assert.equal(coverage.available, true); assert.equal(coverage.startedAt, '2026-10-16T01:00:00.000Z');
  assert.equal(coverage.history, 'collected');
});

test('collector refreshes only dirty and current buckets and reuses cold summaries', async () => {
  const { store, pool } = await setup();
  await store.upsertTaskFact('late-task', fact({ taskId: 'late-task', createdAt: new Date('2026-10-17T07:00:00Z'), completedAt: NOW, status: 'succeeded' }));
  await store.refreshAggregates();
  const scans = pool.calls.filter(call => /ops:aggregate-buckets/.test(call.sql));
  assert.equal(scans.length, 2);
  assert.ok(scans[0].params.some(value => value instanceof Date && value.toISOString() === '2026-10-17T07:00:00.000Z'));
  const firstCount = pool.calls.filter(call => /ops:summary/.test(call.sql)).length;
  assert.equal(firstCount, 5);
  pool.calls.length = 0;
  await store.refreshAggregates();
  assert.equal(pool.calls.filter(call => /ops:summary/.test(call.sql)).length, 3, '24h and 7d summaries are cached for fifteen minutes');
  for (const call of pool.calls.filter(call => /ops:aggregate-buckets/.test(call.sql))) {
    const dates = call.params.filter(value => value instanceof Date);
    assert.ok(Math.max(...dates.map(date => date.getTime())) - Math.min(...dates.map(date => date.getTime())) <= 2 * 60 * 60 * 1000);
  }
});

test('all-status task filter is ignored and trend counts include submitted alias', async () => {
  const { store, pool } = await setup(sql => /ops:trend-cache/.test(sql) ? [{ bucket_start: '2026-10-19 07:59:00.000', submissions: 3, completed: 0, succeeded: 0, failed: 0 }] : []);
  await store.listTaskFacts({ status: 'all' });
  assert.ok(!pool.calls.at(-1).sql.includes('status = ?'));
  await store.refreshAggregates();
  assert.equal(store.getTrends({ window: '1h' }).items[0].submitted, 3);
});

test('first known completion timestamp cannot be replaced by a repeated lifecycle update', async () => {
  const { store, pool } = await setup();
  await store.upsertTaskFact('task-1', fact({ status: 'succeeded', completedAt: NOW }));
  const sql = pool.calls.find(call => /INSERT INTO ops_task_facts/.test(call.sql)).sql;
  assert.ok(sql.includes('completed_at = IF(VALUES(updated_at) >= updated_at, COALESCE(completed_at, VALUES(completed_at)), completed_at)'));
  assert.ok(!sql.split('ON DUPLICATE KEY UPDATE')[1].includes('created_at ='));
});

test('incident upserts update shared read cache immediately without another SQL request', async () => {
  const { store, pool } = await setup();
  await store.upsertIncident({ fingerprint: 'r1:auth', category: 'auth', status: 'active', message: 'Bearer hidden', sampleCount: 10 });
  const writes = pool.calls.length;
  const result = store.listIncidents();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].status, 'active');
  assert.ok(!JSON.stringify(result).includes('hidden')); assert.equal(pool.calls.length, writes);
  await store.upsertIncident({ fingerprint: 'r1:auth', category: 'auth', status: 'recovered' });
  assert.equal(store.listIncidents().items.length, 1); assert.equal(store.listIncidents().items[0].status, 'recovered');
});

test('seven-day trends merge minute counts hourly and preserve unavailable runtime samples', async () => {
  const { store } = await setup(sql => /ops:trend-cache/.test(sql) ? [
    { bucket_start: '2026-10-19 07:58:00.000', submissions: 2, completed: 1, succeeded: 1, failed: 0 },
    { bucket_start: '2026-10-19 07:59:00.000', submissions: 3, completed: 2, succeeded: 1, failed: 1 },
  ] : []);
  await store.refreshAggregates();
  const trends = store.getTrends({ window: '7d' });
  assert.equal(trends.items.length, 1); assert.equal(trends.items[0].submitted, 5); assert.equal(trends.items[0].completed, 3);
  assert.equal(trends.items[0].active, null); assert.equal(trends.items[0].successRate, 2 / 3 * 100);
});

test('aggregate freshness only advances after complete background refresh', async () => {
  const { store, pool } = await setup();
  assert.equal(store.getCoverage().aggregateUpdatedAt, null);
  await store.refreshAggregates();
  assert.equal(store.getCoverage().aggregateUpdatedAt, NOW.toISOString());
  pool.execute = async () => { throw Object.assign(new Error('private'), { code: 'ER_QUERY_INTERRUPTED' }); };
  await assert.rejects(store.refreshAggregates);
  assert.equal(store.getCoverage().aggregateUpdatedAt, NOW.toISOString());
});

test('dirty dimension buckets reset old counts while retaining sampled runtime columns', async () => {
  const { store, pool } = await setup(); await store.refreshAggregates();
  const resets = pool.calls.filter(call => /ops:reset-buckets/.test(call.sql));
  assert.equal(resets.length, 2);
  for (const reset of resets) {
    assert.ok(reset.sql.includes('WHERE bucket_type = ?'));
    assert.ok(!reset.sql.split('WHERE')[0].includes('runtime_'));
    assert.ok(reset.params.filter(value => value instanceof Date).length > 0);
  }
});

test('queue refusals are counted by creation time and excluded from admitted submissions', async () => {
  const { store, pool } = await setup(sql => /ops:refusals/.test(sql) ? [{ user_queue_full: 2, site_queue_full: 3, total: 5 }] : []);
  await store.refreshAggregates();
  assert.deepEqual(store.getFailureSummary({ window: '15m' }).refusals, { userQueueFull: 2, siteQueueFull: 3, total: 5 });
  for (const call of pool.calls.filter(call => /ops:aggregate-buckets/.test(call.sql))) assert.ok(call.sql.includes("status <> 'rejected'"));
  for (const call of pool.calls.filter(call => /ops:refusals/.test(call.sql))) { assert.ok(call.sql.includes('created_at >= ?')); assert.ok(call.sql.includes("status = 'rejected'")); }
});

test('invalid cursors expose a safe 400 response status', async () => {
  const { store } = await setup();
  await assert.rejects(() => store.listTaskFacts({ cursor: 'invalid' }), error => error.status === 400 && /cursor/i.test(error.message));
});

test('redaction handles JSON credential keys, quoted bearer tokens, sessions and wrapped base64', () => {
  const value = sanitizeSummary('{"api_key":"json-private", "accessToken": "access-private", "prompt": "private prompt text"} Bearer "quoted-private" sess-session-private data:image/png;base64,aGVs\nbG8=');
  for (const secret of ['json-private', 'access-private', 'private prompt text', 'quoted-private', 'session-private', 'aGVs', 'bG8=']) assert.ok(!value.includes(secret), secret);
});

test('retention removes only bounded expired batches with separate bucket lifetimes', async () => {
  const { store, pool } = await setup(); await store.pruneExpired();
  const deletes = pool.calls.filter(call => /DELETE FROM/.test(call.sql)); assert.equal(deletes.length, 6);
  for (const call of deletes) { assert.match(call.sql, /WHERE .* < ?/); assert.match(call.sql, /LIMIT 500/); assert.ok(call.sql.includes('ops_')); assert.ok(call.params.some(value => value instanceof Date)); }
  const minutes = deletes.find(call => call.params.includes('minute')); const hours = deletes.find(call => call.params.includes('hour'));
  assert.equal(minutes.params.find(value => value instanceof Date).toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(hours.params.find(value => value instanceof Date).toISOString(), '2026-07-21T08:00:00.000Z');
});
