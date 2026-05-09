const staticCatalog = require("./config/videoRoutes.json");
const { toNonNegativePoint } = require("./pointMath.cjs");
const { fromDbDateTime, getPool, isMySqlConfigured, toDbDateTime, withTransaction } = require("./db.cjs");

const VALID_TRANSPORTS = new Set(["openai-video"]);
const VALID_MODES = new Set(["async"]);

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
const trimTrailingSlash = (value = "") => trimToString(value).replace(/\/+$/, "");

const normalizeStaticRoute = (route, index) => ({
  route_id: trimToString(route.id),
  label: trimToString(route.label || route.id),
  description: trimToNull(route.description),
  route_family: trimToString(route.routeFamily || "default"),
  line_value: trimToString(route.line || `line${index + 1}`),
  transport: trimToString(route.transport || "openai-video"),
  mode: trimToString(route.mode || "async"),
  base_url: trimTrailingSlash(route.baseUrl),
  generate_path: trimToString(route.generatePath || "/v2/videos/generations"),
  task_path: trimToNull(route.taskPath || "/v2/videos/generations/{taskId}"),
  upstream_model: trimToNull(route.upstreamModel),
  use_request_model: parseBoolean(route.useRequestModel, false),
  allow_user_api_key_without_login: parseBoolean(route.allowUserApiKeyWithoutLogin, false),
  api_key: null,
  api_key_env: trimToNull(route.apiKeyEnv),
  point_cost: parseDecimal(route.pointCost, 0),
  sort_order: parseInteger(route.sortOrder, index),
  is_active: parseBoolean(route.isActive, true),
  is_default_route: parseBoolean(route.isDefaultRoute, false),
  created_at: null,
  updated_at: null,
});

const buildStaticRows = () =>
  Array.isArray(staticCatalog.routes)
    ? staticCatalog.routes.map((route, index) => normalizeStaticRoute(route, index))
    : [];

const mapRowToRoute = (row, { includeSecrets = false } = {}) => ({
  id: trimToString(row.route_id),
  label: trimToString(row.label || row.route_id),
  description: trimToString(row.description || ""),
  routeFamily: trimToString(row.route_family || "default"),
  line: trimToString(row.line_value || "default"),
  transport: trimToString(row.transport || "openai-video"),
  mode: trimToString(row.mode || "async"),
  baseUrl: trimTrailingSlash(row.base_url || ""),
  generatePath: trimToString(row.generate_path || "/v2/videos/generations"),
  taskPath: trimToString(row.task_path || ""),
  upstreamModel: trimToString(row.upstream_model || ""),
  useRequestModel: parseBoolean(row.use_request_model, false),
  allowUserApiKeyWithoutLogin: parseBoolean(row.allow_user_api_key_without_login, false),
  apiKeyEnv: trimToString(row.api_key_env || ""),
  pointCost: parseDecimal(row.point_cost, 0),
  sortOrder: parseInteger(row.sort_order, 0),
  isActive: parseBoolean(row.is_active, true),
  isDefaultRoute: parseBoolean(row.is_default_route, false),
  hasApiKey: Boolean(trimToString(row.api_key || "")),
  createdAt: row.created_at ? fromDbDateTime(row.created_at) : null,
  updatedAt: row.updated_at ? fromDbDateTime(row.updated_at) : null,
  ...(includeSecrets ? { apiKey: trimToString(row.api_key || "") } : {}),
});

