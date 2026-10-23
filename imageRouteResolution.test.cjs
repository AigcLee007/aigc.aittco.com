const assert = require("node:assert/strict");
const { test } = require("node:test");
const { selectDefaultImageRoute } = require("./imageRouteResolution.cjs");

test("selects the default route for the requested model family", () => {
  const routes = [
    { id: "global", modelFamily: "nano-banana", isDefaultRoute: true },
    { id: "gpt-backup", modelFamily: "gpt-image-2", isDefaultRoute: false },
    { id: "gpt-default", modelFamily: "gpt-image-2", isDefaultRoute: true },
  ];

  assert.equal(
    selectDefaultImageRoute({ routes, defaultRouteId: "global", routeFamily: "gpt-image-2" })?.id,
    "gpt-default",
  );
});

test("uses the first active route in a model family if that family has no marked default", () => {
  const routes = [
    { id: "gpt-inactive", modelFamily: "gpt-image-2", isActive: false },
    { id: "gpt-first", modelFamily: "gpt-image-2" },
  ];

  assert.equal(
    selectDefaultImageRoute({ routes, defaultRouteId: "missing", routeFamily: "gpt-image-2" })?.id,
    "gpt-first",
  );
});

test("uses the global default only when no route family is known", () => {
  const routes = [
    { id: "global", modelFamily: "nano-banana", isDefaultRoute: true },
    { id: "gpt", modelFamily: "gpt-image-2" },
  ];

  assert.equal(selectDefaultImageRoute({ routes, defaultRouteId: "global" })?.id, "global");
});
