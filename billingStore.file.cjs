const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const imageRouteCatalog = require("./config/imageRoutes.json");
const { buildBillingLedgerReport } = require("./billingReportUtils.cjs");
const {
  toNonNegativePoint,
  toPointNumber,
  toPositivePoint,
  toSignedPoint,
} = require("./pointMath.cjs");

const BILLING_FILE = path.join(__dirname, "billing-data.json");
const BILLING_VERSION = 1;
const LEDGER_LIMIT = 5000;
const SETTLED_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_TASK_TIMEOUT_MINUTES = () =>
  Math.max(
    10,
    Number.parseInt(String(process.env.BILLING_PENDING_TASK_TIMEOUT_MINUTES || "90"), 10) || 90,
  );
const VIDEO_PENDING_TASK_TIMEOUT_MINUTES = () =>
  Math.max(
    PENDING_TASK_TIMEOUT_MINUTES(),
    Number.parseInt(String(process.env.BILLING_VIDEO_PENDING_TASK_TIMEOUT_MINUTES || "360"), 10) || 360,
  );

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

const DEFAULT_SIGNUP_POINTS = () =>
  toPositivePoint(process.env.DEFAULT_SIGNUP_POINTS, 0);

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

const createDefaultStore = () => ({
  version: BILLING_VERSION,
  accounts: {},
  userAccountIndex: {},
  ledger: [],
  pendingTasks: {},
  redeemCodes: {},
});

const writeStore = (store) => {
  fs.writeFileSync(BILLING_FILE, JSON.stringify(store, null, 2), "utf8");
};

const normalizeStore = (store) => {
  const next = store && typeof store === "object" ? store : createDefaultStore();
  if (!next.accounts || typeof next.accounts !== "object") next.accounts = {};
  if (!next.userAccountIndex || typeof next.userAccountIndex !== "object") {
    next.userAccountIndex = {};
  }
  if (!Array.isArray(next.ledger)) next.ledger = [];
  if (!next.pendingTasks || typeof next.pendingTasks !== "object") next.pendingTasks = {};
  if (!next.redeemCodes || typeof next.redeemCodes !== "object") next.redeemCodes = {};
  next.version = BILLING_VERSION;
  return next;
};

