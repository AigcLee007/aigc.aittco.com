const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { randomInt } = require("crypto");
const {
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
} = require("./authShared.cjs");

const AUTH_FILE = path.join(__dirname, "auth-data.json");
const AUTH_VERSION = 2;
const EMAIL_CODE_LENGTH = 6;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_COOLDOWN_MS = 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_EMAIL_CODE_PURPOSES = new Set(["login", "password_reset"]);

class AuthError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const createDefaultStore = () => ({
  version: AUTH_VERSION,
  users: {},
  emailIndex: {},
  sessions: {},
  emailCodes: {},
});

const writeStore = (store) => {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2), "utf8");
};

const normalizeUser = (user = {}, emailFallback = "") => {
  const email = normalizeEmail(user.email || emailFallback);
  const role = normalizeRole(user.role, "user");
  return {
    userId: String(user.userId || buildUserId()).trim(),
    email,
    displayName: normalizeDisplayName(user.displayName) || toDisplayNameFallback(email),
    adminNote: String(user.adminNote || "").trim(),
    passwordHash: String(user.passwordHash || "").trim() || null,
    role,
    status: normalizeStatus(user.status, "active"),
    passwordUpdatedAt: user.passwordUpdatedAt || null,
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: user.updatedAt || user.createdAt || new Date().toISOString(),
    lastLoginAt: user.lastLoginAt || null,
  };
};

const normalizeStore = (store) => {
  const next = store && typeof store === "object" ? store : createDefaultStore();
  if (!next.users || typeof next.users !== "object") next.users = {};
  if (!next.emailIndex || typeof next.emailIndex !== "object") next.emailIndex = {};
  if (!next.sessions || typeof next.sessions !== "object") next.sessions = {};
  if (!next.emailCodes || typeof next.emailCodes !== "object") next.emailCodes = {};
  next.version = AUTH_VERSION;

  const normalizedUsers = {};
  const normalizedEmailIndex = {};
  const orderedUsers = Object.values(next.users)
    .map((user) => normalizeUser(user))
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.userId.localeCompare(right.userId);
    });

  let hasSuperAdmin = orderedUsers.some((user) => normalizeRole(user.role, "user") === "super_admin");
  orderedUsers.forEach((user, index) => {
    const nextUser = {
      ...user,
      role:
        index === 0 && !hasSuperAdmin
          ? "super_admin"
          : shouldAutoPromoteEmail(user.email) && normalizeRole(user.role, "user") === "user"
            ? "admin"
            : normalizeRole(user.role, "user"),
    };
    if (nextUser.role === "super_admin") {
      hasSuperAdmin = true;
    }
    normalizedUsers[nextUser.userId] = nextUser;
    normalizedEmailIndex[nextUser.email] = nextUser.userId;
  });

  next.users = normalizedUsers;
  next.emailIndex = normalizedEmailIndex;
  return next;
};

const readStore = () => {
  if (!fs.existsSync(AUTH_FILE)) {
    const initial = createDefaultStore();
    writeStore(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8").trim();
    if (!raw) {
      const initial = createDefaultStore();
      writeStore(initial);
      return initial;
    }
    const parsed = normalizeStore(JSON.parse(raw));
    writeStore(parsed);
    return parsed;
  } catch (_error) {
    const fallback = createDefaultStore();
    writeStore(fallback);
    return fallback;
  }
};

const cleanupStore = (store) => {
  const now = Date.now();
  Object.keys(store.emailCodes).forEach((email) => {
    const record = store.emailCodes[email];
    if (!record) return;
    if (new Date(record.expiresAt).getTime() <= now) {
      delete store.emailCodes[email];
    }
  });
  Object.keys(store.sessions).forEach((token) => {
    const session = store.sessions[token];
    if (!session) return;
    if (new Date(session.expiresAt).getTime() <= now) {
      delete store.sessions[token];
    }
  });
};

const withStore = (mutator) => {
  const store = normalizeStore(readStore());
  const result = mutator(store);
  cleanupStore(store);
  writeStore(store);
  return result;
};

const toPublicUser = (user, { includeAdminNote = false } = {}) => {
  const role = getEffectiveRole(user);
  const publicUser = {
    userId: user.userId,
    email: normalizeEmail(user.email),
    displayName:
      normalizeDisplayName(user.displayName) || toDisplayNameFallback(user.email),
    role,
    isAdmin: hasAdminRole(role),
    isSuperAdmin: hasSuperAdminRole(role),
    status: normalizeStatus(user.status, "active"),
    passwordConfigured: Boolean(user.passwordHash),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
  };
  if (includeAdminNote) {
    publicUser.adminNote = String(user.adminNote || "").trim();
  }
  return publicUser;
};

const createSession = (userId) => {
  const now = new Date();
  return {
    token: buildSessionToken(),
    userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
};

const createTransporter = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number.parseInt(String(process.env.SMTP_PORT || "587"), 10);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host || !Number.isFinite(port) || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || port === 465,
    auth: { user, pass },
  });
};

