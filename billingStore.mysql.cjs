const { randomBytes } = require("crypto");
const imageRouteCatalog = require("./config/imageRoutes.json");
const { buildBillingLedgerReport } = require("./billingReportUtils.cjs");
const {
  toNonNegativePoint,
  toPointNumber,
  toPositivePoint,
  toSignedPoint,
} = require("./pointMath.cjs");
const {
  execute,
  fromDbDateTime,
  getPool,
  query,
  toDbDateTime,
  withTransaction,
} = require("./db.cjs");

const LEDGER_LIMIT = 5000;
const SETTLED_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

class BillingError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const parsePositiveInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 ? parsed : 0;
};

const DEFAULT_SIGNUP_POINTS = () => toPositivePoint(process.env.DEFAULT_SIGNUP_POINTS, 0);
const BILLING_LOCK_TIMEOUT_SECONDS = parsePositiveInteger(
  process.env.BILLING_LOCK_TIMEOUT_SECONDS,
  5,
);

const normalizeRedeemCode = (value = "") =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const formatRedeemCode = (value = "") => {
  const normalized = normalizeRedeemCode(value);
  if (!normalized) return "";
  return normalized.match(/.{1,4}/g)?.join("-") || normalized;
};

const createRedeemCodeValue = () =>
  `NB${randomBytes(8).toString("hex").toUpperCase()}`;

const normalizeLockKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_");

const buildNamedLock = (prefix, value) => {
  const key = normalizeLockKey(value) || randomBytes(6).toString("hex");
  return `${prefix}:${key}`.slice(0, 64);
};

const withNamedLock = async (connection, lockName, runner) => {
  const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS locked", [
    lockName,
    BILLING_LOCK_TIMEOUT_SECONDS,
  ]);
  const locked = Number(rows?.[0]?.locked || 0) === 1;
  if (!locked) {
    throw new BillingError(
      "ACCOUNT_BUSY",
      "Account is busy, please retry in a moment",
    );
  }

  try {
    return await runner();
  } finally {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => null);
  }
};

let billingSchemaPromise = null;

