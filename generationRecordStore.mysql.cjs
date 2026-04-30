const { randomBytes } = require("crypto");
const {
  fromDbDateTime,
  getPool,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");

let generationRecordSchemaPromise = null;
let generationRecordMaintenanceTimer = null;

const parseEnvInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const MAX_PROMPT_LENGTH = Math.max(
  256,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_PROMPT_LENGTH, 4000),
);
const MAX_ERROR_LENGTH = Math.max(
  256,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_ERROR_LENGTH, 2000),
);
const MAX_URL_LENGTH = Math.max(
  256,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_URL_LENGTH, 2048),
);
const MAX_META_STRING_LENGTH = Math.max(
  1024,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_META_STRING_LENGTH, 12000),
);
const MAX_META_DEPTH = Math.max(
  1,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_META_DEPTH, 4),
);
const MAX_META_KEYS = Math.max(
  5,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_META_KEYS, 40),
);
const MAX_META_ARRAY_ITEMS = Math.max(
  5,
  parseEnvInt(process.env.GENERATION_RECORD_MAX_META_ARRAY_ITEMS, 12),
);
const SUCCESS_RETENTION_DAYS = Math.max(
  1,
  parseEnvInt(process.env.GENERATION_RECORD_SUCCESS_RETENTION_DAYS, 30),
);
const FAILED_RETENTION_DAYS = Math.max(
  1,
  parseEnvInt(process.env.GENERATION_RECORD_FAILED_RETENTION_DAYS, 7),
);
const PENDING_RETENTION_DAYS = Math.max(
  1,
  parseEnvInt(process.env.GENERATION_RECORD_PENDING_RETENTION_DAYS, 3),
);
const CLEANUP_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  parseEnvInt(process.env.GENERATION_RECORD_CLEANUP_INTERVAL_MS, 6 * 60 * 60 * 1000),
);

const ensureGenerationRecordSchema = async () => {
  if (!generationRecordSchemaPromise) {
    generationRecordSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS generation_records (
          id VARCHAR(40) PRIMARY KEY,
          user_id VARCHAR(32) NOT NULL,
          account_id VARCHAR(32) NULL,
          owner_email VARCHAR(255) NULL,
          ui_mode VARCHAR(24) NOT NULL,
          media_type VARCHAR(16) NOT NULL,
          action_name VARCHAR(40) NULL,
          prompt_text LONGTEXT NULL,
          model_id VARCHAR(80) NULL,
          model_name VARCHAR(120) NULL,
          route_id VARCHAR(80) NULL,
          route_label VARCHAR(120) NULL,
          task_id VARCHAR(255) NULL,
          status VARCHAR(16) NOT NULL,
          quantity INT NOT NULL DEFAULT 1,
          aspect_ratio VARCHAR(20) NULL,
          output_size VARCHAR(32) NULL,
          preview_url LONGTEXT NULL,
          result_urls_json LONGTEXT NULL,
          error_message LONGTEXT NULL,
          meta_json LONGTEXT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          completed_at DATETIME(3) NULL,
          UNIQUE KEY uq_generation_records_task_id (task_id),
          INDEX idx_generation_records_user_created (user_id, created_at),
          INDEX idx_generation_records_user_status_created (user_id, status, created_at),
          INDEX idx_generation_records_user_media_created (user_id, media_type, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })();
  }

  return generationRecordSchemaPromise;
};

const normalizeStatus = (value = "PENDING") => {
  const normalized = String(value || "PENDING").trim().toUpperCase();
  if (["PENDING", "SUCCESS", "FAILED"].includes(normalized)) return normalized;
  return "PENDING";
};

const normalizeMediaType = (value = "IMAGE") => {
  const normalized = String(value || "IMAGE").trim().toUpperCase();
  return normalized === "VIDEO" ? "VIDEO" : "IMAGE";
};

const normalizeUiMode = (value = "canvas") => {
  const normalized = String(value || "canvas").trim().toLowerCase();
  return normalized === "classic" ? "classic" : "canvas";
};

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 ? parsed : fallback;
};