const normalizeEmailCodePurpose = (purpose = "login") => {
  const normalized = String(purpose || "login").trim().toLowerCase();
  return AUTH_EMAIL_CODE_PURPOSES.has(normalized) ? normalized : "login";
};

const describeEmailCodePurpose = (purpose = "login") => {
  const normalizedPurpose = normalizeEmailCodePurpose(purpose);
  if (normalizedPurpose === "password_reset") {
    return {
      subject: "password reset verification code",
      title: "password reset verification code",
      text: "Use this code to reset your password",
    };
  }
  return {
    subject: "login verification code",
    title: "login verification code",
    text: "Use this code to sign in",
  };
};

const sendEmailCode = async (email, code, { purpose = "login" } = {}) => {
  const transporter = createTransporter();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  const appName = String(process.env.APP_NAME || "Nano Banana Pro").trim();
  const purposeMeta = describeEmailCodePurpose(purpose);

  if (!transporter || !from) {
    if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") {
      console.log(`[Auth] Dev email code for ${email}: ${code}`);
      return { previewCode: code, delivered: false };
    }
    throw new AuthError(
      "EMAIL_DELIVERY_NOT_CONFIGURED",
      "Email delivery is not configured on the server",
    );
  }

  await transporter.sendMail({
    from,
    to: email,
    subject: `${appName} ${purposeMeta.subject}`,
    text: `${purposeMeta.text}: ${code}. It will expire in 10 minutes.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>${appName} ${purposeMeta.title}</h2>
      <p>${purposeMeta.text}:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
      <p>It expires in 10 minutes. Please do not share this code with anyone.</p>
    </div>`,
  });

  return { previewCode: null, delivered: true };
};

const getRegistrationStatus = () => {
  const store = readStore();
  const totalUsers = Object.keys(store.users).length;
  return {
    totalUsers,
    hasUsers: totalUsers > 0,
    firstUserWillBeSuperAdmin: totalUsers === 0,
    passwordLoginEnabled: true,
  };
};

const getUserByEmail = (store, email) => {
  const userId = store.emailIndex[email];
  return userId ? store.users[userId] || null : null;
};

const consumeEmailCodeRecord = (store, email, code, { purpose = "login" } = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();
  const normalizedPurpose = normalizeEmailCodePurpose(purpose);

  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AuthError("INVALID_EMAIL_CODE", "Verification code must be 6 digits");
  }

  const record = store.emailCodes[normalizedEmail];
  if (!record) {
    throw new AuthError("EMAIL_CODE_REQUIRED", "Please request a verification code first");
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    delete store.emailCodes[normalizedEmail];
    throw new AuthError("EMAIL_CODE_EXPIRED", "Verification code has expired");
  }
  if (normalizeEmailCodePurpose(record.purpose) !== normalizedPurpose) {
    delete store.emailCodes[normalizedEmail];
    throw new AuthError(
      "EMAIL_CODE_PURPOSE_MISMATCH",
      "This verification code does not match the current operation. Please request a new code.",
    );
  }

  record.attempts = Number(record.attempts || 0) + 1;
  if (record.attempts > 5) {
    delete store.emailCodes[normalizedEmail];
    throw new AuthError(
      "EMAIL_CODE_LOCKED",
      "Too many incorrect attempts, please request a new code",
    );
  }
  if (record.codeHash !== hashCode(normalizedCode)) {
    throw new AuthError("EMAIL_CODE_INVALID", "Verification code is incorrect");
  }

  delete store.emailCodes[normalizedEmail];
  return normalizedEmail;
};