const ensureBillingSchema = async () => {
  if (!billingSchemaPromise) {
    billingSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS billing_accounts (
          account_id VARCHAR(32) PRIMARY KEY,
          owner_user_id VARCHAR(32) NOT NULL UNIQUE,
          owner_email VARCHAR(255) NOT NULL,
          points DECIMAL(12,1) NOT NULL DEFAULT 0,
          total_recharged DECIMAL(12,1) NOT NULL DEFAULT 0,
          total_spent DECIMAL(12,1) NOT NULL DEFAULT 0,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          last_seen_at DATETIME(3) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS billing_ledger (
          id VARCHAR(40) PRIMARY KEY,
          type VARCHAR(24) NOT NULL,
          account_id VARCHAR(32) NOT NULL,
          points DECIMAL(12,1) NOT NULL,
          balance_after DECIMAL(12,1) NOT NULL,
          created_at DATETIME(3) NOT NULL,
          meta_json LONGTEXT NULL,
          refunded_at DATETIME(3) NULL,
          refund_reason VARCHAR(128) NULL,
          INDEX idx_billing_ledger_account_created (account_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS billing_pending_tasks (
          task_id VARCHAR(255) PRIMARY KEY,
          account_id VARCHAR(32) NOT NULL,
          charge_id VARCHAR(40) NULL,
          points DECIMAL(12,1) NOT NULL DEFAULT 0,
          route_id VARCHAR(80) NULL,
          action_name VARCHAR(40) NULL,
          created_at DATETIME(3) NOT NULL,
          settled_at DATETIME(3) NULL,
          status VARCHAR(24) NOT NULL,
          refund_id VARCHAR(40) NULL,
          refunded_at DATETIME(3) NULL,
          INDEX idx_billing_pending_tasks_settled_at (settled_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS billing_redeem_codes (
          code_value VARCHAR(40) PRIMARY KEY,
          points DECIMAL(12,1) NOT NULL,
          note VARCHAR(255) NULL,
          created_by_user_id VARCHAR(32) NULL,
          created_by_email VARCHAR(255) NULL,
          created_at DATETIME(3) NOT NULL,
          redeemed_by_user_id VARCHAR(32) NULL,
          redeemed_by_email VARCHAR(255) NULL,
          redeemed_account_id VARCHAR(32) NULL,
          redeemed_at DATETIME(3) NULL,
          INDEX idx_billing_redeem_codes_created_at (created_at),
          INDEX idx_billing_redeem_codes_redeemed_at (redeemed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      const ensureOneDecimalColumn = async (tableName, columnName, definition) => {
        const [rows] = await pool.execute(
          `
            SELECT DATA_TYPE, NUMERIC_SCALE
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            LIMIT 1
          `,
          [tableName, columnName],
        );
        const row = rows?.[0] || null;
        const dataType = String(row?.DATA_TYPE || "").toLowerCase();
        const numericScale = Number.parseInt(String(row?.NUMERIC_SCALE ?? "-1"), 10);
        if (dataType === "decimal" && numericScale === 1) return;
        await pool.execute(
          `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definition}`,
        );
      };

      await ensureOneDecimalColumn("billing_accounts", "points", "DECIMAL(12,1) NOT NULL DEFAULT 0");
      await ensureOneDecimalColumn(
        "billing_accounts",
        "total_recharged",
        "DECIMAL(12,1) NOT NULL DEFAULT 0",
      );
      await ensureOneDecimalColumn(
        "billing_accounts",
        "total_spent",
        "DECIMAL(12,1) NOT NULL DEFAULT 0",
      );
      await ensureOneDecimalColumn("billing_ledger", "points", "DECIMAL(12,1) NOT NULL");
      await ensureOneDecimalColumn(
        "billing_ledger",
        "balance_after",
        "DECIMAL(12,1) NOT NULL",
      );
      await ensureOneDecimalColumn(
        "billing_pending_tasks",
        "points",
        "DECIMAL(12,1) NOT NULL DEFAULT 0",
      );
      await ensureOneDecimalColumn(
        "billing_redeem_codes",
        "points",
        "DECIMAL(12,1) NOT NULL",
      );
    })();
  }

  return billingSchemaPromise;
};

const cleanupBillingArtifacts = async (executor = null) => {
  await ensureBillingSchema();
  const db = executor || (await getPool());
  const cutoff = toDbDateTime(new Date(Date.now() - SETTLED_TASK_RETENTION_MS));
  await db.execute(
    "DELETE FROM billing_pending_tasks WHERE settled_at IS NOT NULL AND settled_at < ?",
    [cutoff],
  );
  await db.execute(
    `
      DELETE l FROM billing_ledger l
      INNER JOIN (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS row_num
          FROM billing_ledger
        ) ranked
        WHERE ranked.row_num > ?
      ) extra ON extra.id = l.id
    `,
    [LEDGER_LIMIT],
  ).catch(() => Promise.resolve());
};

const withAccountSerializedTransaction = async (accountId, runner) => {
  const targetAccountId = String(accountId || "").trim();
  if (!targetAccountId) {
    throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
  }

  await ensureBillingSchema();
  return withTransaction(async (connection) => {
    await cleanupBillingArtifacts(connection);
    return withNamedLock(
      connection,
      buildNamedLock("billing:account", targetAccountId),
      () => runner(connection, targetAccountId),
    );
  });
};

const withUserSerializedTransaction = async (userId, runner) => {
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) {
    throw new BillingError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  await ensureBillingSchema();
  return withTransaction(async (connection) => {
    await cleanupBillingArtifacts(connection);
    return withNamedLock(
      connection,
      buildNamedLock("billing:user", targetUserId),
      () => runner(connection, targetUserId),
    );
  });
};

const publicAccount = (account) => ({
  accountId: account.account_id || account.accountId,
  ownerUserId: account.owner_user_id || account.ownerUserId || "",
  ownerEmail: account.owner_email || account.ownerEmail || "",
  points: toPointNumber(account.points || 0),
  totalRecharged: toPointNumber(account.total_recharged || account.totalRecharged || 0),
  totalSpent: toPointNumber(account.total_spent || account.totalSpent || 0),
  createdAt: fromDbDateTime(account.created_at || account.createdAt),
  updatedAt: fromDbDateTime(account.updated_at || account.updatedAt),
  lastSeenAt: fromDbDateTime(account.last_seen_at || account.lastSeenAt),
});

const parseLedgerMeta = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return { raw: String(value) };
  }
};

const publicLedgerEntry = (entry) => ({
  id: entry.id,
  type: String(entry.type || "").trim(),
  accountId: entry.account_id || entry.accountId || "",
  points: toPointNumber(entry.points || 0),
  balanceAfter: toPointNumber(entry.balance_after || entry.balanceAfter || 0),
  createdAt: fromDbDateTime(entry.created_at || entry.createdAt),
  refundedAt: fromDbDateTime(entry.refunded_at || entry.refundedAt),
  refundReason: String(entry.refund_reason || entry.refundReason || "").trim() || null,
  meta: parseLedgerMeta(entry.meta_json || entry.meta),
});

const publicRedeemCode = (entry) => ({
  code: formatRedeemCode(entry.code_value || entry.codeValue || entry.code || ""),
  normalizedCode: normalizeRedeemCode(
    entry.code_value || entry.codeValue || entry.code || "",
  ),
  points: toPointNumber(entry.points || 0),
  note: String(entry.note || "").trim(),
  createdByUserId: String(entry.created_by_user_id || entry.createdByUserId || "").trim() || null,
  createdByEmail: String(entry.created_by_email || entry.createdByEmail || "").trim() || null,
  createdAt: fromDbDateTime(entry.created_at || entry.createdAt),
  redeemedByUserId:
    String(entry.redeemed_by_user_id || entry.redeemedByUserId || "").trim() || null,
  redeemedByEmail:
    String(entry.redeemed_by_email || entry.redeemedByEmail || "").trim() || null,
  redeemedAccountId:
    String(entry.redeemed_account_id || entry.redeemedAccountId || "").trim() || null,
  redeemedAt: fromDbDateTime(entry.redeemed_at || entry.redeemedAt),
  status: entry.redeemed_at || entry.redeemedAt ? "redeemed" : "active",
});

const getBillingPricing = () =>
  (imageRouteCatalog.routes || []).map((route) => ({
    routeId: route.id,
    label: route.label,
    line: route.line,
    modelFamily: route.modelFamily,
    mode: route.mode,
    transport: route.transport,
    pointCost: toPointNumber(route.pointCost || 0),
  }));

const getOrCreateAccountInTx = async (connection, user) => {
  const userId = String(user?.userId || "").trim();
  if (!userId) {
    throw new BillingError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  const [rows] = await connection.execute(
    "SELECT * FROM billing_accounts WHERE owner_user_id = ? LIMIT 1 FOR UPDATE",
    [userId],
  );
  let account = rows[0];

  if (!account) {
    const now = new Date();
    const accountId = `acct_${randomBytes(8).toString("hex")}`;
    const signupPoints = DEFAULT_SIGNUP_POINTS();
    const nowDb = toDbDateTime(now);

    await connection.execute(
      `
        INSERT INTO billing_accounts (
          account_id, owner_user_id, owner_email, points,
          total_recharged, total_spent, created_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `,
      [accountId, userId, String(user.email || "").trim().toLowerCase(), signupPoints, signupPoints, nowDb, nowDb, nowDb],
    );

    if (signupPoints >= 0) {
      await connection.execute(
        `
          INSERT INTO billing_ledger (
            id, type, account_id, points, balance_after, created_at, meta_json
          ) VALUES (?, 'signup', ?, ?, ?, ?, ?)
        `,
        [
          `led_${randomBytes(8).toString("hex")}`,
          accountId,
          signupPoints,
          signupPoints,
          nowDb,
          JSON.stringify({
            ownerUserId: userId,
            ownerEmail: String(user.email || "").trim().toLowerCase(),
          }),
        ],
      );
    }

    account = {
      account_id: accountId,
      owner_user_id: userId,
      owner_email: String(user.email || "").trim().toLowerCase(),
      points: signupPoints,
      total_recharged: signupPoints,
      total_spent: 0,
      created_at: nowDb,
      updated_at: nowDb,
      last_seen_at: nowDb,
    };
    return account;
  }

  const nowDb = toDbDateTime();
  const ownerEmail = String(user.email || account.owner_email || "").trim().toLowerCase();
  await connection.execute(
    `
      UPDATE billing_accounts
      SET owner_email = ?, updated_at = ?, last_seen_at = ?
      WHERE account_id = ?
    `,
    [ownerEmail, nowDb, nowDb, account.account_id],
  );

  return {
    ...account,
    owner_email: ownerEmail,
    updated_at: nowDb,
    last_seen_at: nowDb,
  };
};

const ensureAccountForUser = async (user) => {
  const userId = String(user?.userId || "").trim();
  return withUserSerializedTransaction(userId, async (connection) => {
    const account = await getOrCreateAccountInTx(connection, user);
    return publicAccount(account);
  });
};

const ensureBillingIdentity = async (req) => ({
  account: await requireBillingAccount(req),
  accessToken: null,
});

const requireBillingAccount = async (req) => {
  const authUser = req?.authUser;
  if (!authUser?.userId) {
    throw new BillingError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }
  return ensureAccountForUser(authUser);
};

const getAccountSummary = async (accountId) => {
  await ensureBillingSchema();
  await cleanupBillingArtifacts();
  const rows = await query("SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1", [accountId]);
  const account = rows[0];
  if (!account) {
    throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
  }

  const nowDb = toDbDateTime();
  await execute(
    "UPDATE billing_accounts SET updated_at = ?, last_seen_at = ? WHERE account_id = ?",
    [nowDb, nowDb, accountId],
  );

  return publicAccount({
    ...account,
    updated_at: nowDb,
    last_seen_at: nowDb,
  });
};

const getAccountByUserId = async (userId) => {
  await ensureBillingSchema();
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) return null;
  const rows = await query(
    "SELECT * FROM billing_accounts WHERE owner_user_id = ? LIMIT 1",
    [targetUserId],
  );
  return rows?.[0] ? publicAccount(rows[0]) : null;
};

const getAccountsByUserIds = async (userIds = []) => {
  await ensureBillingSchema();
  const safeUserIds = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map((item) => String(item || "").trim()).filter(Boolean)),
  );
  if (safeUserIds.length === 0) return {};

  const placeholders = safeUserIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM billing_accounts WHERE owner_user_id IN (${placeholders})`,
    safeUserIds,
  );

  return (rows || []).reduce((accumulator, row) => {
    accumulator[String(row.owner_user_id || "").trim()] = publicAccount(row);
    return accumulator;
  }, {});
};

const getAccountLedger = async (accountId, { page = 1, pageSize = 20 } = {}) => {
  await ensureBillingSchema();
  await cleanupBillingArtifacts();

  const targetAccountId = String(accountId || "").trim();
  if (!targetAccountId) {
    throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
  }

  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
  const offset = (safePage - 1) * safePageSize;

  const countRows = await query(
    "SELECT COUNT(*) AS total FROM billing_ledger WHERE account_id = ?",
    [targetAccountId],
  );
  const total = Number(countRows?.[0]?.total || 0);

  const rows = await query(
    `
      SELECT *
      FROM billing_ledger
      WHERE account_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `,
    [targetAccountId],
  );

  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    entries: (rows || []).map((row) => publicLedgerEntry(row)),
  };
};

const getAccountLedgerReport = async (
  accountId,
  {
    page = 1,
    pageSize = 20,
    startDate = "",
    endDate = "",
    type = "",
    modelId = "",
    routeId = "",
  } = {},
) => {
  await ensureBillingSchema();
  await cleanupBillingArtifacts();

  const targetAccountId = String(accountId || "").trim();
  if (!targetAccountId) {
    throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
  }

  const rows = await query(
    `
      SELECT *
      FROM billing_ledger
      WHERE account_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    [targetAccountId],
  );

  return buildBillingLedgerReport(
    (rows || []).map((row) => publicLedgerEntry(row)),
    {
      page,
      pageSize,
      startDate,
      endDate,
      type,
      modelId,
      routeId,
    },
  );
};

