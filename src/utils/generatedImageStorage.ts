const LINE4_ORIGINAL_SEGMENT = "/generated-assets/line4/original/";
const LINE4_THUMB_SEGMENT = "/generated-assets/line4/thumb/";

export const isLocalLine4StoredImage = (value?: string | null): boolean =>
  typeof value === "string" && value.includes(LINE4_ORIGINAL_SEGMENT);

export const getLocalLine4ThumbnailUrl = (
  value?: string | null,
): string | null => {
  if (!isLocalLine4StoredImage(value)) return null;
  return value!
    .replace(LINE4_ORIGINAL_SEGMENT, LINE4_THUMB_SEGMENT)
    .replace(/\.[a-zA-Z0-9]+(?:\?|#|$)/, ".webp$1");
};

export const getPreferredImageDisplayUrl = (
  originalUrl?: string | null,
  thumbnailUrl?: string | null,
): string => {
  if (thumbnailUrl) return thumbnailUrl;
  return getLocalLine4ThumbnailUrl(originalUrl) || originalUrl || "";
};

export const isOlderThanHours = (
  isoTimestamp?: string | null,
  hours = 72,
): boolean => {
  if (!isoTimestamp) return false;
  const parsed = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > hours * 60 * 60 * 1000;
};
