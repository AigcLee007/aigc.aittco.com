const GPT_IMAGE_COMPATIBLE_PATTERN = /^gpt-image-2(?:$|-|\.5(?:-|$))/i;

const isGptImageCompatibleModel = (value = '') => {
  const normalized = String(value || '').trim();
  return normalized === 'seedream-5-pro' || GPT_IMAGE_COMPATIBLE_PATTERN.test(normalized);
};

module.exports = {
  GPT_IMAGE_COMPATIBLE_PATTERN,
  isGptImageCompatibleModel,
};