const createMetricBucket = (seed = {}) => ({
  totalCharges: 0,
  successfulCharges: 0,
  failedCharges: 0,
  pendingTasks: 0,
  grossChargePoints: 0,
  refundedPoints: 0,
  netSpentPoints: 0,
  requestsLast24h: 0,
  successfulLast24h: 0,
  failedLast24h: 0,
  lastChargeAt: null,
  ...seed,
});

const buildAdminBillingOverviewFromRows = ({
  accounts = [],
  chargeEntries = [],
  pendingTasks = [],
  recentWindowHours = 24,
} = {}) => {
  const safeRecentWindowHours = Math.max(
    1,
    Number.parseInt(String(recentWindowHours || 24), 10) || 24,
  );
  const recentCutoffMs = Date.now() - safeRecentWindowHours * 60 * 60 * 1000;

  const overall = createMetricBucket({
    totalAccounts: 0,
    totalBalancePoints: 0,
    totalRechargedPoints: 0,
    totalSpentPoints: 0,
  });
  const routeStats = new Map();
  const modelStats = new Map();

  const touchLatestTimestamp = (currentValue, nextValue) => {
    if (!nextValue) return currentValue || null;
    if (!currentValue) return nextValue;
    return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
  };

  const applyChargeToBucket = (bucket, { refunded, isRecent, createdAt, points }) => {
    bucket.totalCharges += 1;
    bucket.grossChargePoints = toPointNumber(bucket.grossChargePoints + points, 0);
    bucket.lastChargeAt = touchLatestTimestamp(bucket.lastChargeAt, createdAt);

    if (refunded) {
      bucket.failedCharges += 1;
      bucket.refundedPoints = toPointNumber(bucket.refundedPoints + points, 0);
      if (isRecent) bucket.failedLast24h += 1;
    } else {
      bucket.successfulCharges += 1;
      bucket.netSpentPoints = toPointNumber(bucket.netSpentPoints + points, 0);
      if (isRecent) bucket.successfulLast24h += 1;
    }

    if (isRecent) {
      bucket.requestsLast24h += 1;
    }
  };

  for (const account of accounts || []) {
    overall.totalAccounts += 1;
    overall.totalBalancePoints = toPointNumber(
      overall.totalBalancePoints + toPointNumber(account.points || 0),
      0,
    );
    overall.totalRechargedPoints = toPointNumber(
      overall.totalRechargedPoints + toPointNumber(account.total_recharged || 0),
      0,
    );
    overall.totalSpentPoints = toPointNumber(
      overall.totalSpentPoints + toPointNumber(account.total_spent || 0),
      0,
    );
  }

  for (const task of pendingTasks || []) {
    if (String(task.status || "").toUpperCase() !== "PENDING" || task.settled_at) {
      continue;
    }

    overall.pendingTasks += 1;
    const routeId = String(task.route_id || "").trim() || "unknown";
    const routeBucket = routeStats.get(routeId) || createMetricBucket({ routeId });
    routeBucket.pendingTasks += 1;
    routeStats.set(routeId, routeBucket);
  }

  for (const entry of chargeEntries || []) {
    const meta = parseLedgerMeta(entry.meta_json || entry.meta);
    const createdAt =
      fromDbDateTime(entry.created_at || entry.createdAt) ||
      String(entry.created_at || entry.createdAt || "").trim() ||
      null;
    const createdAtMs = createdAt ? Date.parse(createdAt) : NaN;
    const isRecent = Number.isFinite(createdAtMs) && createdAtMs >= recentCutoffMs;
    const refunded = Boolean(entry.refunded_at || entry.refundedAt);
    const points = toPointNumber(entry.points || 0);

    applyChargeToBucket(overall, { refunded, isRecent, createdAt, points });

    const routeId = String(meta?.routeId || "").trim() || "unknown";
    const routeBucket =
      routeStats.get(routeId) ||
      createMetricBucket({
        routeId,
        line: String(meta?.line || "").trim() || null,
      });
    applyChargeToBucket(routeBucket, { refunded, isRecent, createdAt, points });
    routeStats.set(routeId, routeBucket);

    const modelId = String(meta?.modelId || "").trim();
    const requestModel = String(meta?.model || "").trim();
    const modelKey = modelId || requestModel || "unknown";
    const modelBucket =
      modelStats.get(modelKey) ||
      createMetricBucket({
        modelKey,
        modelId: modelId || null,
        requestModel: requestModel || null,
      });
    applyChargeToBucket(modelBucket, { refunded, isRecent, createdAt, points });
    modelStats.set(modelKey, modelBucket);
  }

  const finalizeBucket = (bucket) => ({
    ...bucket,
    grossChargePoints: toPointNumber(bucket.grossChargePoints, 0),
    refundedPoints: toPointNumber(bucket.refundedPoints, 0),
    netSpentPoints: toPointNumber(bucket.netSpentPoints, 0),
    totalBalancePoints: toPointNumber(bucket.totalBalancePoints, 0),
    totalRechargedPoints: toPointNumber(bucket.totalRechargedPoints, 0),
    totalSpentPoints: toPointNumber(bucket.totalSpentPoints, 0),
    successRate:
      bucket.totalCharges > 0
        ? Number(((bucket.successfulCharges / bucket.totalCharges) * 100).toFixed(1))
        : 0,
    successRateLast24h:
      bucket.requestsLast24h > 0
        ? Number(((bucket.successfulLast24h / bucket.requestsLast24h) * 100).toFixed(1))
        : 0,
  });

  return {
    recentWindowHours: safeRecentWindowHours,
    overall: finalizeBucket(overall),
    routeStats: Array.from(routeStats.values())
      .map((bucket) => finalizeBucket(bucket))
      .sort((left, right) => {
        if (right.requestsLast24h !== left.requestsLast24h) {
          return right.requestsLast24h - left.requestsLast24h;
        }
        if (right.totalCharges !== left.totalCharges) {
          return right.totalCharges - left.totalCharges;
        }
        return String(left.routeId || "").localeCompare(String(right.routeId || ""));
      }),
    modelStats: Array.from(modelStats.values())
      .map((bucket) => finalizeBucket(bucket))
      .sort((left, right) => {
        if (right.requestsLast24h !== left.requestsLast24h) {
          return right.requestsLast24h - left.requestsLast24h;
        }
        if (right.totalCharges !== left.totalCharges) {
          return right.totalCharges - left.totalCharges;
        }
        return String(left.modelKey || "").localeCompare(String(right.modelKey || ""));
      }),
  };
};

