const staticCatalog = require("./config/videoModels.json");
const { toNonNegativePoint } = require("./pointMath.cjs");
const { fromDbDateTime, getPool, isMySqlConfigured, toDbDateTime, withTransaction } = require("./db.cjs");

const trimToString = (value = "") => String(value ?? "").trim();
const trimToNull = (value = "") => {
  const trimmed = trimToString(value);
  return trimmed ? trimmed : null;
};
const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
};
const parseInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseDecimal = (value, fallback = 0) => {
  return toNonNegativePoint(value, fallback);
};
const normalizeStringArray = (value = []) => {
  const input = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(new Set(input.map((item) => trimToString(item)).filter(Boolean)));
};
const encodeJson = (value) => JSON.stringify(normalizeStringArray(value));
const parseJsonArray = (value) => {
  if (Array.isArray(value)) return normalizeStringArray(value);
  const text = trimToString(value);
  if (!text) return [];
  try {
    return normalizeStringArray(JSON.parse(text));
  } catch (_error) {
    return normalizeStringArray(text);
  }
};

const normalizeStaticModel = (model, index) => ({
  model_id: trimToString(model.id),
  label: trimToString(model.label || model.id),
  description: trimToNull(model.description),
  model_family: trimToString(model.modelFamily || model.id || "default"),
  route_family: trimToString(model.routeFamily || model.modelFamily || "default"),
  request_model: trimToNull(model.requestModel),
  selector_cost: parseDecimal(model.selectorCost, 0),
  max_reference_images: Math.max(0, parseInteger(model.maxReferenceImages, 1)),
  reference_labels_json: encodeJson(model.referenceLabels || []),
  default_aspect_ratio: trimToString(model.defaultAspectRatio || "16:9"),
  aspect_ratio_options_json: encodeJson(model.aspectRatioOptions || ["16:9", "9:16"]),
  default_duration: trimToString(model.defaultDuration || "4"),
  duration_options_json: encodeJson(model.durationOptions || ["4", "6", "8"]),
  supports_hd: parseBoolean(model.supportsHd, false),
  default_hd: parseBoolean(model.defaultHd, false),
  is_active: parseBoolean(model.isActive, true),
  is_default_model: trimToString(model.id) === trimToString(staticCatalog.defaultModelId || ""),
  sort_order: parseInteger(model.sortOrder, index),
  created_at: null,
  updated_at: null,
});

const buildStaticRows = () =>
  Array.isArray(staticCatalog.models)
    ? staticCatalog.models.map((model, index) => normalizeStaticModel(model, index))
    : [];

const mapRowToModel = (row) => ({
  id: trimToString(row.model_id),
  label: trimToString(row.label || row.model_id),
  description: trimToString(row.description || ""),
  modelFamily: trimToString(row.model_family || row.model_id || "default"),
  routeFamily: trimToString(row.route_family || row.model_family || "default"),
  requestModel: trimToString(row.request_model || ""),
  selectorCost: parseDecimal(row.selector_cost, 0),
  maxReferenceImages: Math.max(0, parseInteger(row.max_reference_images, 1)),
  referenceLabels: parseJsonArray(row.reference_labels_json),
  defaultAspectRatio: trimToString(row.default_aspect_ratio || "16:9"),
  aspectRatioOptions: parseJsonArray(row.aspect_ratio_options_json),
  defaultDuration: trimToString(row.default_duration || "4"),
  durationOptions: parseJsonArray(row.duration_options_json),
  supportsHd: parseBoolean(row.supports_hd, false),
  defaultHd: parseBoolean(row.default_hd, false),
  isActive: parseBoolean(row.is_active, true),
  isDefaultModel: parseBoolean(row.is_default_model, false),
  sortOrder: parseInteger(row.sort_order, 0),
  createdAt: row.created_at ? fromDbDateTime(row.created_at) : null,
  updatedAt: row.updated_at ? fromDbDateTime(row.updated_at) : null,
});

