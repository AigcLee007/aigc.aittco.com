const { toPointNumber } = require("./pointMath.cjs");

const IMAGE_INPUT_FIELDS = [
  "images",
  "image",
  "reference_images",
  "reference_image",
  "image_urls",
  "image_url",
  "reference_image_urls",
  "reference_image_url",
];

const getRequestedSizeKey = (requestBody = {}) => {
  const size = String(
    requestBody.image_size ||
      requestBody.imageSize ||
      requestBody.size ||
      requestBody.generationConfig?.imageConfig?.imageSize ||
      requestBody.generationConfig?.image_config?.image_size ||
      "",
  ).trim().toLowerCase();
  return ["1k", "2k", "4k", "720p", "1080p"].includes(size) ? size : "";
};

const getInputImageCount = (requestBody = {}) => {
  const inputCounts = new Map();
  for (const field of IMAGE_INPUT_FIELDS) {
    const value = requestBody[field];
    const values = Array.isArray(value) ? value : [value];
    const fieldCounts = new Map();
    for (const item of values) {
      const image = typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? item.url || item.image_url || item.b64_json
          : "";
      if (typeof image !== "string" || !image.trim()) continue;
      const trimmed = image.trim();
      const dataUrl = trimmed.match(/^data:image\/[^;,]+;base64,([\s\S]+)$/i);
      const identity = dataUrl ? dataUrl[1].replace(/\s+/g, "") : trimmed;
      fieldCounts.set(identity, (fieldCounts.get(identity) || 0) + 1);
    }
    for (const [identity, count] of fieldCounts) {
      inputCounts.set(identity, Math.max(inputCounts.get(identity) || 0, count));
    }
  }
  return [...inputCounts.values()].reduce((total, count) => total + count, 0);
};

const getRoutePointCost = (route, quantity = 1, requestBody = {}) => {
  const sizeKey = getRequestedSizeKey(requestBody);
  const sizeOverride = sizeKey ? route?.sizeOverrides?.[sizeKey] : null;
  const outputPointCost = toPointNumber(sizeOverride?.pointCost ?? route?.pointCost ?? 0);
  const outputCount = Math.max(1, Number(quantity || 1));
  const rawInputPointCost = Number.parseFloat(String(
    sizeOverride?.inputImagePointCost ?? route?.inputImagePointCost ?? 0,
  ));
  const inputPointCost = Number.isFinite(rawInputPointCost) && rawInputPointCost > 0
    ? rawInputPointCost
    : 0;
  const inputCost = inputPointCost * getInputImageCount(requestBody);

  return toPointNumber(Math.max(0, outputPointCost) * outputCount + inputCost, 0);
};

module.exports = { getInputImageCount, getRoutePointCost };