const getAdminBillingOverview = async ({ recentWindowHours = 24 } = {}) => {
  await ensureBillingSchema();
  await cleanupBillingArtifacts();

  const [accounts, chargeEntries, pendingTasks] = await Promise.all([
    query(
      `
        SELECT points, total_recharged, total_spent
        FROM billing_accounts
      `,
    ),
    query(
      `
        SELECT points, created_at, meta_json, refunded_at
        FROM billing_ledger
        WHERE type = 'charge'
      `,
    ),
    query(
      `
        SELECT route_id, status, settled_at
        FROM billing_pending_tasks
      `,
    ),
  ]);

  return buildAdminBillingOverviewFromRows({
    accounts,
    chargeEntries,
    pendingTasks,
    recentWindowHours,
  });
};

const reservePoints = async (accountId, points, meta = {}) => {
  return withAccountSerializedTransaction(accountId, async (connection, targetAccountId) => {
    const [rows] = await connection.execute(
      "SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1 FOR UPDATE",
      [targetAccountId],
    );
    const account = rows[0];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const cost = toPositivePoint(points, 0);
    if (cost <= 0) {
      return {
        chargeId: null,
        account: publicAccount(account),
        points: 0,
      };
    }

    const currentPoints = toPointNumber(account.points || 0);
    if (currentPoints < cost) {
      throw new BillingError("INSUFFICIENT_POINTS", "Insufficient points", {
        currentPoints,
        requiredPoints: cost,
      });
    }

    const nextPoints = toPointNumber(currentPoints - cost, 0);
    const nextTotalSpent = toPointNumber(Number(account.total_spent || 0) + cost, 0);
    const nowDb = toDbDateTime();
    await connection.execute(
      `
        UPDATE billing_accounts
        SET points = ?, total_spent = ?, updated_at = ?, last_seen_at = ?
        WHERE account_id = ?
      `,
      [nextPoints, nextTotalSpent, nowDb, nowDb, targetAccountId],
    );

    const chargeId = `chg_${randomBytes(10).toString("hex")}`;
    await connection.execute(
      `
        INSERT INTO billing_ledger (
          id, type, account_id, points, balance_after, created_at, meta_json
        ) VALUES (?, 'charge', ?, ?, ?, ?, ?)
      `,
      [chargeId, targetAccountId, cost, nextPoints, nowDb, JSON.stringify(meta || {})],
    );

    return {
      chargeId,
      account: publicAccount({
        ...account,
        points: nextPoints,
        total_spent: nextTotalSpent,
        updated_at: nowDb,
        last_seen_at: nowDb,
      }),
      points: cost,
    };
  });
};

