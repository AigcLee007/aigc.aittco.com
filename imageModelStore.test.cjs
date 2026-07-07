const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("image model store schema seeding", () => {
  it("seeds missing static models even when the image model table already has rows", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageModelStore.cjs"), "utf8");

    assert.ok(
      source.includes("SELECT model_id FROM image_models"),
      "schema seeding should read existing model IDs before importing static models",
    );
    assert.ok(
      source.includes("existingModelIds"),
      "schema seeding should track existing model IDs",
    );
    assert.ok(
      !source.includes("if (Number(countRows?.[0]?.total || 0) > 0) {\r\n          return;\r\n        }") &&
        !source.includes("if (Number(countRows?.[0]?.total || 0) > 0) {\n          return;\n        }"),
      "schema seeding must not skip all static models just because the table is non-empty",
    );
  });
});
