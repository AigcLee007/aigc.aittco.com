const fs = require('node:fs');
const path = require('node:path');

function parseWindow(args) {
  const [start, end, accountId] = args;
  const explicit = value => typeof value === 'string' && /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (!explicit(start) || !explicit(end) || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 86400000) {
    throw new Error('Provide start/end ISO timestamps with timezone, covering at most 24 hours.');
  }
  return { since: new Date(start).toISOString().slice(0, 23).replace('T', ' '), until: new Date(end).toISOString().slice(0, 23).replace('T', ' '), accountId: accountId || undefined };
}

async function diagnoseWindow(connection, { since, until, accountId }) {
  const filter = accountId ? ' AND account_id = ?' : '';
  const params = [since, until, ...(accountId ? [accountId] : [])];
  const meta = "IF(JSON_VALID(meta_json), meta_json, '{}')";
  const [ledger] = await connection.execute(`SELECT id, type, account_id AS accountId, points, balance_after AS balanceAfter,
    created_at AS createdAtUtc, refunded_at AS refundedAtUtc, refund_reason AS refundReason,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.routeId')) AS routeId,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.action')) AS action,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.imageJobId')) AS imageJobId,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.chargeId')) AS originalChargeId
    FROM billing_ledger WHERE created_at >= ? AND created_at < ?${filter} ORDER BY created_at LIMIT 501`, params);
  const [records] = await connection.execute(`SELECT id, account_id AS accountId, user_id AS userId, task_id AS taskId,
    route_id AS routeId, model_id AS modelId, action_name AS action, status,
    created_at AS createdAtUtc, completed_at AS completedAtUtc,
    (CHAR_LENGTH(TRIM(COALESCE(prompt_text, ''))) = 0) AS emptyPrompt,
    JSON_LENGTH(IF(JSON_VALID(result_urls_json), result_urls_json, '[]')) AS resultCount,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.chargeId')) AS chargeId,
    JSON_UNQUOTE(JSON_EXTRACT(${meta}, '$.imageJobId')) AS imageJobId
    FROM generation_records WHERE media_type = 'IMAGE' AND created_at >= ? AND created_at < ?${filter} ORDER BY created_at LIMIT 501`, params);
  const [jobs] = await connection.execute(`SELECT task_id AS taskId, request_id AS requestId, user_id AS userId, status,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.chargeId')) AS chargeId,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.routeId')) AS routeId,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.generationRecordId')) AS generationRecordId,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.createdAt')) AS createdAtUtc,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.completedAt')) AS completedAtUtc,
    JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.storageStatus')) AS storageStatus,
    JSON_EXTRACT(job_json, '$.clientLiveTaskIds') AS canvasNodeIds,
    JSON_LENGTH(JSON_EXTRACT(job_json, '$.resultUrls')) AS resultCount
    FROM image_jobs WHERE created_at_ms >= ? AND created_at_ms < ?${accountId ? " AND JSON_UNQUOTE(JSON_EXTRACT(job_json, '$.accountId')) = ?" : ''}
    ORDER BY created_at_ms LIMIT 501`, [Date.parse(since.replace(' ', 'T') + 'Z'), Date.parse(until.replace(' ', 'T') + 'Z'), ...(accountId ? [accountId] : [])]);
  const byAccount = new Map();
  for (const row of ledger) {
    if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, { accountId: row.accountId, charges: 0, refunds: 0, reservedPoints: 0, refundedPoints: 0, netSpentPoints: 0 });
    const sum = byAccount.get(row.accountId);
    if (row.type === 'charge') { sum.charges++; sum.reservedPoints += Number(row.points); }
    if (row.type === 'refund') { sum.refunds++; sum.refundedPoints += Number(row.points); }
  }
  const accounts = [...byAccount.values()].map(sum => ({ ...sum, reservedPoints: Math.round(sum.reservedPoints * 10) / 10, refundedPoints: Math.round(sum.refundedPoints * 10) / 10, netSpentPoints: Math.round((sum.reservedPoints - sum.refundedPoints) * 10) / 10 }));
  return { checkedAtUtc: new Date().toISOString(), windowUtc: { since, until }, accounts,
    recordSummary: { success: records.filter(r => r.status === 'SUCCESS').length, failed: records.filter(r => r.status === 'FAILED').length, pending: records.filter(r => r.status === 'PENDING').length, emptyPrompt: records.filter(r => Number(r.emptyPrompt) === 1).length },
    truncated: [ledger, records, jobs].some(rows => rows.length > 500), ledger, records, jobs,
    note: 'Read-only. Times are UTC. Counts/net spending cover only this window; refunds outside it are not included. If truncated, narrow the window/account. No prompts, image URLs, tokens, or full job payloads are exported.' };
}

if (require.main === module) {
  void (async () => {
    const options = parseWindow(process.argv.slice(2));
    const env = path.join(__dirname, '..', '.env');
    if (fs.existsSync(env) && typeof process.loadEnvFile === 'function') process.loadEnvFile(env);
    if (!process.env.MYSQL_URL && !(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE)) throw new Error('MySQL environment is required. Run inside the app container.');
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(process.env.MYSQL_URL ? { uri: process.env.MYSQL_URL, timezone: 'Z', dateStrings: true, connectTimeout: 10000 } : {
      host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, timezone: 'Z', dateStrings: true, connectTimeout: 10000,
    });
    try { console.log(JSON.stringify(await diagnoseWindow(connection, options), null, 2)); } finally { await connection.end(); }
  })().catch(error => { console.error('Image diagnosis failed:', error.code || error.message); process.exitCode = 1; });
}
module.exports = { parseWindow, diagnoseWindow };