const refundChargeInTx = async (connection, accountId, chargeId, meta = {}) => {
  if (!accountId || !chargeId) return null;

  const [accountRows] = await connection.execute(
    "SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1 FOR UPDATE",
    [accountId],
  );
  const account = accountRows[0];
  if (!account) return null;

  const [chargeRows] = await connection.execute(
    `
      SELECT * FROM billing_ledger
      WHERE id = ? AND type = 'charge' AND account_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [chargeId, accountId],
  );
  const charge = chargeRows[0];
  if (!charge || charge.refunded_at) return null;

  const refundPointsValue = toPointNumber(charge.points || 0);
    const nextPoints = toPointNumber(toPointNumber(account.points || 0) + refundPointsValue, 0);
  const nextTotalSpent = toNonNegativePoint(
    Number(account.total_spent || 0) - refundPointsValue,
    0,
  );
  const nowDb = toDbDateTime();

  await connection.execute(
    `
      UPDATE billing_accounts
      SET points = ?, total_spent = ?, updated_at = ?, last_seen_at = ?
      WHERE account_id = ?
    `,
    [nextPoints, nextTotalSpent, nowDb, nowDb, accountId],
  );

  await connection.execute(
    `
      UPDATE billing_ledger
      SET refunded_at = ?, refund_reason = ?
      WHERE id = ?
    `,
    [nowDb, meta.reason || "task_failed", chargeId],
  );

  const refundId = `ref_${randomBytes(10).toString("hex")}`;
  await connection.execute(
    `
      INSERT INTO billing_ledger (
        id, type, account_id, points, balance_after, created_at, meta_json
      ) VALUES (?, 'refund', ?, ?, ?, ?, ?)
    `,
    [
      refundId,
      accountId,
      refundPointsValue,
      nextPoints,
      nowDb,
      JSON.stringify({
        ...meta,
        chargeId,
      }),
    ],
  );

  return {
    refundId,
    account: publicAccount({
      ...account,
      points: nextPoints,
      total_spent: nextTotalSpent,
      updated_at: nowDb,
      last_seen_at: nowDb,
    }),
    points: refundPointsValue,
  };
};

const refundPoints = async (accountId, chargeId, meta = {}) => {
  return withAccountSerializedTransaction(accountId, async (connection, targetAccountId) =>
    refundChargeInTx(connection, targetAccountId, chargeId, meta),
  );
};

const registerPendingTask = async (taskId, taskInfo) => {
  await ensureBillingSchema();
  const nowDb = toDbDateTime();
  await execute(
    `
      INSERT INTO billing_pending_tasks (
        task_id, account_id, charge_id, points, route_id,
        action_name, created_at, settled_at, status, refund_id, refunded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', NULL, NULL)
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id),
        charge_id = VALUES(charge_id),
        points = VALUES(points),
        route_id = VALUES(route_id),
        action_name = VALUES(action_name),
        created_at = VALUES(created_at),
        settled_at = NULL,
        status = 'PENDING',
        refund_id = NULL,
        refunded_at = NULL
    `,
    [
      taskId,
      taskInfo.accountId || "",
      taskInfo.chargeId || null,
      toPositivePoint(taskInfo.points, 0),
      taskInfo.routeId || null,
      taskInfo.action || null,
      nowDb,
    ],
  );

  return {
    ...taskInfo,
    createdAt: nowDb.replace(" ", "T") + "Z",
    settledAt: null,
    status: "PENDING",
  };
};

const settlePendingTask = async (taskId, status) => {
  await ensureBillingSchema();
  return withTransaction(async (connection) => {
    await cleanupBillingArtifacts(connection);
    const [rows] = await connection.execute(
      "SELECT * FROM billing_pending_tasks WHERE task_id = ? LIMIT 1 FOR UPDATE",
      [taskId],
    );
    const task = rows[0];
    if (!task) return null;
    if (task.settled_at) return task;

    return withNamedLock(
      connection,
      buildNamedLock("billing:account", task.account_id || ""),
      async () => {
        const normalizedStatus = String(status || "").toUpperCase();
        const nowDb = toDbDateTime();
        let refund = null;

        if (normalizedStatus === "FAILED") {
          refund = await refundChargeInTx(connection, task.account_id, task.charge_id, {
            reason: "task_failed",
            taskId,
            routeId: task.route_id,
          });
        }

        await connection.execute(
          `
            UPDATE billing_pending_tasks
            SET status = ?, settled_at = ?, refund_id = ?, refunded_at = ?
            WHERE task_id = ?
          `,
          [
            normalizedStatus,
            nowDb,
            refund?.refundId || null,
            refund?.account?.updatedAt ? toDbDateTime(refund.account.updatedAt) : null,
            taskId,
          ],
        );

        return {
          ...task,
          status: normalizedStatus,
          settled_at: nowDb,
          refund_id: refund?.refundId || null,
          refunded_at: refund?.account?.updatedAt ? toDbDateTime(refund.account.updatedAt) : null,
        };
      },
    );
  });
};

const rechargeAccount = async (accountId, points, note = "") => {
  return withAccountSerializedTransaction(accountId, async (connection, targetAccountId) => {
    const [rows] = await connection.execute(
      "SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1 FOR UPDATE",
      [targetAccountId],
    );
    const account = rows[0];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const amount = toPositivePoint(points, 0);
    if (amount <= 0) {
      throw new BillingError(
        "INVALID_RECHARGE_POINTS",
        "Recharge points must be greater than zero",
      );
    }

    const nextPoints = toPointNumber(toPointNumber(account.points || 0) + amount, 0);
    const nextTotalRecharged = toPointNumber(
      Number(account.total_recharged || 0) + amount,
      0,
    );
    const nowDb = toDbDateTime();
    await connection.execute(
      `
        UPDATE billing_accounts
        SET points = ?, total_recharged = ?, updated_at = ?, last_seen_at = ?
        WHERE account_id = ?
      `,
      [nextPoints, nextTotalRecharged, nowDb, nowDb, targetAccountId],
    );

    await connection.execute(
      `
        INSERT INTO billing_ledger (
          id, type, account_id, points, balance_after, created_at, meta_json
        ) VALUES (?, 'recharge', ?, ?, ?, ?, ?)
      `,
      [
        `rcg_${randomBytes(10).toString("hex")}`,
        targetAccountId,
        amount,
        nextPoints,
        nowDb,
        JSON.stringify({ note }),
      ],
    );

    return publicAccount({
      ...account,
      points: nextPoints,
      total_recharged: nextTotalRecharged,
      updated_at: nowDb,
      last_seen_at: nowDb,
    });
  });
};

const adjustAccountPoints = async (accountId, deltaPoints, meta = {}) => {
  return withAccountSerializedTransaction(accountId, async (connection, targetAccountId) => {
    const [rows] = await connection.execute(
      "SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1 FOR UPDATE",
      [targetAccountId],
    );
    const account = rows[0];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const delta = toSignedPoint(deltaPoints, 0);
    if (!delta) {
      throw new BillingError(
        "INVALID_ADJUST_POINTS",
        "Adjustment points cannot be zero",
      );
    }

    const nextPoints = toPointNumber(toPointNumber(account.points || 0) + delta, 0);
    if (nextPoints < 0) {
      throw new BillingError("INSUFFICIENT_POINTS", "Insufficient points", {
        currentPoints: toPointNumber(account.points || 0),
        requiredPoints: toPointNumber(Math.abs(delta), 0),
      });
    }

    const nextTotalRecharged = toPointNumber(
      Number(account.total_recharged || 0) + (delta > 0 ? delta : 0),
      0,
    );
    const nowDb = toDbDateTime();
    await connection.execute(
      `
        UPDATE billing_accounts
        SET points = ?, total_recharged = ?, updated_at = ?, last_seen_at = ?
        WHERE account_id = ?
      `,
      [nextPoints, nextTotalRecharged, nowDb, nowDb, targetAccountId],
    );

    const ledgerType = delta > 0 ? "admin_credit" : "admin_debit";
    await connection.execute(
      `
        INSERT INTO billing_ledger (
          id, type, account_id, points, balance_after, created_at, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `adj_${randomBytes(10).toString("hex")}`,
        ledgerType,
        targetAccountId,
        toPointNumber(Math.abs(delta), 0),
        nextPoints,
        nowDb,
        JSON.stringify({
          note: String(meta.note || "").trim(),
          reason: String(meta.reason || "manual_adjust").trim(),
          actorUserId: String(meta.actorUserId || "").trim() || null,
          actorEmail: String(meta.actorEmail || "").trim().toLowerCase() || null,
          delta,
        }),
      ],
    );

    return publicAccount({
      ...account,
      points: nextPoints,
      total_recharged: nextTotalRecharged,
      updated_at: nowDb,
      last_seen_at: nowDb,
    });
  });
};

