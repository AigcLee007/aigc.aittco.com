const staticCatalog = require("./config/imageModels.json");
const { toNonNegativePoint } = require("./pointMath.cjs");
const {
  fromDbDateTime,
  getPool,
  isMySqlConfigured,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");

const VALID_ICON_KINDS = new Set([
  "banana",
  "banana-zap",
  "sparkles",
  "layers",
  "zap",
  "none",
]);
const VALID_PANEL_LAYOUTS = new Set(["nano-banana", "default", "compact"]);
const VALID_SIZE_BEHAVIORS = new Set([
  "passthrough",
  "doubao-v5",
  "doubao-v45",
  "z-image-turbo",
]);

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

  return Array.from(
    new Set(
      input
        .map((item) => trimToString(item))
        .filter(Boolean),
    ),
  );
};
const encodeJson = (value) => JSON.stringify(normalizeStringArray(value));
const parseJsonArray = (value) => {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

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
  icon_kind: trimToString(model.iconKind || "banana"),
  panel_layout: trimToString(model.panelLayout || "default"),
  size_behavior: trimToString(model.sizeBehavior || "passthrough"),
  default_size: trimToString(model.defaultSize || "1k"),
  size_options_json: encodeJson(model.sizeOptions || []),
  extra_aspect_ratios_json: encodeJson(model.extraAspectRatios || []),
  show_size_selector: parseBoolean(model.showSizeSelector, true),
  supports_custom_ratio: parseBoolean(model.supportsCustomRatio, true),
  is_active: parseBoolean(model.isActive, true),
  is_default_model:
    trimToString(model.id) === trimToString(staticCatalog.defaultModelId || ""),
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
  iconKind: trimToString(row.icon_kind || "banana"),
  panelLayout: trimToString(row.panel_layout || "default"),
  sizeBehavior: trimToString(row.size_behavior || "passthrough"),
  defaultSize: trimToString(row.default_size || "1k"),
  sizeOptions: parseJsonArray(row.size_options_json),
  extraAspectRatios: parseJsonArray(row.extra_aspect_ratios_json),
  showSizeSelector: parseBoolean(row.show_size_selector, true),
  supportsCustomRatio: parseBoolean(row.supports_custom_ratio, true),
  isActive: parseBoolean(row.is_active, true),
  isDefaultModel: parseBoolean(row.is_default_model, false),
  sortOrder: parseInteger(row.sort_order, 0),
  createdAt: row.created_at ? fromDbDateTime(row.created_at) : null,
  updatedAt: row.updated_at ? fromDbDateTime(row.updated_at) : null,
});