const requestEmailCode = async (email, { purpose = "login" } = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPurpose = normalizeEmailCodePurpose(purpose);
  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }

  const store = readStore();
  cleanupStore(store);

  if (normalizedPurpose === "password_reset") {
    const existingUser = getUserByEmail(store, normalizedEmail);
    if (!existingUser) {
      throw new AuthError(
        "PASSWORD_RESET_USER_NOT_FOUND",
        "No account was found for this email address",
      );
    }
    if (normalizeStatus(existingUser.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }
    if (!existingUser.passwordHash) {
      throw new AuthError(
        "AUTH_PASSWORD_NOT_SET",
        "This account does not have a password yet. Please use email verification to sign in first.",
      );
    }
  }

  const existing = store.emailCodes[normalizedEmail];
  const now = Date.now();
  if (existing && now - new Date(existing.lastSentAt).getTime() < EMAIL_CODE_COOLDOWN_MS) {
    const waitSeconds = Math.ceil(
      (EMAIL_CODE_COOLDOWN_MS - (now - new Date(existing.lastSentAt).getTime())) / 1000,
    );
    throw new AuthError(
      "EMAIL_CODE_COOLDOWN",
      `Please wait ${waitSeconds} seconds before requesting another code`,
      { waitSeconds },
    );
  }

  const code = String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, "0");
  const emailResult = await sendEmailCode(normalizedEmail, code, {
    purpose: normalizedPurpose,
  });

  store.emailCodes[normalizedEmail] = {
    codeHash: hashCode(code),
    purpose: normalizedPurpose,
    expiresAt: new Date(now + EMAIL_CODE_TTL_MS).toISOString(),
    lastSentAt: new Date(now).toISOString(),
    attempts: 0,
  };
  writeStore(store);

  return {
    email: normalizedEmail,
    expiresInSeconds: Math.floor(EMAIL_CODE_TTL_MS / 1000),
    previewCode: emailResult.previewCode,
  };
};

const verifyEmailCode = (email, code, { purpose = "login" } = {}) => {
  return withStore((store) => {
    const normalizedEmail = consumeEmailCodeRecord(store, email, code, { purpose });

    let userId = store.emailIndex[normalizedEmail];
    let user = userId ? store.users[userId] : null;
    if (!user) {
      const orderedUsers = Object.values(store.users).sort((left, right) => {
        const leftTime = new Date(left.createdAt).getTime();
        const rightTime = new Date(right.createdAt).getTime();
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.userId.localeCompare(right.userId);
      });
      const role =
        orderedUsers.length === 0
          ? "super_admin"
          : shouldAutoPromoteEmail(normalizedEmail)
            ? "admin"
            : "user";
      user = normalizeUser({
        userId: buildUserId(),
        email: normalizedEmail,
        displayName: toDisplayNameFallback(normalizedEmail),
        role,
        status: "active",
        lastLoginAt: new Date().toISOString(),
      });
      store.users[user.userId] = user;
      store.emailIndex[normalizedEmail] = user.userId;
      userId = user.userId;
    }

    if (normalizeStatus(user.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }

    user.role =
      normalizeRole(user.role, "user") === "user" && shouldAutoPromoteEmail(user.email)
        ? "admin"
        : normalizeRole(user.role, "user");
    user.updatedAt = new Date().toISOString();
    user.lastLoginAt = user.updatedAt;

    const session = createSession(userId);
    store.sessions[session.token] = session;

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
      createdSuperAdmin: normalizeRole(user.role, "user") === "super_admin",
    };
  });
};

const resetPasswordWithEmailCode = (email, code, password) => {
  let safePassword = "";
  try {
    safePassword = validatePassword(password);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }

  return withStore((store) => {
    const normalizedEmail = consumeEmailCodeRecord(store, email, code, {
      purpose: "password_reset",
    });
    const user = getUserByEmail(store, normalizedEmail);
    if (!user) {
      throw new AuthError(
        "PASSWORD_RESET_USER_NOT_FOUND",
        "No account was found for this email address",
      );
    }
    if (normalizeStatus(user.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }

    user.passwordHash = hashPassword(safePassword);
    user.passwordUpdatedAt = new Date().toISOString();
    user.updatedAt = user.passwordUpdatedAt;
    user.lastLoginAt = user.passwordUpdatedAt;

    Object.keys(store.sessions).forEach((token) => {
      if (store.sessions[token]?.userId === user.userId) {
        delete store.sessions[token];
      }
    });

    const session = createSession(user.userId);
    store.sessions[session.token] = session;

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
    };
  });
};

