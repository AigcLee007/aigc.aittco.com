const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");

const imageExtByMime = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const LOCAL_LINE4_ROUTE_ID = "nano-banana-pro-line4";
const STORAGE_TTL_HOURS = Number.parseInt(
  String(process.env.LINE4_LOCAL_STORAGE_TTL_HOURS || "72"),
  10,
);
const THUMB_WIDTH = Number.parseInt(
  String(process.env.LINE4_LOCAL_THUMB_WIDTH || "480"),
  10,
);
const THUMB_QUALITY = Number.parseInt(
  String(process.env.LINE4_LOCAL_THUMB_QUALITY || "82"),
  10,
);
const STORAGE_ROOT = path.join(__dirname, "storage", "generated", "line4");
const ORIGINAL_ROOT = path.join(STORAGE_ROOT, "original");
const THUMB_ROOT = path.join(STORAGE_ROOT, "thumb");
const PUBLIC_ROOT = "/generated-assets/line4";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let lastCleanupAt = 0;
let cleanupPromise = null;

const trim = (value = "") => String(value || "").trim();
const sanitizeSegment = (value = "unknown") =>
  trim(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unknown";
const dedupe = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => trim(item))
        .filter(Boolean),
    ),
  );

const getMaxBytes = () => {
  const parsed = Number.parseInt(
    trim(process.env.GENERATED_ASSET_MAX_BYTES || "52428800"),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 52428800;
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const isLikelyVideoUrl = (value = "") => {
  const raw = trim(value).toLowerCase();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    const pathname = url.pathname.toLowerCase();
    return /\.(mp4|mov|webm|m4v|m3u8)$/i.test(pathname);
  } catch (_error) {
    return /\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i.test(raw);
  }
};

const parseDataImage = (value = "") => {
  const match = trim(value).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const data = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(data, "base64");
  return { buffer, mimeType };
};

const inferMimeFromMagic = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "image/png";
  if (
    buffer
      .slice(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.slice(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/png";
};

const normalizeMime = (mimeType = "", buffer = null) => {
  const lower = trim(mimeType).split(";")[0].toLowerCase();
  if (lower.startsWith("image/")) return lower;
  return inferMimeFromMagic(buffer);
};

const extForMime = (mimeType = "") =>
  imageExtByMime[trim(mimeType).toLowerCase()] || "png";

const buildRelativeParts = (context = {}, mimeType = "", buffer) => {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const userId = sanitizeSegment(context.userId || "anonymous");
  const routeId = sanitizeSegment(context.routeId || "unknown-route");
  const recordOrTask = sanitizeSegment(
    context.recordId || context.taskId || context.requestId || "no-record",
  );
  return {
    dir: path.join(yyyy, mm, dd, userId, routeId, recordOrTask),
    filename: `${hash.slice(0, 32)}.${extForMime(mimeType)}`,
    thumbFilename: `${hash.slice(0, 32)}.webp`,
  };
};

const toPublicUrl = (kind, relativePath) =>
  `${PUBLIC_ROOT}/${kind}/${relativePath.replace(/\\/g, "/")}`;

const listFilesRecursively = async (rootDir) => {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
};

const cleanupExpiredLocalAssets = async () => {
  const cutoffMs = Date.now() - Math.max(STORAGE_TTL_HOURS, 1) * 60 * 60 * 1000;
  for (const rootDir of [ORIGINAL_ROOT, THUMB_ROOT]) {
    if (!fs.existsSync(rootDir)) continue;
    const files = await listFilesRecursively(rootDir);
    for (const filePath of files) {
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.mtimeMs < cutoffMs) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      } catch (_error) {
        // ignore cleanup failures
      }
    }
  }
};

const scheduleCleanup = () => {
  const now = Date.now();
  if (cleanupPromise || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  cleanupPromise = cleanupExpiredLocalAssets()
    .catch(() => {})
    .finally(() => {
      cleanupPromise = null;
    });
};

const downloadImage = async (url) => {
  if (isLikelyVideoUrl(url)) {
    throw new Error("Skipping likely video URL");
  }
  const maxBytes = getMaxBytes();
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: Number.parseInt(trim(process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS || "30000"), 10),
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    },
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds generated asset max bytes (${buffer.length})`);
  }
  const mimeType = normalizeMime(response.headers["content-type"], buffer);
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Downloaded result is not an image (${mimeType || "unknown"})`);
  }
  return { buffer, mimeType };
};

const loadImageSource = async (source) => {
  const dataImage = parseDataImage(source);
  if (dataImage) {
    if (dataImage.buffer.length > getMaxBytes()) {
      throw new Error(`Data image exceeds generated asset max bytes (${dataImage.buffer.length})`);
    }
    return dataImage;
  }
  if (/^https?:\/\//i.test(trim(source))) {
    return downloadImage(source);
  }
  throw new Error("Unsupported generated image source");
};