const parseCursorDateTime = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return toDbDateTime(date);
};

const uniqueUrls = (urls = []) =>
  Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((item) => clampText(item, MAX_URL_LENGTH))
        .filter(Boolean),
    ),
  );

const clampText = (value, maxLength = 0) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 12))}[truncated]`;
};

const sanitizeJsonValue = (value, depth = 0) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return clampText(value, 512);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (depth >= MAX_META_DEPTH) {
      return `[array(${value.length}) truncated]`;
    }
    return value
      .slice(0, MAX_META_ARRAY_ITEMS)
      .map((item) => sanitizeJsonValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_META_DEPTH) {
      return "[object truncated]";
    }
    const entries = Object.entries(value).slice(0, MAX_META_KEYS);
    return Object.fromEntries(
      entries.map(([key, item]) => [clampText(key, 80) || "key", sanitizeJsonValue(item, depth + 1)]),
    );
  }

  return clampText(String(value), 512);
};

const stringifyMeta = (value) => {
  if (!value) return null;
  const normalized = sanitizeJsonValue(value, 0);
  const serialized = JSON.stringify(normalized);
  if (!serialized) return null;
  if (serialized.length <= MAX_META_STRING_LENGTH) return serialized;
  return JSON.stringify({
    truncated: true,
    size: serialized.length,
    preview: clampText(serialized, MAX_META_STRING_LENGTH - 64),
  });
};

const parseJsonField = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
};

const publicRecord = (record = {}) => ({
  id: String(record.id || "").trim(),
  userId: String(record.user_id || record.userId || "").trim(),
  accountId: String(record.account_id || record.accountId || "").trim() || null,
  ownerEmail:
    String(record.owner_email || record.ownerEmail || "").trim() || null,
  uiMode: normalizeUiMode(record.ui_mode || record.uiMode),
  mediaType: normalizeMediaType(record.media_type || record.mediaType),
  actionName:
    String(record.action_name || record.actionName || "").trim() || null,
  prompt: String(record.prompt_text || record.prompt || "").trim(),
  modelId: String(record.model_id || record.modelId || "").trim() || null,
  modelName: String(record.model_name || record.modelName || "").trim() || null,
  routeId: String(record.route_id || record.routeId || "").trim() || null,
  routeLabel:
    String(record.route_label || record.routeLabel || "").trim() || null,
  taskId: String(record.task_id || record.taskId || "").trim() || null,
  status: normalizeStatus(record.status),
  quantity: parsePositiveInt(record.quantity, 1),
  aspectRatio:
    String(record.aspect_ratio || record.aspectRatio || "").trim() || null,
  outputSize:
    String(record.output_size || record.outputSize || "").trim() || null,
  previewUrl:
    String(record.preview_url || record.previewUrl || "").trim() || null,
  resultUrls: uniqueUrls(
    parseJsonField(record.result_urls_json || record.resultUrls) || [],
  ),
  errorMessage:
    String(record.error_message || record.errorMessage || "").trim() || null,
  meta: parseJsonField(record.meta_json || record.meta),
  createdAt: fromDbDateTime(record.created_at || record.createdAt),
  updatedAt: fromDbDateTime(record.updated_at || record.updatedAt),
  completedAt: fromDbDateTime(record.completed_at || record.completedAt),
});

const createGenerationRecord = async (payload = {}) => {
  await ensureGenerationRecordSchema();

  return withTransaction(async (connection) => {
    const now = new Date();
    const nowDb = toDbDateTime(now);
    const resultUrls = uniqueUrls(payload.resultUrls);
    const previewUrl = String(payload.previewUrl || "").trim() || resultUrls[0] || null;
  const status = normalizeStatus(payload.status);
  const record = {
      id: `genrec_${randomBytes(8).toString("hex")}`,
      userId: String(payload.userId || "").trim(),
      accountId: String(payload.accountId || "").trim() || null,
      ownerEmail: String(payload.ownerEmail || "").trim().toLowerCase() || null,
      uiMode: normalizeUiMode(payload.uiMode),
      mediaType: normalizeMediaType(payload.mediaType),
      actionName: String(payload.actionName || "").trim() || null,
      prompt: clampText(payload.prompt, MAX_PROMPT_LENGTH),
      modelId: String(payload.modelId || "").trim() || null,
      modelName: String(payload.modelName || "").trim() || null,
      routeId: String(payload.routeId || "").trim() || null,
      routeLabel: String(payload.routeLabel || "").trim() || null,
      taskId: String(payload.taskId || "").trim() || null,
      status,
      quantity: parsePositiveInt(payload.quantity, 1),
      aspectRatio: String(payload.aspectRatio || "").trim() || null,
      outputSize: String(payload.outputSize || "").trim() || null,
      previewUrl: previewUrl ? clampText(previewUrl, MAX_URL_LENGTH) : null,
      resultUrlsJson: JSON.stringify(resultUrls),
      errorMessage: clampText(payload.errorMessage, MAX_ERROR_LENGTH) || null,
      metaJson: stringifyMeta(payload.meta),
      createdAt: nowDb,
      updatedAt: nowDb,
      completedAt: status === "PENDING" ? null : nowDb,
    };

    await connection.execute(
      `
        INSERT INTO generation_records (
          id, user_id, account_id, owner_email, ui_mode, media_type, action_name,
          prompt_text, model_id, model_name, route_id, route_label, task_id, status,
          quantity, aspect_ratio, output_size, preview_url, result_urls_json,
          error_message, meta_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.userId,
        record.accountId,
        record.ownerEmail,
        record.uiMode,
        record.mediaType,
        record.actionName,
        record.prompt,
        record.modelId,
        record.modelName,
        record.routeId,
        record.routeLabel,
        record.taskId,
        record.status,
        record.quantity,
        record.aspectRatio,
        record.outputSize,
        record.previewUrl,
        record.resultUrlsJson,
        record.errorMessage,
        record.metaJson,
        record.createdAt,
        record.updatedAt,
        record.completedAt,
      ],
    );

    return publicRecord({
      id: record.id,
      user_id: record.userId,
      account_id: record.accountId,
      owner_email: record.ownerEmail,
      ui_mode: record.uiMode,
      media_type: record.mediaType,
      action_name: record.actionName,
      prompt_text: record.prompt,
      model_id: record.modelId,
      model_name: record.modelName,
      route_id: record.routeId,
      route_label: record.routeLabel,
      task_id: record.taskId,
      status: record.status,
      quantity: record.quantity,
      aspect_ratio: record.aspectRatio,
      output_size: record.outputSize,
      preview_url: record.previewUrl,
      result_urls_json: record.resultUrlsJson,
      error_message: record.errorMessage,
      meta_json: record.metaJson,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      completed_at: record.completedAt,
    });
  });
};