const registerWithPassword = async ({ email, password, displayName = "" }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }

  let safePassword = "";
  try {
    safePassword = validatePassword(password);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }
  const normalizedDisplayName = normalizeDisplayName(displayName);

  return withStore((store) => {
    const existingId = store.emailIndex[normalizedEmail];
    if (existingId && store.users[existingId]) {
      throw new AuthError("EMAIL_ALREADY_EXISTS", "This email has already been registered");
    }

    const orderedUsers = Object.values(store.users).sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.userId.localeCompare(right.userId);
    });

    const role =
      orderedUsers.length === 0
        ? "super_admin"
        : shouldAutoPromoteEmail(normalizedEmail)
          ? "admin"
          : "user";
    const nowIso = new Date().toISOString();
    const user = normalizeUser({
      userId: buildUserId(),
      email: normalizedEmail,
      displayName: normalizedDisplayName || toDisplayNameFallback(normalizedEmail),
      passwordHash: hashPassword(safePassword),
      passwordUpdatedAt: nowIso,
      role,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
    });

    store.users[user.userId] = user;
    store.emailIndex[user.email] = user.userId;

    const session = createSession(user.userId);
    store.sessions[session.token] = session;

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
      createdSuperAdmin: role === "super_admin",
    };
  });
};

const loginWithPassword = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail) || !String(password || "")) {
    throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  return withStore((store) => {
    const userId = store.emailIndex[normalizedEmail];
    const user = userId ? store.users[userId] : null;
    if (!user) {
      throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    if (normalizeStatus(user.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }
    if (!user.passwordHash) {
      throw new AuthError(
        "AUTH_PASSWORD_NOT_SET",
        "This account does not have a password yet. Please use another sign-in method first.",
      );
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    user.role =
      normalizeRole(user.role, "user") === "user" && shouldAutoPromoteEmail(user.email)
        ? "admin"
        : normalizeRole(user.role, "user");
    user.updatedAt = new Date().toISOString();
    user.lastLoginAt = user.updatedAt;

    const session = createSession(user.userId);
    store.sessions[session.token] = session;

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
    };
  });
};

const getSessionTokenFromRequest = (req) => String(req.headers["x-auth-session"] || "").trim();

const getSessionUserFromRequest = (req) => {
  const token = getSessionTokenFromRequest(req);
  if (!token || !validateSessionToken(token)) {
    return null;
  }

  return withStore((store) => {
    const session = store.sessions[token];
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      delete store.sessions[token];
      return null;
    }

    const user = store.users[session.userId];
    if (!user) {
      delete store.sessions[token];
      return null;
    }
    if (normalizeStatus(user.status, "active") !== "active") {
      delete store.sessions[token];
      return null;
    }

    user.role =
      normalizeRole(user.role, "user") === "user" && shouldAutoPromoteEmail(user.email)
        ? "admin"
        : normalizeRole(user.role, "user");
    const now = new Date();
    session.lastSeenAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    user.updatedAt = now.toISOString();

    return toPublicUser(user);
  });
};

const requireAuthUser = (req) => {
  const user = req.authUser || getSessionUserFromRequest(req);
  if (!user) {
    throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }
  return user;
};

const setUserPassword = (authUser, password) => {
  const targetUserId = String(authUser?.userId || "").trim();
  if (!targetUserId) {
    throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  let safePassword = "";
  try {
    safePassword = validatePassword(password);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }

  return withStore((store) => {
    const user = store.users[targetUserId];
    if (!user) {
      throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
    }
    if (normalizeStatus(user.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }

    user.passwordHash = hashPassword(safePassword);
    user.passwordUpdatedAt = new Date().toISOString();
    user.updatedAt = user.passwordUpdatedAt;
    return toPublicUser(user);
  });
};

const changeUserPassword = (authUser, currentPassword, newPassword) => {
  const targetUserId = String(authUser?.userId || "").trim();
  if (!targetUserId) {
    throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  const currentPasswordText = String(currentPassword || "");
  if (!currentPasswordText) {
    throw new AuthError("AUTH_INVALID_CURRENT_PASSWORD", "Current password is required");
  }

  let safePassword = "";
  try {
    safePassword = validatePassword(newPassword);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }

  return withStore((store) => {
    const user = store.users[targetUserId];
    if (!user) {
      throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
    }
    if (normalizeStatus(user.status, "active") !== "active") {
      throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
    }
    if (!user.passwordHash) {
      throw new AuthError(
        "AUTH_PASSWORD_NOT_SET",
        "This account does not have a password yet. Please set a password first.",
      );
    }
    if (!verifyPassword(currentPasswordText, user.passwordHash)) {
      throw new AuthError("AUTH_INVALID_CURRENT_PASSWORD", "Current password is incorrect");
    }

    user.passwordHash = hashPassword(safePassword);
    user.passwordUpdatedAt = new Date().toISOString();
    user.updatedAt = user.passwordUpdatedAt;
    return toPublicUser(user);
  });
};

const requireSuperAdminAccess = (req) => {
  const user = requireAuthUser(req);
  if (!hasSuperAdminRole(user.role)) {
    throw new AuthError("SUPER_ADMIN_REQUIRED", "Super administrator access is required");
  }
  return user;
};

const logoutSession = (req) => {
  const token = getSessionTokenFromRequest(req);
  if (!token) return false;
  return withStore((store) => {
    if (!store.sessions[token]) return false;
    delete store.sessions[token];
    return true;
  });
};

const requireAdminAccess = (req, fallbackApiKeys = []) => {
  const authUser = req.authUser || getSessionUserFromRequest(req);
  const requestAuthorization = String(req.headers["authorization"] || "").trim();
  const validFallbackKeys = (Array.isArray(fallbackApiKeys) ? fallbackApiKeys : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (authUser?.isAdmin) {
    return authUser;
  }
  if (requestAuthorization && validFallbackKeys.includes(requestAuthorization)) {
    return authUser || {
      userId: "emergency-admin",
      email: "",
      displayName: "Emergency Admin",
      role: "super_admin",
      isAdmin: true,
      isSuperAdmin: true,
      status: "active",
      passwordConfigured: false,
      createdAt: "",
      updatedAt: "",
      lastLoginAt: null,
    };
  }
  if (!authUser) {
    throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }
  throw new AuthError("ADMIN_REQUIRED", "Administrator access is required");
};

const listAdminUsers = ({ search = "", page = 1, pageSize = 20, includeAdminNote = false } = {}) => {
  const trimmedSearch = String(search || "").trim().toLowerCase();
  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));

  const store = readStore();
  const users = Object.values(store.users)
    .map((user) => toPublicUser(user, { includeAdminNote }))
    .filter((user) => {
      if (!trimmedSearch) return true;
      return [user.email, user.displayName, user.userId]
        .join(" ")
        .toLowerCase()
        .includes(trimmedSearch);
    })
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.userId.localeCompare(left.userId);
    });

  const total = users.length;
  const offset = (safePage - 1) * safePageSize;
  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    users: users.slice(offset, offset + safePageSize),
  };
};

