const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

const CHANGE_LOG_FILE = path.join(__dirname, "admin-change-logs.json");
const CHANGE_LOG_LIMIT = 500;

const normalizeEntries = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id || "").trim() || `adm_${randomBytes(8).toString("hex")}`,
      createdAt: String(entry.createdAt || "").trim() || new Date().toISOString(),
      actorUserId: String(entry.actorUserId || "").trim() || null,
      actorEmail: String(entry.actorEmail || "").trim() || null,
      actorDisplayName: String(entry.actorDisplayName || "").trim() || null,
      actorRole: String(entry.actorRole || "").trim() || null,
      action: String(entry.action || "").trim() || "unknown",
      entityType: String(entry.entityType || "").trim() || "unknown",
      entityId: String(entry.entityId || "").trim() || "unknown",
      summary: String(entry.summary || "").trim() || "未命名操作",
      detail: entry.detail ?? null,
    }))
    .slice(0, CHANGE_LOG_LIMIT);
};

const readEntries = () => {
  if (!fs.existsSync(CHANGE_LOG_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(CHANGE_LOG_FILE, "utf8").trim();
    if (!raw) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch (_error) {
    return [];
  }
};

const writeEntries = (entries) => {
  fs.writeFileSync(
    CHANGE_LOG_FILE,
    JSON.stringify(normalizeEntries(entries), null, 2),
    "utf8",
  );
};

const sanitizeDetail = (value) => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return { raw: String(value) };
  }
};

const recordAdminChange = (entry = {}) => {
  const nextEntry = {
    id: `adm_${randomBytes(8).toString("hex")}`,
    createdAt: new Date().toISOString(),
    actorUserId: String(entry.actorUserId || "").trim() || null,
    actorEmail: String(entry.actorEmail || "").trim() || null,
    actorDisplayName: String(entry.actorDisplayName || "").trim() || null,
    actorRole: String(entry.actorRole || "").trim() || null,
    action: String(entry.action || "").trim() || "unknown",
    entityType: String(entry.entityType || "").trim() || "unknown",
    entityId: String(entry.entityId || "").trim() || "unknown",
    summary: String(entry.summary || "").trim() || "未命名操作",
    detail: sanitizeDetail(entry.detail),
  };

  const entries = readEntries();
  entries.unshift(nextEntry);
  writeEntries(entries.slice(0, CHANGE_LOG_LIMIT));
  return nextEntry;
};

const listAdminChanges = ({ limit = 40 } = {}) => {
  const safeLimit = Math.min(
    CHANGE_LOG_LIMIT,
    Math.max(1, Number.parseInt(String(limit || 40), 10) || 40),
  );
  return readEntries().slice(0, safeLimit);
};

module.exports = {
  listAdminChanges,
  recordAdminChange,
};
