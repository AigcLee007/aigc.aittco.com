const crypto = require("crypto");
const axios = require("axios");
const OSS = require("ali-oss");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const truthy = new Set(["1", "true", "yes", "on", "enabled"]);
const imageExtByMime = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

let cachedClient = null;
let cachedClientKey = "";

const trim = (value = "") => String(value || "").trim();
const trimSlash = (value = "") => trim(value).replace(/\/+$/, "");
const normalizeProvider = () =>
  trim(process.env.GENERATED_ASSET_PROVIDER || "aliyun-oss").toLowerCase();

const isStorageEnabled = () =>
  truthy.has(trim(process.env.GENERATED_ASSET_STORAGE).toLowerCase());

const getMaxBytes = () => {
  const parsed = Number.parseInt(
    trim(process.env.GENERATED_ASSET_MAX_BYTES || "52428800"),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 52428800;
};

const getPublicBaseUrl = () =>
  trimSlash(
    process.env.GENERATED_ASSET_PUBLIC_BASE_URL ||
      process.env.OSS_PUBLIC_BASE_URL ||
      process.env.S3_PUBLIC_BASE_URL ||
      "",
  );

const getBucket = () =>
  trim(
    process.env.GENERATED_ASSET_BUCKET ||
      process.env.ALIYUN_OSS_BUCKET ||
      process.env.OSS_BUCKET ||
      process.env.S3_BUCKET ||
      process.env.R2_BUCKET ||
      "",
  );

const getPrefix = () =>
  trim(process.env.GENERATED_ASSET_PREFIX || "generated/images")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/");

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

const isManagedUrl = (value = "") => {
  const publicBaseUrl = getPublicBaseUrl();
  const raw = trim(value);
  return Boolean(publicBaseUrl && raw.startsWith(`${publicBaseUrl}/`));
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
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
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

const buildObjectKey = ({ buffer, mimeType, context = {} }) => {
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
  return [
    getPrefix(),
    yyyy,
    mm,
    dd,
    userId,
    routeId,
    recordOrTask,
    `${hash.slice(0, 32)}.${extForMime(mimeType)}`,
  ]
    .filter(Boolean)
    .join("/");
};

const getClient = () => {
  const provider = normalizeProvider();
  const bucket = getBucket();
  const publicBaseUrl = getPublicBaseUrl();
  const clientKey = JSON.stringify({
    provider,
    bucket,
    publicBaseUrl,
    endpoint:
      process.env.ALIYUN_OSS_ENDPOINT ||
      process.env.OSS_ENDPOINT ||
      process.env.S3_ENDPOINT ||
      process.env.R2_ENDPOINT ||
      "",
    region:
      process.env.ALIYUN_OSS_REGION ||
      process.env.OSS_REGION ||
      process.env.S3_REGION ||
      process.env.AWS_REGION ||
      "auto",
  });

  if (cachedClient && cachedClientKey === clientKey) return cachedClient;

  if (!bucket) throw new Error("Generated asset bucket is not configured");
  if (!publicBaseUrl) {
    throw new Error("GENERATED_ASSET_PUBLIC_BASE_URL is not configured");
  }

  if (provider === "aliyun-oss" || provider === "oss") {
    const accessKeyId = trim(
      process.env.ALIYUN_OSS_ACCESS_KEY_ID ||
        process.env.OSS_ACCESS_KEY_ID ||
        process.env.GENERATED_ASSET_ACCESS_KEY_ID ||
        "",
    );
    const accessKeySecret = trim(
      process.env.ALIYUN_OSS_ACCESS_KEY_SECRET ||
        process.env.OSS_ACCESS_KEY_SECRET ||
        process.env.GENERATED_ASSET_ACCESS_KEY_SECRET ||
        "",
    );
    const region = trim(process.env.ALIYUN_OSS_REGION || process.env.OSS_REGION || "");
    const endpoint = trim(process.env.ALIYUN_OSS_ENDPOINT || process.env.OSS_ENDPOINT || "");
    if (!accessKeyId || !accessKeySecret) {
      throw new Error("Aliyun OSS access key is not configured");
    }
    if (!region && !endpoint) {
      throw new Error("Aliyun OSS region or endpoint is not configured");
    }
    cachedClient = {
      provider,
      bucket,
      publicBaseUrl,
      client: new OSS({
        accessKeyId,
        accessKeySecret,
        bucket,
        region: region || undefined,
        endpoint: endpoint || undefined,
        secure: true,
      }),
    };
  } else if (["s3", "s3-compatible", "r2", "cloudflare-r2"].includes(provider)) {
    const accessKeyId = trim(
      process.env.S3_ACCESS_KEY_ID ||
        process.env.AWS_ACCESS_KEY_ID ||
        process.env.R2_ACCESS_KEY_ID ||
        process.env.GENERATED_ASSET_ACCESS_KEY_ID ||
        "",
    );
    const secretAccessKey = trim(
      process.env.S3_SECRET_ACCESS_KEY ||
        process.env.AWS_SECRET_ACCESS_KEY ||
        process.env.R2_SECRET_ACCESS_KEY ||
        process.env.GENERATED_ASSET_ACCESS_KEY_SECRET ||
        "",
    );
    const endpoint = trim(process.env.S3_ENDPOINT || process.env.R2_ENDPOINT || "");
    const region = trim(process.env.S3_REGION || process.env.AWS_REGION || "auto");
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("S3-compatible access key is not configured");
    }
    cachedClient = {
      provider,
      bucket,
      publicBaseUrl,
      client: new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle:
          trim(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === "true",
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      }),
    };
  } else {
    throw new Error(`Unsupported generated asset provider: ${provider}`);
  }

  cachedClientKey = clientKey;
  return cachedClient;
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
  if (isManagedUrl(source)) {
    return { skipped: true, storedUrl: source, reason: "already-managed" };
  }
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

const uploadImage = async ({ buffer, mimeType, context }) => {
  const storage = getClient();
  const objectKey = buildObjectKey({ buffer, mimeType, context });
  const cacheControl = trim(
    process.env.GENERATED_ASSET_CACHE_CONTROL ||
      "public, max-age=31536000, immutable",
  );

  if (storage.provider === "aliyun-oss" || storage.provider === "oss") {
    await storage.client.put(objectKey, buffer, {
      mime: mimeType,
      headers: {
        "Cache-Control": cacheControl,
      },
    });
  } else {
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: cacheControl,
      }),
    );
  }

  return {
    objectKey,
    storedUrl: `${storage.publicBaseUrl}/${objectKey}`,
  };
};

