const { createHash } = require('node:crypto');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WINDOWS = Object.freeze({ '5m': 5 * MINUTE, '15m': 15 * MINUTE, '1h': HOUR, '24h': DAY, '7d': 7 * DAY });
const FACT_FIELDS = Object.freeze({
  taskId: ['task_id', 100], requestId: ['request_id', 128], userId: ['user_id', 100], userLabel: ['user_label', 255],
  uiMode: ['ui_mode', 20], modelId: ['model_id', 160], routeId: ['route_id', 160], status: ['status', 24], phase: ['phase', 32],
  storageStatus: ['storage_status', 24], settlementStatus: ['settlement_status', 24], failureStage: ['failure_stage', 32],
  failureCategory: ['failure_category', 48], failureCode: ['failure_code', 100], httpStatus: ['http_status', 'http'],
  errorSummary: ['error_summary', 1000], createdAt: ['created_at', 'date'], startedAt: ['started_at', 'date'],
  upstreamStartedAt: ['upstream_started_at', 'date'], completedAt: ['completed_at', 'date'], updatedAt: ['updated_at', 'date'],
});
const FACT_COLUMNS = Object.values(FACT_FIELDS).map(([column]) => column).join(', ');
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Math.max(0, Number(value) || 0);
const safeWindow = (value, fallback) => Object.hasOwn(WINDOWS, value) ? value : fallback;

// Do not persist URLs at all: even an apparently public asset can carry a session
// token in its path. Remove secret-bearing free text before enforcing the cap.
function sanitizeSummary(value, maxLength = 1000) {
  if (value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value)
    .replace(/data:[^\s,]*;base64,[a-z0-9+/=]+(?:[\r\n]+[a-z0-9+/=]+)*/gi, '[redacted image]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(/\bBearer\s+(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi, '[redacted]')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[redacted key]')
    .replace(/\b(?:sess|session)[-_][a-z0-9_-]+/gi, '[redacted]')
    .replace(/\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:token|id|key)?|token|secret|password|credential|prompt|request[_ -]?body|response[_ -]?body)\b["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9+/]{128,}={0,2}\b/g, '[redacted data]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, Math.max(0, Math.min(1000, maxLength)));
}

function normalizeFailure(error = {}) {
  const input = error && typeof error === 'object' ? error : { message: error };
  const http = Number(input.httpStatus ?? input.status);
  return {
    stage: sanitizeSummary(input.stage ?? input.failureStage, 32),
    category: sanitizeSummary(input.category ?? input.failureCategory, 48),
    code: sanitizeSummary(input.code ?? input.failureCode, 100),
    httpStatus: Number.isInteger(http) && http >= 100 && http <= 599 ? http : null,
    message: sanitizeSummary(input.message ?? input.errorSummary),
  };
}

function asDate(value, fallback = null) {
  if (value == null || value === '') return fallback;
  let input = value;
  if (typeof input === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(input)) input = input.replace(' ', 'T') + 'Z';
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isFinite(date.getTime()) ? date : fallback;
}
const iso = value => asDate(value)?.toISOString() ?? null;
const boundary = (value, size) => new Date(Math.floor(value.getTime() / size) * size);