const buildCatalogFromRoutes = (routes, { includeInactive = false } = {}) => {
  const visibleRoutes = includeInactive ? [...routes] : routes.filter((route) => route.isActive !== false);
  const sortedRoutes = [...visibleRoutes].sort((left, right) => {
    if ((left.sortOrder || 0) !== (right.sortOrder || 0)) return (left.sortOrder || 0) - (right.sortOrder || 0);
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

  return {
    defaultRouteId: defaultRoute?.id || trimToString(staticCatalog.defaultRouteId || ""),
    routes: sortedRoutes,
  };
};

let routeSchemaPromise = null;

const ensureVideoRouteSchema = async () => {
  if (!isMySqlConfigured()) return false;
  if (!routeSchemaPromise) {
    routeSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS video_routes (
          route_id VARCHAR(120) PRIMARY KEY,
          label VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          route_family VARCHAR(64) NOT NULL,
          line_value VARCHAR(64) NOT NULL,
          transport VARCHAR(32) NOT NULL,
          mode VARCHAR(16) NOT NULL,
          base_url VARCHAR(255) NOT NULL,
          generate_path VARCHAR(255) NOT NULL,
          task_path VARCHAR(255) NULL,
          upstream_model VARCHAR(160) NULL,
          use_request_model TINYINT(1) NOT NULL DEFAULT 0,
          allow_user_api_key_without_login TINYINT(1) NOT NULL DEFAULT 0,
          api_key LONGTEXT NULL,
          api_key_env VARCHAR(128) NULL,
          point_cost DECIMAL(10,1) NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          is_default_route TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          INDEX idx_video_routes_active (is_active, sort_order),
          INDEX idx_video_routes_family_line (route_family, line_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      const [allowUserKeyColumns] = await pool.execute(
        "SHOW COLUMNS FROM video_routes LIKE 'allow_user_api_key_without_login'",
      );
      if (!allowUserKeyColumns?.length) {
        await pool.execute(`
          ALTER TABLE video_routes
          ADD COLUMN allow_user_api_key_without_login TINYINT(1) NOT NULL DEFAULT 0
            AFTER use_request_model
        `);
      }
      const [pointCostColumns] = await pool.execute(
        "SHOW COLUMNS FROM video_routes LIKE 'point_cost'",
      );
      const pointCostType = String(pointCostColumns?.[0]?.Type || "").toLowerCase();
      if (!/^decimal\(\d+,\s*1\)$/.test(pointCostType)) {
        await pool.execute(`
          ALTER TABLE video_routes
          MODIFY COLUMN point_cost DECIMAL(10,1) NOT NULL DEFAULT 0
        `);
      }
      await pool.execute(
        `
          UPDATE video_routes
          SET allow_user_api_key_without_login = 1
          WHERE transport = 'openai-video'
            AND mode = 'async'
            AND LOWER(base_url) LIKE '%api.bltcy.ai%'
        `,
      );

      await withTransaction(async (connection) => {
        const [countRows] = await connection.execute("SELECT COUNT(*) AS total FROM video_routes");
        if (Number(countRows?.[0]?.total || 0) > 0) return;
        const nowDb = toDbDateTime();
        for (const row of buildStaticRows()) {
          await connection.execute(
            `INSERT INTO video_routes (
              route_id,label,description,route_family,line_value,transport,mode,base_url,generate_path,
              task_path,upstream_model,use_request_model,allow_user_api_key_without_login,api_key,api_key_env,point_cost,sort_order,
              is_active,is_default_route,created_at,updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.route_id, row.label, row.description, row.route_family, row.line_value, row.transport, row.mode,
              row.base_url, row.generate_path, row.task_path, row.upstream_model, row.use_request_model ? 1 : 0,
              row.allow_user_api_key_without_login ? 1 : 0,
              row.api_key, row.api_key_env, row.point_cost, row.sort_order, row.is_active ? 1 : 0,
              row.is_default_route ? 1 : 0, nowDb, nowDb,
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
  return buildCatalogFromRoutes(includeInactive ? rows : rows.filter((route) => route.isActive !== false), { includeInactive });
};

const getVideoRouteCatalog = async ({ includeInactive = false, includeSecrets = false } = {}) => {
  if (!isMySqlConfigured()) return getStaticCatalog({ includeInactive, includeSecrets });
  await ensureVideoRouteSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM video_routes ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY sort_order ASC, label ASC, route_id ASC`,
  );
  return buildCatalogFromRoutes((rows || []).map((row) => mapRowToRoute(row, { includeSecrets })), { includeInactive });
};

const getVideoRouteById = async (routeId, { includeInactive = true, includeSecrets = false } = {}) => {
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) return null;
  if (!isMySqlConfigured()) {
    const catalog = getStaticCatalog({ includeInactive, includeSecrets });
    return catalog.routes.find((route) => route.id === routeIdValue) || null;
  }
  await ensureVideoRouteSchema();
  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM video_routes WHERE route_id = ? ${includeInactive ? "" : "AND is_active = 1"} LIMIT 1`,
    [routeIdValue],
  );
  return rows?.[0] ? mapRowToRoute(rows[0], { includeSecrets }) : null;
};

const requireMySqlVideoRouteManagement = async () => {
  if (!isMySqlConfigured()) throw new Error("Video route management requires MySQL storage to be enabled");
  await ensureVideoRouteSchema();
};

const validateRoutePayload = (input = {}, { partial = false } = {}) => {
  const next = {};
  if (!partial || Object.prototype.hasOwnProperty.call(input, "id")) {
    const value = trimToString(input.id);
    if (!partial && !value) throw new Error("Route ID is required");
    if (value) next.route_id = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "label")) {
    const value = trimToString(input.label);
    if (!partial && !value) throw new Error("Route label is required");
    if (value) next.label = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "description")) next.description = trimToNull(input.description);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "routeFamily")) {
    const value = trimToString(input.routeFamily);
    if (!partial && !value) throw new Error("Route family is required");
    if (value) next.route_family = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "line")) {
    const value = trimToString(input.line);
    if (!partial && !value) throw new Error("Route line is required");
    if (value) next.line_value = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "transport")) {
    const value = trimToString(input.transport || "openai-video");
    if (!VALID_TRANSPORTS.has(value)) throw new Error(`Transport must be one of: ${Array.from(VALID_TRANSPORTS).join(", ")}`);
    next.transport = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "mode")) {
    const value = trimToString(input.mode || "async");
    if (!VALID_MODES.has(value)) throw new Error(`Mode must be one of: ${Array.from(VALID_MODES).join(", ")}`);
    next.mode = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "baseUrl")) {
    const value = trimTrailingSlash(input.baseUrl);
    if (!partial && !value) throw new Error("Base URL is required");
    if (value) next.base_url = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "generatePath")) {
    const value = trimToString(input.generatePath);
    if (!partial && !value) throw new Error("Generate path is required");
    if (value) next.generate_path = value;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "taskPath")) next.task_path = trimToNull(input.taskPath);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "upstreamModel")) next.upstream_model = trimToNull(input.upstreamModel);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "useRequestModel")) next.use_request_model = parseBoolean(input.useRequestModel, false) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "allowUserApiKeyWithoutLogin")) {
    next.allow_user_api_key_without_login = parseBoolean(input.allowUserApiKeyWithoutLogin, false) ? 1 : 0;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(input, "apiKeyEnv")) next.api_key_env = trimToNull(input.apiKeyEnv);
  if (Object.prototype.hasOwnProperty.call(input, "apiKey")) next.api_key = trimToNull(input.apiKey);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "pointCost")) next.point_cost = Math.max(0, parseDecimal(input.pointCost, 0));
  if (!partial || Object.prototype.hasOwnProperty.call(input, "sortOrder")) next.sort_order = parseInteger(input.sortOrder, 0);
  if (!partial || Object.prototype.hasOwnProperty.call(input, "isActive")) next.is_active = parseBoolean(input.isActive, true) ? 1 : 0;
  if (!partial || Object.prototype.hasOwnProperty.call(input, "isDefaultRoute")) next.is_default_route = parseBoolean(input.isDefaultRoute, false) ? 1 : 0;
  return next;
};

const fetchAdminVideoRoutes = async () => {
  await requireMySqlVideoRouteManagement();
  return (await getVideoRouteCatalog({ includeInactive: true })).routes;
};

const createManagedVideoRoute = async (input = {}) => {
  await requireMySqlVideoRouteManagement();
  const payload = validateRoutePayload(input, { partial: false });
  const nowDb = toDbDateTime();
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT route_id FROM video_routes WHERE route_id = ? LIMIT 1", [payload.route_id]);
    if (existingRows?.[0]) throw new Error("Route ID already exists");
    const [duplicateRows] = await connection.execute(
      "SELECT route_id FROM video_routes WHERE route_family = ? AND line_value = ? LIMIT 1",
      [payload.route_family, payload.line_value],
    );
    if (duplicateRows?.[0]) throw new Error("The same route family and line already exist");
    if (payload.is_default_route) {
      await connection.execute("UPDATE video_routes SET is_default_route = 0 WHERE route_family = ?", [payload.route_family]);
    }
    await connection.execute(
      `INSERT INTO video_routes (
        route_id,label,description,route_family,line_value,transport,mode,base_url,generate_path,task_path,
        upstream_model,use_request_model,allow_user_api_key_without_login,api_key,api_key_env,point_cost,sort_order,is_active,is_default_route,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.route_id, payload.label, payload.description || null, payload.route_family, payload.line_value, payload.transport,
        payload.mode, payload.base_url, payload.generate_path, payload.task_path || null, payload.upstream_model || null,
        payload.use_request_model || 0, payload.allow_user_api_key_without_login || 0, payload.api_key || null, payload.api_key_env || null, payload.point_cost || 0,
        payload.sort_order || 0, payload.is_active ?? 1, payload.is_default_route || 0, nowDb, nowDb,
      ],
    );
    const [rows] = await connection.execute("SELECT * FROM video_routes WHERE route_id = ? LIMIT 1", [payload.route_id]);
    return mapRowToRoute(rows[0], { includeSecrets: false });
  });
};

const updateManagedVideoRoute = async (routeId, patch = {}) => {
  await requireMySqlVideoRouteManagement();
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) throw new Error("Route ID is required");
  const payload = validateRoutePayload(patch, { partial: true });
  delete payload.route_id;
  payload.updated_at = toDbDateTime();
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT * FROM video_routes WHERE route_id = ? LIMIT 1 FOR UPDATE", [routeIdValue]);
    if (!existingRows?.[0]) throw new Error("Video route does not exist");
    const nextRouteFamily = trimToString(payload.route_family || existingRows[0].route_family || "");
    const nextLineValue = trimToString(payload.line_value || existingRows[0].line_value || "");
    const [duplicateRows] = await connection.execute(
      "SELECT route_id FROM video_routes WHERE route_family = ? AND line_value = ? AND route_id <> ? LIMIT 1",
      [nextRouteFamily, nextLineValue, routeIdValue],
    );
    if (duplicateRows?.[0]) throw new Error("The same route family and line already exist");
    if (payload.is_default_route) {
      await connection.execute("UPDATE video_routes SET is_default_route = 0 WHERE route_family = ?", [nextRouteFamily]);
    }
    const entries = Object.entries(payload);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      await connection.execute(`UPDATE video_routes SET ${assignments} WHERE route_id = ?`, [...entries.map(([, value]) => value), routeIdValue]);
    }
    const [rows] = await connection.execute("SELECT * FROM video_routes WHERE route_id = ? LIMIT 1", [routeIdValue]);
    return mapRowToRoute(rows[0], { includeSecrets: false });
  });
};