const createRedeemCodes = async ({
  points,
  quantity = 1,
  note = "",
  createdByUserId = null,
  createdByEmail = null,
} = {}) => {
  await ensureBillingSchema();
  return withTransaction(async (connection) => {
    await cleanupBillingArtifacts(connection);

    const amount = toPositivePoint(points, 0);
    const totalCodes = Math.min(
      100,
      Math.max(1, parsePositiveInteger(quantity, 1)),
    );

    if (amount <= 0) {
      throw new BillingError(
        "INVALID_REDEEM_CODE_POINTS",
        "Redeem code points must be greater than zero",
      );
    }

    const nowDb = toDbDateTime();
    const created = [];

    for (let index = 0; index < totalCodes; index += 1) {
      let codeValue = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = createRedeemCodeValue();
        const [existingRows] = await connection.execute(
          "SELECT code_value FROM billing_redeem_codes WHERE code_value = ? LIMIT 1",
          [candidate],
        );
        if (!existingRows?.length) {
          codeValue = candidate;
          break;
        }
      }

      if (!codeValue) {
        throw new BillingError(
          "REDEEM_CODE_GENERATION_FAILED",
          "Failed to generate a unique redeem code",
        );
      }

      await connection.execute(
        `
          INSERT INTO billing_redeem_codes (
            code_value, points, note, created_by_user_id, created_by_email, created_at,
            redeemed_by_user_id, redeemed_by_email, redeemed_account_id, redeemed_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
        `,
        [
          codeValue,
          amount,
          String(note || "").trim() || null,
          String(createdByUserId || "").trim() || null,
          String(createdByEmail || "").trim().toLowerCase() || null,
          nowDb,
        ],
      );

      created.push(
        publicRedeemCode({
          code_value: codeValue,
          points: amount,
          note,
          created_by_user_id: createdByUserId,
          created_by_email: createdByEmail,
          created_at: nowDb,
        }),
      );
    }

    return created;
  });
};

