const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getRoutePointCost } = require("./imageRoutePricing.cjs");

test("charges outputs and input images at the selected size rate without charging alias copies twice", () => {
  const route = {
    pointCost: 4,
    sizeOverrides: {
      "1k": { pointCost: 4, inputImagePointCost: 1.25 },
      "2k": { pointCost: 4, inputImagePointCost: 1.25 },
    },
  };
  const inputImage = "data:image/png;base64,AAAA";

  assert.equal(getRoutePointCost(route, 3, {
    image_size: "2k",
    images: [inputImage, "https://example.com/ref.png"],
    image: inputImage,
  }), 14.5);
  assert.equal(getRoutePointCost(route, 1, { image_size: "1k", images: [inputImage] }), 5.3);
  assert.equal(getRoutePointCost(route, 1, { image_size: "1k", images: [inputImage, inputImage], image: inputImage }), 6.5);
  assert.equal(getRoutePointCost(route, 2, { image_size: "1k" }), 8);
});

test("counts a single edit input without charging the mask and preserves legacy route pricing", () => {
  const inputImage = "data:image/png;base64,AAAA";
  assert.equal(getRoutePointCost({
    pointCost: 3,
    sizeOverrides: { "1k": { pointCost: 3, inputImagePointCost: 1.25 } },
  }, 1, { size: "1k", image: inputImage, mask: "data:image/png;base64,BBBB" }), 4.3);

  assert.equal(getRoutePointCost({ pointCost: 2.5 }, 3, { images: [inputImage] }), 7.5);
});