const buildCatalogFromModels = (models, { includeInactive = false } = {}) => {
  const visibleModels = includeInactive
    ? [...models]
    : models.filter((model) => model.isActive !== false);
  const sortedModels = [...visibleModels].sort((left, right) => {
    const leftOrder = parseInteger(left.sortOrder, 0);
    const rightOrder = parseInteger(right.sortOrder, 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
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

const ensureImageModelSchema = async () => {
  if (!isMySqlConfigured()) return false;

  if (!modelSchemaPromise) {
    modelSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS image_models (
          model_id VARCHAR(120) PRIMARY KEY,
          label VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          model_family VARCHAR(64) NOT NULL,
          route_family VARCHAR(64) NOT NULL,
          request_model VARCHAR(160) NULL,
          selector_cost DECIMAL(10,1) NOT NULL DEFAULT 0,
          icon_kind VARCHAR(32) NOT NULL DEFAULT 'banana',
          panel_layout VARCHAR(32) NOT NULL DEFAULT 'default',
          size_behavior VARCHAR(32) NOT NULL DEFAULT 'passthrough',
          default_size VARCHAR(16) NOT NULL DEFAULT '1k',
          size_options_json LONGTEXT NOT NULL,
          extra_aspect_ratios_json LONGTEXT NOT NULL,
          show_size_selector TINYINT(1) NOT NULL DEFAULT 1,
          supports_custom_ratio TINYINT(1) NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          is_default_model TINYINT(1) NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          INDEX idx_image_models_active (is_active, sort_order),
          INDEX idx_image_models_request_model (request_model)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      const [selectorCostColumns] = await pool.execute(
        "SHOW COLUMNS FROM image_models LIKE 'selector_cost'",
      );
      const selectorCostType = String(selectorCostColumns?.[0]?.Type || "").toLowerCase();
      if (!/^decimal\(\d+,\s*1\)$/.test(selectorCostType)) {
        await pool.execute(`
          ALTER TABLE image_models
          MODIFY COLUMN selector_cost DECIMAL(10,1) NOT NULL DEFAULT 0
        `);
      }

      await withTransaction(async (connection) => {
        const [countRows] = await connection.execute(
          "SELECT COUNT(*) AS total FROM image_models",
        );
        if (Number(countRows?.[0]?.total || 0) > 0) {
          return;
        }

        const nowDb = toDbDateTime();
        const rows = buildStaticRows();
        for (const row of rows) {
          await connection.execute(
            `
              INSERT INTO image_models (
                model_id, label, description, model_family, route_family,
                request_model, selector_cost, icon_kind, panel_layout, size_behavior,
                default_size, size_options_json, extra_aspect_ratios_json,
                show_size_selector, supports_custom_ratio, is_active,
                is_default_model, sort_order, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              row.model_id,
              row.label,
              row.description,
              row.model_family,
              row.route_family,
              row.request_model,
              row.selector_cost,
              row.icon_kind,
              row.panel_layout,
              row.size_behavior,
              row.default_size,
              row.size_options_json,
              row.extra_aspect_ratios_json,
              row.show_size_selector ? 1 : 0,
              row.supports_custom_ratio ? 1 : 0,
              row.is_active ? 1 : 0,
              row.is_default_model ? 1 : 0,
              row.sort_order,
              nowDb,
              nowDb,
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
  const models = includeInactive ? rows : rows.filter((model) => model.isActive !== false);
  return buildCatalogFromModels(models, { includeInactive });
};

const getImageModelCatalog = async ({ includeInactive = false } = {}) => {
  if (!isMySqlConfigured()) {
    return getStaticCatalog({ includeInactive });
  }

  await ensureImageModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM image_models
      ${includeInactive ? "" : "WHERE is_active = 1"}
      ORDER BY sort_order ASC, label ASC, model_id ASC
    `,
  );

  return buildCatalogFromModels((rows || []).map((row) => mapRowToModel(row)), {
    includeInactive,
  });
};

const getImageModelById = async (modelId, { includeInactive = true } = {}) => {
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) return null;

  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive });
    return catalog.models.find((model) => model.id === modelIdValue) || null;
  }

  await ensureImageModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM image_models
      WHERE model_id = ?
      ${includeInactive ? "" : "AND is_active = 1"}
      LIMIT 1
    `,
    [modelIdValue],
  );

  if (!rows?.[0]) return null;
  return mapRowToModel(rows[0]);
};

const getImageModelByRequestModel = async (
  requestModel,
  { includeInactive = true } = {},
) => {
  const requestModelValue = trimToString(requestModel);
  if (!requestModelValue) return null;

  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive });
    return (
      catalog.models.find(
        (model) =>
          model.id === requestModelValue || model.requestModel === requestModelValue,
      ) || null
    );
  }

  await ensureImageModelSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM image_models
      WHERE (model_id = ? OR request_model = ?)
      ${includeInactive ? "" : "AND is_active = 1"}
      ORDER BY sort_order ASC
      LIMIT 1
    `,
    [requestModelValue, requestModelValue],
  );

  if (!rows?.[0]) return null;
  return mapRowToModel(rows[0]);
};

const requireMySqlModelManagement = async () => {
  if (!isMySqlConfigured()) {
    throw new Error("Image model management requires MySQL storage to be enabled");
  }
  await ensureImageModelSchema();
};

const validateModelPayload = (input = {}, { partial = false } = {}) => {
  const next = {};

  if (!partial || Object.prototype.hasOwnProperty.call(input, "id")) {
    const modelId = trimToString(input.id);
    if (!partial && !modelId) {
      throw new Error("Model ID is required");
    }
    if (modelId) next.model_id = modelId;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "label")) {
    const label = trimToString(input.label);
    if (!partial && !label) {
      throw new Error("Model label is required");
    }
    if (label) next.label = label;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "description")) {
    next.description = trimToNull(input.description);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "modelFamily")) {
    const modelFamily = trimToString(input.modelFamily);
    if (!partial && !modelFamily) {
      throw new Error("Model family is required");
    }
    if (modelFamily) next.model_family = modelFamily;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "routeFamily")) {
    const routeFamily = trimToString(input.routeFamily || "default");
    next.route_family = routeFamily || "default";
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "requestModel")) {
    next.request_model = trimToNull(input.requestModel);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "selectorCost")) {
    next.selector_cost = Math.max(0, parseDecimal(input.selectorCost, 0));
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "iconKind")) {
    const iconKind = trimToString(input.iconKind || "banana");
    if (!VALID_ICON_KINDS.has(iconKind)) {
      throw new Error(`Icon kind must be one of: ${Array.from(VALID_ICON_KINDS).join(", ")}`);
    }
    next.icon_kind = iconKind;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "panelLayout")) {
    const panelLayout = trimToString(input.panelLayout || "default");
    if (!VALID_PANEL_LAYOUTS.has(panelLayout)) {
      throw new Error(
        `Panel layout must be one of: ${Array.from(VALID_PANEL_LAYOUTS).join(", ")}`,
      );
    }
    next.panel_layout = panelLayout;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "sizeBehavior")) {
    const sizeBehavior = trimToString(input.sizeBehavior || "passthrough");
    if (!VALID_SIZE_BEHAVIORS.has(sizeBehavior)) {
      throw new Error(
        `Size behavior must be one of: ${Array.from(VALID_SIZE_BEHAVIORS).join(", ")}`,
      );
    }
    next.size_behavior = sizeBehavior;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "defaultSize")) {
    const defaultSize = trimToString(input.defaultSize || "1k");
    next.default_size = defaultSize || "1k";
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "sizeOptions")) {
    const sizeOptions = normalizeStringArray(input.sizeOptions);
    next.size_options_json = JSON.stringify(sizeOptions);
    if (!partial && sizeOptions.length === 0) {
      throw new Error("At least one size option is required");
    }
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(input, "extraAspectRatios")
  ) {
    next.extra_aspect_ratios_json = JSON.stringify(
      normalizeStringArray(input.extraAspectRatios),
    );
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(input, "showSizeSelector")
  ) {
    next.show_size_selector = parseBoolean(input.showSizeSelector, true) ? 1 : 0;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(input, "supportsCustomRatio")
  ) {
    next.supports_custom_ratio = parseBoolean(input.supportsCustomRatio, true) ? 1 : 0;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "isActive")) {
    next.is_active = parseBoolean(input.isActive, true) ? 1 : 0;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "isDefaultModel")) {
    next.is_default_model = parseBoolean(input.isDefaultModel, false) ? 1 : 0;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "sortOrder")) {
    next.sort_order = parseInteger(input.sortOrder, 0);
  }

  return next;
};

