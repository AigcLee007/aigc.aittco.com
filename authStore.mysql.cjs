const nodemailer = require("nodemailer");
const { randomInt } = require("crypto");
const {
  execute,
  fromDbDateTime,
  getPool,
  query,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");
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

let authSchemaPromise = null;

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

const resolveStoredRole = (row = {}) => {
  const storedRole = normalizeRole(row.role, "user");
  if (storedRole !== "user") return storedRole;
  return shouldAutoPromoteEmail(row.email) ? "admin" : storedRole;
};

const toPublicUser = (user, { includeAdminNote = false } = {}) => {
  const role = getEffectiveRole(user);
  const publicUser = {
    userId: user.user_id || user.userId,
    email: normalizeEmail(user.email),
    displayName:
      normalizeDisplayName(user.display_name || user.displayName) ||
      toDisplayNameFallback(user.email),
    role,
    isAdmin: hasAdminRole(role),
    isSuperAdmin: hasSuperAdminRole(role),
    status: normalizeStatus(user.status, "active"),
    passwordConfigured: Boolean(user.password_hash || user.passwordHash),
    createdAt: fromDbDateTime(user.created_at || user.createdAt),
    updatedAt: fromDbDateTime(user.updated_at || user.updatedAt),
    lastLoginAt: fromDbDateTime(user.last_login_at || user.lastLoginAt),
  };
  if (includeAdminNote) {
    publicUser.adminNote = String(user.admin_note || user.adminNote || "").trim();
  }
  return publicUser;
};

const createSession = (userId) => {
  const now = new Date();
  return {
    token: buildSessionToken(),
    userId,
    createdAt: toDbDateTime(now),
    lastSeenAt: toDbDateTime(now),
    expiresAt: toDbDateTime(new Date(now.getTime() + SESSION_TTL_MS)),
  };
};

const ensureAuthSchema = async () => {
  if (!authSchemaPromise) {
    authSchemaPromise = (async () => {
      const pool = await getPool();
      const ensureColumn = async (statement) => {
        try {
          await pool.execute(statement);
        } catch (error) {
          if (error?.code !== "ER_DUP_FIELDNAME") {
            throw error;
          }
        }
      };
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS auth_users (
          user_id VARCHAR(32) PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          display_name VARCHAR(120) NULL,
          admin_note TEXT NULL,
          password_hash VARCHAR(255) NULL,
          role VARCHAR(24) NOT NULL DEFAULT 'user',
          status VARCHAR(24) NOT NULL DEFAULT 'active',
          password_updated_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          last_login_at DATETIME(3) NULL,
          INDEX idx_auth_users_role_status (role, status),
          INDEX idx_auth_users_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN display_name VARCHAR(120) NULL");
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN admin_note TEXT NULL");
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN password_hash VARCHAR(255) NULL");
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN role VARCHAR(24) NOT NULL DEFAULT 'user'");
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'active'");
      await ensureColumn("ALTER TABLE auth_users ADD COLUMN password_updated_at DATETIME(3) NULL");
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token VARCHAR(96) PRIMARY KEY,
          user_id VARCHAR(32) NOT NULL,
          created_at DATETIME(3) NOT NULL,
          last_seen_at DATETIME(3) NOT NULL,
          expires_at DATETIME(3) NOT NULL,
          INDEX idx_auth_sessions_user_id (user_id),
          INDEX idx_auth_sessions_expires_at (expires_at),
          CONSTRAINT fk_auth_sessions_user
            FOREIGN KEY (user_id) REFERENCES auth_users(user_id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS auth_email_codes (
          email VARCHAR(255) PRIMARY KEY,
          code_hash VARCHAR(64) NOT NULL,
          purpose VARCHAR(32) NOT NULL DEFAULT 'login',
          expires_at DATETIME(3) NOT NULL,
          last_sent_at DATETIME(3) NOT NULL,
          attempts INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await ensureColumn("ALTER TABLE auth_email_codes ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'login'");

      await withTransaction(async (connection) => {
        const [rows] = await connection.execute(
          `
            SELECT user_id, email, role, status, created_at
            FROM auth_users
            ORDER BY created_at ASC, user_id ASC
            FOR UPDATE
          `,
        );

        if (!rows.length) return;

        let hasSuperAdmin = rows.some((row) => normalizeRole(row.role, "user") === "super_admin");
        if (!hasSuperAdmin) {
          const firstUser = rows[0];
          await connection.execute(
            "UPDATE auth_users SET role = 'super_admin', updated_at = ? WHERE user_id = ?",
            [toDbDateTime(), firstUser.user_id],
          );
          hasSuperAdmin = true;
        }

        for (const row of rows) {
          const nextRole = resolveStoredRole(row);
          const nextStatus = normalizeStatus(row.status, "active");
          const currentRole = normalizeRole(row.role, "user");
          if (nextRole !== currentRole || nextStatus !== String(row.status || "active")) {
            await connection.execute(
              "UPDATE auth_users SET role = ?, status = ?, updated_at = ? WHERE user_id = ?",
              [nextRole, nextStatus, toDbDateTime(), row.user_id],
            );
          }
        }
      });
    })();
  }

  return authSchemaPromise;
};

const cleanupExpiredAuthArtifacts = async (executor = null) => {
  await ensureAuthSchema();
  const db = executor || (await getPool());
  const now = toDbDateTime();
  await db.execute("DELETE FROM auth_email_codes WHERE expires_at <= ?", [now]);
  await db.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", [now]);
};

const ensureUserCanSignIn = (row) => {
  if (!row) {
    throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  const status = normalizeStatus(row.status, "active");
  if (status !== "active") {
    throw new AuthError("AUTH_USER_DISABLED", "This account has been disabled");
  }
};

const getRegistrationStatus = async () => {
  await ensureAuthSchema();
  await cleanupExpiredAuthArtifacts();
  const rows = await query("SELECT COUNT(*) AS total FROM auth_users");
  const totalUsers = Number(rows?.[0]?.total || 0);
  return {
    totalUsers,
    hasUsers: totalUsers > 0,
    firstUserWillBeSuperAdmin: totalUsers === 0,
    passwordLoginEnabled: true,
  };
};

const getLockedUserByEmail = async (connection, email) => {
  const [userRows] = await connection.execute(
    "SELECT * FROM auth_users WHERE email = ? LIMIT 1 FOR UPDATE",
    [email],
  );
  return userRows[0] || null;
};

const consumeEmailCodeRecord = async (
  connection,
  email,
  code,
  { purpose = "login" } = {},
) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();
  const normalizedPurpose = normalizeEmailCodePurpose(purpose);

  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AuthError("INVALID_EMAIL_CODE", "Verification code must be 6 digits");
  }

  await cleanupExpiredAuthArtifacts(connection);

  const [codeRows] = await connection.execute(
    "SELECT * FROM auth_email_codes WHERE email = ? FOR UPDATE",
    [normalizedEmail],
  );
  const codeRow = codeRows[0];

  if (!codeRow) {
    throw new AuthError("EMAIL_CODE_REQUIRED", "Please request a verification code first");
  }
  if (new Date(fromDbDateTime(codeRow.expires_at)).getTime() <= Date.now()) {
    await connection.execute("DELETE FROM auth_email_codes WHERE email = ?", [normalizedEmail]);
    throw new AuthError("EMAIL_CODE_EXPIRED", "Verification code has expired");
  }
  if (normalizeEmailCodePurpose(codeRow.purpose) !== normalizedPurpose) {
    await connection.execute("DELETE FROM auth_email_codes WHERE email = ?", [normalizedEmail]);
    throw new AuthError(
      "EMAIL_CODE_PURPOSE_MISMATCH",
      "This verification code does not match the current operation. Please request a new code.",
    );
  }

  const attempts = Number(codeRow.attempts || 0) + 1;
  await connection.execute("UPDATE auth_email_codes SET attempts = ? WHERE email = ?", [
    attempts,
    normalizedEmail,
  ]);
  if (attempts > 5) {
    await connection.execute("DELETE FROM auth_email_codes WHERE email = ?", [normalizedEmail]);
    throw new AuthError(
      "EMAIL_CODE_LOCKED",
      "Too many incorrect attempts, please request a new code",
    );
  }
  if (codeRow.code_hash !== hashCode(normalizedCode)) {
    throw new AuthError("EMAIL_CODE_INVALID", "Verification code is incorrect");
  }

  await connection.execute("DELETE FROM auth_email_codes WHERE email = ?", [normalizedEmail]);
  return normalizedEmail;
};

const requestEmailCode = async (email, { purpose = "login" } = {}) => {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPurpose = normalizeEmailCodePurpose(purpose);
  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }

  const code = String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, "0");
  const now = new Date();
  const nowDb = toDbDateTime(now);
  const expiresAtDb = toDbDateTime(new Date(now.getTime() + EMAIL_CODE_TTL_MS));

  await withTransaction(async (connection) => {
    await cleanupExpiredAuthArtifacts(connection);
    if (normalizedPurpose === "password_reset") {
      const existingUser = await getLockedUserByEmail(connection, normalizedEmail);
      ensureUserCanSignIn(existingUser);
      if (!String(existingUser.password_hash || "").trim()) {
        throw new AuthError(
          "AUTH_PASSWORD_NOT_SET",
          "This account does not have a password yet. Please use email verification to sign in first.",
        );
      }
    }

    const [rows] = await connection.execute(
      "SELECT last_sent_at FROM auth_email_codes WHERE email = ? FOR UPDATE",
      [normalizedEmail],
    );

    const current = rows[0];
    if (current) {
      const lastSentAt = new Date(fromDbDateTime(current.last_sent_at)).getTime();
      const elapsed = Date.now() - lastSentAt;
      if (elapsed < EMAIL_CODE_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((EMAIL_CODE_COOLDOWN_MS - elapsed) / 1000);
        throw new AuthError(
          "EMAIL_CODE_COOLDOWN",
          `Please wait ${waitSeconds} seconds before requesting another code`,
          { waitSeconds },
        );
      }
    }

    await connection.execute(
      `
        INSERT INTO auth_email_codes (email, code_hash, purpose, expires_at, last_sent_at, attempts)
        VALUES (?, ?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          code_hash = VALUES(code_hash),
          purpose = VALUES(purpose),
          expires_at = VALUES(expires_at),
          last_sent_at = VALUES(last_sent_at),
          attempts = 0
      `,
      [normalizedEmail, hashCode(code), normalizedPurpose, expiresAtDb, nowDb],
    );
  });

  try {
    const emailResult = await sendEmailCode(normalizedEmail, code, {
      purpose: normalizedPurpose,
    });
    return {
      email: normalizedEmail,
      expiresInSeconds: Math.floor(EMAIL_CODE_TTL_MS / 1000),
      previewCode: emailResult.previewCode,
    };
  } catch (error) {
    await execute("DELETE FROM auth_email_codes WHERE email = ?", [normalizedEmail]);
    throw error;
  }
};

const upsertRoleForEmailPromotion = async (connection, row) => {
  const nextRole = resolveStoredRole(row);
  const currentRole = normalizeRole(row.role, "user");
  if (nextRole !== currentRole) {
    await connection.execute(
      "UPDATE auth_users SET role = ?, updated_at = ? WHERE user_id = ?",
      [nextRole, toDbDateTime(), row.user_id],
    );
    return {
      ...row,
      role: nextRole,
      updated_at: toDbDateTime(),
    };
  }
  return row;
};

const verifyEmailCode = async (email, code, { purpose = "login" } = {}) => {
  await ensureAuthSchema();

  return withTransaction(async (connection) => {
    const normalizedEmail = await consumeEmailCodeRecord(connection, email, code, {
      purpose,
    });

    const [userRows] = await connection.execute(
      "SELECT * FROM auth_users WHERE email = ? LIMIT 1 FOR UPDATE",
      [normalizedEmail],
    );
    let user = userRows[0];
    const nowDb = toDbDateTime();

    if (!user) {
      const [countRows] = await connection.execute(
        "SELECT COUNT(*) AS total FROM auth_users FOR UPDATE",
      );
      const isFirstUser = Number(countRows?.[0]?.total || 0) === 0;
      const role = isFirstUser ? "super_admin" : resolveStoredRole({ email: normalizedEmail });
      const userId = buildUserId();
      const displayName = toDisplayNameFallback(normalizedEmail);
      await connection.execute(
        `
          INSERT INTO auth_users (
            user_id, email, display_name, password_hash, role, status,
            password_updated_at, created_at, updated_at, last_login_at
          ) VALUES (?, ?, ?, NULL, ?, 'active', NULL, ?, ?, ?)
        `,
        [userId, normalizedEmail, displayName, role, nowDb, nowDb, nowDb],
      );
      user = {
        user_id: userId,
        email: normalizedEmail,
        display_name: displayName,
        password_hash: null,
        role,
        status: "active",
        created_at: nowDb,
        updated_at: nowDb,
        last_login_at: nowDb,
      };
    } else {
      ensureUserCanSignIn(user);
      user = await upsertRoleForEmailPromotion(connection, user);
      await connection.execute(
        "UPDATE auth_users SET updated_at = ?, last_login_at = ? WHERE user_id = ?",
        [nowDb, nowDb, user.user_id],
      );
      user = {
        ...user,
        updated_at: nowDb,
        last_login_at: nowDb,
      };
    }

    const session = createSession(user.user_id);
    await connection.execute(
      `
        INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [session.token, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt],
    );

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
      createdSuperAdmin: normalizeRole(user.role, "user") === "super_admin",
    };
  });
};

const resetPasswordWithEmailCode = async (email, code, password) => {
  await ensureAuthSchema();

  let safePassword = "";
  try {
    safePassword = validatePassword(password);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }

  return withTransaction(async (connection) => {
    const normalizedEmail = await consumeEmailCodeRecord(connection, email, code, {
      purpose: "password_reset",
    });
    let user = await getLockedUserByEmail(connection, normalizedEmail);
    if (!user) {
      throw new AuthError(
        "PASSWORD_RESET_USER_NOT_FOUND",
        "No account was found for this email address",
      );
    }
    ensureUserCanSignIn(user);
    user = await upsertRoleForEmailPromotion(connection, user);

    const nowDb = toDbDateTime();
    const passwordHash = hashPassword(safePassword);
    await connection.execute(
      `
        UPDATE auth_users
        SET password_hash = ?, password_updated_at = ?, updated_at = ?, last_login_at = ?
        WHERE user_id = ?
      `,
      [passwordHash, nowDb, nowDb, nowDb, user.user_id],
    );
    await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [user.user_id]);

    const session = createSession(user.user_id);
    await connection.execute(
      `
        INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [session.token, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt],
    );

    return {
      sessionToken: session.token,
      user: toPublicUser({
        ...user,
        password_hash: passwordHash,
        password_updated_at: nowDb,
        updated_at: nowDb,
        last_login_at: nowDb,
      }),
    };
  });
};

const registerWithPassword = async ({ email, password, displayName = "" }) => {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  const normalizedDisplayName = normalizeDisplayName(displayName);
  let safePassword = "";

  try {
    safePassword = validatePassword(password);
  } catch (error) {
    throw new AuthError("INVALID_PASSWORD", error.message);
  }

  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }

  return withTransaction(async (connection) => {
    await cleanupExpiredAuthArtifacts(connection);

    const [existingRows] = await connection.execute(
      "SELECT * FROM auth_users WHERE email = ? LIMIT 1 FOR UPDATE",
      [normalizedEmail],
    );
    if (existingRows[0]) {
      throw new AuthError("EMAIL_ALREADY_EXISTS", "This email has already been registered");
    }

    const [countRows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM auth_users FOR UPDATE",
    );
    const isFirstUser = Number(countRows?.[0]?.total || 0) === 0;
    const role = isFirstUser ? "super_admin" : resolveStoredRole({ email: normalizedEmail });
    const nowDb = toDbDateTime();
    const userId = buildUserId();
    const passwordHash = hashPassword(safePassword);
    const finalDisplayName = normalizedDisplayName || toDisplayNameFallback(normalizedEmail);

    await connection.execute(
      `
        INSERT INTO auth_users (
          user_id, email, display_name, password_hash, role, status,
          password_updated_at, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `,
      [userId, normalizedEmail, finalDisplayName, passwordHash, role, nowDb, nowDb, nowDb, nowDb],
    );

    const session = createSession(userId);
    await connection.execute(
      `
        INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [session.token, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt],
    );

    return {
      sessionToken: session.token,
      user: toPublicUser({
        user_id: userId,
        email: normalizedEmail,
        display_name: finalDisplayName,
        password_hash: passwordHash,
        role,
        status: "active",
        created_at: nowDb,
        updated_at: nowDb,
        last_login_at: nowDb,
      }),
      createdSuperAdmin: role === "super_admin",
    };
  });
};

const loginWithPassword = async ({ email, password }) => {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || "");

  if (!isValidEmail(normalizedEmail)) {
    throw new AuthError("INVALID_EMAIL", "Please enter a valid email address");
  }
  if (!rawPassword) {
    throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  return withTransaction(async (connection) => {
    await cleanupExpiredAuthArtifacts(connection);
    const [rows] = await connection.execute(
      "SELECT * FROM auth_users WHERE email = ? LIMIT 1 FOR UPDATE",
      [normalizedEmail],
    );
    let user = rows[0];
    ensureUserCanSignIn(user);

    if (!String(user.password_hash || "").trim()) {
      throw new AuthError(
        "AUTH_PASSWORD_NOT_SET",
        "This account does not have a password yet. Please use another sign-in method first.",
      );
    }
    if (!verifyPassword(rawPassword, user.password_hash)) {
      throw new AuthError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    user = await upsertRoleForEmailPromotion(connection, user);
    const nowDb = toDbDateTime();
    await connection.execute(
      "UPDATE auth_users SET updated_at = ?, last_login_at = ? WHERE user_id = ?",
      [nowDb, nowDb, user.user_id],
    );
    user = {
      ...user,
      updated_at: nowDb,
      last_login_at: nowDb,
    };

    const session = createSession(user.user_id);
    await connection.execute(
      `
        INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [session.token, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt],
    );

    return {
      sessionToken: session.token,
      user: toPublicUser(user),
    };
  });
};

