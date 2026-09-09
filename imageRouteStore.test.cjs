const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("image route store schema seeding", () => {
  it("defines the database timestamp before inserting static routes", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageRouteStore.cjs"), "utf8");
    const seedStart = source.indexOf("const rows = buildStaticRows().filter(");
    const firstInsertTimestamp = source.indexOf("nowDb,", seedStart);
    const timestampDeclaration = source.lastIndexOf("const nowDb = toDbDateTime();", firstInsertTimestamp);

    assert.notStrictEqual(seedStart, -1);
    assert.notStrictEqual(firstInsertTimestamp, -1);
    assert.ok(
      timestampDeclaration > seedStart,
      "static route seeding must define nowDb before using it for created_at/updated_at",
    );
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
      const flare = catalog.routes.find((route) => route.id === "gpt-image-2.5-flare");

      assert.equal(flare?.isDefaultRoute, true);
    } finally {
      mysqlKeys.forEach((key) => {
        if (previousValues[key] === undefined) delete process.env[key];
        else process.env[key] = previousValues[key];
      });
    }
  });
});
