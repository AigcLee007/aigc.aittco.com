const IMAGE_PROXY_PREFIX = '/api/proxy/image?url=';

export const isRemoteHttpUrl = (src: string) => /^https?:\/\//i.test(src);

export const isProxiedImageUrl = (src: string) => src.startsWith(IMAGE_PROXY_PREFIX);

export const getProxiedImageUrl = (src: string) => {
  if (!src) return '';
  if (isProxiedImageUrl(src)) return src;
  if (isRemoteHttpUrl(src)) return `${IMAGE_PROXY_PREFIX}${encodeURIComponent(src)}`;
  return src;
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
