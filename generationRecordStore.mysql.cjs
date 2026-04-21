const { randomBytes } = require("crypto");
const {
  fromDbDateTime,
  getPool,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");

let generationRecordSchemaPromise = null;

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

const uniqueUrls = (urls = []) =>
  Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

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
      prompt: String(payload.prompt || "").trim(),
      modelId: String(payload.modelId || "").trim() || null,
      modelName: String(payload.modelName || "").trim() || null,
      routeId: String(payload.routeId || "").trim() || null,
      routeLabel: String(payload.routeLabel || "").trim() || null,
      taskId: String(payload.taskId || "").trim() || null,
      status,
      quantity: parsePositiveInt(payload.quantity, 1),
      aspectRatio: String(payload.aspectRatio || "").trim() || null,
      outputSize: String(payload.outputSize || "").trim() || null,
      previewUrl,
      resultUrlsJson: JSON.stringify(resultUrls),
      errorMessage: String(payload.errorMessage || "").trim() || null,
      metaJson: payload.meta ? JSON.stringify(payload.meta) : null,
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
    params.push(String(updates.taskId || "").trim() || null);
  }
  if (updates.outputSize !== undefined) {
    fields.push("output_size = ?");
    params.push(String(updates.outputSize || "").trim() || null);
  }
  if (updates.aspectRatio !== undefined) {
    fields.push("aspect_ratio = ?");
    params.push(String(updates.aspectRatio || "").trim() || null);
  }
  if (updates.errorMessage !== undefined) {
    fields.push("error_message = ?");
    params.push(String(updates.errorMessage || "").trim() || null);
  }
  if (updates.meta !== undefined) {
    fields.push("meta_json = ?");
    params.push(updates.meta ? JSON.stringify(updates.meta) : null);
  }
  if (updates.previewUrl !== undefined) {
    fields.push("preview_url = ?");
    params.push(String(updates.previewUrl || "").trim() || null);
  } else if (resultUrls.length > 0) {
    fields.push("preview_url = ?");
    params.push(resultUrls[0]);
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

const listGenerationRecordsForUser = async (userId, options = {}) => {
  await ensureGenerationRecordSchema();

  const normalizedUserId = String(userId || "").trim();
  const mediaType = String(options.mediaType || "all").trim().toUpperCase();
  const status = String(options.status || "all").trim().toUpperCase();
  const page = parsePositiveInt(options.page, 1);
  const pageSize = Math.min(100, parsePositiveInt(options.pageSize, 20));

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

  const pool = await getPool();
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM generation_records WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = Number(countRows?.[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const safeLimit = Math.max(1, Math.min(100, Number(pageSize || 20)));
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

  return {
    total,
    page: safePage,
    pageSize,
    totalPages,
    records: rows.map((row) => publicRecord(row)),
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

module.exports = {
  attachTaskToGenerationRecord,
  clearGenerationRecordsForUser,
  completeGenerationRecord,
  completeGenerationRecordByTaskId,
  createGenerationRecord,
  listGenerationRecordsForUser,
};
