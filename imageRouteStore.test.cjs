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
});