const deleteManagedVideoRoute = async (routeId) => {
  await requireMySqlVideoRouteManagement();
  const routeIdValue = trimToString(routeId);
  if (!routeIdValue) throw new Error("Route ID is required");
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.execute("SELECT * FROM video_routes WHERE route_id = ? LIMIT 1 FOR UPDATE", [routeIdValue]);
    const existing = existingRows?.[0];
    if (!existing) throw new Error("Video route does not exist");
    const family = trimToString(existing.route_family || "");
    const deletingDefault = parseBoolean(existing.is_default_route, false);
    await connection.execute("DELETE FROM video_routes WHERE route_id = ?", [routeIdValue]);
    const [remainingRows] = await connection.execute("SELECT * FROM video_routes WHERE route_family = ? ORDER BY is_active DESC, sort_order ASC, label ASC, route_id ASC", [family]);
    const rows = remainingRows || [];
    const hasDefault = rows.some((row) => parseBoolean(row.is_default_route, false));
    if (deletingDefault || !hasDefault) {
      const fallback = rows.find((row) => parseBoolean(row.is_active, true)) || rows[0] || null;
      if (fallback?.route_id) {
        await connection.execute(
          "UPDATE video_routes SET is_default_route = CASE WHEN route_id = ? THEN 1 ELSE 0 END WHERE route_family = ?",
          [fallback.route_id, family],
        );
      }
    }
    return true;
  });
};

module.exports = {
  createManagedVideoRoute,
  deleteManagedVideoRoute,
  ensureVideoRouteSchema,
  fetchAdminVideoRoutes,
  getVideoRouteById,
  getVideoRouteCatalog,
  updateManagedVideoRoute,
};