const getSessionTokenFromRequest = (req) => String(req.headers["x-auth-session"] || "").trim();

const getSessionUserFromRequest = async (req) => {
  await ensureAuthSchema();
  const token = getSessionTokenFromRequest(req);
  if (!token || !validateSessionToken(token)) {
    return null;
  }

  return withTransaction(async (connection) => {
    await cleanupExpiredAuthArtifacts(connection);
    const [rows] = await connection.execute(
      `
        SELECT
          s.token,
          s.user_id,
          s.created_at AS session_created_at,
          s.last_seen_at,
          s.expires_at,
          u.user_id,
          u.email,
          u.display_name,
          u.password_hash,
          u.role,
          u.status,
          u.created_at,
          u.updated_at,
          u.last_login_at
        FROM auth_sessions s
        INNER JOIN auth_users u ON u.user_id = s.user_id
        WHERE s.token = ?
        LIMIT 1
        FOR UPDATE
      `,
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(fromDbDateTime(row.expires_at)).getTime() <= Date.now()) {
      await connection.execute("DELETE FROM auth_sessions WHERE token = ?", [token]);
      return null;
    }
    if (normalizeStatus(row.status, "active") !== "active") {
      await connection.execute("DELETE FROM auth_sessions WHERE token = ?", [token]);
      return null;
    }

    const promotedRow = await upsertRoleForEmailPromotion(connection, row);
    const now = new Date();
    const lastSeenAt = toDbDateTime(now);
    const expiresAt = toDbDateTime(new Date(now.getTime() + SESSION_TTL_MS));
    await connection.execute(
      "UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?",
      [lastSeenAt, expiresAt, token],
    );
    await connection.execute("UPDATE auth_users SET updated_at = ? WHERE user_id = ?", [
      lastSeenAt,
      row.user_id,
    ]);

    return toPublicUser({
      ...promotedRow,
      updated_at: lastSeenAt,
    });
  });
};

