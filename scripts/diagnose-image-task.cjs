const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const chargeId = String(process.argv[2] || '');
if (!/^chg_[a-f0-9]{20}$/.test(chargeId)) {
  console.error('Usage: node scripts/diagnose-image-task.cjs chg_<20 hex characters>');
  process.exitCode = 1;
} else {
  void diagnose().catch((error) => {
    console.error('Diagnostic query failed:', error.code || error.name);
    process.exitCode = 1;
  });
}

async function diagnose() {
  const mysql = require('mysql2/promise');
  // Connect directly: db.cjs also initializes databases, which is unnecessary here.
  const config = {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectTimeout: 10000,
    timezone: 'Z', dateStrings: true,
  };
  const connection = await mysql.createConnection(process.env.MYSQL_URL || config);
  const parseMeta = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
  try {
    const [charges] = await connection.execute(
      'SELECT id, type, created_at, refunded_at, refund_reason, meta_json FROM billing_ledger WHERE id = ? LIMIT 1',
      [chargeId],
    );
    const [tasks] = await connection.execute(
      'SELECT task_id, route_id, action_name, status, created_at, settled_at FROM billing_pending_tasks WHERE charge_id = ?',
      [chargeId],
    );
    const [records] = await connection.execute(
      `SELECT id, task_id, route_id, action_name, status, created_at, completed_at,
        JSON_LENGTH(IF(JSON_VALID(result_urls_json), result_urls_json, '[]')) AS result_count
       FROM generation_records
       WHERE task_id IN (SELECT task_id FROM billing_pending_tasks WHERE charge_id = ?)
          OR JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(meta_json), meta_json, '{}'), '$.chargeId')) = ?`,
      [chargeId, chargeId],
    );
    const charge = charges[0];
    const meta = parseMeta(charge?.meta_json);
    console.log(JSON.stringify({
      checkedAtUtc: new Date().toISOString(),
      charge: charge ? {
        id: charge.id, createdAtUtc: charge.created_at, refundedAtUtc: charge.refunded_at,
        refundReason: charge.refund_reason, routeId: meta.routeId, action: meta.action,
      } : null,
      tasks, generationRecords: records,
      note: 'An unrefunded charge does not prove success. Task status and result_count distinguish receipt from a stored result. Older edits may have no generation record.',
    }, null, 2));
  } finally {
    await connection.end();
  }
}
