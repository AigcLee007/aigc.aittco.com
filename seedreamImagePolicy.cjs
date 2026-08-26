const MAX_SEEDREAM_EDGE = 3072;
const MAX_SEEDREAM_PIXELS = 4194304;
const SEEDREAM_SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;

const getSeedreamSizeError = (requestBody = {}) => {
  const raw = requestBody.size || requestBody.image_size || requestBody.imageSize || '2k';
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '1k' || normalized === '2k') return null;
  const explicit = normalized.match(SEEDREAM_SIZE_PATTERN);
  if (explicit) {
    const width = Number(explicit[1]);
    const height = Number(explicit[2]);
    if (width > 0 && height > 0 && Math.max(width, height) <= MAX_SEEDREAM_EDGE && width * height <= MAX_SEEDREAM_PIXELS) {
      return null;
    }
  }
  return 'Seedream-5-pro 仅支持 1K 和 2K 尺寸';
};

module.exports = { getSeedreamSizeError };