const readStore = () => {
  if (!fs.existsSync(BILLING_FILE)) {
    const initial = createDefaultStore();
    writeStore(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(BILLING_FILE, "utf8").trim();
    if (!raw) {
      const initial = createDefaultStore();
      writeStore(initial);
      return initial;
    }
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    const fallback = createDefaultStore();
    writeStore(fallback);
    return fallback;
  }
};

const withStore = (mutator) => {
  const store = readStore();
  const result = mutator(store);
  cleanupStore(store);
  writeStore(store);
  return result;
};

const cleanupStore = (store) => {
  if (store.ledger.length > LEDGER_LIMIT) {
    store.ledger = store.ledger.slice(0, LEDGER_LIMIT);
  }

  const now = Date.now();
  Object.keys(store.pendingTasks).forEach((taskId) => {
    const task = store.pendingTasks[taskId];
    if (!task) return;
    if (task.settledAt && now - new Date(task.settledAt).getTime() > SETTLED_TASK_RETENTION_MS) {
      delete store.pendingTasks[taskId];
    }
  });
};

const expireStalePendingTasksInStore = (store) => {
  const now = Date.now();
  const imageTimeoutMs = PENDING_TASK_TIMEOUT_MINUTES() * 60 * 1000;
  const videoTimeoutMs = VIDEO_PENDING_TASK_TIMEOUT_MINUTES() * 60 * 1000;

  Object.entries(store.pendingTasks || {}).forEach(([taskId, task]) => {
    if (!task || String(task.status || "").toUpperCase() !== "PENDING" || task.settledAt) {
      return;
    }
    const createdAtMs = Date.parse(task.createdAt || "");
    if (!Number.isFinite(createdAtMs)) return;
    const routeId = String(task.routeId || "").toLowerCase();
    const timeoutMs = routeId.includes("video") ? videoTimeoutMs : imageTimeoutMs;
    if (now - createdAtMs < timeoutMs) return;

    task.status = "STALE";
    task.settledAt = new Date(now).toISOString();
    task.refundId = null;
    task.refundedAt = null;
  });
};

const createAccountForUser = (user = {}) => {
  const now = new Date().toISOString();
  const signupPoints = DEFAULT_SIGNUP_POINTS();
  return {
    accountId: `acct_${randomBytes(8).toString("hex")}`,
    ownerUserId: String(user.userId || "").trim(),
    ownerEmail: String(user.email || "").trim().toLowerCase(),
    points: signupPoints,
    totalRecharged: signupPoints,
    totalSpent: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
};

const publicAccount = (account) => ({
  accountId: account.accountId,
  ownerUserId: account.ownerUserId || "",
  ownerEmail: account.ownerEmail || "",
  points: toPointNumber(account.points || 0),
  totalRecharged: toPointNumber(account.totalRecharged || 0),
  totalSpent: toPointNumber(account.totalSpent || 0),
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
  lastSeenAt: account.lastSeenAt,
});

const publicLedgerEntry = (entry) => ({
  id: entry.id,
  type: String(entry.type || "").trim(),
  accountId: entry.accountId || "",
  points: toPointNumber(entry.points || 0),
  balanceAfter: toPointNumber(entry.balanceAfter || 0),
  createdAt: entry.createdAt || null,
  refundedAt: entry.refundedAt || null,
  refundReason: entry.refundReason || null,
  meta: entry.meta || null,
});

const publicRedeemCode = (entry) => ({
  code: formatRedeemCode(entry.codeValue || entry.code || ""),
  normalizedCode: normalizeRedeemCode(entry.codeValue || entry.code || ""),
  points: toPointNumber(entry.points || 0),
  note: String(entry.note || "").trim(),
  createdByUserId: String(entry.createdByUserId || "").trim() || null,
  createdByEmail: String(entry.createdByEmail || "").trim() || null,
  createdAt: entry.createdAt || null,
  redeemedByUserId: String(entry.redeemedByUserId || "").trim() || null,
  redeemedByEmail: String(entry.redeemedByEmail || "").trim() || null,
  redeemedAccountId: String(entry.redeemedAccountId || "").trim() || null,
  redeemedAt: entry.redeemedAt || null,
  status: entry.redeemedAt ? "redeemed" : "active",
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

const touchAccount = (account) => {
  const now = new Date().toISOString();
  account.updatedAt = now;
  account.lastSeenAt = now;
};

const getOrCreateUserAccountInStore = (store, user) => {
  const userId = String(user?.userId || "").trim();
  if (!userId) {
    throw new BillingError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  const indexedAccountId = store.userAccountIndex[userId];
  let account = indexedAccountId ? store.accounts[indexedAccountId] : null;

  if (!account) {
    account =
      Object.values(store.accounts).find(
        (item) => item && String(item.ownerUserId || "").trim() === userId,
      ) || null;
  }

  if (!account) {
    account = createAccountForUser(user);
    store.accounts[account.accountId] = account;
    store.userAccountIndex[userId] = account.accountId;
    store.ledger.unshift({
      id: `led_${randomBytes(8).toString("hex")}`,
      type: "signup",
      accountId: account.accountId,
      points: account.points,
      balanceAfter: account.points,
      createdAt: account.createdAt,
      meta: {
        ownerUserId: account.ownerUserId,
        ownerEmail: account.ownerEmail,
      },
    });
    return account;
  }

  account.ownerUserId = userId;
  account.ownerEmail = String(user.email || account.ownerEmail || "").trim().toLowerCase();
  store.userAccountIndex[userId] = account.accountId;
  return account;
};

const ensureAccountForUser = (user) =>
  withStore((store) => {
    const account = getOrCreateUserAccountInStore(store, user);
    touchAccount(account);
    return publicAccount(account);
  });

const ensureBillingIdentity = (req) => ({
  account: requireBillingAccount(req),
  accessToken: null,
});

const requireBillingAccount = (req) => {
  const authUser = req?.authUser;
  if (!authUser?.userId) {
    throw new BillingError("AUTH_LOGIN_REQUIRED", "Please sign in before using this feature");
  }

  return withStore((store) => {
    const account = getOrCreateUserAccountInStore(store, authUser);
    touchAccount(account);
    return publicAccount(account);
  });
};

const getAccountSummary = (accountId) =>
  withStore((store) => {
    const account = store.accounts[accountId];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    touchAccount(account);
    return publicAccount(account);
  });

const getAccountByUserId = (userId) =>
  withStore((store) => {
    const targetUserId = String(userId || "").trim();
    if (!targetUserId) return null;
    const accountId = store.userAccountIndex[targetUserId];
    if (accountId && store.accounts[accountId]) {
      return publicAccount(store.accounts[accountId]);
    }
    const account = Object.values(store.accounts).find(
      (item) => item && String(item.ownerUserId || "").trim() === targetUserId,
    );
    return account ? publicAccount(account) : null;
  });

const getAccountsByUserIds = (userIds = []) =>
  withStore((store) => {
    const safeUserIds = Array.from(
      new Set((Array.isArray(userIds) ? userIds : []).map((item) => String(item || "").trim()).filter(Boolean)),
    );
    return safeUserIds.reduce((accumulator, userId) => {
      const accountId = store.userAccountIndex[userId];
      const account =
        (accountId && store.accounts[accountId]) ||
        Object.values(store.accounts).find(
          (item) => item && String(item.ownerUserId || "").trim() === userId,
        );
      if (account) {
        accumulator[userId] = publicAccount(account);
      }
      return accumulator;
    }, {});
  });

const getAccountLedger = (accountId, { page = 1, pageSize = 20 } = {}) =>
  withStore((store) => {
    const targetAccountId = String(accountId || "").trim();
    if (!targetAccountId || !store.accounts[targetAccountId]) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
    const entries = store.ledger
      .filter((entry) => entry.accountId === targetAccountId)
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(right.id || "").localeCompare(String(left.id || ""));
      });
    const total = entries.length;
    const offset = (safePage - 1) * safePageSize;

    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
      entries: entries.slice(offset, offset + safePageSize).map((entry) => publicLedgerEntry(entry)),
    };
  });

const getAccountLedgerReport = (
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
) =>
  withStore((store) => {
    const targetAccountId = String(accountId || "").trim();
    if (!targetAccountId || !store.accounts[targetAccountId]) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const entries = store.ledger
      .filter((entry) => entry.accountId === targetAccountId)
      .map((entry) => publicLedgerEntry(entry));

    return buildBillingLedgerReport(entries, {
      page,
      pageSize,
      startDate,
      endDate,
      type,
      modelId,
      routeId,
    });
  });

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

const buildAdminBillingOverviewFromStore = (store, { recentWindowHours = 24 } = {}) => {
  const safeRecentWindowHours = Math.max(
    1,
    Number.parseInt(String(recentWindowHours || 24), 10) || 24,
  );
  const recentCutoffMs = Date.now() - safeRecentWindowHours * 60 * 60 * 1000;

  const accounts = Object.values(store.accounts || {});
  const chargeEntries = (store.ledger || []).filter((entry) => entry?.type === "charge");
  const pendingTasks = Object.values(store.pendingTasks || {});

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

  for (const account of accounts) {
    overall.totalAccounts += 1;
    overall.totalBalancePoints = toPointNumber(
      overall.totalBalancePoints + toPointNumber(account?.points || 0),
      0,
    );
    overall.totalRechargedPoints = toPointNumber(
      overall.totalRechargedPoints + toPointNumber(account?.totalRecharged || 0),
      0,
    );
    overall.totalSpentPoints = toPointNumber(
      overall.totalSpentPoints + toPointNumber(account?.totalSpent || 0),
      0,
    );
  }

  for (const task of pendingTasks) {
    if (String(task?.status || "").toUpperCase() !== "PENDING" || task?.settledAt) {
      continue;
    }

    overall.pendingTasks += 1;
    const routeId = String(task?.routeId || "").trim() || "unknown";
    const routeBucket = routeStats.get(routeId) || createMetricBucket({ routeId });
    routeBucket.pendingTasks += 1;
    routeStats.set(routeId, routeBucket);
  }

  for (const entry of chargeEntries) {
    const meta = entry?.meta && typeof entry.meta === "object" ? entry.meta : {};
    const createdAt = String(entry?.createdAt || "").trim() || null;
    const createdAtMs = createdAt ? Date.parse(createdAt) : NaN;
    const isRecent = Number.isFinite(createdAtMs) && createdAtMs >= recentCutoffMs;
    const refunded = Boolean(entry?.refundedAt);
    const points = toPointNumber(entry?.points || 0);

    applyChargeToBucket(overall, { refunded, isRecent, createdAt, points });

    const routeId = String(meta.routeId || "").trim() || "unknown";
    const routeBucket =
      routeStats.get(routeId) ||
      createMetricBucket({
        routeId,
        line: String(meta.line || "").trim() || null,
      });
    applyChargeToBucket(routeBucket, { refunded, isRecent, createdAt, points });
    routeStats.set(routeId, routeBucket);

    const modelId = String(meta.modelId || "").trim();
    const requestModel = String(meta.model || "").trim();
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

const getAdminBillingOverview = ({ recentWindowHours = 24 } = {}) =>
  withStore((store) => {
    expireStalePendingTasksInStore(store);
    return buildAdminBillingOverviewFromStore(store, { recentWindowHours });
  });

const listPendingTasks = ({ status = "PENDING", limit = 50 } = {}) =>
  withStore((store) => {
    expireStalePendingTasksInStore(store);
    const normalizedStatus = String(status || "PENDING").trim().toUpperCase();
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit || 50), 10) || 50));
    return Object.entries(store.pendingTasks || {})
      .map(([taskId, task]) => ({
        taskId,
        accountId: String(task?.accountId || "").trim() || null,
        chargeId: String(task?.chargeId || "").trim() || null,
        points: toPointNumber(task?.points || 0, 0),
        routeId: String(task?.routeId || "").trim() || null,
        actionName: String(task?.action || task?.actionName || "").trim() || null,
        createdAt: String(task?.createdAt || "").trim() || null,
        settledAt: String(task?.settledAt || "").trim() || null,
        status: String(task?.status || "").trim().toUpperCase() || "PENDING",
      }))
      .filter((task) => task.status === normalizedStatus && !task.settledAt)
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
      .slice(0, safeLimit);
  });

