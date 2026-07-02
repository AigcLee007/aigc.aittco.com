const assert = require("assert");

const {
  isGeneratedAssetStorageEnabled,
} = require("./generatedAssetService.cjs");

describe("generated asset persistence route matching", () => {
  it("persists kuaiaiapi image results through local storage", () => {
    assert.strictEqual(
      isGeneratedAssetStorageEnabled({
        routeId: "gpt-image-2-kuaiai",
        routeBaseUrl: "https://www.kuaiaiapi.com",
      }),
      true,
    );
  });
});
