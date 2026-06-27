const IMAGE_PROXY_PREFIX = '/api/proxy/image?url=';

export const isRemoteHttpUrl = (src: string) => /^https?:\/\//i.test(src);

export const isProxiedImageUrl = (src: string) => src.startsWith(IMAGE_PROXY_PREFIX);

export const unwrapMiswrappedImageUrl = (src: string) => {
  const trimmed = String(src || '').trim();
  const match = trimmed.match(/^data:image\/[^;,]+;base64,(https?:\/\/[\s\S]+)$/i);
  return match ? match[1].trim() : trimmed;
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