const saveLocalAsset = async ({ buffer, mimeType, context }) => {
  await ensureDir(ORIGINAL_ROOT);
  await ensureDir(THUMB_ROOT);

  const parts = buildRelativeParts(context, mimeType, buffer);
  const originalRelativePath = path.join(parts.dir, parts.filename);
  const thumbRelativePath = path.join(parts.dir, parts.thumbFilename);
  const originalAbsolutePath = path.join(ORIGINAL_ROOT, originalRelativePath);
  const thumbAbsolutePath = path.join(THUMB_ROOT, thumbRelativePath);

  await ensureDir(path.dirname(originalAbsolutePath));
  await ensureDir(path.dirname(thumbAbsolutePath));

  await fs.promises.writeFile(originalAbsolutePath, buffer);
  await sharp(buffer)
    .rotate()
    .resize({
      width: Number.isFinite(THUMB_WIDTH) && THUMB_WIDTH > 0 ? THUMB_WIDTH : 480,
      withoutEnlargement: true,
    })
    .webp({
      quality: Number.isFinite(THUMB_QUALITY) && THUMB_QUALITY > 0 ? THUMB_QUALITY : 82,
    })
    .toFile(thumbAbsolutePath);

  return {
    objectKey: originalRelativePath.replace(/\\/g, "/"),
    storedUrl: toPublicUrl("original", originalRelativePath),
    thumbnailUrl: toPublicUrl("thumb", thumbRelativePath),
    mimeType,
    size: buffer.length,
  };
};

const persistOne = async ({ source, context }) => {
  const loaded = await loadImageSource(source);
  const mimeType = normalizeMime(loaded.mimeType, loaded.buffer);
  const stored = await saveLocalAsset({
    buffer: loaded.buffer,
    mimeType,
    context,
  });
  return {
    originalUrl: source,
    storedUrl: stored.storedUrl,
    thumbnailUrl: stored.thumbnailUrl,
    objectKey: stored.objectKey,
    mimeType: stored.mimeType,
    size: stored.size,
  };
};

const rewritePayload = (value, replacements) => {
  if (!value || replacements.size === 0) return value;

  if (typeof value === "string") {
    return replacements.get(value) || value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewritePayload(item, replacements));
  }

  if (typeof value !== "object") return value;

  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    next[key] = rewritePayload(raw, replacements);
  }

  if (typeof value.b64_json === "string") {
    const dataUrl = `data:image/png;base64,${value.b64_json.trim()}`;
    const storedUrl = replacements.get(dataUrl);
    if (storedUrl) {
      next.url = storedUrl;
      next.image_url = next.image_url || storedUrl;
    }
  }

  return next;
};

const shouldPersistRoute = (context = {}) =>
  trim(context.routeId) === LOCAL_LINE4_ROUTE_ID;

const persistGeneratedImageResults = async ({
  payload = null,
  resultUrls = [],
  context = {},
  logger = null,
} = {}) => {
  const normalizedUrls = dedupe(resultUrls);
  if (normalizedUrls.length === 0 || !shouldPersistRoute(context)) {
    return {
      payload,
      resultUrls: normalizedUrls,
      previewUrl: normalizedUrls[0] || null,
      assets: [],
      errors: [],
      enabled: false,
    };
  }

  scheduleCleanup();

  const assets = [];
  const errors = [];
  const replacements = new Map();

  for (const source of normalizedUrls) {
    if (isLikelyVideoUrl(source) || /^data:video\//i.test(source)) {
      continue;
    }

    try {
      const asset = await persistOne({ source, context });
      assets.push(asset);
      if (asset.storedUrl) replacements.set(source, asset.storedUrl);
    } catch (error) {
      const item = {
        originalUrl: source,
        error: error.message || "Generated asset persistence failed",
      };
      errors.push(item);
      if (logger?.warn) {
        logger.warn({
          timestamp: new Date().toISOString(),
          type: "Generated Asset Persist Warning",
          routeId: context.routeId || null,
          modelId: context.modelId || null,
          taskId: context.taskId || null,
          recordId: context.recordId || null,
          message: item.error,
          sourcePreview: source.slice(0, 160),
        });
      }
    }
  }

  const finalUrls = normalizedUrls.map((url) => replacements.get(url) || url);
  const previewUrl = assets[0]?.thumbnailUrl || finalUrls[0] || null;
  let nextPayload = rewritePayload(payload, replacements);
  if (nextPayload && typeof nextPayload === "object" && !Array.isArray(nextPayload)) {
    nextPayload = {
      ...nextPayload,
      url: nextPayload.url || nextPayload.image_url || finalUrls[0] || null,
      image_url: nextPayload.image_url || nextPayload.url || finalUrls[0] || null,
      images: Array.isArray(nextPayload.images) ? nextPayload.images : finalUrls,
      preview_url: previewUrl,
      thumbnail_url: previewUrl,
      thumbnails: assets.map((asset) => asset.thumbnailUrl).filter(Boolean),
    };
    if (assets.length || errors.length) {
      nextPayload.asset_persistence = {
        enabled: true,
        stored: assets.length,
        failed: errors.length,
      };
    }
  }

  return {
    payload: nextPayload,
    resultUrls: finalUrls,
    previewUrl,
    assets,
    errors,
    enabled: true,
  };
};

module.exports = {
  isGeneratedAssetStorageEnabled: shouldPersistRoute,
  LOCAL_LINE4_ROUTE_ID,
  LINE4_LOCAL_STORAGE_ROOT: STORAGE_ROOT,
  persistGeneratedImageResults,
};
