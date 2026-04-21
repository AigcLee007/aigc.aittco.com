const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("crypto");

const AUTH_ROLES = ["user", "admin", "super_admin"];
const AUTH_USER_STATUSES = ["active", "disabled"];
const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_MIN_LENGTH = 8;

const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const normalizeDisplayName = (value = "") => String(value || "").trim();
const isValidEmail = (value = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
const hashCode = (value = "") =>
  createHash("sha256").update(String(value || ""), "utf8").digest("hex");
const validateSessionToken = (value) =>
  typeof value === "string" && /^sess_[A-Za-z0-9]{24,128}$/.test(value);

const normalizeRole = (value, fallback = "user") => {
  const role = String(value || "").trim().toLowerCase();
  return AUTH_ROLES.includes(role) ? role : fallback;
};

const normalizeStatus = (value, fallback = "active") => {
  const status = String(value || "").trim().toLowerCase();
  return AUTH_USER_STATUSES.includes(status) ? status : fallback;
};

const hasAdminRole = (role) => {
  const normalized = normalizeRole(role, "user");
  return normalized === "admin" || normalized === "super_admin";
};

const hasSuperAdminRole = (role) => normalizeRole(role, "user") === "super_admin";

const getAdminEmailSet = () =>
  new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(/[,\n\r;\s]+/)
      .map(normalizeEmail)
      .filter(Boolean),
  );

const shouldAutoPromoteEmail = (email = "") => getAdminEmailSet().has(normalizeEmail(email));

const getEffectiveRole = (user = {}) => {
  const storedRole = normalizeRole(user.role, "user");
  if (storedRole !== "user") return storedRole;
  return shouldAutoPromoteEmail(user.email) ? "admin" : storedRole;
};

const toDisplayNameFallback = (email = "") => {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return normalized;
  return normalized.split("@")[0];
};

const validatePassword = (password) => {
  const text = String(password || "");
  if (text.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (text.length > 200) {
    throw new Error("Password is too long");
  }
  return text;
};

const hashPassword = (password) => {
  const value = validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(value, salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived}`;
};

const verifyPassword = (password, storedHash) => {
  const serialized = String(storedHash || "").trim();
  if (!serialized) return false;
  const [prefix, salt, digest] = serialized.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !digest) return false;

  const derived = scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(digest, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
};

const buildSessionToken = () => `sess_${randomBytes(24).toString("hex")}`;
const buildUserId = () => `usr_${randomBytes(8).toString("hex")}`;

module.exports = {
  AUTH_ROLES,
  AUTH_USER_STATUSES,
  buildSessionToken,
  buildUserId,
  getEffectiveRole,
  hasAdminRole,
  hasSuperAdminRole,
  hashCode,
  hashPassword,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizeRole,
  normalizeStatus,
  shouldAutoPromoteEmail,
  toDisplayNameFallback,
  validatePassword,
  validateSessionToken,
  verifyPassword,
};