function safeFact(input = {}, datesAsStrings = false) {
  const output = {};
  for (const [key, [, type]] of Object.entries(FACT_FIELDS)) {
    if (!Object.hasOwn(input, key)) continue;
    if (type === 'date') output[key] = datesAsStrings ? iso(input[key]) : asDate(input[key]);
    else if (type === 'http') output[key] = normalizeFailure({ httpStatus: input[key] }).httpStatus;
    else output[key] = sanitizeSummary(input[key], type);
  }
  return output;
}
function mapFact(row) {
  const source = {};
  for (const [key, [column]] of Object.entries(FACT_FIELDS)) if (Object.hasOwn(row, column)) source[key] = row[column];
  return safeFact(source, true);
}
function emptySummary() {
  return { generatedAt: null, total: 0, succeeded: 0, failed: 0, successRate: null, affectedUsers: 0, failedUserIds: [], causes: [], routes: [], storageFailures: 0, settlementPending: 0, refusals: { userQueueFull: 0, siteQueueFull: 0, total: 0 }, p50QueueMs: null, p95QueueMs: null, p50TotalMs: null, p95TotalMs: null };
}
// A logarithmic histogram is mergeable across buckets. Never average bucket P95s.
// Return the upper bound of the selected power-of-two millisecond bin.
function percentile(rows, field, fraction) {
  const bins = new Map();
  for (const row of rows) {
    if (row[field] == null) continue;
    const bin = Number(row[field]);
    if (Number.isInteger(bin) && bin >= 0 && bin <= 40) bins.set(bin, (bins.get(bin) || 0) + count(row.sample_count));
  }
  const total = [...bins.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const target = Math.max(1, Math.ceil(total * fraction));
  let accumulated = 0;
  for (const [bin, samples] of [...bins].sort((a, b) => a[0] - b[0])) {
    accumulated += samples;
    if (accumulated >= target) return bin === 0 ? 0 : 2 ** bin;
  }
  return null;
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS ops_task_facts (' +
    'task_id VARCHAR(100) PRIMARY KEY, request_id VARCHAR(128) NOT NULL, user_id VARCHAR(100) NOT NULL, user_label VARCHAR(255) NULL, ' +
    'ui_mode VARCHAR(20) NOT NULL, model_id VARCHAR(160) NULL, route_id VARCHAR(160) NULL, status VARCHAR(24) NOT NULL, phase VARCHAR(32) NOT NULL, ' +
    'storage_status VARCHAR(24) NULL, settlement_status VARCHAR(24) NOT NULL, failure_stage VARCHAR(32) NULL, failure_category VARCHAR(48) NULL, ' +
    'failure_code VARCHAR(100) NULL, http_status SMALLINT NULL, error_summary VARCHAR(1000) NULL, created_at DATETIME(3) NOT NULL, started_at DATETIME(3) NULL, ' +
    'upstream_started_at DATETIME(3) NULL, completed_at DATETIME(3) NULL, updated_at DATETIME(3) NOT NULL, ' +
    'INDEX ops_facts_created (created_at, task_id), INDEX ops_facts_status_created (status, created_at, task_id), INDEX ops_facts_user_created (user_id, created_at, task_id), ' +
    'INDEX ops_facts_route_created (route_id, created_at, task_id), INDEX ops_facts_completed (completed_at, status), INDEX ops_facts_updated (updated_at, task_id), ' +
    'INDEX ops_facts_request (request_id, created_at, task_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS ops_task_events (' +
    'event_id CHAR(36) PRIMARY KEY, task_id VARCHAR(100) NOT NULL, event_type VARCHAR(48) NOT NULL, created_at DATETIME(3) NOT NULL, payload_json JSON NOT NULL, ' +
    'INDEX ops_events_task_time (task_id, created_at, event_id), INDEX ops_events_created (created_at, event_id), INDEX ops_events_type_time (event_type, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS ops_metric_buckets (' +
    'bucket_type VARCHAR(8) NOT NULL, bucket_start DATETIME(3) NOT NULL, dimension_type VARCHAR(16) NOT NULL, dimension_id VARCHAR(160) NOT NULL, ' +
    'submissions BIGINT NOT NULL DEFAULT 0, completed BIGINT NOT NULL DEFAULT 0, succeeded BIGINT NOT NULL DEFAULT 0, failed BIGINT NOT NULL DEFAULT 0, ' +
    'queue_histogram JSON NULL, total_histogram JSON NULL, runtime_active INT NULL, runtime_local_queued INT NULL, runtime_upstream_queued INT NULL, runtime_sampled_at DATETIME(3) NULL, ' +
    'updated_at DATETIME(3) NOT NULL, PRIMARY KEY (bucket_type, bucket_start, dimension_type, dimension_id), INDEX ops_buckets_time (bucket_start)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS ops_incidents (' +
    'fingerprint VARCHAR(200) PRIMARY KEY, category VARCHAR(48) NOT NULL, severity VARCHAR(20) NOT NULL, message VARCHAR(1000) NULL, route_id VARCHAR(160) NULL, ' +
    'sample_count INT NOT NULL DEFAULT 0, affected_users INT NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL, first_seen_at DATETIME(3) NOT NULL, ' +
    'last_seen_at DATETIME(3) NOT NULL, acknowledged_at DATETIME(3) NULL, acknowledged_by VARCHAR(100) NULL, recovered_at DATETIME(3) NULL, closed_at DATETIME(3) NULL, ' +
    'updated_at DATETIME(3) NOT NULL, INDEX ops_incident_status_time (status, updated_at), INDEX ops_incident_retention (updated_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'CREATE TABLE IF NOT EXISTS ops_admin_audit (' +
    'audit_id CHAR(36) PRIMARY KEY, incident_fingerprint VARCHAR(200) NULL, admin_id VARCHAR(100) NOT NULL, action VARCHAR(48) NOT NULL, created_at DATETIME(3) NOT NULL, ' +
    'INDEX ops_audit_time (created_at, audit_id), INDEX ops_audit_incident (incident_fingerprint, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
];

function createOperationsDashboardStore({ pool, enabled = Boolean(pool), now = () => new Date(), logger = console } = {}) {
  let initialized = false;
  let initialization;
  let refreshing;
  let startedAt = null;
  let lastCollectedAt = null;
  let aggregateUpdatedAt = null;
  let collectionError = null;
  let collected = false;
  let lastRuntimeMinute = null;
  let lastColdSummaryAt = null;
  let dirtyVersion = 0;
  const dirtyBuckets = { minute: new Map(), hour: new Map() };
  const runtimeWrites = new Map();
  let trendCache = [];
  let incidentCache = [];
  let summaryCache = Object.fromEntries(Object.keys(WINDOWS).map(window => [window, emptySummary()]));
  const clock = () => asDate(typeof now === 'function' ? now() : now, new Date());
  const getCoverage = () => ({ available: Boolean(enabled && pool && initialized), startedAt, lastCollectedAt, aggregateUpdatedAt, error: collectionError,
    history: !enabled || !pool || !initialized ? 'unavailable' : collected ? 'collected' : 'not_collected' });
  const markFailure = (error, operation) => {
    // Driver messages may echo SQL values. Retain only a constrained driver code.
    const rawCode = String(error?.code || 'COLLECTION_FAILED');
    const code = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'COLLECTION_FAILED';
    const safeOperation = /^[a-z0-9-]{1,64}$/.test(String(operation || '')) ? String(operation) : null;
    collectionError = 'Operations telemetry collection failed' + (safeOperation ? ' at ' + safeOperation : '') + ' (' + code + ')';
    try { logger?.warn?.(collectionError); } catch {}
    const safeError = new Error(collectionError);
    safeError.code = code;
    return safeError;
  };
  const query = async (sql, params = []) => {
    try { const [rows] = await pool.execute(sql, params); return rows; }
    catch (error) {
      const operation = String(sql).match(/\/\*\s*ops:([a-z0-9-]{1,64})\s*\*\//i)?.[1]?.toLowerCase();
      throw markFailure(error, operation);
    }
  };
  const markCollected = () => { collected = true; lastCollectedAt = clock().toISOString(); };
  const loadTrends = async timestamp => {
    const rows = await query("/* ops:trend-cache */ SELECT bucket_type, bucket_start, submissions, completed, succeeded, failed, runtime_active, runtime_local_queued, runtime_upstream_queued, runtime_sampled_at FROM ops_metric_buckets WHERE bucket_type = 'minute' AND bucket_start >= ? AND bucket_start <= ? AND dimension_type = 'global' AND dimension_id = '' ORDER BY bucket_start ASC LIMIT 10081", [new Date(timestamp.getTime() - 7 * DAY), timestamp]);
    return rows.map(row => ({ bucketStart: iso(row.bucket_start), timestamp: iso(row.bucket_start), submitted: count(row.submissions), submissions: count(row.submissions), completed: count(row.completed), succeeded: count(row.succeeded), failed: count(row.failed),
      successRate: count(row.succeeded) + count(row.failed) ? count(row.succeeded) / (count(row.succeeded) + count(row.failed)) * 100 : null,
      active: row.runtime_active == null ? null : count(row.runtime_active), localQueued: row.runtime_local_queued == null ? null : count(row.runtime_local_queued), upstreamQueued: row.runtime_upstream_queued == null ? null : count(row.runtime_upstream_queued), sampledAt: iso(row.runtime_sampled_at) }));
  };
  const mapIncident = row => ({ fingerprint: sanitizeSummary(row.fingerprint, 200), category: sanitizeSummary(row.category, 48), severity: sanitizeSummary(row.severity, 20), message: sanitizeSummary(row.message), routeId: sanitizeSummary(row.route_id, 160), sampleCount: count(row.sample_count), affectedUsers: count(row.affected_users), status: sanitizeSummary(row.status, 20),
    firstSeenAt: iso(row.first_seen_at), lastSeenAt: iso(row.last_seen_at), acknowledgedAt: iso(row.acknowledged_at), acknowledgedBy: sanitizeSummary(row.acknowledged_by, 100), recoveredAt: iso(row.recovered_at), closedAt: iso(row.closed_at), updatedAt: iso(row.updated_at) });
  const loadIncidents = async timestamp => {
    const rows = await query('/* ops:incident-list */ SELECT fingerprint, category, severity, message, route_id, sample_count, affected_users, status, first_seen_at, last_seen_at, acknowledged_at, acknowledged_by, recovered_at, closed_at, updated_at FROM ops_incidents WHERE updated_at >= ? ORDER BY updated_at DESC, fingerprint DESC LIMIT 50', [new Date(timestamp.getTime() - 90 * DAY)]);
    return rows.map(mapIncident);
  };
  const init = async () => {
    if (!enabled || !pool || initialized) return getCoverage();
    if (!initialization) initialization = (async () => {
      try {
        for (const sql of SCHEMA) await query(sql);
        const timestamp = clock();
        const history = await query('/* ops:history-start */ SELECT MIN(started_at) AS started_at FROM (SELECT MIN(created_at) AS started_at FROM ops_task_facts UNION ALL SELECT MIN(bucket_start) AS started_at FROM ops_metric_buckets) history');
        startedAt = iso(history[0]?.started_at) || timestamp.toISOString();
        collected = Boolean(history[0]?.started_at);
        trendCache = await loadTrends(timestamp);
        incidentCache = await loadIncidents(timestamp);
        initialized = true;
        collectionError = null;
      } catch { initialized = false; }
      return getCoverage();
    })();
    try { return await initialization; } finally { initialization = null; }
  };
  const markDirty = value => {
    const timestamp = asDate(value);
    if (!timestamp) return;
    const current = clock().getTime();
    for (const [type, size, retention] of [['minute', MINUTE, 7 * DAY], ['hour', HOUR, 30 * DAY]]) {
      if (timestamp.getTime() < current - retention || timestamp.getTime() > current) continue;
      dirtyBuckets[type].set(boundary(timestamp, size).getTime(), ++dirtyVersion);
    }
  };
  const ready = async () => {
    if (!enabled || !pool) return false;
    await init();
    if (!initialized) throw new Error(collectionError || 'Operations telemetry unavailable');
    return true;
  };

  const upsertTaskFact = async (taskId, input = {}) => {
    if (!await ready()) return false;
    const safe = safeFact({ ...input, taskId });
    if (!safe.taskId) throw new Error('Task id required');
    const timestamp = clock();
    const insert = { requestId: '', userId: '', uiMode: 'unknown', status: 'queued', phase: 'queued', settlementStatus: 'unknown', ...safe,
      createdAt: safe.createdAt || timestamp, updatedAt: safe.updatedAt || timestamp };
    const keys = Object.keys(insert);
    const columns = keys.map(key => FACT_FIELDS[key][0]);
    // Set updated_at last: MySQL evaluates assignments from left to right.
    const updates = keys.filter(key => !['taskId', 'createdAt', 'updatedAt'].includes(key) && Object.hasOwn(safe, key))
      .map(key => { const column = FACT_FIELDS[key][0]; const value = ['completedAt', 'startedAt', 'upstreamStartedAt'].includes(key) ? 'COALESCE(' + column + ', VALUES(' + column + '))' : 'VALUES(' + column + ')'; return column + ' = IF(VALUES(updated_at) >= updated_at, ' + value + ', ' + column + ')'; });
    updates.push('updated_at = GREATEST(updated_at, VALUES(updated_at))');
    await query('/* ops:task-fact-write */ INSERT INTO ops_task_facts (' + columns.join(', ') + ') VALUES (' + keys.map(() => '?').join(', ') + ') ON DUPLICATE KEY UPDATE ' + updates.join(', '), keys.map(key => insert[key]));
    // SQL preserves the first timestamps. Read that authoritative row by its
    // primary key so a later archive snapshot repairs the original buckets.
    // A stale no-op update must not enqueue unrelated retained-history buckets.
    const stored = await query('/* ops:fact-timestamps */ SELECT created_at, completed_at, updated_at FROM ops_task_facts WHERE task_id = ? LIMIT 1', [safe.taskId]);
    const persisted = stored[0];
    const storedUpdatedAt = asDate(persisted?.updated_at);
    if (persisted && storedUpdatedAt && storedUpdatedAt.getTime() === insert.updatedAt.getTime()) {
      markDirty(persisted.created_at);
      markDirty(persisted.completed_at);
    }
    markCollected();
    return true;
  };

  const appendEvent = async (input = {}) => {
    if (!await ready()) return false;
    const taskId = sanitizeSummary(input.taskId, 100);
    const type = sanitizeSummary(input.type, 48);
    if (!taskId || !type) throw new Error('Task id and event type required');
    const payload = safeFact(input, true);
    delete payload.taskId;
    delete payload.createdAt;
    // Collector-created timestamps change on retries. Event identity instead
    // uses the durable task version and its strictly allowlisted state.
    let id;
    if (input.eventId != null) {
      id = String(input.eventId).toLowerCase();
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw Object.assign(new Error('Invalid operations event id'), { status: 400 });
    } else {
      const digest = createHash('sha256').update(JSON.stringify([taskId, type, payload])).digest('hex').slice(0, 32);
      id = digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-5' + digest.slice(13, 16) + '-a' + digest.slice(17, 20) + '-' + digest.slice(20);
    }
    await query('/* ops:task-event-write */ INSERT IGNORE INTO ops_task_events (event_id, task_id, event_type, created_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [id, taskId, type, asDate(input.createdAt, clock()), JSON.stringify(payload)]);
    markCollected();
    return id;
  };

  const listTaskFacts = async (options = {}) => {
    if (!await ready()) return { items: [], nextCursor: null };
    const timestamp = clock();
    const window = safeWindow(options.window, '24h');
    const params = [new Date(timestamp.getTime() - WINDOWS[window]), timestamp];
    const where = ['created_at >= ?', 'created_at <= ?'];
    for (const key of ['status', 'userId', 'routeId', 'taskId', 'requestId', 'failureCategory', 'storageStatus', 'settlementStatus']) {
      if (options[key] != null && options[key] !== '' && options[key] !== 'all') { where.push(FACT_FIELDS[key][0] + ' = ?'); params.push(String(options[key]).slice(0, 255)); }
    }
    if (options.cursor) {
      let cursor;
      try { cursor = JSON.parse(Buffer.from(String(options.cursor), 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('Invalid task cursor'), { status: 400 }); }
      const date = asDate(cursor?.createdAt);
      if (!date || typeof cursor.taskId !== 'string' || !cursor.taskId || cursor.taskId.length > 100) throw Object.assign(new Error('Invalid task cursor'), { status: 400 });
      where.push('(created_at < ? OR (created_at = ? AND task_id < ?))');
      params.push(date, date, cursor.taskId);
    }
    const limit = Math.min(50, Math.max(1, Number.parseInt(options.limit, 10) || 50));
    const rows = await query('/* ops:task-list */ SELECT ' + FACT_COLUMNS + ' FROM ops_task_facts WHERE ' + where.join(' AND ') + ' ORDER BY created_at DESC, task_id DESC LIMIT ' + (limit + 1), params);
    const items = rows.slice(0, limit).map(mapFact);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, taskId: last.taskId })).toString('base64url') : null };
  };

  const getTaskFact = async taskId => {
    if (!await ready()) return null;
    const id = String(taskId ?? '').slice(0, 100);
    const tasks = await query('/* ops:task-detail */ SELECT ' + FACT_COLUMNS + ' FROM ops_task_facts WHERE task_id = ? LIMIT 1', [id]);
    if (!tasks.length) return null;
    const rows = await query('/* ops:task-events */ SELECT event_id, task_id, event_type, created_at, payload_json FROM ops_task_events WHERE task_id = ? ORDER BY created_at ASC, event_id ASC LIMIT 200', [id]);
    const events = rows.map(row => {
      let payload = {};
      try { payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json || {}; } catch {}
      return { ...safeFact(payload, true), eventId: sanitizeSummary(row.event_id, 36), taskId: sanitizeSummary(row.task_id, 100), type: sanitizeSummary(row.event_type, 48), createdAt: iso(row.created_at) };
    });
    return { task: mapFact(tasks[0]), events };
  };

  const recordRuntimeSample = async (sample = {}) => {
    if (!await ready()) return false;
    const timestamp = asDate(sample.timestamp, clock());
    const minute = boundary(timestamp, MINUTE);
    const minuteKey = minute.getTime();
    if (lastRuntimeMinute != null && minuteKey <= lastRuntimeMinute) return false;
    if (runtimeWrites.has(minuteKey)) return runtimeWrites.get(minuteKey);
    const work = (async () => {
      const value = input => Math.min(1_000_000, Math.floor(count(input)));
      const active = value(sample.active);
      await query('/* ops:runtime-sample */ INSERT INTO ops_metric_buckets (bucket_type, bucket_start, dimension_type, dimension_id, runtime_active, runtime_local_queued, runtime_upstream_queued, runtime_sampled_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ' +
        'runtime_active = IF(runtime_sampled_at IS NULL OR runtime_sampled_at < VALUES(runtime_sampled_at), VALUES(runtime_active), runtime_active), ' +
        'runtime_local_queued = IF(runtime_sampled_at IS NULL OR runtime_sampled_at < VALUES(runtime_sampled_at), VALUES(runtime_local_queued), runtime_local_queued), ' +
        'runtime_upstream_queued = IF(runtime_sampled_at IS NULL OR runtime_sampled_at < VALUES(runtime_sampled_at), VALUES(runtime_upstream_queued), runtime_upstream_queued), ' +
        'runtime_sampled_at = GREATEST(COALESCE(runtime_sampled_at, VALUES(runtime_sampled_at)), VALUES(runtime_sampled_at)), updated_at = GREATEST(updated_at, VALUES(updated_at))',
      ['minute', minute, 'global', '', active, value(sample.localQueued), Math.min(active, value(sample.upstreamQueued)), timestamp, clock()]);
      lastRuntimeMinute = minuteKey;
      markCollected();
      return true;
    })();
    runtimeWrites.set(minuteKey, work);
    try { return await work; } finally { runtimeWrites.delete(minuteKey); }
  };

  // All history scans below have an indexed time predicate and run only on the
  // collector's timer. Public trend/failure getters never execute SQL.
  const refreshAggregates = async () => {
    if (!await ready()) return false;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const timestamp = clock();
      const nextSummaries = { ...summaryCache };
      const refreshCold = lastColdSummaryAt == null || timestamp.getTime() - lastColdSummaryAt >= 15 * MINUTE;
      const terminalWhere = "completed_at >= ? AND completed_at <= ? AND status IN ('succeeded', 'failed')";
      for (const [window, duration] of Object.entries(WINDOWS)) {
        if (duration > HOUR && !refreshCold) continue;
        const params = [new Date(timestamp.getTime() - duration), timestamp];
        const summaryRows = await query('/* ops:summary */ SELECT COUNT(*) AS total, SUM(status = \'succeeded\') AS succeeded, SUM(status = \'failed\') AS failed, ' +
          "COUNT(DISTINCT CASE WHEN status = 'failed' THEN user_id END) AS affected_users, SUM(storage_status = 'failed') AS storage_failures, SUM(settlement_status = 'pending') AS settlement_pending FROM ops_task_facts WHERE " + terminalWhere, params);
        const refusalRows = await query("/* ops:refusals */ SELECT COUNT(*) AS total, SUM(failure_category = 'user_queue_full') AS user_queue_full, SUM(failure_category = 'site_queue_full') AS site_queue_full FROM ops_task_facts WHERE created_at >= ? AND created_at <= ? AND status = 'rejected'", params);
        const causeRows = await query("/* ops:causes */ SELECT COALESCE(failure_category, 'unknown') AS category, COUNT(*) AS count, COUNT(DISTINCT user_id) AS affected_users FROM ops_task_facts WHERE " + terminalWhere + " AND status = 'failed' GROUP BY failure_category ORDER BY count DESC LIMIT 50", params);
        const userRows = await query("/* ops:failed-users */ SELECT user_id, COALESCE(failure_category, 'unknown') AS category, COUNT(*) AS count FROM ops_task_facts WHERE " + terminalWhere + " AND status = 'failed' GROUP BY user_id, failure_category ORDER BY count DESC, user_id ASC LIMIT 2500", params);
        const routeRows = await query("/* ops:route-summary */ SELECT route_id, COUNT(*) AS total, SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed, SUM(http_status = 429) AS rate_limited, COUNT(DISTINCT CASE WHEN status = 'failed' THEN user_id END) AS affected_users FROM ops_task_facts WHERE " + terminalWhere + ' GROUP BY route_id ORDER BY total DESC LIMIT 50', params);
        const routeIds = routeRows.map(route => route.route_id).filter(id => id != null).slice(0, 50);
        const routeWhere = [];
        if (routeIds.length) routeWhere.push('route_id IN (' + routeIds.map(() => '?').join(', ') + ')');
        if (routeRows.some(route => route.route_id == null)) routeWhere.push('route_id IS NULL');
        const routeLatencyRows = routeWhere.length ? await query('/* ops:route-latency */ SELECT route_id, CEIL(LOG2(1 + TIMESTAMPDIFF(MICROSECOND, created_at, completed_at) / 1000)) AS total_bin, COUNT(*) AS sample_count FROM ops_task_facts WHERE ' +
          terminalWhere + ' AND completed_at >= created_at AND (' + routeWhere.join(' OR ') + ') GROUP BY route_id, total_bin', [...params, ...routeIds]) : [];
        const latencyRows = await query('/* ops:latency */ SELECT ' +
          'CASE WHEN started_at IS NULL OR started_at < created_at THEN NULL ELSE CEIL(LOG2(1 + TIMESTAMPDIFF(MICROSECOND, created_at, started_at) / 1000)) END AS queue_bin, ' +
          'CASE WHEN completed_at < created_at THEN NULL ELSE CEIL(LOG2(1 + TIMESTAMPDIFF(MICROSECOND, created_at, completed_at) / 1000)) END AS total_bin, COUNT(*) AS sample_count ' +
          'FROM ops_task_facts WHERE ' + terminalWhere + ' GROUP BY queue_bin, total_bin', params);
        const row = summaryRows[0] || {};
        const succeeded = count(row.succeeded);
        const failed = count(row.failed);
        const total = succeeded + failed;
        nextSummaries[window] = { generatedAt: timestamp.toISOString(), total, succeeded, failed, successRate: total ? succeeded / total * 100 : null, affectedUsers: count(row.affected_users),
          failedUserIds: [...new Set(userRows.map(user => sanitizeSummary(user.user_id, 100)).filter(Boolean))].slice(0, 50),
          causes: causeRows.map(cause => ({ category: sanitizeSummary(cause.category, 48), count: count(cause.count), affectedUsers: count(cause.affected_users),
            userIds: [...new Set(userRows.filter(user => user.category === cause.category).map(user => sanitizeSummary(user.user_id, 100)).filter(Boolean))].slice(0, 50) })),
          routes: routeRows.map(route => { const passed = count(route.succeeded); const rejected = count(route.failed); return { routeId: sanitizeSummary(route.route_id, 160), total: passed + rejected, succeeded: passed, failed: rejected,
            successRate: passed + rejected ? passed / (passed + rejected) * 100 : null, affectedUsers: count(route.affected_users), rateLimited: count(route.rate_limited), p95TotalMs: percentile(routeLatencyRows.filter(latency => latency.route_id === route.route_id), 'total_bin', 0.95) }; }),
          storageFailures: count(row.storage_failures), settlementPending: count(row.settlement_pending),
          refusals: { userQueueFull: count(refusalRows[0]?.user_queue_full), siteQueueFull: count(refusalRows[0]?.site_queue_full), total: count(refusalRows[0]?.total) },
          p50QueueMs: percentile(latencyRows, 'queue_bin', 0.5), p95QueueMs: percentile(latencyRows, 'queue_bin', 0.95),
          p50TotalMs: percentile(latencyRows, 'total_bin', 0.5), p95TotalMs: percentile(latencyRows, 'total_bin', 0.95) };
      }
      const bucketVersions = {};
      for (const [type, size, format] of [['minute', MINUTE, '%Y-%m-%d %H:%i:00.000'], ['hour', HOUR, '%Y-%m-%d %H:00:00.000']]) {
        const current = boundary(timestamp, size).getTime();
        // Revisit the current/previous buckets after a restart. Dirty older
        // buckets repair late results without rebuilding the retained history.
        const selected = new Map(dirtyBuckets[type]);
        if (!selected.has(current)) selected.set(current, 0);
        if (!selected.has(current - size)) selected.set(current - size, 0);
        bucketVersions[type] = [...selected].sort((a, b) => a[0] - b[0]).slice(0, 120);
        const ranges = bucketVersions[type].map(([start]) => [new Date(start), new Date(start + size)]);
        const timeWhere = column => ranges.map(() => '(' + column + ' >= ? AND ' + column + ' < ?)').join(' OR ');
        const rangeParams = ranges.flat();
        const rows = await query("/* ops:aggregate-buckets */ SELECT bucket_start, dimension_type, dimension_id, SUM(submissions) AS submissions, SUM(completed) AS completed, SUM(succeeded) AS succeeded, SUM(failed) AS failed FROM (" +
          "SELECT DATE_FORMAT(activity_at, '" + format + "') AS bucket_start, dimensions.dimension_type, CASE dimensions.dimension_type WHEN 'route' THEN COALESCE(activity.route_id, '') WHEN 'model' THEN COALESCE(activity.model_id, '') WHEN 'ui' THEN activity.ui_mode ELSE '' END AS dimension_id, " +
          'submissions, completed, succeeded, failed FROM (' +
          "SELECT created_at AS activity_at, route_id, model_id, ui_mode, 1 AS submissions, 0 AS completed, 0 AS succeeded, 0 AS failed FROM ops_task_facts WHERE (" + timeWhere('created_at') + ") AND created_at <= ? AND status <> 'rejected' " +
          "UNION ALL SELECT completed_at AS activity_at, route_id, model_id, ui_mode, 0 AS submissions, 1 AS completed, status = 'succeeded' AS succeeded, status = 'failed' AS failed FROM ops_task_facts WHERE (" + timeWhere('completed_at') + ") AND completed_at <= ? AND status IN ('succeeded', 'failed')" +
          ") activity CROSS JOIN (SELECT 'global' AS dimension_type UNION ALL SELECT 'route' UNION ALL SELECT 'model' UNION ALL SELECT 'ui') dimensions" +
          ') grouped_activity GROUP BY bucket_start, dimension_type, dimension_id', [...rangeParams, timestamp, ...rangeParams, timestamp]);
        // Reset only affected metric counts before replacing their dimensions.
        // A task can resolve its route after admission, leaving an obsolete
        // unknown-route row; runtime columns remain independently sampled.
        await query('/* ops:reset-buckets */ UPDATE ops_metric_buckets SET submissions = 0, completed = 0, succeeded = 0, failed = 0, updated_at = ? WHERE bucket_type = ? AND bucket_start IN (' + ranges.map(() => '?').join(', ') + ')', [timestamp, type, ...ranges.map(([start]) => start)]);
        // Write in small batches and preserve independently sampled runtime columns.
        for (let offset = 0; offset < rows.length; offset += 100) {
          const batch = rows.slice(offset, offset + 100);
          const values = [];
          for (const row of batch) values.push(type, asDate(row.bucket_start), row.dimension_type || 'global', row.dimension_id || '', count(row.submissions), count(row.completed), count(row.succeeded), count(row.failed), timestamp);
          await query('/* ops:write-buckets */ INSERT INTO ops_metric_buckets (bucket_type, bucket_start, dimension_type, dimension_id, submissions, completed, succeeded, failed, updated_at) VALUES ' + batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ') +
            ' ON DUPLICATE KEY UPDATE submissions = VALUES(submissions), completed = VALUES(completed), succeeded = VALUES(succeeded), failed = VALUES(failed), updated_at = VALUES(updated_at)', values);
        }
      }
      const nextTrends = await loadTrends(timestamp);
      const nextIncidents = await loadIncidents(timestamp);
      trendCache = nextTrends;
      incidentCache = nextIncidents;
      summaryCache = nextSummaries;
      aggregateUpdatedAt = timestamp.toISOString();
      if (refreshCold) lastColdSummaryAt = timestamp.getTime();
      for (const [type, entries] of Object.entries(bucketVersions)) for (const [start, version] of entries) if (dirtyBuckets[type].get(start) === version) dirtyBuckets[type].delete(start);
      markCollected();
      return true;
    })();
    try { return await refreshing; } finally { refreshing = null; }
  };

  const getFailureSummary = ({ window = '15m' } = {}) => clone(summaryCache[safeWindow(window, '15m')]);
  const getTrends = ({ window = '1h' } = {}) => {
    const selected = safeWindow(window, '1h');
    const start = clock().getTime() - WINDOWS[selected];
    let items = trendCache.filter(row => asDate(row.bucketStart)?.getTime() >= start);
    if (selected === '7d') {
      const hours = new Map();
      for (const point of items) {
        const key = boundary(asDate(point.bucketStart), HOUR).toISOString();
        let hour = hours.get(key);
        if (!hour) { hour = { ...point, bucketStart: key, timestamp: key, submitted: 0, submissions: 0, completed: 0, succeeded: 0, failed: 0, active: null, localQueued: null, upstreamQueued: null }; hours.set(key, hour); }
        for (const metric of ['submitted', 'submissions', 'completed', 'succeeded', 'failed']) hour[metric] += point[metric];
        for (const metric of ['active', 'localQueued', 'upstreamQueued']) if (point[metric] != null) hour[metric] = hour[metric] == null ? point[metric] : Math.max(hour[metric], point[metric]);
        if (point.sampledAt) hour.sampledAt = point.sampledAt;
      }
      items = [...hours.values()].map(hour => ({ ...hour, successRate: hour.completed ? hour.succeeded / hour.completed * 100 : null }));
    }
    return { items: clone(items), window: selected };
  };

  const upsertIncident = async (input = {}) => {
    if (!await ready()) return false;
    const timestamp = clock();
    const fingerprint = sanitizeSummary(input.fingerprint, 200);
    if (!fingerprint) throw new Error('Incident fingerprint required');
    const status = ['active', 'open', 'acknowledged', 'recovered', 'closed'].includes(input.status) ? input.status : 'active';
    const values = [fingerprint, sanitizeSummary(input.category, 48) || 'unknown', sanitizeSummary(input.severity, 20) || 'warning', sanitizeSummary(input.message), sanitizeSummary(input.routeId, 160), Math.floor(count(input.sampleCount)), Math.floor(count(input.affectedUsers)), status,
      asDate(input.firstSeenAt, timestamp), asDate(input.lastSeenAt, timestamp), status === 'recovered' ? asDate(input.recoveredAt, timestamp) : null, status === 'closed' ? asDate(input.closedAt, timestamp) : null, timestamp];
    await query('/* ops:incident-write */ INSERT INTO ops_incidents (fingerprint, category, severity, message, route_id, sample_count, affected_users, status, first_seen_at, last_seen_at, recovered_at, closed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE category = VALUES(category), severity = VALUES(severity), message = VALUES(message), route_id = VALUES(route_id), sample_count = VALUES(sample_count), affected_users = VALUES(affected_users), status = VALUES(status), last_seen_at = VALUES(last_seen_at), recovered_at = VALUES(recovered_at), closed_at = VALUES(closed_at), updated_at = VALUES(updated_at)',
    values);
    const columns = ['fingerprint', 'category', 'severity', 'message', 'route_id', 'sample_count', 'affected_users', 'status', 'first_seen_at', 'last_seen_at', 'recovered_at', 'closed_at', 'updated_at'];
    const item = mapIncident(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    const previous = incidentCache.find(incident => incident.fingerprint === fingerprint);
    if (previous) { item.firstSeenAt = previous.firstSeenAt; item.acknowledgedAt = previous.acknowledgedAt; item.acknowledgedBy = previous.acknowledgedBy; }
    incidentCache = [item, ...incidentCache.filter(incident => incident.fingerprint !== fingerprint)].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || right.fingerprint.localeCompare(left.fingerprint)).slice(0, 50);
    markCollected();
    return true;
  };
  const listIncidents = () => ({ items: clone(incidentCache) });

  const pruneExpired = async () => {
    if (!await ready()) return false;
    const timestamp = clock();
    const retention = [
      ['ops_task_facts', 'created_at', 30, null], ['ops_task_events', 'created_at', 14, null],
      ['ops_metric_buckets', 'bucket_start', 7, 'minute'], ['ops_metric_buckets', 'bucket_start', 90, 'hour'],
      ['ops_incidents', 'updated_at', 90, null], ['ops_admin_audit', 'created_at', 90, null],
    ];
    let deleted = 0;
    for (const [table, column, days, type] of retention) {
      const params = [new Date(timestamp.getTime() - days * DAY)];
      if (type) params.push(type);
      const result = await query('/* ops:retention-prune */ DELETE FROM ' + table + ' WHERE ' + column + ' < ?' + (type ? ' AND bucket_type = ?' : '') + ' ORDER BY ' + column + ' ASC LIMIT 500', params);
      deleted += count(result?.affectedRows);
    }
    return { deleted };
  };

  return { init, upsertTaskFact, appendEvent, listTaskFacts, getTaskFact, refreshAggregates, recordRuntimeSample, getTrends, getFailureSummary, listIncidents, upsertIncident, getCoverage, pruneExpired };
}

module.exports = { createOperationsDashboardStore, sanitizeSummary, normalizeFailure };
