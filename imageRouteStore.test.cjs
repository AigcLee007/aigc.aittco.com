const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const createManagedCatalogHarness = (overrides = {}) => {
  const catalog = require("./config/imageRoutes.json");
  const rows = catalog.routes.map((route) => ({
    route_id: route.id, label: route.label, model_family: route.modelFamily,
    line_value: route.line, transport: route.transport, mode: route.mode,
    base_url: route.baseUrl, generate_path: route.generatePath,
    task_path: route.taskPath, edit_path: route.editPath, upstream_model: route.upstreamModel,
    api_key_env: route.apiKeyEnv, api_key: "managed-key", point_cost: route.pointCost,
    size_overrides: JSON.stringify(route.sizeOverrides || {}), is_active: 1,
    is_default_route: route.isDefaultRoute ? 1 : 0,
    is_default_nano_banana_line: 0, updated_at: "2026-11-01 00:00:00.000",
    ...(route.id === "seedream-5.5-mouxihub" ? overrides : {}),
  }));
  const changes = [];
  const execute = async (sql, params = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("CREATE TABLE")) return [{}];
    if (text.startsWith("SHOW COLUMNS")) return [[{ Type: "decimal(10,1)" }]];
    if (text.startsWith("SELECT")) {
      return [rows.filter((row) => !text.includes("WHERE route_id = ?") || row.route_id === params[0])
        .map((row) => ({ ...row }))];
    }
    // Execute bound equality updates against persisted rows, including their WHERE guards.
    const update = text.match(/^UPDATE image_routes SET (.+?) WHERE (.+)$/);
    if (update) {
      const assignments = update[1].split(", ").map((term) => term.match(/^(\w+) = \?$/)?.[1]);
      const conditions = update[2].split(" AND ").map((term) => term.match(/^(\w+) = \?$/)?.[1]);
      assert.ok(assignments.every(Boolean) && conditions.every(Boolean), `Unsupported SQL: ${text}`);
      assert.equal(params.length, assignments.length + conditions.length);
      let affectedRows = 0;
      for (const row of rows) {
        if (!conditions.every((key, index) => row[key] === params[assignments.length + index])) continue;
        assignments.forEach((key, index) => { row[key] = params[index]; });
        changes.push({ routeId: row.route_id, columns: assignments });
        affectedRows++;
      }
      return [{ affectedRows }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };
  const db = {
    isMySqlConfigured: () => true,
    getPool: async () => ({ execute }),
    withTransaction: async (runner) => runner({ execute }),
    toDbDateTime: () => "2026-11-19 00:00:00.000",
    fromDbDateTime: (value) => value,
  };
  const loadStore = () => {
    const filename = path.join(__dirname, "imageRouteStore.cjs");
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      module, exports: module.exports,
      require: (name) => name === "./db.cjs" ? db : localRequire(name),
    }, { filename });
    return module.exports;
  };
  return { loadStore, changes, rows };
};

describe("Seedream Mouxihub managed catalog upgrade", () => {
  it("repairs a pre-existing database route before catalog reads and upstream resolution", async () => {
    const harness = createManagedCatalogHarness({
      label: "眸析云", line_value: "眸析云", upstream_model: "seedream-5.5",
      point_cost: 7, is_default_route: 1,
    });
    const store = harness.loadStore();
    const catalog = await store.getImageRouteCatalog();
    const publicRoute = catalog.routes.find((route) => route.id === "seedream-5.5-mouxihub");
    expect(publicRoute).toMatchObject({ label: "官转线路", line: "官转线路", upstreamModel: "seedream-v5.5" });
    const route = await store.getImageRouteById(publicRoute.id, { includeSecrets: true });
    expect(route).toMatchObject({ upstreamModel: "seedream-v5.5", apiKey: "managed-key", pointCost: 7, isDefaultRoute: true });
    expect(route.sizeOverrides["2k"].inputImagePointCost).toBe(1.25);
    expect(harness.changes.every((change) => change.routeId === route.id)).toBe(true);
    const writes = harness.changes.length;
    await harness.loadStore().ensureImageRouteSchema();
    expect(harness.changes.length).toBe(writes);
  });

  it("repairs only legacy fields while preserving an administrator's custom name and disabled state", async () => {
    const { loadStore } = createManagedCatalogHarness({
      label: "我的专线", line_value: "官转线路", upstream_model: "seedream-5.5", is_active: 0,
    });
    const route = await loadStore().getImageRouteById("seedream-5.5-mouxihub");
    expect(route).toMatchObject({ label: "我的专线", line: "官转线路", upstreamModel: "seedream-v5.5", isActive: false });
  });

  it("preserves custom models and the same route ID repointed to another provider", async () => {
    for (const overrides of [
      { label: "自定义名称", line_value: "自定义线路", upstream_model: "custom-model" },
      { label: "眸析云", line_value: "眸析云", upstream_model: "seedream-5.5", base_url: "https://other.example" },
    ]) {
      const { loadStore, changes } = createManagedCatalogHarness(overrides);
      const route = await loadStore().getImageRouteById("seedream-5.5-mouxihub");
      expect(route).toMatchObject({ label: overrides.label, line: overrides.line_value, upstreamModel: overrides.upstream_model });
      expect(changes).toHaveLength(0);
    }
  });
});

