const staticCatalog = require("./config/imageRoutes.json");
const { toNonNegativePoint } = require("./pointMath.cjs");
const {
  fromDbDateTime,
  getPool,
  isMySqlConfigured,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");

const VALID_TRANSPORTS = new Set(["openai-image", "gemini-native"]);
const VALID_MODES = new Set(["async", "sync"]);

const trimToString = (value = "") => String(value ?? "").trim();
const trimToNull = (value = "") => {
  const trimmed = trimToString(value);
  return trimmed ? trimmed : null;
};
const sanitizeApiKey = (value = "") => {
  const cleaned = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;
  if (/^Bearer\s+/i.test(cleaned)) {
    const token = cleaned.replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
    return token ? `Bearer ${token}` : null;
  }
  return cleaned.replace(/\s+/g, "");
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
const parsePoint = (value, fallback = 0) => toNonNegativePoint(value, fallback);
const trimTrailingSlash = (value = "") => trimToString(value).replace(/\/+$/, "");
const normalizeSizeKey = (value = "") => {
  const normalized = trimToString(value).toLowerCase();
  return ["1k", "2k", "4k"].includes(normalized) ? normalized : "";
};
const normalizeSizeOverrides = (value) => {
  let source = value;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return {};
    try {
      source = JSON.parse(trimmed);
    } catch (error) {
      return {};
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const next = {};
  for (const [rawKey, rawEntry] of Object.entries(source)) {
    const key = normalizeSizeKey(rawKey);
    if (!key || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const upstreamModel = trimToString(rawEntry.upstreamModel || "");
    const pointCostRaw = rawEntry.pointCost;
    const pointCost =
      pointCostRaw === null || pointCostRaw === undefined || pointCostRaw === ""
        ? null
        : parsePoint(pointCostRaw, 0);

    const entry = {};
    if (upstreamModel) {
      entry.upstreamModel = upstreamModel;
    }
    if (pointCost !== null) {
      entry.pointCost = pointCost;
    }
    if (entry.upstreamModel || Number.isFinite(entry.pointCost)) {
      next[key] = entry;
    }
  }

  return next;
};
const stringifySizeOverrides = (value) => {
  const normalized = normalizeSizeOverrides(value);
  return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
};
const hasSizeOverrideModel = (value) =>
  Object.values(normalizeSizeOverrides(value)).some((entry) => trimToString(entry.upstreamModel || ""));

const normalizeStaticRoute = (route, index) => ({
  route_id: trimToString(route.id),
  label: trimToString(route.label || route.id),
  description: trimToNull(route.description),
  model_family: trimToString(route.modelFamily || "default"),
  line_value: trimToString(route.line || `line${index + 1}`),
  transport: trimToString(route.transport || "openai-image"),
  mode: trimToString(route.mode || "async"),
  base_url: trimTrailingSlash(route.baseUrl),
  generate_path: trimToString(route.generatePath || "/v1/images/generations"),
  task_path: trimToNull(route.taskPath),
  edit_path: trimToNull(route.editPath),
  chat_path: trimToNull(route.chatPath),
  upstream_model: trimToNull(route.upstreamModel),
  use_request_model: parseBoolean(route.useRequestModel, false),
  allow_user_api_key_without_login: parseBoolean(route.allowUserApiKeyWithoutLogin, false),
  api_key: null,
  api_key_env: trimToNull(route.apiKeyEnv),
  point_cost: parsePoint(route.pointCost, 0),
  size_overrides: stringifySizeOverrides(route.sizeOverrides),
  sort_order: index,
  is_active: true,
  is_default_route:
    trimToString(route.id) === trimToString(staticCatalog.defaultRouteId || ""),
  is_default_nano_banana_line:
    trimToString(route.modelFamily) === "nano-banana" &&
    trimToString(route.line) === trimToString(staticCatalog.defaultNanoBananaLine || ""),
  created_at: null,
  updated_at: null,
});

const buildStaticRows = () =>
  Array.isArray(staticCatalog.routes)
    ? staticCatalog.routes.map((route, index) => normalizeStaticRoute(route, index))
    : [];

const getStaticRouteDefaults = (routeId) =>
  buildStaticRows().find((row) => trimToString(row.route_id) === trimToString(routeId)) || null;

const getMergedSizeOverrides = (row) => ({
  ...normalizeSizeOverrides(getStaticRouteDefaults(row.route_id)?.size_overrides),
  ...normalizeSizeOverrides(row.size_overrides),
});

const mapRowToRoute = (row, { includeSecrets = false } = {}) => ({
  id: trimToString(row.route_id),
  label: trimToString(row.label || row.route_id),
  description: trimToString(row.description || ""),
  modelFamily: trimToString(row.model_family || "default"),
  line: trimToString(row.line_value || "default"),
  transport: trimToString(row.transport || "openai-image"),
  mode: trimToString(row.mode || "async"),
  baseUrl: trimTrailingSlash(row.base_url || ""),
  generatePath: trimToString(row.generate_path || "/v1/images/generations"),
  taskPath: trimToString(row.task_path || ""),
  editPath: trimToString(row.edit_path || ""),
  chatPath: trimToString(row.chat_path || ""),
  upstreamModel: trimToString(row.upstream_model || ""),
  useRequestModel: parseBoolean(row.use_request_model, false),
  allowUserApiKeyWithoutLogin: parseBoolean(row.allow_user_api_key_without_login, false),
  apiKeyEnv: trimToString(row.api_key_env || ""),
  pointCost: parsePoint(row.point_cost, 0),
  sizeOverrides: getMergedSizeOverrides(row),
  sortOrder: parseInteger(row.sort_order, 0),
  isActive: parseBoolean(row.is_active, true),
  isDefaultRoute: parseBoolean(row.is_default_route, false),
  isDefaultNanoBananaLine: parseBoolean(row.is_default_nano_banana_line, false),
  hasApiKey: Boolean(trimToString(row.api_key || "")),
  createdAt: row.created_at ? fromDbDateTime(row.created_at) : null,
  updatedAt: row.updated_at ? fromDbDateTime(row.updated_at) : null,
  ...(includeSecrets ? { apiKey: trimToString(row.api_key || "") } : {}),
});

const buildCatalogFromRoutes = (routes, { includeInactive = false } = {}) => {
  const visibleRoutes = includeInactive
    ? [...routes]
    : routes.filter((route) => route.isActive !== false);
  const sortedRoutes = [...visibleRoutes].sort((left, right) => {
    const leftOrder = parseInteger(left.sortOrder, 0);
    const rightOrder = parseInteger(right.sortOrder, 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label);
  });
  const activeRoutes = sortedRoutes.filter((route) => route.isActive !== false);

  const defaultRoute =
    activeRoutes.find((route) => route.isDefaultRoute) ||
    activeRoutes.find((route) => route.id === trimToString(staticCatalog.defaultRouteId || "")) ||
    activeRoutes[0] ||
    sortedRoutes.find((route) => route.isDefaultRoute) ||
    sortedRoutes[0] ||
    null;
  const defaultNanoBananaRoute =
    activeRoutes.find(
      (route) => route.modelFamily === "nano-banana" && route.isDefaultNanoBananaLine,
    ) ||
    activeRoutes.find(
      (route) =>
        route.modelFamily === "nano-banana" &&
        route.line === trimToString(staticCatalog.defaultNanoBananaLine || ""),
    ) ||
    activeRoutes.find((route) => route.modelFamily === "nano-banana") ||
    sortedRoutes.find(
      (route) => route.modelFamily === "nano-banana" && route.isDefaultNanoBananaLine,
    ) ||
    sortedRoutes.find((route) => route.modelFamily === "nano-banana") ||
    defaultRoute;

  return {
    defaultRouteId: defaultRoute?.id || trimToString(staticCatalog.defaultRouteId || ""),
    defaultNanoBananaLine:
      defaultNanoBananaRoute?.line ||
      trimToString(staticCatalog.defaultNanoBananaLine || "line1"),
    routes: sortedRoutes,
  };
};

let routeSchemaPromise = null;

const ensureImageRouteSchema = async () => {
  if (!isMySqlConfigured()) return false;

  if (!routeSchemaPromise) {
    routeSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS image_routes (
          route_id VARCHAR(120) PRIMARY KEY,
          label VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          model_family VARCHAR(64) NOT NULL,
          line_value VARCHAR(64) NOT NULL,
          transport VARCHAR(32) NOT NULL,
          mode VARCHAR(16) NOT NULL,
          base_url VARCHAR(255) NOT NULL,
          generate_path VARCHAR(255) NOT NULL,
          task_path VARCHAR(255) NULL,
          edit_path VARCHAR(255) NULL,
          chat_path VARCHAR(255) NULL,
          upstream_model VARCHAR(160) NULL,
          use_request_model TINYINT(1) NOT NULL DEFAULT 0,
          allow_user_api_key_without_login TINYINT(1) NOT NULL DEFAULT 0,
          api_key LONGTEXT NULL,
          api_key_env VARCHAR(128) NULL,
          point_cost DECIMAL(10,1) NOT NULL DEFAULT 0,
          size_overrides LONGTEXT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          is_default_route TINYINT(1) NOT NULL DEFAULT 0,
          is_default_nano_banana_line TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          INDEX idx_image_routes_active (is_active, sort_order),
          INDEX idx_image_routes_family_line (model_family, line_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      const [allowUserKeyColumns] = await pool.execute(
        "SHOW COLUMNS FROM image_routes LIKE 'allow_user_api_key_without_login'",
      );
      if (!allowUserKeyColumns?.length) {
        await pool.execute(`
          ALTER TABLE image_routes
          ADD COLUMN allow_user_api_key_without_login TINYINT(1) NOT NULL DEFAULT 0
            AFTER use_request_model
        `);
      }
      const [sizeOverrideColumns] = await pool.execute(
        "SHOW COLUMNS FROM image_routes LIKE 'size_overrides'",
      );
      if (!sizeOverrideColumns?.length) {
        await pool.execute(`
          ALTER TABLE image_routes
          ADD COLUMN size_overrides LONGTEXT NULL
            AFTER point_cost
        `);
      }
      const [pointCostColumns] = await pool.execute(
        "SHOW COLUMNS FROM image_routes LIKE 'point_cost'",
      );
      const pointCostType = String(pointCostColumns?.[0]?.Type || "").toLowerCase();
      if (!/^decimal\(\d+,\s*1\)$/.test(pointCostType)) {
        await pool.execute(`
          ALTER TABLE image_routes
          MODIFY COLUMN point_cost DECIMAL(10,1) NOT NULL DEFAULT 0
        `);
      }
      await pool.execute(
        `
          UPDATE image_routes
          SET allow_user_api_key_without_login = 1
          WHERE transport = 'openai-image'
            AND mode = 'async'
            AND LOWER(base_url) LIKE '%api.bltcy.ai%'
        `,
      );

      await withTransaction(async (connection) => {
        const [countRows] = await connection.execute(
          "SELECT COUNT(*) AS total FROM image_routes",
        );
        if (Number(countRows?.[0]?.total || 0) > 0) {
          return;
        }

        const nowDb = toDbDateTime();
        const rows = buildStaticRows();
        for (const row of rows) {
          await connection.execute(
            `
              INSERT INTO image_routes (
                route_id, label, description, model_family, line_value,
                transport, mode, base_url, generate_path, task_path,
                edit_path, chat_path, upstream_model, use_request_model,
                allow_user_api_key_without_login,
                api_key, api_key_env, point_cost, size_overrides, sort_order, is_active,
                is_default_route, is_default_nano_banana_line, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              row.route_id,
              row.label,
              row.description,
              row.model_family,
              row.line_value,
              row.transport,
              row.mode,
              row.base_url,
              row.generate_path,
              row.task_path,
              row.edit_path,
              row.chat_path,
              row.upstream_model,
              row.use_request_model ? 1 : 0,
              row.allow_user_api_key_without_login ? 1 : 0,
              row.api_key,
              row.api_key_env,
              row.point_cost,
              row.size_overrides,
              row.sort_order,
              row.is_active ? 1 : 0,
              row.is_default_route ? 1 : 0,
              row.is_default_nano_banana_line ? 1 : 0,
              nowDb,
              nowDb,
            ],
          );
        }
      });
    })();
  }

  await routeSchemaPromise;
  return true;
};

const getStaticCatalog = ({ includeInactive = false, includeSecrets = false } = {}) => {
  const rows = buildStaticRows().map((row) => mapRowToRoute(row, { includeSecrets }));
  const routes = includeInactive ? rows : rows.filter((route) => route.isActive !== false);
  return buildCatalogFromRoutes(routes, { includeInactive });
};

const getImageRouteCatalog = async ({
  includeInactive = false,
  includeSecrets = false,
} = {}) => {
  if (!isMySqlConfigured()) {
    return getStaticCatalog({ includeInactive, includeSecrets });
  }

  await ensureImageRouteSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM image_routes
      ${includeInactive ? "" : "WHERE is_active = 1"}
      ORDER BY sort_order ASC, label ASC, route_id ASC
    `,
  );

  const mapped = (rows || []).map((row) => mapRowToRoute(row, { includeSecrets }));
  return buildCatalogFromRoutes(mapped, { includeInactive });
};

const getImageRouteById = async (
  routeId,
  { includeInactive = true, includeSecrets = false } = {},
) => {
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) return null;

  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive, includeSecrets });
    return catalog.routes.find((route) => route.id === routeIdValue) || null;
  }

  await ensureImageRouteSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM image_routes
      WHERE route_id = ?
      ${includeInactive ? "" : "AND is_active = 1"}
      LIMIT 1
    `,
    [routeIdValue],
  );
  if (!rows?.[0]) return null;
  return mapRowToRoute(rows[0], { includeSecrets });
};

const getImageRoutePricing = async () => {
  const catalog = await getImageRouteCatalog();
  return catalog.routes.map((route) => ({
    routeId: route.id,
    label: route.label,
    line: route.line,
    modelFamily: route.modelFamily,
    mode: route.mode,
    transport: route.transport,
    pointCost: route.pointCost,
  }));
};

const requireMySqlRouteManagement = async () => {
  if (!isMySqlConfigured()) {
    throw new Error("Route management requires MySQL storage to be enabled");
  }
  await ensureImageRouteSchema();
};

const validateRoutePayload = (input = {}, { partial = false } = {}) => {
  const next = {};

  if (!partial || Object.prototype.hasOwnProperty.call(input, "id")) {
    const routeId = trimToString(input.id);
    if (!partial && !routeId) {
      throw new Error("Route ID is required");
    }
    if (routeId) next.route_id = routeId;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "label")) {
    const label = trimToString(input.label);
    if (!partial && !label) {
      throw new Error("Route label is required");
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

  if (!partial || Object.prototype.hasOwnProperty.call(input, "line")) {
    const line = trimToString(input.line);
    if (!partial && !line) {
      throw new Error("Route line is required");
    }
    if (line) next.line_value = line;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "transport")) {
    const transport = trimToString(input.transport || "openai-image");
    if (!VALID_TRANSPORTS.has(transport)) {
      throw new Error("Transport must be openai-image or gemini-native");
    }
    next.transport = transport;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "mode")) {
    const mode = trimToString(input.mode || "async");
    if (!VALID_MODES.has(mode)) {
      throw new Error("Mode must be async or sync");
    }
    next.mode = mode;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "baseUrl")) {
    const baseUrl = trimTrailingSlash(input.baseUrl);
    if (!partial && !baseUrl) {
      throw new Error("Base URL is required");
    }
    if (baseUrl) next.base_url = baseUrl;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "generatePath")) {
    const generatePath = trimToString(input.generatePath);
    if (!partial && !generatePath) {
      throw new Error("Generate path is required");
    }
    if (generatePath) next.generate_path = generatePath;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "taskPath")) {
    next.task_path = trimToNull(input.taskPath);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "editPath")) {
    next.edit_path = trimToNull(input.editPath);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "chatPath")) {
    next.chat_path = trimToNull(input.chatPath);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "upstreamModel")) {
    next.upstream_model = trimToNull(input.upstreamModel);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "useRequestModel")) {
    next.use_request_model = parseBoolean(input.useRequestModel, false) ? 1 : 0;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(input, "allowUserApiKeyWithoutLogin")
  ) {
    next.allow_user_api_key_without_login = parseBoolean(
      input.allowUserApiKeyWithoutLogin,
      false,
    )
      ? 1
      : 0;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "apiKeyEnv")) {
    next.api_key_env = trimToNull(input.apiKeyEnv);
  }

  if (Object.prototype.hasOwnProperty.call(input, "apiKey")) {
    next.api_key = sanitizeApiKey(input.apiKey);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "pointCost")) {
    next.point_cost = parsePoint(input.pointCost, 0);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "sizeOverrides")) {
    next.size_overrides = stringifySizeOverrides(input.sizeOverrides);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "sortOrder")) {
    next.sort_order = parseInteger(input.sortOrder, 0);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "isActive")) {
    next.is_active = parseBoolean(input.isActive, true) ? 1 : 0;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(input, "isDefaultRoute")) {
    next.is_default_route = parseBoolean(input.isDefaultRoute, false) ? 1 : 0;
  }

  if (
    !partial ||
    Object.prototype.hasOwnProperty.call(input, "isDefaultNanoBananaLine")
  ) {
    next.is_default_nano_banana_line = parseBoolean(
      input.isDefaultNanoBananaLine,
      false,
    )
      ? 1
      : 0;
  }

  return next;
};

const validateResolvedRouteConfig = (payload) => {
  const transport = trimToString(payload.transport || "openai-image");
  const mode = trimToString(payload.mode || "async");
  const generatePath = trimToString(payload.generate_path || "");
  const lowerGeneratePath = generatePath.toLowerCase();
  const hasModelPlaceholder = generatePath.includes("{model}");
  const upstreamModel = trimToString(payload.upstream_model || "");
  const useRequestModel = parseBoolean(payload.use_request_model, false);
  const allowUserApiKeyWithoutLogin = parseBoolean(
    payload.allow_user_api_key_without_login,
    false,
  );
  const sizeOverrides = normalizeSizeOverrides(payload.size_overrides);
  const taskPath = trimToString(payload.task_path || "");

  if (transport === "openai-image") {
    if (hasModelPlaceholder || lowerGeneratePath.includes("generatecontent")) {
      throw new Error(
        "OpenAI image transport cannot use Gemini generateContent paths; switch transport to gemini-native",
      );
    }
    if (mode === "async" && !taskPath) {
      throw new Error("OpenAI image async routes must include taskPath");
    }
  }

  if (transport === "gemini-native") {
    if (mode !== "sync") {
      throw new Error("Gemini native routes currently support sync mode only");
    }
    if (!hasModelPlaceholder) {
      throw new Error("Gemini native routes must include {model} in generatePath");
    }
    if (!useRequestModel && !upstreamModel && !hasSizeOverrideModel(sizeOverrides)) {
      throw new Error(
        "Gemini native routes must define upstreamModel, configure size override models, or enable useRequestModel",
      );
    }
  }

  if (allowUserApiKeyWithoutLogin && (transport !== "openai-image" || mode !== "async")) {
    throw new Error(
      "Direct user API key without login is supported on OpenAI async image routes only",
    );
  }
};

const fetchAdminRoutes = async () => {
  await requireMySqlRouteManagement();
  const catalog = await getImageRouteCatalog({
    includeInactive: true,
    includeSecrets: false,
  });
  return catalog.routes;
};

const createManagedImageRoute = async (input = {}) => {
  await requireMySqlRouteManagement();
  const payload = validateRoutePayload(input, { partial: false });
  validateResolvedRouteConfig(payload);
  const nowDb = toDbDateTime();

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT route_id FROM image_routes WHERE route_id = ? LIMIT 1",
      [payload.route_id],
    );
    if (existingRows?.[0]) {
      throw new Error("Route ID already exists");
    }

    const [duplicateRows] = await connection.execute(
      `
        SELECT route_id
        FROM image_routes
        WHERE model_family = ? AND line_value = ?
        LIMIT 1
      `,
      [payload.model_family, payload.line_value],
    );
    if (duplicateRows?.[0]) {
      throw new Error("The same model family and line already exist");
    }

    if (payload.is_default_route) {
      await connection.execute(
        "UPDATE image_routes SET is_default_route = 0 WHERE model_family = ?",
        [payload.model_family],
      );
    }

    if (payload.is_default_nano_banana_line) {
      await connection.execute(
        "UPDATE image_routes SET is_default_nano_banana_line = 0 WHERE model_family = 'nano-banana'",
      );
    }

    await connection.execute(
      `
        INSERT INTO image_routes (
          route_id, label, description, model_family, line_value,
          transport, mode, base_url, generate_path, task_path,
          edit_path, chat_path, upstream_model, use_request_model,
          allow_user_api_key_without_login,
          api_key, api_key_env, point_cost, size_overrides, sort_order, is_active,
          is_default_route, is_default_nano_banana_line, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.route_id,
        payload.label,
        payload.description || null,
        payload.model_family,
        payload.line_value,
        payload.transport,
        payload.mode,
        payload.base_url,
        payload.generate_path,
        payload.task_path || null,
        payload.edit_path || null,
        payload.chat_path || null,
        payload.upstream_model || null,
        payload.use_request_model || 0,
        payload.allow_user_api_key_without_login || 0,
        payload.api_key || null,
        payload.api_key_env || null,
        payload.point_cost || 0,
        payload.size_overrides || null,
        payload.sort_order || 0,
        payload.is_active ?? 1,
        payload.is_default_route || 0,
        payload.is_default_nano_banana_line || 0,
        nowDb,
        nowDb,
      ],
    );

    const [rows] = await connection.execute(
      "SELECT * FROM image_routes WHERE route_id = ? LIMIT 1",
      [payload.route_id],
    );
    return mapRowToRoute(rows[0], { includeSecrets: false });
  });
};

const updateManagedImageRoute = async (routeId, patch = {}) => {
  await requireMySqlRouteManagement();
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) {
    throw new Error("Route ID is required");
  }

  const payload = validateRoutePayload(patch, { partial: true });
  delete payload.route_id;
  payload.updated_at = toDbDateTime();

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT * FROM image_routes WHERE route_id = ? LIMIT 1 FOR UPDATE",
      [routeIdValue],
    );
    if (!existingRows?.[0]) {
      throw new Error("Route does not exist");
    }

    const nextModelFamily = trimToString(payload.model_family || existingRows[0].model_family || "");
    const nextLineValue = trimToString(payload.line_value || existingRows[0].line_value || "");
    validateResolvedRouteConfig({
      ...existingRows[0],
      ...payload,
      model_family: nextModelFamily,
      line_value: nextLineValue,
    });
    const [duplicateRows] = await connection.execute(
      `
        SELECT route_id
        FROM image_routes
        WHERE model_family = ? AND line_value = ? AND route_id <> ?
        LIMIT 1
      `,
      [nextModelFamily, nextLineValue, routeIdValue],
    );
    if (duplicateRows?.[0]) {
      throw new Error("The same model family and line already exist");
    }

    if (payload.is_default_route) {
      await connection.execute(
        "UPDATE image_routes SET is_default_route = 0 WHERE model_family = ?",
        [nextModelFamily],
      );
    }

    if (payload.is_default_nano_banana_line) {
      const family = nextModelFamily;
      if (family !== "nano-banana") {
        throw new Error("Only nano-banana routes can be set as default line");
      }
      await connection.execute(
        "UPDATE image_routes SET is_default_nano_banana_line = 0 WHERE model_family = 'nano-banana'",
      );
    }

    const entries = Object.entries(payload);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      await connection.execute(
        `UPDATE image_routes SET ${assignments} WHERE route_id = ?`,
        [...entries.map(([, value]) => value), routeIdValue],
      );
    }

    const [rows] = await connection.execute(
      "SELECT * FROM image_routes WHERE route_id = ? LIMIT 1",
      [routeIdValue],
    );
    return mapRowToRoute(rows[0], { includeSecrets: false });
  });
};

