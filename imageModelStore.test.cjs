const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("image model store schema seeding", () => {
  it("seeds static models only through the one-time catalog initializer", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageModelStore.cjs"), "utf8");

    assert.ok(
      source.includes('catalogName: "image-models"'),
      "image models need their own persistent initialization marker",
    );
    assert.ok(
      source.includes('countSql: "SELECT COUNT(*) AS total FROM image_models"'),
      "only an empty, uninitialized model catalog may import static defaults",
    );
    assert.ok(
      source.includes("initializeCatalogOnce(connection") &&
        source.includes("for (const row of buildStaticRows())"),
      "static model inserts must be guarded by the persistent initialization marker",
    );
  });
});