const reservePoints = (accountId, points, meta = {}) =>
  withStore((store) => {
    const account = store.accounts[accountId];
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

    account.points = toPointNumber(Number(account.points || 0) - cost, 0);
    account.totalSpent = toPointNumber(Number(account.totalSpent || 0) + cost, 0);
    touchAccount(account);

    const chargeId = `chg_${randomBytes(10).toString("hex")}`;
    store.ledger.unshift({
      id: chargeId,
      type: "charge",
      accountId,
      points: cost,
      balanceAfter: account.points,
      createdAt: account.updatedAt,
      meta,
    });

    return {
      chargeId,
      account: publicAccount(account),
      points: cost,
    };
  });

const refundChargeInStore = (store, accountId, chargeId, meta = {}) => {
  const account = store.accounts[accountId];
  if (!account || !chargeId) return null;

  const charge = store.ledger.find(
    (item) => item.id === chargeId && item.type === "charge" && item.accountId === accountId,
  );

  if (!charge || charge.refundedAt) {
    return null;
  }

  const refundPoints = toPointNumber(charge.points || 0);
  account.points = toPointNumber(Number(account.points || 0) + refundPoints, 0);
  account.totalSpent = toNonNegativePoint(
    Number(account.totalSpent || 0) - refundPoints,
    0,
  );
  touchAccount(account);

  charge.refundedAt = account.updatedAt;
  charge.refundReason = meta.reason || "task_failed";

  const refundId = `ref_${randomBytes(10).toString("hex")}`;
  store.ledger.unshift({
    id: refundId,
    type: "refund",
    accountId,
    points: refundPoints,
    balanceAfter: account.points,
    createdAt: account.updatedAt,
    meta: {
      ...meta,
      chargeId,
    },
  });

  return {
    refundId,
    account: publicAccount(account),
    points: refundPoints,
  };
};

