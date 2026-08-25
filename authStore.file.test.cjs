const assert = require("assert");
const fs = require("fs");
const path = require("path");

const AUTH_FILE = path.join(__dirname, "auth-data.json");
const auth = require("./authStore.file.cjs");

const resetStore = () => {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

const register = (email, password) => auth.registerWithPassword({ email, password });
const setRole = (actor, user, role) => auth.updateAdminUser(actor, user.user.userId, { role });

describe("file auth store admin password reset", () => {
  beforeEach(resetStore);
  afterAll(resetStore);

  it("allows a super administrator to reset any user's password and revoke sessions", async () => {
    const superAdmin = await register("root@example.com", "root-pass-123");
    const target = await register("target@example.com", "old-pass-123");
    const targetSession = (await auth.loginWithPassword({
      email: target.user.email,
      password: "old-pass-123",
    })).sessionToken;

    const updated = auth.resetUserPasswordByAdmin(
      superAdmin.user,
      target.user.userId,
      "new-pass-123",
    );

    assert.equal(updated.userId, target.user.userId);
    assert.equal(updated.passwordConfigured, true);
    assert.equal(Object.prototype.hasOwnProperty.call(updated, "passwordHash"), false);
    assert.equal(
      auth.getSessionUserFromRequest({ headers: { "x-auth-session": targetSession } }),
      null,
    );
    const login = await auth.loginWithPassword({
      email: target.user.email,
      password: "new-pass-123",
    });
    assert.equal(login.user.userId, target.user.userId);
  });

  it("allows a regular administrator to reset a user password", async () => {
    const superAdmin = await register("root@example.com", "root-pass-123");
    const admin = await register("admin@example.com", "admin-pass-123");
    const target = await register("target@example.com", "old-pass-123");
    const adminUser = setRole(superAdmin.user, admin, "admin");

    const updated = auth.resetUserPasswordByAdmin(
      adminUser,
      target.user.userId,
      "new-pass-123",
    );

    assert.equal(updated.userId, target.user.userId);
    assert.equal((await auth.loginWithPassword({
      email: target.user.email,
      password: "new-pass-123",
    })).user.userId, target.user.userId);
  });

  it("rejects a regular administrator resetting an administrator account", async () => {
    const superAdmin = await register("root@example.com", "root-pass-123");
    const actor = await register("admin@example.com", "admin-pass-123");
    const target = await register("other-admin@example.com", "old-pass-123");
    const adminActor = setRole(superAdmin.user, actor, "admin");
    setRole(superAdmin.user, target, "admin");

    assert.throws(
      () => auth.resetUserPasswordByAdmin(adminActor, target.user.userId, "new-pass-123"),
      (error) => error && error.code === "ADMIN_PASSWORD_RESET_FORBIDDEN",
    );
  });

  it("rejects a regular administrator resetting an auto-promoted administrator account", async () => {
    const previousAdminEmails = process.env.ADMIN_EMAILS;
    try {
      const superAdmin = await register("root@example.com", "root-pass-123");
      const actor = await register("admin@example.com", "admin-pass-123");
      const target = await register("promoted@example.com", "old-pass-123");
      const adminActor = setRole(superAdmin.user, actor, "admin");
      process.env.ADMIN_EMAILS = target.user.email;

      assert.throws(
        () => auth.resetUserPasswordByAdmin(adminActor, target.user.userId, "new-pass-123"),
        (error) => error && error.code === "ADMIN_PASSWORD_RESET_FORBIDDEN",
      );
    } finally {
      if (previousAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previousAdminEmails;
    }
  });

  it("rejects passwords outside the shared 8-200 character policy", async () => {
    const superAdmin = await register("root@example.com", "root-pass-123");
    const target = await register("target@example.com", "old-pass-123");

    assert.throws(
      () => auth.resetUserPasswordByAdmin(superAdmin.user, target.user.userId, "short"),
      (error) => error && error.code === "INVALID_PASSWORD",
    );
  });

  it("reports a missing target before validating the replacement password", async () => {
    const superAdmin = await register("root@example.com", "root-pass-123");

    assert.throws(
      () => auth.resetUserPasswordByAdmin(superAdmin.user, "missing-user", "short"),
      (error) => error && error.code === "USER_NOT_FOUND",
    );
  });
});
