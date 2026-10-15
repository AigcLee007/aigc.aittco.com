const IMAGE_PROXY_PREFIX = '/api/proxy/image?url=';

export const isRemoteHttpUrl = (src: string) => /^https?:\/\//i.test(src);

export const isProxiedImageUrl = (src: string) => src.startsWith(IMAGE_PROXY_PREFIX);

export const unwrapMiswrappedImageUrl = (src: string) => {
  const trimmed = String(src || '').trim();
  const match = trimmed.match(/^data:image\/[^;,]+;base64,(https?:\/\/[\s\S]+)$/i);
  return match ? match[1].trim() : trimmed;
};

export const normalizeImageResultValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const src = unwrapMiswrappedImageUrl(value);
  if (!src) return null;
  const inline = src.match(/^data:image\/[^;,]+;base64,([\s\S]+)$/i);
  const bytes = (inline ? inline[1] : src).replace(/\s+/g, '');
  const format = bytes.startsWith('/9j/') ? 'jpeg' : bytes.startsWith('UklGR') ? 'webp'
    : bytes.startsWith('R0lGOD') ? 'gif' : bytes.startsWith('iVBOR') ? 'png' : undefined;
  if (format && /^[A-Za-z0-9+/]+={0,2}$/.test(bytes)) return `data:image/${format};base64,${bytes}`;
  if (/^(https?:\/\/|data:|\/)/i.test(src)) return src;
  return `data:image/png;base64,${src}`;
};

export const getProxiedImageUrl = (src: string) => {
  const normalizedSrc = unwrapMiswrappedImageUrl(src);
  if (!normalizedSrc) return '';
  if (isProxiedImageUrl(normalizedSrc)) return normalizedSrc;
  if (isRemoteHttpUrl(normalizedSrc)) return `${IMAGE_PROXY_PREFIX}${encodeURIComponent(normalizedSrc)}`;
  return normalizedSrc;
};

export const getRawImageUrlFromProxy = (src: string) => {
  if (!isProxiedImageUrl(src)) return null;
  try {
    const url = new URL(src, window.location.origin);
    return url.searchParams.get('url');
  } catch {
    return null;
  }
};