const refundPoints = (accountId, chargeId, meta = {}) =>
  withStore((store) => refundChargeInStore(store, accountId, chargeId, meta));

const registerPendingTask = (taskId, taskInfo) =>
  withStore((store) => {
    store.pendingTasks[taskId] = {
      ...taskInfo,
      createdAt: new Date().toISOString(),
      settledAt: null,
      status: "PENDING",
    };
    return store.pendingTasks[taskId];
  });

const settlePendingTask = (taskId, status) =>
  withStore((store) => {
    const task = store.pendingTasks[taskId];
    if (!task) return null;
    if (task.settledAt) return task;

    task.status = status;
    task.settledAt = new Date().toISOString();

    if (String(status).toUpperCase() === "FAILED") {
      const refund = refundChargeInStore(store, task.accountId, task.chargeId, {
        reason: "task_failed",
        taskId,
        routeId: task.routeId,
      });
      task.refundId = refund?.refundId || null;
      task.refundedAt = refund?.account?.updatedAt || null;
    }

    return task;
  });

const rechargeAccount = (accountId, points, note = "") =>
  withStore((store) => {
    const account = store.accounts[accountId];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const amount = toPositivePoint(points, 0);
    if (amount <= 0) {
      throw new BillingError("INVALID_RECHARGE_POINTS", "Recharge points must be greater than zero");
    }

    account.points = toPointNumber(Number(account.points || 0) + amount, 0);
    account.totalRecharged = toPointNumber(Number(account.totalRecharged || 0) + amount, 0);
    touchAccount(account);

    store.ledger.unshift({
      id: `rcg_${randomBytes(10).toString("hex")}`,
      type: "recharge",
      accountId,
      points: amount,
      balanceAfter: account.points,
      createdAt: account.updatedAt,
      meta: { note },
    });

    return publicAccount(account);
  });

