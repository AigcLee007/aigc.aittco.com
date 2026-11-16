(function (root, createPolicy) {
  const policy = createPolicy();
  root.ClassicImageQualityPolicy = policy;
  if (typeof module !== "undefined" && module.exports) module.exports = policy;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const isSeedreamModel = (modelId) =>
    String(modelId || "").trim().toLowerCase().startsWith("seedream-");

  return Object.freeze({
    isSeedreamModel,
    shouldShowQualitySelector: (modelId) => !isSeedreamModel(modelId),
    getQualityPayloadFields: (modelId, quality) =>
      isSeedreamModel(modelId) ? {} : { quality: quality || "auto" },
  });
});
