const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const catalog = require("./config/production-image-routes.json");
const runtimeCatalog = require("./config/imageRoutes.json");
const { getRequiredApiKeyEnvNames, validateRouteConfig } = require("./scripts/replace-production-image-routes.cjs");

test("production config contains 33 unique routes and one default per family", () => {
  validateRouteConfig(catalog);
  assert.equal(catalog.routes.length, 33);
  assert.equal(new Set(catalog.routes.map((route) => route.modelFamily)).size, 8);
  assert.deepEqual(
    [...new Set(catalog.routes.map((route) => route.modelFamily))].sort(),
    ["gemini-nano-banana-2.1", "gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.6-sunburst", "midjourney-v8.2-tehui", "nano-banana-pro", "seedream-5-pro", "seedream-5.5"],
  );
  assert.ok(catalog.routes.every((route) => !Object.hasOwn(route, "apiKey")));
});

test("Mouxihub and RollDek size-specific model and price variants are retained", () => {
  const banana = catalog.routes.find((route) => route.id === "nano-banana-pro-official-t3");
  const nano21 = catalog.routes.find((route) => route.id === "gemini-nano-banana-2.1-discount");
  assert.equal(banana.sizeOverrides["4k"].upstreamModel, "nano-banana-pro-4k");
  assert.equal(banana.sizeOverrides["4k"].pointCost, 12);
  assert.equal(nano21.upstreamModel, "gemini-nano-banana-2.1");
  assert.equal(nano21.sizeOverrides["2k"].pointCost, 3.5);
});

test("table sync modes and task paths remain independent values", () => {
  const gptRelay = catalog.routes.find((route) => route.id === "gpt-image-2-official-relay-high-quality");
  assert.equal(gptRelay.mode, "sync");
  assert.equal(gptRelay.taskPath, "/v1/images/tasks/{taskId}");
  assert.equal(gptRelay.generatePath, "/v1/images/generations");
});

test("GPT-Image-2.6 Sunburst Mouxihub stable route charges 4 points at 1K/2K and 6 points at 4K", () => {
  const routeId = "gpt-image-2.6-sunburst-mouxihub";
  const productionRoute = catalog.routes.find((item) => item.id === routeId);
  const runtimeRoute = runtimeCatalog.routes.find((item) => item.id === routeId);

  for (const route of [productionRoute, runtimeRoute]) {
    assert.ok(route);
    assert.equal(route.label, "稳定线路");
    assert.equal(route.line, "稳定线路");
    assert.equal(route.modelFamily, "gpt-image-2.6-sunburst");
    assert.equal(route.transport, "openai-image");
    assert.equal(route.mode, "async");
    assert.equal(route.baseUrl, "https://api.mouxihub.com");
    assert.equal(route.generatePath, "/v1/images/generations?async=true");
    assert.equal(route.taskPath, "/v1/images/tasks/{taskId}");
    assert.equal(route.editPath, "/v1/images/edits?async=true");
    assert.equal(route.upstreamModel, "gpt-image-2.6-sunburst");
    assert.equal(route.apiKeyEnv, "GPT-image-2.6-sunburst_mouxihub");
    assert.equal(route.pointCost, 4);
    assert.deepEqual(route.supportedQualities, ["low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(route.sizeOverrides, {
      "1k": { pointCost: 4 },
      "2k": { pointCost: 4 },
      "4k": { pointCost: 6, apiKeyEnv: "GPT-image-2.6-sunburst_mouxihub_4k" },
    });
  }

  assert.ok(getRequiredApiKeyEnvNames(catalog).includes("GPT-image-2.6-sunburst_mouxihub_4k"));
});

test("production Docker image copies the route resolver required by server.cjs", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^COPY imageRouteResolution\.cjs \.\/$/m);
  assert.match(dockerfile, /^COPY visionaryImageApi\.cjs \.\/$/m);
});