const requireAuthUser = async (req) => {
  const user = req.authUser || (await getSessionUserFromRequest(req));
  if (!user) {
    throw new AuthError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }
  return user;
};

const setUserPassword = async (authUser, password) => {
  await ensureAuthSchema();
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

  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM auth_users WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [targetUserId],
    );
    const user = rows[0];
    ensureUserCanSignIn(user);

    const nowDb = toDbDateTime();
    const passwordHash = hashPassword(safePassword);
    await connection.execute(
      `
        UPDATE auth_users
        SET password_hash = ?, password_updated_at = ?, updated_at = ?
        WHERE user_id = ?
      `,
      [passwordHash, nowDb, nowDb, targetUserId],
    );

    return toPublicUser({
      ...user,
      password_hash: passwordHash,
      password_updated_at: nowDb,
      updated_at: nowDb,
    });
  });
};

const changeUserPassword = async (authUser, currentPassword, newPassword) => {
  await ensureAuthSchema();
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

  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM auth_users WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [targetUserId],
    );
    const user = rows[0];
    ensureUserCanSignIn(user);

    if (!String(user.password_hash || "").trim()) {
      throw new AuthError(
        "AUTH_PASSWORD_NOT_SET",
        "This account does not have a password yet. Please set a password first.",
      );
    }
    if (!verifyPassword(currentPasswordText, user.password_hash)) {
      throw new AuthError("AUTH_INVALID_CURRENT_PASSWORD", "Current password is incorrect");
    }

    const nowDb = toDbDateTime();
    const passwordHash = hashPassword(safePassword);
    await connection.execute(
      `
        UPDATE auth_users
        SET password_hash = ?, password_updated_at = ?, updated_at = ?
        WHERE user_id = ?
      `,
      [passwordHash, nowDb, nowDb, targetUserId],
    );

    return toPublicUser({
      ...user,
      password_hash: passwordHash,
      password_updated_at: nowDb,
      updated_at: nowDb,
    });
  });
};