const persistOne = async ({ source, context }) => {
  const loaded = await loadImageSource(source);
  if (loaded.skipped) {
    return {
      originalUrl: source,
      storedUrl: loaded.storedUrl,
      skipped: true,
      reason: loaded.reason,
    };
  }

  const mimeType = normalizeMime(loaded.mimeType, loaded.buffer);
  const uploaded = await uploadImage({
    buffer: loaded.buffer,
    mimeType,
    context,
  });
  return {
    originalUrl: source,
    storedUrl: uploaded.storedUrl,
    objectKey: uploaded.objectKey,
    mimeType,
    size: loaded.buffer.length,
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

const persistGeneratedImageResults = async ({
  payload = null,
  resultUrls = [],
  context = {},
  logger = null,
} = {}) => {
  const normalizedUrls = dedupe(resultUrls);
  if (!isStorageEnabled() || normalizedUrls.length === 0) {
    return {
      payload,
      resultUrls: normalizedUrls,
      previewUrl: normalizedUrls[0] || null,
      assets: [],
      errors: [],
      enabled: false,
    };
  }

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
  let nextPayload = rewritePayload(payload, replacements);
  if (nextPayload && typeof nextPayload === "object" && !Array.isArray(nextPayload)) {
    if (finalUrls.length > 0) {
      nextPayload = {
        ...nextPayload,
        url: nextPayload.url || nextPayload.image_url || finalUrls[0],
        image_url: nextPayload.image_url || nextPayload.url || finalUrls[0],
        images: Array.isArray(nextPayload.images) ? nextPayload.images : finalUrls,
      };
    }
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
    previewUrl: finalUrls[0] || null,
    assets,
    errors,
    enabled: true,
  };
};

module.exports = {
  isGeneratedAssetStorageEnabled: isStorageEnabled,
  persistGeneratedImageResults,
};
