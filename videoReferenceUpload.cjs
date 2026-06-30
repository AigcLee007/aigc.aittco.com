const path = require("path");

const VIDEO_REFERENCE_UPLOAD_ROOT = path.join(__dirname, "uploads");
const VIDEO_REFERENCE_UPLOAD_DIR = path.join(VIDEO_REFERENCE_UPLOAD_ROOT, "video-references");
const VIDEO_REFERENCE_MAX_BYTES = 50 * 1024 * 1024;

const VIDEO_EXT_BY_MIME = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const trim = (value = "") => String(value || "").trim();

const parseVideoReferenceDataUrl = (value = "") => {
  const match = trim(value).match(/^data:(video\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mime = trim(match[1]).toLowerCase();
  const ext = VIDEO_EXT_BY_MIME[mime];
  if (!ext) return null;
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return null;
  return { mime, ext, buffer };
};

const validateVideoReferenceUpload = (value = "") => {
  const parsed = parseVideoReferenceDataUrl(value);
  if (!parsed) {
    throw new Error("参考视频格式无效，仅支持 MP4、WEBM、MOV");
  }
  if (parsed.buffer.length > VIDEO_REFERENCE_MAX_BYTES) {
    throw new Error("参考视频不能超过 50MB");
  }
  return parsed;
};

module.exports = {
  VIDEO_REFERENCE_UPLOAD_ROOT,
  VIDEO_REFERENCE_UPLOAD_DIR,
  VIDEO_REFERENCE_MAX_BYTES,
  parseVideoReferenceDataUrl,
  validateVideoReferenceUpload,
};