const attachTaskToGenerationRecord = async (recordId, taskId) => {
  await ensureGenerationRecordSchema();
  const normalizedRecordId = String(recordId || "").trim();
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedRecordId) return null;

  const nowDb = toDbDateTime(new Date());
  const pool = await getPool();
  await pool.execute(
    "UPDATE generation_records SET task_id = ?, updated_at = ? WHERE id = ?",
    [normalizedTaskId || null, nowDb, normalizedRecordId],
  );
  const [rows] = await pool.execute(
    "SELECT * FROM generation_records WHERE id = ? LIMIT 1",
    [normalizedRecordId],
  );
  return rows[0] ? publicRecord(rows[0]) : null;
};

const buildCompletionUpdate = (updates = {}) => {
  const nowDb = toDbDateTime(new Date());
  const resultUrls = uniqueUrls(updates.resultUrls);
  const fields = [];
  const params = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    params.push(normalizeStatus(updates.status));
  }
  if (updates.taskId !== undefined) {
    fields.push("task_id = ?");
    params.push(clampText(updates.taskId, 255) || null);
  }
  if (updates.outputSize !== undefined) {
    fields.push("output_size = ?");
    params.push(clampText(updates.outputSize, 32) || null);
  }
  if (updates.aspectRatio !== undefined) {
    fields.push("aspect_ratio = ?");
    params.push(clampText(updates.aspectRatio, 20) || null);
  }
  if (updates.errorMessage !== undefined) {
    fields.push("error_message = ?");
    params.push(clampText(updates.errorMessage, MAX_ERROR_LENGTH) || null);
  }
  if (updates.meta !== undefined) {
    fields.push("meta_json = ?");
    params.push(stringifyMeta(updates.meta));
  }
  if (updates.previewUrl !== undefined) {
    fields.push("preview_url = ?");
    params.push(clampText(updates.previewUrl, MAX_URL_LENGTH) || null);
  } else if (resultUrls.length > 0) {
    fields.push("preview_url = ?");
    params.push(clampText(resultUrls[0], MAX_URL_LENGTH) || null);
  }
  if (resultUrls.length > 0) {
    fields.push("result_urls_json = ?");
    params.push(JSON.stringify(resultUrls));
  }

  fields.push("updated_at = ?");
  params.push(nowDb);

  if (updates.status && normalizeStatus(updates.status) !== "PENDING") {
    fields.push("completed_at = ?");
    params.push(nowDb);
  }

  return { fields, params };
};