test("Gemini route templates retain literal model placeholders", () => {
  const geminiRoutes = catalog.routes.filter((route) => route.transport === "gemini-native");
  assert.ok(geminiRoutes.length > 0);
  assert.ok(geminiRoutes.every((route) => !route.generatePath.includes("%7Bmodel%7D")));
  assert.ok(geminiRoutes.some((route) => route.generatePath.includes("{model}")));
  assert.ok(geminiRoutes.every((route) => route.generatePath.includes("{model}") || route.generatePath.includes(route.upstreamModel)));
});

test("RollDek routes use its API hostname rather than the www website hostname", () => {
  const rollDekRoutes = catalog.routes.filter((route) => route.baseUrl.includes("rolldek"));
  assert.ok(rollDekRoutes.length > 0);
  assert.ok(rollDekRoutes.every((route) => route.baseUrl === "https://rolldek.com"));
});

test("Visionary Nano Banana Pro backup route matches its documented async endpoint and model id", () => {
  const route = catalog.routes.find((item) => item.id === "nano-banana-pro-backup");
  assert.ok(route);
  assert.equal(route.baseUrl, "https://api.visionary.beer");
  assert.equal(route.generatePath, "/v1/images/generations");
  assert.equal(route.taskPath, "/v1/tasks/{taskId}");
  assert.equal(route.upstreamModel, "nano-banana-pro");
  assert.equal(route.mode, "async");
});

test("Visionary Seedream stable route matches the documented model, endpoint, and size pricing", () => {
  const routeId = "seedream-5-pro-visionary-stable";
  const productionRoute = catalog.routes.find((item) => item.id === routeId);
  const runtimeRoute = runtimeCatalog.routes.find((item) => item.id === routeId);

  for (const route of [productionRoute, runtimeRoute]) {
    assert.ok(route);
    assert.equal(route.label, "稳定线路");
    assert.equal(route.line, "稳定线路");
    assert.equal(route.modelFamily, "seedream-5-pro");
    assert.equal(route.baseUrl, "https://api.visionary.beer");
    assert.equal(route.generatePath, "/v1/images/generations");
    assert.equal(route.taskPath, "/v1/tasks/{taskId}");
    assert.equal(route.upstreamModel, "seedream-5.0-pro");
    assert.equal(route.apiKeyEnv, "Nanobananapro_visionary");
    assert.equal(route.mode, "async");
    assert.equal(route.sizeOverrides["1k"].pointCost, 4);
    assert.equal(route.sizeOverrides["2k"].pointCost, 5);
  }
});

test("Seedream-5.5 production routes mirror the Seedream-5-pro routes and use the 5.5 upstream model", () => {
  const routes = catalog.routes.filter((route) => route.modelFamily === "seedream-5.5");
  assert.equal(routes.length, 3);

  const dedicated = routes.find((route) => route.id === "seedream-5.5-seedream-dedicated");
  const backup = routes.find((route) => route.id === "seedream-5.5-backup");
  const visionary = routes.find((route) => route.id === "seedream-5.5-visionary-stable");

  assert.ok(dedicated);
  assert.equal(dedicated.upstreamModel, "seedream-5.5");
  assert.equal(dedicated.pointCost, 3);
  assert.equal(dedicated.isDefaultRoute, true);
  assert.ok(backup);
  assert.equal(backup.upstreamModel, "seedream-5.5");
  assert.equal(backup.pointCost, 6);
  assert.ok(visionary);
  assert.equal(visionary.label, "稳定线路");
  assert.equal(visionary.baseUrl, "https://api.visionary.beer");
  assert.equal(visionary.upstreamModel, "seedream-5.5");
  assert.equal(visionary.apiKeyEnv, "Nanobananapro_visionary");
  assert.equal(visionary.sizeOverrides["1k"].pointCost, 4);
  assert.equal(visionary.sizeOverrides["2k"].pointCost, 5);

  const runtimeRoutes = runtimeCatalog.routes.filter((route) => route.modelFamily === "seedream-5.5");
  assert.equal(runtimeRoutes.length, 2);
  assert.ok(runtimeRoutes.some((route) => route.id === "seedream-5.5-default" && route.upstreamModel === "seedream-5.5"));
  assert.ok(runtimeRoutes.some((route) => route.id === "seedream-5.5-visionary-stable" && route.upstreamModel === "seedream-5.5"));
});