describe("image route store schema seeding", () => {
  it("adds only static routes missing from the managed catalog", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageRouteStore.cjs"), "utf8");

    assert.ok(source.includes("const missingRows = getMissingStaticRows("));
    assert.ok(source.includes('SELECT route_id, model_family, line_value, is_default_route, is_default_nano_banana_line FROM image_routes'));
  });

  it("skips existing IDs and family-line duplicates without changing existing defaults", () => {
    const { getMissingStaticRows } = require("./imageRouteStore.cjs");
    const existingRows = [
      { route_id: "managed", model_family: "seedream", line_value: "SD专线", is_default_route: 1 },
      { route_id: "custom", model_family: "seedream", line_value: "自定义", is_default_route: 0 },
    ];
    const staticRows = [
      { route_id: "managed", model_family: "seedream", line_value: "renamed", is_default_route: 0 },
      { route_id: "new-id-same-line", model_family: "seedream", line_value: "SD专线", is_default_route: 0 },
      { route_id: "new-default", model_family: "seedream", line_value: "稳定线路", is_default_route: 1 },
      { route_id: "new-family-default", model_family: "another", line_value: "默认", is_default_route: 1 },
    ];

    const missing = getMissingStaticRows(staticRows, existingRows);

    assert.deepEqual(missing.map((row) => row.route_id), ["new-default", "new-family-default"]);
    assert.equal(missing[0].is_default_route, false);
    assert.equal(missing[1].is_default_route, true);
    assert.equal(existingRows[0].is_default_route, 1);
    assert.equal(staticRows[2].is_default_route, 1);
  });

  it("does not import duplicate family-line pairs from the static catalog", () => {
    const { getMissingStaticRows } = require("./imageRouteStore.cjs");
    const staticRows = [
      { route_id: "first", model_family: "seedream", line_value: "稳定线路", is_default_route: 0 },
      { route_id: "second", model_family: "seedream", line_value: "稳定线路", is_default_route: 0 },
    ];

    assert.deepEqual(
      getMissingStaticRows(staticRows, []).map((row) => row.route_id),
      ["first"],
    );
  });

  it("restores the deleted Seedream-5-pro stable route from the runtime catalog", () => {
    const { getMissingStaticRows } = require("./imageRouteStore.cjs");
    const route = require("./config/imageRoutes.json").routes.find(
      (item) => item.id === "seedream-5-pro-visionary-stable",
    );
    assert.ok(route);

    const missingRows = getMissingStaticRows(
      [{
        ...route,
        route_id: route.id,
        model_family: route.modelFamily,
        line_value: route.line,
        is_default_route: route.isDefaultRoute ? 1 : 0,
        is_default_nano_banana_line: 0,
      }],
      [{
        route_id: "seedream-5-pro-default",
        model_family: "seedream-5-pro",
        line_value: "线路一",
        is_default_route: 0,
      }],
    );

    expect(missingRows).toHaveLength(1);
    expect(missingRows[0]).toMatchObject({
      route_id: "seedream-5-pro-visionary-stable",
      model_family: "seedream-5-pro",
      line_value: "稳定线路",
      baseUrl: "https://api.visionary.beer",
      upstreamModel: "seedream-5.0-pro",
      apiKeyEnv: "Nanobananapro_visionary",
    });
  });

  it("normalizes mapped VISON routes through the compatibility layer", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageRouteStore.cjs"), "utf8");

    assert.ok(
      source.includes('require("./imageRouteCompatibility.cjs")'),
      "image route store must load the compatibility layer",
    );
    assert.ok(
      source.includes("normalizeImageRouteCompatibility({"),
      "mapped database routes must pass through the compatibility layer",
    );
  });

  it("preserves per-family default route metadata in the static catalog", async () => {
    const mysqlKeys = [
      "MYSQL_URL",
      "MYSQL_HOST",
      "MYSQL_PORT",
      "MYSQL_USER",
      "MYSQL_PASSWORD",
      "MYSQL_DATABASE",
      "MYSQL_CONNECTION_LIMIT",
    ];
    const previousValues = Object.fromEntries(mysqlKeys.map((key) => [key, process.env[key]]));
    mysqlKeys.forEach((key) => {
      process.env[key] = "";
    });

    try {
      const { getImageRouteCatalog } = require("./imageRouteStore.cjs");
      const catalog = await getImageRouteCatalog();
      const flare = catalog.routes.find((route) => route.id === "gpt-image-2.5-flare-stable");

      assert.equal(flare?.isDefaultRoute, true);
    } finally {
      mysqlKeys.forEach((key) => {
        if (previousValues[key] === undefined) delete process.env[key];
        else process.env[key] = previousValues[key];
      });
    }
  });

  it("retains a per-size API key environment mapping from the static route catalog", async () => {
    const mysqlKeys = [
      "MYSQL_URL",
      "MYSQL_HOST",
      "MYSQL_PORT",
      "MYSQL_USER",
      "MYSQL_PASSWORD",
      "MYSQL_DATABASE",
      "MYSQL_CONNECTION_LIMIT",
    ];
    const previousValues = Object.fromEntries(mysqlKeys.map((key) => [key, process.env[key]]));
    mysqlKeys.forEach((key) => {
      process.env[key] = "";
    });

    try {
      const { getImageRouteById } = require("./imageRouteStore.cjs");
      const route = await getImageRouteById("gpt-image-2.6-sunburst-mouxihub");
      expect(route.sizeOverrides["4k"].apiKeyEnv).toBe("GPT-image-2.6-sunburst_mouxihub_4k");
    } finally {
      mysqlKeys.forEach((key) => {
        if (previousValues[key] === undefined) delete process.env[key];
        else process.env[key] = previousValues[key];
      });
    }
  });

  it("merges persisted size prices without dropping static size-specific API keys", () => {
    const { mergeSizeOverrides, upgradeSizeOverridePointCost } = require("./imageRouteStore.cjs");
    const upgraded = upgradeSizeOverridePointCost({
      "1k": { pointCost: 4 },
      "2k": { pointCost: 4 },
      "4k": { pointCost: 4, apiKeyEnv: "GPT-image-2.6-sunburst_mouxihub_4k" },
    }, "4k", 4, 6);
    expect(upgraded).toEqual({
      "1k": { pointCost: 4 },
      "2k": { pointCost: 4 },
      "4k": { pointCost: 6, apiKeyEnv: "GPT-image-2.6-sunburst_mouxihub_4k" },
    });
    expect(upgradeSizeOverridePointCost({ "4k": { pointCost: 5 } }, "4k", 4, 6)).toBeNull();
    expect(mergeSizeOverrides(
      { "4k": { pointCost: 6, apiKeyEnv: "GPT-image-2.6-sunburst_mouxihub_4k" } },
      upgraded["4k"],
    )).toEqual({
      "4k": { pointCost: 6, apiKeyEnv: "GPT-image-2.6-sunburst_mouxihub_4k" },
    });
  });

  it("preserves fractional per-input-image point rates in size overrides", () => {
    const { mergeSizeOverrides } = require("./imageRouteStore.cjs");
    expect(mergeSizeOverrides(
      JSON.stringify({ "1k": { pointCost: 4, inputImagePointCost: 1.25 } }),
      null,
    )).toEqual({ "1k": { pointCost: 4, inputImagePointCost: 1.25 } });
  });
});

describe("image route result kind", () => {
  it("defaults link-returning upstreams to url and every other upstream to inline", () => {
    const { normalizeResultKind } = require("./imageRouteStore.cjs");
    expect(normalizeResultKind("", "https://api.mouxihub.com")).toBe("url");
    expect(normalizeResultKind(null, "https://api.visionary.beer")).toBe("url");
    expect(normalizeResultKind("", "https://rolldek.com")).toBe("inline");
    expect(normalizeResultKind("", "not a url")).toBe("inline");
  });

  it("keeps an administrator's explicit choice", () => {
    const { normalizeResultKind } = require("./imageRouteStore.cjs");
    expect(normalizeResultKind("inline", "https://api.mouxihub.com")).toBe("inline");
    expect(normalizeResultKind("url", "https://rolldek.com")).toBe("url");
  });
});