const requireSuperAdminAccess = async (req) => {
  const user = await requireAuthUser(req);
  if (!hasSuperAdminRole(user.role)) {
    throw new AuthError("SUPER_ADMIN_REQUIRED", "Super administrator access is required");
  }
  return user;
};

const logoutSession = async (req) => {
  await ensureAuthSchema();
  const token = getSessionTokenFromRequest(req);
  if (!token) return false;
  const result = await execute("DELETE FROM auth_sessions WHERE token = ?", [token]);
  return Number(result.affectedRows || 0) > 0;
};

const requireAdminAccess = async (req, fallbackApiKeys = []) => {
  const authUser = req.authUser || (await getSessionUserFromRequest(req));
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

const normalizePagination = ({ page = 1, pageSize = 20 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
};

const listAdminUsers = async ({ search = "", page = 1, pageSize = 20, includeAdminNote = false } = {}) => {
  await ensureAuthSchema();
  await cleanupExpiredAuthArtifacts();

  const trimmedSearch = String(search || "").trim();
  const { offset, page: safePage, pageSize: safePageSize } = normalizePagination({
    page,
    pageSize,
  });
  const filters = [];
  const params = [];
  if (trimmedSearch) {
    filters.push("(email LIKE ? OR display_name LIKE ? OR user_id LIKE ?)");
    const pattern = `%${trimmedSearch}%`;
    params.push(pattern, pattern, pattern);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM auth_users ${whereClause}`,
    params,
  );
  const total = Number(countRows?.[0]?.total || 0);

  const rows = await query(
    `
      SELECT *
      FROM auth_users
      ${whereClause}
      ORDER BY created_at DESC, user_id DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `,
    params,
  );

  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    users: rows.map((row) => toPublicUser(row, { includeAdminNote })),
  };
};

const getAdminAuthOverview = async ({
  onlineWindowMinutes = 5,
  recentWindowDays = 7,
} = {}) => {
  await ensureAuthSchema();
  await cleanupExpiredAuthArtifacts();

  const safeOnlineWindowMinutes = Math.max(
    1,
    Number.parseInt(String(onlineWindowMinutes || 5), 10) || 5,
  );
  const safeRecentWindowDays = Math.max(
    1,
    Number.parseInt(String(recentWindowDays || 7), 10) || 7,
  );

  const [users, sessions] = await Promise.all([
    query(
      `
        SELECT user_id, role, status, created_at
        FROM auth_users
      `,
    ),
    query(
      `
        SELECT user_id, last_seen_at, expires_at
        FROM auth_sessions
      `,
    ),
  ]);

  const nowMs = Date.now();
  const onlineCutoffMs = nowMs - safeOnlineWindowMinutes * 60 * 1000;
  const recentUsersCutoffMs = nowMs - safeRecentWindowDays * 24 * 60 * 60 * 1000;

  let totalUsers = 0;
  let activeUsers = 0;
  let disabledUsers = 0;
  let adminUsers = 0;
  let superAdminUsers = 0;
  let recentUsers = 0;
  let latestUserCreatedAt = null;

  for (const row of users || []) {
    totalUsers += 1;
    const role = normalizeRole(row.role, "user");
    const status = normalizeStatus(row.status, "active");
    const createdAt = fromDbDateTime(row.created_at);
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

  for (const row of sessions || []) {
    const expiresAt = fromDbDateTime(row.expires_at);
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      continue;
    }

    totalSessions += 1;

    const lastSeenAt = fromDbDateTime(row.last_seen_at);
    const lastSeenAtMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    if (Number.isFinite(lastSeenAtMs) && lastSeenAtMs >= onlineCutoffMs) {
      activeSessions += 1;
      if (row.user_id) {
        onlineUserIds.add(String(row.user_id));
      }
    }
  }

  return {
    totalUsers,
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

const getAdminUserById = async (userId, { includeAdminNote = false } = {}) => {
  await ensureAuthSchema();
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) return null;
  const rows = await query("SELECT * FROM auth_users WHERE user_id = ? LIMIT 1", [targetUserId]);
  if (!rows?.[0]) return null;
  return toPublicUser(rows[0], { includeAdminNote });
};

const updateAdminUser = async (actor, userId, changes = {}) => {
  await ensureAuthSchema();
  if (!hasSuperAdminRole(actor?.role)) {
    throw new AuthError("SUPER_ADMIN_REQUIRED", "Super administrator access is required");
  }

  const targetUserId = String(userId || "").trim();
  if (!targetUserId) {
    throw new AuthError("USER_NOT_FOUND", "User does not exist");
  }

  return withTransaction(async (connection) => {
    await cleanupExpiredAuthArtifacts(connection);
    const [rows] = await connection.execute(
      "SELECT * FROM auth_users WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [targetUserId],
    );
    const existing = rows[0];
    if (!existing) {
      throw new AuthError("USER_NOT_FOUND", "User does not exist");
    }

    const nextDisplayName =
      Object.prototype.hasOwnProperty.call(changes, "displayName")
        ? normalizeDisplayName(changes.displayName) || toDisplayNameFallback(existing.email)
        : normalizeDisplayName(existing.display_name) || toDisplayNameFallback(existing.email);
    const nextRole =
      Object.prototype.hasOwnProperty.call(changes, "role")
        ? normalizeRole(changes.role, normalizeRole(existing.role, "user"))
        : normalizeRole(existing.role, "user");
    const nextStatus =
      Object.prototype.hasOwnProperty.call(changes, "status")
        ? normalizeStatus(changes.status, normalizeStatus(existing.status, "active"))
        : normalizeStatus(existing.status, "active");
    const nextAdminNote =
      Object.prototype.hasOwnProperty.call(changes, "adminNote")
        ? String(changes.adminNote || "").trim().slice(0, 2000)
        : String(existing.admin_note || "").trim();

    if (!["user", "admin", "super_admin"].includes(nextRole)) {
      throw new AuthError("INVALID_USER_ROLE", "Unsupported user role");
    }
    if (!["active", "disabled"].includes(nextStatus)) {
      throw new AuthError("INVALID_USER_STATUS", "Unsupported user status");
    }

    const currentRole = normalizeRole(existing.role, "user");
    const targetWasSuperAdmin = currentRole === "super_admin";
    const targetWillRemainSuperAdmin = nextRole === "super_admin" && nextStatus === "active";
    const targetLosesLastSuperAdmin =
      targetWasSuperAdmin && !targetWillRemainSuperAdmin;

    if (targetUserId === actor.userId && targetLosesLastSuperAdmin) {
      throw new AuthError(
        "LAST_SUPER_ADMIN_PROTECTED",
        "You cannot remove your own final super administrator access",
      );
    }

    if (targetLosesLastSuperAdmin) {
      const [superRows] = await connection.execute(
        `
          SELECT COUNT(*) AS total
          FROM auth_users
          WHERE role = 'super_admin' AND status = 'active' AND user_id <> ?
        `,
        [targetUserId],
      );
      const otherSuperAdmins = Number(superRows?.[0]?.total || 0);
      if (otherSuperAdmins <= 0) {
        throw new AuthError(
          "LAST_SUPER_ADMIN_PROTECTED",
          "At least one active super administrator must remain",
        );
      }
    }

    const nowDb = toDbDateTime();
    await connection.execute(
      `
        UPDATE auth_users
        SET display_name = ?, role = ?, status = ?, admin_note = ?, updated_at = ?
        WHERE user_id = ?
      `,
      [nextDisplayName, nextRole, nextStatus, nextAdminNote || null, nowDb, targetUserId],
    );

    if (nextStatus !== "active") {
      await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [targetUserId]);
    }

    return toPublicUser({
      ...existing,
      display_name: nextDisplayName,
      role: nextRole,
      status: nextStatus,
      admin_note: nextAdminNote,
      updated_at: nowDb,
    }, { includeAdminNote: true });
  });
};

module.exports = {
  AuthError,
  ensureAuthSchema,
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
