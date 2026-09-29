const assert = require("assert");
const fs = require("fs");
const path = require("path");

describe("classic model catalog synchronization", () => {
  it("does not discard active models returned by the shared catalog", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "public", "classic-app", "unified-bridge.js"),
      "utf8",
    );

    assert.ok(
      !source.includes(".filter((model) => CLASSIC_ALLOWED_IMAGE_MODEL_IDS.has(model.id))"),
      "classic catalog loading must not apply a stale hard-coded model allowlist",
    );
    assert.ok(
      source.includes(".filter((model) => model.id && model.isActive !== false)"),
      "classic catalog loading should retain every active model returned by the API",
    );
  });
});