const getAdminAuthOverview = ({
  onlineWindowMinutes = 5,
  recentWindowDays = 7,
} = {}) => {
  const safeOnlineWindowMinutes = Math.max(
    1,
    Number.parseInt(String(onlineWindowMinutes || 5), 10) || 5,
  );
  const safeRecentWindowDays = Math.max(
    1,
    Number.parseInt(String(recentWindowDays || 7), 10) || 7,
  );

  const store = readStore();
  cleanupStore(store);

  const users = Object.values(store.users || {});
  const sessions = Object.values(store.sessions || {});
  const nowMs = Date.now();
  const onlineCutoffMs = nowMs - safeOnlineWindowMinutes * 60 * 1000;
  const recentUsersCutoffMs = nowMs - safeRecentWindowDays * 24 * 60 * 60 * 1000;

  let activeUsers = 0;
  let disabledUsers = 0;
  let adminUsers = 0;
  let superAdminUsers = 0;
  let recentUsers = 0;
  let latestUserCreatedAt = null;

  for (const user of users) {
    const role = normalizeRole(user?.role, "user");
    const status = normalizeStatus(user?.status, "active");
    const createdAt = String(user?.createdAt || "").trim() || null;
    const createdAtMs = createdAt ? Date.parse(createdAt) : NaN;

    if (status === "active") activeUsers += 1;
    if (status === "disabled") disabledUsers += 1;
    if (hasAdminRole(role)) adminUsers += 1;
    if (hasSuperAdminRole(role)) superAdminUsers += 1;
    if (Number.isFinite(createdAtMs) && createdAtMs >= recentUsersCutoffMs) {
      recentUsers += 1;
    }
    if (
      createdAt &&
      (!latestUserCreatedAt || Date.parse(createdAt) > Date.parse(latestUserCreatedAt))
    ) {
      latestUserCreatedAt = createdAt;
    }
  }

  let totalSessions = 0;
  let activeSessions = 0;
  const onlineUserIds = new Set();

  for (const session of sessions) {
    const expiresAtMs = Date.parse(String(session?.expiresAt || ""));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      continue;
    }

    totalSessions += 1;

    const lastSeenAtMs = Date.parse(String(session?.lastSeenAt || ""));
    if (Number.isFinite(lastSeenAtMs) && lastSeenAtMs >= onlineCutoffMs) {
      activeSessions += 1;
      if (session?.userId) {
        onlineUserIds.add(String(session.userId));
      }
    }
  }

  return {
    totalUsers: users.length,
    activeUsers,
    disabledUsers,
    adminUsers,
    superAdminUsers,
    totalSessions,
    activeSessions,
    onlineUsers: onlineUserIds.size,
    recentUsers,
    latestUserCreatedAt,
    onlineWindowMinutes: safeOnlineWindowMinutes,
    recentWindowDays: safeRecentWindowDays,
  };
};