const completeGenerationRecord = async (recordId, updates = {}) => {
  await ensureGenerationRecordSchema();
  const normalizedRecordId = String(recordId || "").trim();
  if (!normalizedRecordId) return null;

  const { fields, params } = buildCompletionUpdate(updates);
  if (!fields.length) return null;

  const pool = await getPool();
  await pool.execute(
    `UPDATE generation_records SET ${fields.join(", ")} WHERE id = ?`,
    [...params, normalizedRecordId],
  );
  const [rows] = await pool.execute(
    "SELECT * FROM generation_records WHERE id = ? LIMIT 1",
    [normalizedRecordId],
  );
  return rows[0] ? publicRecord(rows[0]) : null;
};

const completeGenerationRecordByTaskId = async (taskId, updates = {}) => {
  await ensureGenerationRecordSchema();
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return null;

  const { fields, params } = buildCompletionUpdate(updates);
  if (!fields.length) return null;

  const pool = await getPool();
  await pool.execute(
    `UPDATE generation_records SET ${fields.join(", ")} WHERE task_id = ?`,
    [...params, normalizedTaskId],
  );
  const [rows] = await pool.execute(
    "SELECT * FROM generation_records WHERE task_id = ? LIMIT 1",
    [normalizedTaskId],
  );
  return rows[0] ? publicRecord(rows[0]) : null;
};

const getGenerationRecordByTaskId = async (taskId) => {
  await ensureGenerationRecordSchema();
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return null;

  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT * FROM generation_records WHERE task_id = ? LIMIT 1",
    [normalizedTaskId],
  );
  return rows[0] ? publicRecord(rows[0]) : null;
};