const adjustAccountPoints = (accountId, deltaPoints, meta = {}) =>
  withStore((store) => {
    const account = store.accounts[accountId];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const delta = toSignedPoint(deltaPoints, 0);
    if (!delta) {
      throw new BillingError("INVALID_ADJUST_POINTS", "Adjustment points cannot be zero");
    }

    const currentPoints = toPointNumber(account.points || 0);
    const nextPoints = toPointNumber(currentPoints + delta, 0);
    if (nextPoints < 0) {
      throw new BillingError("INSUFFICIENT_POINTS", "Insufficient points", {
        currentPoints,
        requiredPoints: toPointNumber(Math.abs(delta), 0),
      });
    }

    account.points = nextPoints;
    if (delta > 0) {
      account.totalRecharged = toPointNumber(
        Number(account.totalRecharged || 0) + delta,
        0,
      );
    }
    touchAccount(account);

    store.ledger.unshift({
      id: `adj_${randomBytes(10).toString("hex")}`,
      type: delta > 0 ? "admin_credit" : "admin_debit",
      accountId,
      points: toPointNumber(Math.abs(delta), 0),
      balanceAfter: account.points,
      createdAt: account.updatedAt,
      meta: {
        note: String(meta.note || "").trim(),
        reason: String(meta.reason || "manual_adjust").trim(),
        actorUserId: String(meta.actorUserId || "").trim() || null,
        actorEmail: String(meta.actorEmail || "").trim().toLowerCase() || null,
        delta,
      },
    });

    return publicAccount(account);
  });

