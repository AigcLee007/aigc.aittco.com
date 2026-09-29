const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "videoRouteStore.cjs"), "utf8");
const insertMatch = source.match(
  /INSERT IGNORE INTO video_routes \(\s*([\s\S]*?)\s*\) VALUES \(\s*([\s\S]*?)\s*\)/,
);

describe("video route MySQL static catalog sync", () => {
  test("keeps INSERT columns and values aligned", () => {
    assert.ok(insertMatch, "static video_routes INSERT statement should exist");
    const columns = insertMatch[1]
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    const values = insertMatch[2].split(",").map((value) => value.trim()).filter(Boolean);
    assert.strictEqual(
      values.length,
      columns.length,
      `video_routes INSERT has ${columns.length} columns but ${values.length} values`,
    );
  });
});
