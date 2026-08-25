const assert = require("assert");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;

const users = new Map();
const sessions = [];
const statements = [];

const fakeConnection = {
  async execute(sql, params = []) {
    statements.push({ sql: String(sql), params });
    const normalized = String(sql).replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.startsWith("SELECT USER_ID, EMAIL, ROLE, STATUS, CREATED_AT FROM AUTH_USERS")) {
      return [[...users.values()], []];
    }
    if (normalized.startsWith("SELECT * FROM AUTH_USERS WHERE USER_ID = ?")) {
      const row = users.get(String(params[0]));
      return [row ? [{ ...row }] : [], []];
    }
    if (normalized.startsWith("UPDATE AUTH_USERS SET PASSWORD_HASH")) {
      const row = users.get(String(params[3]));
      if (row) {
        row.password_hash = params[0];
        row.password_updated_at = params[1];
        row.updated_at = params[2];
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    if (normalized.startsWith("DELETE FROM AUTH_SESSIONS WHERE USER_ID = ?")) {
      const target = String(params[0]);
      const before = sessions.length;
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].user_id === target) sessions.splice(index, 1);
      }
      return [{ affectedRows: before - sessions.length }, []];
    }
    return [{ affectedRows: 0 }, []];
  },
};

const fakePool = {
  async execute(sql, params = []) {
    return fakeConnection.execute(sql, params);
  },
};

const fakeDb = {
  execute: (...args) => fakeConnection.execute(...args),
  fromDbDateTime: (value) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const text = String(value);
    return text.endsWith("Z") ? text : `${text.replace(" ", "T")}Z`;
  },
  getPool: async () => fakePool,
  query: (...args) => fakeConnection.execute(...args).then(([rows]) => rows),
  toDbDateTime: (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 23).replace("T", " ");
  },
  withTransaction: async (runner) => runner(fakeConnection),
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename === path.resolve(__dirname, "authStore.mysql.cjs") && request === "./db.cjs") {
    return fakeDb;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const auth = require("./authStore.mysql.cjs");
Module._load = originalLoad;

const makeRow = ({ userId, email, role = "user" }) => ({
  user_id: userId,
  email,
  display_name: email.split("@")[0],
  password_hash: "scrypt$old$hash",
  role,
  status: "active",
  created_at: "2026-01-01 00:00:00.000",
  updated_at: "2026-01-01 00:00:00.000",
  password_updated_at: "2026-01-01 00:00:00.000",
  last_login_at: null,
});

const resetFixtures = () => {
  users.clear();
  sessions.length = 0;
  statements.length = 0;
  users.set("target", makeRow({ userId: "target", email: "target@example.com" }));
  users.set("other-admin", makeRow({ userId: "other-admin", email: "other@example.com", role: "admin" }));
  sessions.push({ token: "target-session", user_id: "target" }, { token: "other-session", user_id: "other-admin" });
};

describe("mysql auth store admin password reset", () => {
  beforeEach(resetFixtures);

  it("requires an authenticated administrator actor", async () => {
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin(null, "target", "valid-pass-123"),
      (error) => error?.code === "AUTH_LOGIN_REQUIRED",
    );
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin({ userId: "user", role: "user" }, "target", "valid-pass-123"),
      (error) => error?.code === "ADMIN_REQUIRED",
    );
  });

  it("looks up the target before validating the replacement password", async () => {
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin({ userId: "root", role: "super_admin" }, "missing", "short"),
      (error) => error?.code === "USER_NOT_FOUND",
    );
    const lookup = statements.findIndex(({ sql }) => /SELECT \* FROM auth_users WHERE user_id/i.test(sql));
    assert.notEqual(lookup, -1);
  });

  it("allows super administrators to reset any target and revoke all sessions", async () => {
    const updated = await auth.resetUserPasswordByAdmin(
      { userId: "root", role: "super_admin" },
      "target",
      "new-pass-123",
    );

    assert.equal(updated.userId, "target");
    assert.equal(updated.passwordConfigured, true);
    assert.equal(Object.prototype.hasOwnProperty.call(updated, "passwordHash"), false);
    assert.equal(sessions.some(({ user_id }) => user_id === "target"), false);
    assert.equal(sessions.some(({ user_id }) => user_id === "other-admin"), true);
    assert.notEqual(users.get("target").password_hash, "scrypt$old$hash");
    assert.equal(
      statements.filter(({ sql }) => /UPDATE\s+auth_users\s+SET\s+password_hash/i.test(sql)).length,
      1,
    );
  });

  it("restricts regular administrators to effective user targets", async () => {
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin({ userId: "admin", role: "admin" }, "other-admin", "new-pass-123"),
      (error) => error?.code === "ADMIN_PASSWORD_RESET_FORBIDDEN",
    );

    const previousAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "target@example.com";
    try {
      await assert.rejects(
        () => auth.resetUserPasswordByAdmin({ userId: "admin", role: "admin" }, "target", "new-pass-123"),
        (error) => error?.code === "ADMIN_PASSWORD_RESET_FORBIDDEN",
      );
    } finally {
      if (previousAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previousAdminEmails;
    }
  });

  it("enforces the shared eight-to-two-hundred-character password policy", async () => {
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin({ userId: "root", role: "super_admin" }, "target", "short"),
      (error) => error?.code === "INVALID_PASSWORD",
    );
    await assert.rejects(
      () => auth.resetUserPasswordByAdmin({ userId: "root", role: "super_admin" }, "target", "x".repeat(201)),
      (error) => error?.code === "INVALID_PASSWORD",
    );
  });
});