const getAdminUserById = (userId, { includeAdminNote = false } = {}) => {
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) return null;
  const store = readStore();
  const user = store.users[targetUserId];
  return user ? toPublicUser(user, { includeAdminNote }) : null;
};

const updateAdminUser = (actor, userId, changes = {}) => {
  if (!hasSuperAdminRole(actor?.role)) {
    throw new AuthError("SUPER_ADMIN_REQUIRED", "Super administrator access is required");
  }

  const targetUserId = String(userId || "").trim();
  if (!targetUserId) {
    throw new AuthError("USER_NOT_FOUND", "User does not exist");
  }

  return withStore((store) => {
    const user = store.users[targetUserId];
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User does not exist");
    }

    const nextDisplayName =
      Object.prototype.hasOwnProperty.call(changes, "displayName")
        ? normalizeDisplayName(changes.displayName) || toDisplayNameFallback(user.email)
        : user.displayName;
    const nextRole =
      Object.prototype.hasOwnProperty.call(changes, "role")
        ? normalizeRole(changes.role, normalizeRole(user.role, "user"))
        : normalizeRole(user.role, "user");
    const nextStatus =
      Object.prototype.hasOwnProperty.call(changes, "status")
        ? normalizeStatus(changes.status, normalizeStatus(user.status, "active"))
        : normalizeStatus(user.status, "active");
    const nextAdminNote =
      Object.prototype.hasOwnProperty.call(changes, "adminNote")
        ? String(changes.adminNote || "").trim().slice(0, 2000)
        : String(user.adminNote || "").trim();

    const targetWasSuperAdmin = normalizeRole(user.role, "user") === "super_admin";
    const targetWillRemainSuperAdmin = nextRole === "super_admin" && nextStatus === "active";
    const targetLosesLastSuperAdmin = targetWasSuperAdmin && !targetWillRemainSuperAdmin;

    if (targetUserId === actor.userId && targetLosesLastSuperAdmin) {
      throw new AuthError(
        "LAST_SUPER_ADMIN_PROTECTED",
        "You cannot remove your own final super administrator access",
      );
    }

    if (targetLosesLastSuperAdmin) {
      const otherActiveSuperAdmins = Object.values(store.users).filter(
        (item) =>
          item.userId !== targetUserId &&
          normalizeRole(item.role, "user") === "super_admin" &&
          normalizeStatus(item.status, "active") === "active",
      );
      if (otherActiveSuperAdmins.length === 0) {
        throw new AuthError(
          "LAST_SUPER_ADMIN_PROTECTED",
          "At least one active super administrator must remain",
        );
      }
    }

    user.displayName = nextDisplayName;
    user.role = nextRole;
    user.status = nextStatus;
    user.adminNote = nextAdminNote;
    user.updatedAt = new Date().toISOString();

    if (nextStatus !== "active") {
      Object.keys(store.sessions).forEach((token) => {
        if (store.sessions[token]?.userId === targetUserId) {
          delete store.sessions[token];
        }
      });
    }

    return toPublicUser(user, { includeAdminNote: true });
  });
};

module.exports = {
  AuthError,
  getAdminAuthOverview,
  getAdminUserById,
  getRegistrationStatus,
  getSessionTokenFromRequest,
  getSessionUserFromRequest,
  listAdminUsers,
  changeUserPassword,
  loginWithPassword,
  logoutSession,
  normalizeEmail,
  registerWithPassword,
  resetPasswordWithEmailCode,
  requestEmailCode,
  requireAdminAccess,
  requireAuthUser,
  requireSuperAdminAccess,
  setUserPassword,
  toPublicUser,
  updateAdminUser,
  verifyEmailCode,
};
