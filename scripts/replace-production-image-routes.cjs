const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { closePool, getPool, isMySqlConfigured, withTransaction } = require("../db.cjs");

const CONFIG_PATH = path.join(__dirname, "../config/production-image-routes.json");
const REQUIRED_ROUTE_COUNT = 23;
const ACTIVE_JOB_STATES = ["queued", "running"];

const validateRouteConfig = (catalog) => {
  if (!Array.isArray(catalog?.routes) || catalog.routes.length !== REQUIRED_ROUTE_COUNT) {
    throw new Error(`Expected exactly ${REQUIRED_ROUTE_COUNT} routes`);
  }
  const ids = new Set();
  const families = new Map();
  for (const route of catalog.routes) {
    if (!route.id || ids.has(route.id)) throw new Error(`Missing or duplicate route ID: ${route.id || "(empty)"}`);
    ids.add(route.id);
    if (!route.modelFamily || !route.apiKeyEnv || !route.baseUrl || !route.generatePath) {
      throw new Error(`Route ${route.id} is missing required configuration`);
    }
    if (!families.has(route.modelFamily)) families.set(route.modelFamily, []);
    families.get(route.modelFamily).push(route);
  }
  for (const [family, routes] of families) {
    if (routes.filter((route) => route.isDefaultRoute === true).length !== 1) {
      throw new Error(`Expected exactly one default route for ${family}`);
    }
  }
  return catalog;
};

const main = async () => {
  const apply = process.argv.includes("--apply");
  if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--apply")) {
    throw new Error("Usage: node scripts/replace-production-image-routes.cjs [--apply]");
  }
  const catalog = validateRouteConfig(JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")));
  if (!isMySqlConfigured()) throw new Error("Run inside the app container with its MySQL environment configured");

  const requiredEnvNames = [...new Set(catalog.routes.map((route) => route.apiKeyEnv))];
  const missingEnvNames = requiredEnvNames.filter((name) => !String(process.env[name] || "").trim());
  if (missingEnvNames.length) throw new Error(`Missing .env variables: ${missingEnvNames.join(", ")}`);

  const pool = await getPool();
  const [modelRows] = await pool.execute(
    "SELECT DISTINCT route_family AS routeFamily FROM image_models WHERE is_active = 1",
  );
  const activeModelFamilies = new Set(modelRows.map((row) => String(row.routeFamily || "").trim()));
  const unmatchedFamilies = [...new Set(catalog.routes.map((route) => route.modelFamily))]
    .filter((family) => !activeModelFamilies.has(family));
  if (unmatchedFamilies.length) {
    throw new Error(`Workbook route families do not match active image models: ${unmatchedFamilies.join(", ")}`);
  }

  const [pendingRows] = await pool.execute(
    "SELECT status, COUNT(*) AS total FROM image_jobs WHERE status IN (?, ?) GROUP BY status",
    ACTIVE_JOB_STATES,
  );
  const pendingCount = pendingRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const [pendingRecordRows] = await pool.execute(
    "SELECT COUNT(*) AS total FROM generation_records WHERE media_type = 'IMAGE' AND status = 'PENDING'",
  );
  const pendingRecordCount = Number(pendingRecordRows[0]?.total || 0);
  if (pendingCount || pendingRecordCount) {
    const summary = pendingRows.map((row) => `${row.status}=${row.total}`).join(", ");
    throw new Error(
      `Pending image work must finish before route replacement: jobs(${summary || "none"}), generationRecords=${pendingRecordCount}`,
    );
  }

  const [existing] = await pool.execute(`
    SELECT route_id AS id, label, description, model_family AS modelFamily, line_value AS line,
      transport, mode, base_url AS baseUrl, generate_path AS generatePath, task_path AS taskPath,
      edit_path AS editPath, chat_path AS chatPath, upstream_model AS upstreamModel,
      use_request_model AS useRequestModel, api_key_env AS apiKeyEnv,
      CASE WHEN LENGTH(TRIM(COALESCE(api_key, ''))) > 0 THEN 1 ELSE 0 END AS hasDatabaseKey,
      point_cost AS pointCost, size_overrides AS sizeOverrides, supported_qualities AS supportedQualities,
      is_active AS isActive, is_default_route AS isDefaultRoute,
      is_default_nano_banana_line AS isDefaultNanoBananaLine
    FROM image_routes ORDER BY model_family, sort_order, route_id
  `);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    currentRouteCount: existing.length,
    targetRouteCount: catalog.routes.length,
    targetFamilies: [...new Set(catalog.routes.map((route) => route.modelFamily))],
    routesWithEnvironmentKeys: requiredEnvNames.length,
    pendingImageJobs: 0,
    pendingGenerationRecords: pendingRecordCount,
  }, null, 2));
  if (!apply) return;

  const backupPath = path.join(os.tmpdir(), `image-routes-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(backupPath, `${JSON.stringify({ routes: existing }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const now = new Date();
  const dbDate = now.toISOString().slice(0, 23).replace("T", " ");
  await withTransaction(async (connection) => {
    await connection.execute("DELETE FROM image_routes");
    for (const route of catalog.routes) {
      await connection.execute(`
        INSERT INTO image_routes (
          route_id, label, description, model_family, line_value, transport, mode,
          base_url, generate_path, task_path, edit_path, chat_path, upstream_model,
          use_request_model, allow_user_api_key_without_login, api_key, api_key_env,
          point_cost, size_overrides, supported_qualities, sort_order, is_active,
          is_default_route, is_default_nano_banana_line, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        route.id, route.label, route.description || null, route.modelFamily, route.line,
        route.transport, route.mode, route.baseUrl, route.generatePath, route.taskPath || null,
        route.editPath || null, route.chatPath || null, route.upstreamModel || null,
        route.useRequestModel ? 1 : 0, route.allowUserApiKeyWithoutLogin ? 1 : 0,
        null, route.apiKeyEnv, route.pointCost || 0,
        route.sizeOverrides ? JSON.stringify(route.sizeOverrides) : null,
        route.supportedQualities ? JSON.stringify(route.supportedQualities) : null,
        route.sortOrder || 0, route.isActive === false ? 0 : 1,
        route.isDefaultRoute ? 1 : 0, route.isDefaultNanoBananaLine ? 1 : 0, dbDate, dbDate,
      ]);
    }
    const [counts] = await connection.execute(`
      SELECT COUNT(*) AS total, COUNT(DISTINCT model_family) AS families,
        SUM(is_default_route) AS defaults FROM image_routes
    `);
    if (Number(counts[0]?.total) !== REQUIRED_ROUTE_COUNT || Number(counts[0]?.defaults) !== 5) {
      throw new Error("Post-import route count/default validation failed; transaction rolled back");
    }
  });
  console.log(JSON.stringify({ result: "applied", backupPath, routeCount: REQUIRED_ROUTE_COUNT }));
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error.message);
    await closePool().catch(() => {});
    process.exitCode = 1;
  }).finally(() => closePool().catch(() => {}));
}

module.exports = { validateRouteConfig };