const createRedeemCodes = ({
  points,
  quantity = 1,
  note = "",
  createdByUserId = null,
  createdByEmail = null,
} = {}) =>
  withStore((store) => {
    const amount = toPositivePoint(points, 0);
    const totalCodes = Math.min(100, Math.max(1, parsePositiveInteger(quantity, 1)));

    if (amount <= 0) {
      throw new BillingError(
        "INVALID_REDEEM_CODE_POINTS",
        "Redeem code points must be greater than zero",
      );
    }

    const created = [];

    for (let index = 0; index < totalCodes; index += 1) {
      let codeValue = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = createRedeemCodeValue();
        if (!store.redeemCodes[candidate]) {
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

      const entry = {
        codeValue,
        points: amount,
        note: String(note || "").trim(),
        createdByUserId: String(createdByUserId || "").trim() || null,
        createdByEmail: String(createdByEmail || "").trim().toLowerCase() || null,
        createdAt: new Date().toISOString(),
        redeemedByUserId: null,
        redeemedByEmail: null,
        redeemedAccountId: null,
        redeemedAt: null,
      };
      store.redeemCodes[codeValue] = entry;
      created.push(publicRedeemCode(entry));
    }

    return created;
  });

const listRedeemCodes = ({ page = 1, pageSize = 20, status = "all" } = {}) =>
  withStore((store) => {
    const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
    const normalizedStatus = String(status || "all").trim().toLowerCase();
    const offset = (safePage - 1) * safePageSize;

    let entries = Object.values(store.redeemCodes || {});
    if (normalizedStatus === "active") {
      entries = entries.filter((entry) => !entry.redeemedAt);
    } else if (normalizedStatus === "redeemed") {
      entries = entries.filter((entry) => Boolean(entry.redeemedAt));
    }

    entries.sort((left, right) => {
      const rightTime = new Date(right.createdAt || 0).getTime();
      const leftTime = new Date(left.createdAt || 0).getTime();
      return rightTime - leftTime;
    });

    const total = entries.length;
    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
      codes: entries.slice(offset, offset + safePageSize).map((entry) => publicRedeemCode(entry)),
    };
  });

const redeemCode = (accountId, code, meta = {}) =>
  withStore((store) => {
    const account = store.accounts[accountId];
    if (!account) {
      throw new BillingError("ACCOUNT_NOT_FOUND", "Billing account does not exist");
    }

    const normalizedCode = normalizeRedeemCode(code);
    if (!normalizedCode) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code is required");
    }

    const redeemEntry = store.redeemCodes[normalizedCode];
    if (!redeemEntry) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code does not exist");
    }
    if (redeemEntry.redeemedAt) {
      throw new BillingError("REDEEM_CODE_ALREADY_USED", "Redeem code has already been used", {
        redeemedAt: redeemEntry.redeemedAt,
      });
    }

    const amount = toPositivePoint(redeemEntry.points, 0);
    if (amount <= 0) {
      throw new BillingError("INVALID_REDEEM_CODE", "Redeem code is invalid");
    }

    account.points = toPointNumber(Number(account.points || 0) + amount, 0);
    account.totalRecharged = toPointNumber(Number(account.totalRecharged || 0) + amount, 0);
    touchAccount(account);

    redeemEntry.redeemedByUserId = String(meta.userId || "").trim() || null;
    redeemEntry.redeemedByEmail = String(meta.email || "").trim().toLowerCase() || null;
    redeemEntry.redeemedAccountId = accountId;
    redeemEntry.redeemedAt = account.updatedAt;

    store.ledger.unshift({
      id: `gft_${randomBytes(10).toString("hex")}`,
      type: "redeem_code",
      accountId,
      points: amount,
      balanceAfter: account.points,
      createdAt: account.updatedAt,
      meta: {
        code: formatRedeemCode(normalizedCode),
        normalizedCode,
        note: redeemEntry.note || null,
        createdByUserId: redeemEntry.createdByUserId || null,
        createdByEmail: redeemEntry.createdByEmail || null,
        redeemedByUserId: redeemEntry.redeemedByUserId,
        redeemedByEmail: redeemEntry.redeemedByEmail,
      },
    });

    return {
      account: publicAccount(account),
      redeemCode: publicRedeemCode(redeemEntry),
      points: amount,
    };
  });

module.exports = {
  BillingError,
  getAdminBillingOverview,
  ensureBillingIdentity,
  ensureAccountForUser,
  getAccountByUserId,
  getAccountLedger,
  getAccountLedgerReport,
  getAccountsByUserIds,
  requireBillingAccount,
  getAccountSummary,
  getBillingPricing,
  listPendingTasks,
  reservePoints,
  refundPoints,
  registerPendingTask,
  settlePendingTask,
  rechargeAccount,
  adjustAccountPoints,
  createRedeemCodes,
  listRedeemCodes,
  redeemCode,
  startBillingMaintenance: () => null,
};