const listRedeemCodes = async ({
  page = 1,
  pageSize = 20,
  status = "all",
} = {}) => {
  await ensureBillingSchema();
  await cleanupBillingArtifacts();

  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
  const offset = (safePage - 1) * safePageSize;
  const normalizedStatus = String(status || "all").trim().toLowerCase();
  const filters = [];
  const params = [];

  if (normalizedStatus === "active") {
    filters.push("redeemed_at IS NULL");
  } else if (normalizedStatus === "redeemed") {
    filters.push("redeemed_at IS NOT NULL");
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const countRows = await query(
    `SELECT COUNT(*) AS total FROM billing_redeem_codes ${whereClause}`,
    params,
  );
  const total = Number(countRows?.[0]?.total || 0);
  const rows = await query(
    `
      SELECT *
      FROM billing_redeem_codes
      ${whereClause}
      ORDER BY created_at DESC, code_value DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `,
    params,
  );

  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    codes: (rows || []).map((row) => publicRedeemCode(row)),
  };
};

const redeemCode = async (accountId, code, meta = {}) => {
  return withAccountSerializedTransaction(accountId, async (connection, targetAccountId) => {
    const normalizedCode = normalizeRedeemCode(code);
    if (!normalizedCode) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code is required");
    }

    const [accountRows] = await connection.execute(
      "SELECT * FROM billing_accounts WHERE account_id = ? LIMIT 1 FOR UPDATE",
      [targetAccountId],
    );
    const account = accountRows[0];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const [codeRows] = await connection.execute(
      "SELECT * FROM billing_redeem_codes WHERE code_value = ? LIMIT 1 FOR UPDATE",
      [normalizedCode],
    );
    const codeRow = codeRows[0];
    if (!codeRow) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code does not exist");
    }
    if (codeRow.redeemed_at) {
      throw new BillingError("REDEEM_CODE_ALREADY_USED", "Redeem code has already been used", {
        redeemedAt: fromDbDateTime(codeRow.redeemed_at),
      });
    }

    const amount = toPositivePoint(codeRow.points, 0);
    if (amount <= 0) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code is invalid");
    }

    const nextPoints = toPointNumber(toPointNumber(account.points || 0) + amount, 0);
    const nextTotalRecharged = toPointNumber(
      Number(account.total_recharged || 0) + amount,
      0,
    );
    const nowDb = toDbDateTime();
    await connection.execute(
      `
        UPDATE billing_accounts
        SET points = ?, total_recharged = ?, updated_at = ?, last_seen_at = ?
        WHERE account_id = ?
      `,
      [nextPoints, nextTotalRecharged, nowDb, nowDb, targetAccountId],
    );

    await connection.execute(
      `
        UPDATE billing_redeem_codes
        SET redeemed_by_user_id = ?, redeemed_by_email = ?, redeemed_account_id = ?, redeemed_at = ?
        WHERE code_value = ?
      `,
      [
        String(meta.userId || "").trim() || null,
        String(meta.email || "").trim().toLowerCase() || null,
        targetAccountId,
        nowDb,
        normalizedCode,
      ],
    );

    await connection.execute(
      `
        INSERT INTO billing_ledger (
          id, type, account_id, points, balance_after, created_at, meta_json
        ) VALUES (?, 'redeem_code', ?, ?, ?, ?, ?)
      `,
      [
        `gft_${randomBytes(10).toString("hex")}`,
        targetAccountId,
        amount,
        nextPoints,
        nowDb,
        JSON.stringify({
          code: formatRedeemCode(normalizedCode),
          normalizedCode,
          note: String(codeRow.note || "").trim() || null,
          createdByUserId: String(codeRow.created_by_user_id || "").trim() || null,
          createdByEmail: String(codeRow.created_by_email || "").trim() || null,
          redeemedByUserId: String(meta.userId || "").trim() || null,
          redeemedByEmail: String(meta.email || "").trim().toLowerCase() || null,
        }),
      ],
    );

    return {
      account: publicAccount({
        ...account,
        points: nextPoints,
        total_recharged: nextTotalRecharged,
        updated_at: nowDb,
        last_seen_at: nowDb,
      }),
      redeemCode: publicRedeemCode({
        ...codeRow,
        redeemed_by_user_id: String(meta.userId || "").trim() || null,
        redeemed_by_email: String(meta.email || "").trim().toLowerCase() || null,
        redeemed_account_id: targetAccountId,
        redeemed_at: nowDb,
      }),
      points: amount,
    };
  });
};

module.exports = {
  BillingError,
  getAdminBillingOverview,
  ensureBillingIdentity,
  ensureBillingSchema,
  ensureAccountForUser,
  getAccountByUserId,
  getAccountLedger,
  getAccountLedgerReport,
  getAccountsByUserIds,
  requireBillingAccount,
  getAccountSummary,
  getBillingPricing,
  reservePoints,
  refundPoints,
  registerPendingTask,
  settlePendingTask,
  rechargeAccount,
  adjustAccountPoints,
  createRedeemCodes,
  listRedeemCodes,
  redeemCode,
};
