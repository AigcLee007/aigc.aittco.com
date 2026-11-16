const GPT_IMAGE_COMPATIBLE_PATTERN = /^gpt-image-2(?:$|-|\.[56](?:-|$))/i;

const isGptImageCompatibleModel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('seedream-') || GPT_IMAGE_COMPATIBLE_PATTERN.test(normalized);
};

module.exports = {
  GPT_IMAGE_COMPATIBLE_PATTERN,
  isGptImageCompatibleModel,
};