const deleteManagedImageRoute = async (routeId) => {
  await requireMySqlRouteManagement();
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) {
    throw new Error("Route ID is required");
  }

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute(
      "SELECT * FROM image_routes WHERE route_id = ? LIMIT 1 FOR UPDATE",
      [routeIdValue],
    );
    const existing = existingRows?.[0];
    if (!existing) {
      throw new Error("Route does not exist");
    }

    const family = trimToString(existing.model_family || "");

    const deletingDefaultRoute = parseBoolean(existing.is_default_route, false);
    const deletingDefaultNanoLine = parseBoolean(existing.is_default_nano_banana_line, false);
    await connection.execute("DELETE FROM image_routes WHERE route_id = ?", [routeIdValue]);

    const [remainingRows] = await connection.execute(
      `
        SELECT *
        FROM image_routes
        ORDER BY is_active DESC, sort_order ASC, label ASC, route_id ASC
      `,
    );
    const rows = remainingRows || [];
    const activeFallback = rows.find((row) => parseBoolean(row.is_active, true)) || rows[0] || null;
    const familyRows = rows.filter(
      (row) => trimToString(row.model_family || "") === family,
    );
    const familyFallback =
      familyRows.find((row) => parseBoolean(row.is_active, true)) ||
      familyRows[0] ||
      null;
    const hasDefaultRoute = familyRows.some((row) =>
      parseBoolean(row.is_default_route, false),
    );
    if ((deletingDefaultRoute || !hasDefaultRoute) && familyFallback?.route_id) {
      await connection.execute(
        "UPDATE image_routes SET is_default_route = CASE WHEN route_id = ? THEN 1 ELSE 0 END WHERE model_family = ?",
        [familyFallback.route_id, family],
      );
    }

    const nanoRows = rows.filter(
      (row) => trimToString(row.model_family || "") === "nano-banana",
    );
    const nanoFallback =
      nanoRows.find((row) => parseBoolean(row.is_active, true)) || nanoRows[0] || null;
    const hasDefaultNano = nanoRows.some((row) =>
      parseBoolean(row.is_default_nano_banana_line, false),
    );
    if ((deletingDefaultNanoLine || !hasDefaultNano) && nanoFallback?.route_id) {
      await connection.execute(
        `
          UPDATE image_routes
          SET is_default_nano_banana_line = CASE WHEN route_id = ? THEN 1 ELSE 0 END
          WHERE model_family = 'nano-banana'
        `,
        [nanoFallback.route_id],
      );
    }

    return true;
  });
};

module.exports = {
  createManagedImageRoute,
  deleteManagedImageRoute,
  ensureImageRouteSchema,
  fetchAdminRoutes,
  getImageRouteById,
  getImageRouteCatalog,
  getImageRoutePricing,
  updateManagedImageRoute,
};