const buildCatalogFromModels = (models, { includeInactive = false } = {}) => {
  const visibleModels = includeInactive ? [...models] : models.filter((model) => model.isActive !== false);
  const sortedModels = [...visibleModels].sort((left, right) => {
    if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0);
    return left.label.localeCompare(right.label);
  });
  const activeModels = sortedModels.filter((model) => model.isActive !== false);
  const defaultModel =
    activeModels.find((model) => model.isDefaultModel) ||
    activeModels.find((model) => model.id === trimToString(staticCatalog.defaultModelId || "")) ||
    activeModels[0] ||
    sortedModels.find((model) => model.isDefaultModel) ||
    sortedModels[0] ||
    null;

  return {
    defaultModelId: defaultModel?.id || trimToString(staticCatalog.defaultModelId || ""),
    models: sortedModels,
  };
};

let modelSchemaPromise = null;

const ensureVideoModelSchema = async () => {
  if (!isMySqlConfigured()) return false;
  if (!modelSchemaPromise) {
    modelSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS video_models (
          model_id VARCHAR(120) PRIMARY KEY,
          label VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          model_family VARCHAR(64) NOT NULL,
          route_family VARCHAR(64) NOT NULL,
          request_model VARCHAR(160) NULL,
          selector_cost DECIMAL(10,1) NOT NULL DEFAULT 0,
          max_reference_images INT NOT NULL DEFAULT 1,
          reference_labels_json LONGTEXT NOT NULL,
          default_aspect_ratio VARCHAR(16) NOT NULL DEFAULT '16:9',
          aspect_ratio_options_json LONGTEXT NOT NULL,
          default_duration VARCHAR(16) NOT NULL DEFAULT '4',
          duration_options_json LONGTEXT NOT NULL,
          supports_hd TINYINT(1) NOT NULL DEFAULT 0,
          default_hd TINYINT(1) NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          is_default_model TINYINT(1) NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          INDEX idx_video_models_active (is_active, sort_order),
          INDEX idx_video_models_request_model (request_model)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      const [selectorCostColumns] = await pool.execute(
        "SHOW COLUMNS FROM video_models LIKE 'selector_cost'",
      );
      const selectorCostType = String(selectorCostColumns?.[0]?.Type || "").toLowerCase();
      if (!/^decimal\(\d+,\s*1\)$/.test(selectorCostType)) {
        await pool.execute(`
          ALTER TABLE video_models
          MODIFY COLUMN selector_cost DECIMAL(10,1) NOT NULL DEFAULT 0
        `);
      }

      await withTransaction(async (connection) => {
        const [countRows] = await connection.execute("SELECT COUNT(*) AS total FROM video_models");
        if (Number(countRows?.[0]?.total || 0) > 0) return;
        const nowDb = toDbDateTime();
        for (const row of buildStaticRows()) {
          await connection.execute(
            `INSERT INTO video_models (
              model_id,label,description,model_family,route_family,request_model,selector_cost,
              max_reference_images,reference_labels_json,default_aspect_ratio,aspect_ratio_options_json,
              default_duration,duration_options_json,supports_hd,default_hd,is_active,is_default_model,
              sort_order,created_at,updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.model_id, row.label, row.description, row.model_family, row.route_family, row.request_model,
              row.selector_cost, row.max_reference_images, row.reference_labels_json, row.default_aspect_ratio,
              row.aspect_ratio_options_json, row.default_duration, row.duration_options_json, row.supports_hd ? 1 : 0,
              row.default_hd ? 1 : 0, row.is_active ? 1 : 0, row.is_default_model ? 1 : 0, row.sort_order, nowDb, nowDb,
            ],
          );
        }
      });
    })();
  }
  await modelSchemaPromise;
  return true;
};

const getStaticCatalog = ({ includeInactive = false } = {}) => {
  const rows = buildStaticRows().map((row) => mapRowToModel(row));
  return buildCatalogFromModels(includeInactive ? rows : rows.filter((model) => model.isActive !== false), { includeInactive });
};

const getVideoModelCatalog = async ({ includeInactive = false } = {}) => {
  if (!isMySqlConfigured()) return getStaticCatalog({ includeInactive });
  await ensureVideoModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM video_models ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY sort_order ASC, label ASC, model_id ASC`,
  );
  return buildCatalogFromModels((rows || []).map((row) => mapRowToModel(row)), { includeInactive });
};

const getVideoModelById = async (modelId, { includeInactive = true } = {}) => {
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) return null;
  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive });
    return catalog.models.find((model) => model.id === modelIdValue) || null;
  }
  await ensureVideoModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM video_models WHERE model_id = ? ${includeInactive ? "" : "AND is_active = 1"} LIMIT 1`,
    [modelIdValue],
  );
  return rows?.[0] ? mapRowToModel(rows[0]) : null;
};

const getVideoModelByRequestModel = async (requestModel, { includeInactive = true } = {}) => {
  const requestModelValue = trimToString(requestModel);
  if (!requestModelValue) return null;
  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive });
    return catalog.models.find((model) => model.id === requestModelValue || model.requestModel === requestModelValue) || null;
  }
  await ensureVideoModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM video_models WHERE (model_id = ? OR request_model = ?) ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order ASC LIMIT 1`,
    [requestModelValue, requestModelValue],
  );
  return rows?.[0] ? mapRowToModel(rows[0]) : null;
};

