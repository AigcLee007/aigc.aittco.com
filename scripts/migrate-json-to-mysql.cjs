const fs = require("fs");
const path = require("path");

const localEnvPath = path.join(__dirname, "..", ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

const { closePool, isMySqlConfigured, toDbDateTime, withTransaction } = require("../db.cjs");
const { ensureAuthSchema } = require("../authStore.mysql.cjs");
const { ensureBillingSchema } = require("../billingStore.mysql.cjs");

const ROOT_DIR = path.join(__dirname, "..");
const AUTH_FILE = path.join(ROOT_DIR, "auth-data.json");
const BILLING_FILE = path.join(ROOT_DIR, "billing-data.json");

const readJsonFile = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${path.basename(filePath)}: ${error.message}`);
  }
};

const normalizeObjectValues = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : [];

const migrateAuthStore = async () => {
  const authStore = readJsonFile(AUTH_FILE, null);
  if (!authStore) {
    return {
      importedUsers: 0,
      skippedUsers: 0,
      importedSessions: 0,
      skippedSessions: 0,
      importedEmailCodes: 0,
      skippedEmailCodes: 0,
      authStore: null,
    };
  }

  const users = normalizeObjectValues(authStore.users);
  const sessions = normalizeObjectValues(authStore.sessions);
  const emailCodes = Object.entries(authStore.emailCodes || {});

  let importedUsers = 0;
  let skippedUsers = 0;
  let importedSessions = 0;
  let skippedSessions = 0;
  let importedEmailCodes = 0;
  let skippedEmailCodes = 0;

  await ensureAuthSchema();

  await withTransaction(async (connection) => {
    for (const user of users) {
      const userId = String(user?.userId || "").trim();
      const email = String(user?.email || "").trim().toLowerCase();
      if (!userId || !email) {
        skippedUsers += 1;
        continue;
      }

      const createdAt = toDbDateTime(user.createdAt || new Date());
      const updatedAt = toDbDateTime(user.updatedAt || user.createdAt || new Date());
      const lastLoginAt = user.lastLoginAt ? toDbDateTime(user.lastLoginAt) : null;

      await connection.execute(
        `
          INSERT INTO auth_users (user_id, email, created_at, updated_at, last_login_at)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            created_at = VALUES(created_at),
            updated_at = VALUES(updated_at),
            last_login_at = VALUES(last_login_at)
        `,
        [userId, email, createdAt, updatedAt, lastLoginAt],
      );
      importedUsers += 1;
    }

    for (const session of sessions) {
      const token = String(session?.token || "").trim();
      const userId = String(session?.userId || "").trim();
      if (!token || !userId) {
        skippedSessions += 1;
        continue;
      }

      await connection.execute(
        `
          INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            created_at = VALUES(created_at),
            last_seen_at = VALUES(last_seen_at),
            expires_at = VALUES(expires_at)
        `,
        [
          token,
          userId,
          toDbDateTime(session.createdAt || new Date()),
          toDbDateTime(session.lastSeenAt || session.createdAt || new Date()),
          toDbDateTime(session.expiresAt || new Date()),
        ],
      );
      importedSessions += 1;
    }

    for (const [emailRaw, record] of emailCodes) {
      const email = String(emailRaw || "").trim().toLowerCase();
      const codeHash = String(record?.codeHash || "").trim();
      if (!email || !codeHash) {
        skippedEmailCodes += 1;
        continue;
      }

      await connection.execute(
        `
          INSERT INTO auth_email_codes (email, code_hash, expires_at, last_sent_at, attempts)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            code_hash = VALUES(code_hash),
            expires_at = VALUES(expires_at),
            last_sent_at = VALUES(last_sent_at),
            attempts = VALUES(attempts)
        `,
        [
          email,
          codeHash,
          toDbDateTime(record.expiresAt || new Date()),
          toDbDateTime(record.lastSentAt || new Date()),
          Number.parseInt(String(record.attempts || "0"), 10) || 0,
        ],
      );
      importedEmailCodes += 1;
    }
  });

  return {
    importedUsers,
    skippedUsers,
    importedSessions,
    skippedSessions,
    importedEmailCodes,
    skippedEmailCodes,
    authStore,
  };
};

const migrateBillingStore = async (authStore) => {
  const billingStore = readJsonFile(BILLING_FILE, null);
  if (!billingStore) {
    return {
      importedAccounts: 0,
      skippedAccounts: 0,
      importedLedger: 0,
      skippedLedger: 0,
      importedPendingTasks: 0,
      skippedPendingTasks: 0,
    };
  }

  const accounts = normalizeObjectValues(billingStore.accounts);
  const ledger = Array.isArray(billingStore.ledger) ? billingStore.ledger : [];
  const pendingTasks = Object.entries(billingStore.pendingTasks || {});
  const reverseUserAccountIndex = new Map(
    Object.entries(billingStore.userAccountIndex || {}).map(([userId, accountId]) => [
      String(accountId || "").trim(),
      String(userId || "").trim(),
    ]),
  );
  const authUsersById = new Map(
    normalizeObjectValues(authStore?.users).map((user) => [
      String(user?.userId || "").trim(),
      user,
    ]),
  );
  const authEmailIndex = authStore?.emailIndex || {};
  const importedAccountIds = new Set();
  let importedAccounts = 0;
  let skippedAccounts = 0;
  let importedLedger = 0;
  let skippedLedger = 0;
  let importedPendingTasks = 0;
  let skippedPendingTasks = 0;

  await ensureBillingSchema();

  await withTransaction(async (connection) => {
    for (const account of accounts) {
      const accountId = String(account?.accountId || "").trim();
      const ownerEmail = String(account?.ownerEmail || "").trim().toLowerCase();
      const ownerUserId = String(
        account?.ownerUserId ||
          reverseUserAccountIndex.get(accountId) ||
          authEmailIndex[ownerEmail] ||
          "",
      ).trim();
      if (!accountId || !ownerUserId) {
        skippedAccounts += 1;
        continue;
      }
      const authUser = authUsersById.get(ownerUserId);

      const createdAt = toDbDateTime(account.createdAt || new Date());
      const updatedAt = toDbDateTime(account.updatedAt || account.createdAt || new Date());
      const lastSeenAt = toDbDateTime(
        account.lastSeenAt || account.updatedAt || account.createdAt || new Date(),
      );

      await connection.execute(
        `
          INSERT INTO billing_accounts (
            account_id, owner_user_id, owner_email, points, total_recharged, total_spent,
            created_at, updated_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            owner_user_id = VALUES(owner_user_id),
            owner_email = VALUES(owner_email),
            points = VALUES(points),
            total_recharged = VALUES(total_recharged),
            total_spent = VALUES(total_spent),
            created_at = VALUES(created_at),
            updated_at = VALUES(updated_at),
            last_seen_at = VALUES(last_seen_at)
        `,
        [
          accountId,
          ownerUserId,
          String(ownerEmail || authUser?.email || "").trim().toLowerCase(),
          Number(account.points || 0),
          Number(account.totalRecharged || 0),
          Number(account.totalSpent || 0),
          createdAt,
          updatedAt,
          lastSeenAt,
        ],
      );
      importedAccounts += 1;
      importedAccountIds.add(accountId);
    }

    for (const entry of ledger) {
      const ledgerId = String(entry?.id || "").trim();
      const accountId = String(entry?.accountId || "").trim();
      if (!ledgerId || !accountId || !importedAccountIds.has(accountId)) {
        skippedLedger += 1;
        continue;
      }

      await connection.execute(
        `
          INSERT INTO billing_ledger (
            id, type, account_id, points, balance_after, created_at, meta_json, refunded_at, refund_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type = VALUES(type),
            account_id = VALUES(account_id),
            points = VALUES(points),
            balance_after = VALUES(balance_after),
            created_at = VALUES(created_at),
            meta_json = VALUES(meta_json),
            refunded_at = VALUES(refunded_at),
            refund_reason = VALUES(refund_reason)
        `,
        [
          ledgerId,
          String(entry.type || "charge"),
          accountId,
          Number(entry.points || 0),
          Number(entry.balanceAfter || 0),
          toDbDateTime(entry.createdAt || new Date()),
          JSON.stringify(entry.meta || {}),
          entry.refundedAt ? toDbDateTime(entry.refundedAt) : null,
          entry.refundReason ? String(entry.refundReason) : null,
        ],
      );
      importedLedger += 1;
    }

    for (const [taskIdRaw, task] of pendingTasks) {
      const taskId = String(taskIdRaw || "").trim();
      const accountId = String(task?.accountId || "").trim();
      if (!taskId || !accountId || !importedAccountIds.has(accountId)) {
        skippedPendingTasks += 1;
        continue;
      }

      await connection.execute(
        `
          INSERT INTO billing_pending_tasks (
            task_id, account_id, charge_id, points, route_id, action_name,
            created_at, settled_at, status, refund_id, refunded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            account_id = VALUES(account_id),
            charge_id = VALUES(charge_id),
            points = VALUES(points),
            route_id = VALUES(route_id),
            action_name = VALUES(action_name),
            created_at = VALUES(created_at),
            settled_at = VALUES(settled_at),
            status = VALUES(status),
            refund_id = VALUES(refund_id),
            refunded_at = VALUES(refunded_at)
        `,
        [
          taskId,
          accountId,
          task?.chargeId ? String(task.chargeId) : null,
          Number(task?.points || 0),
          task?.routeId ? String(task.routeId) : null,
          task?.action ? String(task.action) : null,
          toDbDateTime(task?.createdAt || new Date()),
          task?.settledAt ? toDbDateTime(task.settledAt) : null,
          String(task?.status || "PENDING").toUpperCase(),
          task?.refundId ? String(task.refundId) : null,
          task?.refundedAt ? toDbDateTime(task.refundedAt) : null,
        ],
      );
      importedPendingTasks += 1;
    }
  });

  return {
    importedAccounts,
    skippedAccounts,
    importedLedger,
    skippedLedger,
    importedPendingTasks,
    skippedPendingTasks,
  };
};

const main = async () => {
  if (!isMySqlConfigured()) {
    throw new Error(
      "MySQL is not configured. Set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE first.",
    );
  }

  const authResult = await migrateAuthStore();
  const billingResult = await migrateBillingStore(authResult.authStore);

  console.log("[migrate:mysql] Auth import:", {
    importedUsers: authResult.importedUsers,
    skippedUsers: authResult.skippedUsers,
    importedSessions: authResult.importedSessions,
    skippedSessions: authResult.skippedSessions,
    importedEmailCodes: authResult.importedEmailCodes,
    skippedEmailCodes: authResult.skippedEmailCodes,
  });
  console.log("[migrate:mysql] Billing import:", billingResult);
  console.log("[migrate:mysql] Migration completed successfully.");
};

main()
  .catch((error) => {
    console.error("[migrate:mysql] Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