const fetchAdminImageModels = async () => {
  await requireMySqlModelManagement();
  const catalog = await getImageModelCatalog({ includeInactive: true });
  return catalog.models;
};

const createManagedImageModel = async (input = {}) => {
  await requireMySqlModelManagement();
  const payload = validateModelPayload(input, { partial: false });
  const nowDb = toDbDateTime();

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT model_id FROM image_models WHERE model_id = ? LIMIT 1",
      [payload.model_id],
    );
    if (existingRows?.[0]) {
      throw new Error("Model ID already exists");
    }

    if (payload.is_default_model) {
      await connection.execute("UPDATE image_models SET is_default_model = 0");
    }

    await connection.execute(
      `
        INSERT INTO image_models (
          model_id, label, description, model_family, route_family,
          request_model, selector_cost, icon_kind, panel_layout, size_behavior,
          default_size, size_options_json, extra_aspect_ratios_json,
          show_size_selector, supports_custom_ratio, is_active,
          is_default_model, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.model_id,
        payload.label,
        payload.description || null,
        payload.model_family,
        payload.route_family || "default",
        payload.request_model || null,
        payload.selector_cost || 0,
        payload.icon_kind || "banana",
        payload.panel_layout || "default",
        payload.size_behavior || "passthrough",
        payload.default_size || "1k",
        payload.size_options_json || JSON.stringify(["1k"]),
        payload.extra_aspect_ratios_json || JSON.stringify([]),
        payload.show_size_selector ?? 1,
        payload.supports_custom_ratio ?? 1,
        payload.is_active ?? 1,
        payload.is_default_model || 0,
        payload.sort_order || 0,
        nowDb,
        nowDb,
      ],
    );

    const [rows] = await connection.execute(
      "SELECT * FROM image_models WHERE model_id = ? LIMIT 1",
      [payload.model_id],
    );
    return mapRowToModel(rows[0]);
  });
};

const updateManagedImageModel = async (modelId, patch = {}) => {
  await requireMySqlModelManagement();
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) {
    throw new Error("Model ID is required");
  }

  const payload = validateModelPayload(patch, { partial: true });
  delete payload.model_id;
  payload.updated_at = toDbDateTime();

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT * FROM image_models WHERE model_id = ? LIMIT 1 FOR UPDATE",
      [modelIdValue],
    );
    if (!existingRows?.[0]) {
      throw new Error("Image model does not exist");
    }

    if (payload.is_default_model) {
      await connection.execute("UPDATE image_models SET is_default_model = 0");
    }

    const entries = Object.entries(payload);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      await connection.execute(
        `UPDATE image_models SET ${assignments} WHERE model_id = ?`,
        [...entries.map(([, value]) => value), modelIdValue],
      );
    }

    const [rows] = await connection.execute(
      "SELECT * FROM image_models WHERE model_id = ? LIMIT 1",
      [modelIdValue],
    );
    return mapRowToModel(rows[0]);
  });
};

const deleteManagedImageModel = async (modelId) => {
  await requireMySqlModelManagement();
  const modelIdValue = trimToString(modelId);
  if (!modelIdValue) {
    throw new Error("Model ID is required");
  }

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT * FROM image_models WHERE model_id = ? LIMIT 1 FOR UPDATE",
      [modelIdValue],
    );
    const existing = existingRows?.[0];
    if (!existing) {
      throw new Error("Image model does not exist");
    }

    const deletingDefault = parseBoolean(existing.is_default_model, false);
    await connection.execute("DELETE FROM image_models WHERE model_id = ?", [modelIdValue]);

    const [remainingRows] = await connection.execute(
      `
        SELECT *
        FROM image_models
        ORDER BY is_active DESC, sort_order ASC, label ASC, model_id ASC
      `,
    );

    const hasDefault = (remainingRows || []).some((row) =>
      parseBoolean(row.is_default_model, false),
    );
    if (deletingDefault || !hasDefault) {
      const fallback =
        (remainingRows || []).find((row) => parseBoolean(row.is_active, true)) ||
        remainingRows?.[0] ||
        null;
      if (fallback?.model_id) {
        await connection.execute(
          "UPDATE image_models SET is_default_model = CASE WHEN model_id = ? THEN 1 ELSE 0 END",
          [fallback.model_id],
        );
      }
    }

    return true;
  });
};

module.exports = {
  createManagedImageModel,
  deleteManagedImageModel,
  ensureImageModelSchema,
  fetchAdminImageModels,
  getImageModelById,
  getImageModelByRequestModel,
  getImageModelCatalog,
  updateManagedImageModel,
};