const requireMySqlVideoModelManagement = async () => {
  if (!isMySqlConfigured()) throw new Error("Video model management requires MySQL storage to be enabled");
  await ensureVideoModelSchema();
};

const validateModelPayload = (input = {}, { partial = false } = {}) => {
  const next = {};
  if (!partial || Object.prototype.hasOwnProperty.call(input, "id")) {
    const value = trimToString(input.id);
    if (!partial && !value) throw new Error("Model ID is required");
    if (value) next.model_id = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "label")) {
    const value = trimToString(input.label);
    if (!partial && !value) throw new Error("Model label is required");
    if (value) next.label = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "description")) next.description = trimToNull(input.description);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "modelFamily")) {
    const value = trimToString(input.modelFamily);
    if (!partial && !value) throw new Error("Model family is required");
    if (value) next.model_family = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "routeFamily")) next.route_family = trimToString(input.routeFamily || "default") || "default";
  if (!partial || Object.prototype.hasOwnProperty.call(input, "requestModel")) next.request_model = trimToNull(input.requestModel);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "selectorCost")) next.selector_cost = Math.max(0, parseDecimal(input.selectorCost, 0));
  if (!partial || Object.prototype.hasOwnProperty.call(input, "maxReferenceImages")) next.max_reference_images = Math.max(0, parseInteger(input.maxReferenceImages, 1));
  if (!partial || Object.prototype.hasOwnProperty.call(input, "referenceLabels")) next.reference_labels_json = JSON.stringify(normalizeStringArray(input.referenceLabels));
  if (!partial || Object.prototype.hasOwnProperty.call(input, "defaultAspectRatio")) next.default_aspect_ratio = trimToString(input.defaultAspectRatio || "16:9") || "16:9";
  if (!partial || Object.prototype.hasOwnProperty.call(input, "aspectRatioOptions")) {
    const values = normalizeStringArray(input.aspectRatioOptions);
    if (!partial && values.length === 0) throw new Error("At least one aspect ratio option is required");
    next.aspect_ratio_options_json = JSON.stringify(values);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "defaultDuration")) next.default_duration = trimToString(input.defaultDuration || "4") || "4";
  if (!partial || Object.prototype.hasOwnProperty.call(input, "durationOptions")) {
    const values = normalizeStringArray(input.durationOptions);
    if (!partial && values.length === 0) throw new Error("At least one duration option is required");
    next.duration_options_json = JSON.stringify(values);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "supportsHd")) next.supports_hd = parseBoolean(input.supportsHd, false) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "defaultHd")) next.default_hd = parseBoolean(input.defaultHd, false) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "isActive")) next.is_active = parseBoolean(input.isActive, true) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "isDefaultModel")) next.is_default_model = parseBoolean(input.isDefaultModel, false) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "sortOrder")) next.sort_order = parseInteger(input.sortOrder, 0);
  return next;
};

const fetchAdminVideoModels = async () => {
  await requireMySqlVideoModelManagement();
  return (await getVideoModelCatalog({ includeInactive: true })).models;
};

