const path = require("path");
const fs = require("fs");

const VIDEO_FRAME_UPLOAD_ROOT = path.join(__dirname, "uploads");
const VIDEO_FRAME_UPLOAD_DIR = path.join(VIDEO_FRAME_UPLOAD_ROOT, "video-frames");
const VIDEO_FRAME_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

const trim = (value = "") => String(value || "").trim();

const parseVideoFrameDataUrl = (value = "") => {
  const match = trim(value).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;

  const mime = trim(match[1]).toLowerCase();
  const ext = IMAGE_EXT_BY_MIME[mime];
  if (!ext) return null;

  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return null;

  return { mime: mime === "image/jpg" ? "image/jpeg" : mime, ext, buffer };
};

const getPublicBaseUrl = (req) => {
  const configured = trim(
    process.env.PUBLIC_BASE_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.SITE_URL ||
      process.env.APP_URL,
  ).replace(/\/+$/, "");
  if (configured) return configured;

  const proto = trim(req?.get?.("x-forwarded-proto") || req?.protocol || "http").split(",")[0];
  const host = trim(req?.get?.("x-forwarded-host") || req?.get?.("host"));
  return host ? `${proto || "http"}://${host}` : "";
};

const toAbsolutePublicUrl = (value, req) => {
  const raw = trim(value);
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;

  const baseUrl = getPublicBaseUrl(req);
  if (!baseUrl) return raw;
  return `${baseUrl}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

const resolveUploadDir = (baseDir = VIDEO_FRAME_UPLOAD_ROOT) =>
  path.join(baseDir, "video-frames");

const saveVideoFrameDataUrl = (value, req, label = "frame", baseDir) => {
  const parsed = parseVideoFrameDataUrl(value);
  if (!parsed) return null;
  if (parsed.buffer.length > VIDEO_FRAME_MAX_BYTES) {
    throw new Error("首尾帧图片不能超过 10MB");
  }

  const uploadDir = resolveUploadDir(baseDir);
  fs.mkdirSync(uploadDir, { recursive: true });
  const safeLabel = trim(label).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 24) || "frame";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeLabel}.${parsed.ext}`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, parsed.buffer);

  return toAbsolutePublicUrl(`/uploads/video-frames/${filename}`, req);
};

const normalizePublicVideoFrameUrl = (value, req, label, baseDir) => {
  const raw = trim(value);
  if (!raw) return raw;

  const savedUrl = saveVideoFrameDataUrl(raw, req, label, baseDir);
  if (savedUrl) return savedUrl;
  return toAbsolutePublicUrl(raw, req);
};

const normalizeVideoFramePayloadUrls = (body, req, baseDir) => {
  if (!body || typeof body !== "object") return body;
  if (body.start_frame !== undefined) {
    body.start_frame = normalizePublicVideoFrameUrl(body.start_frame, req, "start-frame", baseDir);
  }
  if (body.end_frame !== undefined) {
    body.end_frame = normalizePublicVideoFrameUrl(body.end_frame, req, "end-frame", baseDir);
  }
  if (body.video_reference !== undefined) {
    body.video_reference = toAbsolutePublicUrl(body.video_reference, req);
  }
  return body;
};

module.exports = {
  VIDEO_FRAME_UPLOAD_DIR,
  VIDEO_FRAME_MAX_BYTES,
  parseVideoFrameDataUrl,
  getPublicBaseUrl,
  toAbsolutePublicUrl,
  normalizePublicVideoFrameUrl,
  normalizeVideoFramePayloadUrls,
  resolveUploadDir,
};
