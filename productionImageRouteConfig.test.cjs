const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const catalog = require("./config/production-image-routes.json");
const { validateRouteConfig } = require("./scripts/replace-production-image-routes.cjs");

test("production workbook config contains 23 unique routes and one default per family", () => {
  validateRouteConfig(catalog);
  assert.equal(catalog.routes.length, 23);
  assert.equal(new Set(catalog.routes.map((route) => route.modelFamily)).size, 5);
  assert.deepEqual(
    [...new Set(catalog.routes.map((route) => route.modelFamily))].sort(),
    ["gemini-nano-banana-2.1", "gpt-image-2", "gpt-image-2.5-sunburst", "nano-banana-pro", "seedream-5-pro"],
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

test("production Docker image copies the route resolver required by server.cjs", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^COPY imageRouteResolution\.cjs \.\/$/m);
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