const createManagedVideoModel = async (input = {}) => {
  await requireMySqlVideoModelManagement();
  const payload = validateModelPayload(input, { partial: false });
  const nowDb = toDbDateTime();
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT model_id FROM video_models WHERE model_id = ? LIMIT 1", [payload.model_id]);
    if (existingRows?.[0]) throw new Error("Model ID already exists");
    if (payload.is_default_model) await connection.execute("UPDATE video_models SET is_default_model = 0");
    await connection.execute(
      `INSERT INTO video_models (
        model_id,label,description,model_family,route_family,request_model,selector_cost,max_reference_images,
        reference_labels_json,default_aspect_ratio,aspect_ratio_options_json,default_duration,duration_options_json,
        supports_hd,default_hd,is_active,is_default_model,sort_order,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.model_id, payload.label, payload.description || null, payload.model_family, payload.route_family || "default",
        payload.request_model || null, payload.selector_cost || 0, payload.max_reference_images ?? 1,
        payload.reference_labels_json || JSON.stringify([]), payload.default_aspect_ratio || "16:9",
        payload.aspect_ratio_options_json || JSON.stringify(["16:9", "9:16"]), payload.default_duration || "4",
        payload.duration_options_json || JSON.stringify(["4", "6", "8"]), payload.supports_hd ?? 0, payload.default_hd ?? 0,
        payload.is_active ?? 1, payload.is_default_model || 0, payload.sort_order || 0, nowDb, nowDb,
      ],
    );
    const [rows] = await connection.execute("SELECT * FROM video_models WHERE model_id = ? LIMIT 1", [payload.model_id]);
    return mapRowToModel(rows[0]);
  });
};

const updateManagedVideoModel = async (modelId, patch = {}) => {
  await requireMySqlVideoModelManagement();
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) throw new Error("Model ID is required");
  const payload = validateModelPayload(patch, { partial: true });
  delete payload.model_id;
  payload.updated_at = toDbDateTime();
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT * FROM video_models WHERE model_id = ? LIMIT 1 FOR UPDATE", [modelIdValue]);
    if (!existingRows?.[0]) throw new Error("Video model does not exist");
    if (payload.is_default_model) await connection.execute("UPDATE video_models SET is_default_model = 0");
    const entries = Object.entries(payload);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      await connection.execute(`UPDATE video_models SET ${assignments} WHERE model_id = ?`, [...entries.map(([, value]) => value), modelIdValue]);
    }
    const [rows] = await connection.execute("SELECT * FROM video_models WHERE model_id = ? LIMIT 1", [modelIdValue]);
    return mapRowToModel(rows[0]);
  });
};

const deleteManagedVideoModel = async (modelId) => {
  await requireMySqlVideoModelManagement();
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) throw new Error("Model ID is required");
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT * FROM video_models WHERE model_id = ? LIMIT 1 FOR UPDATE", [modelIdValue]);
    const existing = existingRows?.[0];
    if (!existing) throw new Error("Video model does not exist");
    const deletingDefault = parseBoolean(existing.is_default_model, false);
    await connection.execute("DELETE FROM video_models WHERE model_id = ?", [modelIdValue]);
    const [remainingRows] = await connection.execute("SELECT * FROM video_models ORDER BY is_active DESC, sort_order ASC, label ASC, model_id ASC");
    const hasDefault = (remainingRows || []).some((row) => parseBoolean(row.is_default_model, false));
    if (deletingDefault || !hasDefault) {
      const fallback = (remainingRows || []).find((row) => parseBoolean(row.is_active, true)) || remainingRows?.[0] || null;
      if (fallback?.model_id) {
        await connection.execute("UPDATE video_models SET is_default_model = CASE WHEN model_id = ? THEN 1 ELSE 0 END", [fallback.model_id]);
      }
    }
    return true;
  });
};

module.exports = {
  createManagedVideoModel,
  deleteManagedVideoModel,
  ensureVideoModelSchema,
  fetchAdminVideoModels,
  getVideoModelById,
  getVideoModelByRequestModel,
  getVideoModelCatalog,
  updateManagedVideoModel,
};