const listGenerationRecordsForUser = async (userId, options = {}) => {
  await ensureGenerationRecordSchema();

  const normalizedUserId = String(userId || "").trim();
  const mediaType = String(options.mediaType || "all").trim().toUpperCase();
  const status = String(options.status || "all").trim().toUpperCase();
  const page = parsePositiveInt(options.page, 1);
  const pageSize = Math.min(100, parsePositiveInt(options.pageSize, 20));
  const sinceCreatedAt = parseCursorDateTime(options.sinceCreatedAt);
  const sinceId = String(options.sinceId || "").trim();

  const where = ["user_id = ?"];
  const params = [normalizedUserId];

  if (mediaType !== "ALL") {
    where.push("media_type = ?");
    params.push(normalizeMediaType(mediaType));
  }
  if (status !== "ALL") {
    where.push("status = ?");
    params.push(normalizeStatus(status));
  }
  if (sinceCreatedAt) {
    where.push("(created_at > ? OR (created_at = ? AND id <> ?))");
    params.push(sinceCreatedAt, sinceCreatedAt, sinceId || "__cursor__");
  }

  const pool = await getPool();
  const safeLimit = Math.max(1, Math.min(100, Number(pageSize || 20)));
  if (sinceCreatedAt) {
    const [incrementalRows] = await pool.execute(
      `
        SELECT *
        FROM generation_records
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ${safeLimit}
      `,
      params,
    );
    const records = incrementalRows.map((row) => publicRecord(row));
    const cursorRecord = records[0] || null;
    return {
      total: records.length,
      page: 1,
      pageSize: safeLimit,
      totalPages: 1,
      records,
      incremental: true,
      cursor: cursorRecord
        ? {
            sinceCreatedAt: cursorRecord.createdAt,
            sinceId: cursorRecord.id,
          }
        : null,
    };
  }

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM generation_records WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = Number(countRows?.[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const safeOffset = Math.max(0, Number(offset || 0));

  const [rows] = await pool.execute(
    `
      SELECT *
      FROM generation_records
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `,
    params,
  );
  const records = rows.map((row) => publicRecord(row));
  const cursorRecord = records[0] || null;

  return {
    total,
    page: safePage,
    pageSize,
    totalPages,
    records,
    cursor: cursorRecord
      ? {
          sinceCreatedAt: cursorRecord.createdAt,
          sinceId: cursorRecord.id,
        }
      : null,
  };
};

const clearGenerationRecordsForUser = async (userId, options = {}) => {
  await ensureGenerationRecordSchema();

  const normalizedUserId = String(userId || "").trim();
  const mediaType = String(options.mediaType || "all").trim().toUpperCase();
  const where = ["user_id = ?"];
  const params = [normalizedUserId];

  if (mediaType !== "ALL") {
    where.push("media_type = ?");
    params.push(normalizeMediaType(mediaType));
  }

  const pool = await getPool();
  const [result] = await pool.execute(
    `DELETE FROM generation_records WHERE ${where.join(" AND ")}`,
    params,
  );
  return {
    removed: Number(result?.affectedRows || 0),
  };
};

const cleanupExpiredGenerationRecords = async () => {
  await ensureGenerationRecordSchema();
  const pool = await getPool();
  const [result] = await pool.execute(
    `
      DELETE FROM generation_records
      WHERE
        (status = 'SUCCESS' AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY)
        OR (status = 'FAILED' AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY)
        OR (status = 'PENDING' AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY)
    `,
    [SUCCESS_RETENTION_DAYS, FAILED_RETENTION_DAYS, PENDING_RETENTION_DAYS],
  );
  return {
    removed: Number(result?.affectedRows || 0),
    successRetentionDays: SUCCESS_RETENTION_DAYS,
    failedRetentionDays: FAILED_RETENTION_DAYS,
    pendingRetentionDays: PENDING_RETENTION_DAYS,
  };
};

const startGenerationRecordMaintenance = (logger = console) => {
  if (generationRecordMaintenanceTimer) return generationRecordMaintenanceTimer;

  const runCleanup = async () => {
    try {
      const result = await cleanupExpiredGenerationRecords();
      if (result.removed > 0) {
        logger.info?.(
          `[Generation Records] Removed ${result.removed} expired rows (success=${result.successRetentionDays}d, failed=${result.failedRetentionDays}d, pending=${result.pendingRetentionDays}d)`,
        );
      }
    } catch (error) {
      logger.warn?.(`[Generation Records] Cleanup failed: ${error.message}`);
    }
  };

  setTimeout(() => {
    void runCleanup();
  }, 10 * 1000);
  generationRecordMaintenanceTimer = setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);

  logger.info?.(
    `[Generation Records] Maintenance enabled: every ${CLEANUP_INTERVAL_MS}ms (success=${SUCCESS_RETENTION_DAYS}d, failed=${FAILED_RETENTION_DAYS}d, pending=${PENDING_RETENTION_DAYS}d)`,
  );

  return generationRecordMaintenanceTimer;
};

module.exports = {
  attachTaskToGenerationRecord,
  clearGenerationRecordsForUser,
  cleanupExpiredGenerationRecords,
  completeGenerationRecord,
  completeGenerationRecordByTaskId,
  createGenerationRecord,
  getGenerationRecordByTaskId,
  listGenerationRecordsForUser,
  startGenerationRecordMaintenance,
};
