const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("image model store schema seeding", () => {
  it("imports initial models once and migrates Seedream-5.5 once without overwriting managed rows", () => {
    const source = fs.readFileSync(path.join(__dirname, "imageModelStore.cjs"), "utf8");

    assert.ok(
      source.includes('catalogName: "image-models"') &&
        source.includes('countSql: "SELECT COUNT(*) AS total FROM image_models"'),
      "initial model defaults must remain protected by their one-time marker",
    );
    assert.ok(
      source.includes('catalogName: "image-models-seedream-5.5"') &&
        source.includes("WHERE model_id = 'seedream-5.5'"),
      "the new model must use an ID-specific one-time migration",
    );
    assert.ok(
      source.includes('getStaticModelDefaults("seedream-5.5")') &&
        source.includes('"INSERT IGNORE"') &&
        source.includes("insertImageModelRow(connection, row, nowDb, { ignoreConflict: true })"),
      "the migration must add only the new static model when it is absent",
    );
  });
});
