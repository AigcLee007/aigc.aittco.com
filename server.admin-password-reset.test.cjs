const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const AUTH_FILE = path.join(os.tmpdir(), `image-zhuce-admin-route-${process.pid}.json`);
const MYSQL_ENV_KEYS = Object.keys(process.env).filter((key) => key.startsWith("MYSQL_"));
const MYSQL_ENV_BACKUP = Object.fromEntries(MYSQL_ENV_KEYS.map((key) => [key, process.env[key]]));
[
  "MYSQL_URL",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
  "MYSQL_CONNECTION_LIMIT",
].forEach((key) => {
  process.env[key] = "";
});
process.env.AUTH_STORE_FILE = AUTH_FILE;
const auth = require("./authStore.file.cjs");

const request = (server, method, pathname, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        method,
        path: pathname,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (_error) {
            // Preserve non-JSON response bodies for useful assertion failures.
          }
          resolve({ status: res.statusCode, body: json, text });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

const resetStore = () => {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

describe.sequential("admin password reset route", () => {
  let app;

  beforeAll(() => {
    app = require("./server.cjs");
  });

  afterAll(() => {
    resetStore();
    Object.keys(process.env)
      .filter((key) => key.startsWith("MYSQL_"))
      .forEach((key) => delete process.env[key]);
    Object.entries(MYSQL_ENV_BACKUP).forEach(([key, value]) => {
      process.env[key] = value;
    });
  });

  const withServer = async (callback) => {
    resetStore();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await callback(server);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      resetStore();
    }
  };

  it("resets a user password for an authenticated administrator and redacts secrets", async () => {
    await withServer(async (server) => {
      const admin = await auth.registerWithPassword({ email: "root@example.com", password: "root-pass-123" });
      const target = await auth.registerWithPassword({ email: "target@example.com", password: "old-pass-123" });
      const session = await auth.loginWithPassword({ email: admin.user.email, password: "root-pass-123" });

      const result = await request(
        server,
        "POST",
        `/api/admin/users/${target.user.userId}/password`,
        { password: "new-pass-123" },
        { "x-auth-session": session.sessionToken },
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.user.userId, target.user.userId);
      assert.equal(Object.prototype.hasOwnProperty.call(result.body.user, "passwordHash"), false);
      assert.equal(JSON.stringify(result.body).includes("new-pass-123"), false);
      assert.equal(
        (await auth.loginWithPassword({ email: target.user.email, password: "new-pass-123" })).user.userId,
        target.user.userId,
      );
    });
  });

  it("requires admin access and maps forbidden, missing, and invalid errors", async () => {
    await withServer(async (server) => {
      const admin = await auth.registerWithPassword({ email: "root@example.com", password: "root-pass-123" });
      const target = await auth.registerWithPassword({ email: "target@example.com", password: "old-pass-123" });
      const regular = await auth.registerWithPassword({ email: "regular@example.com", password: "regular-pass-123" });
      const regularAdmin = await auth.registerWithPassword({ email: "regular-admin@example.com", password: "admin-pass-123" });
      auth.updateAdminUser(admin.user, regularAdmin.user.userId, { role: "admin" });
      auth.updateAdminUser(admin.user, target.user.userId, { role: "admin" });
      const regularSession = await auth.loginWithPassword({ email: regular.user.email, password: "regular-pass-123" });
      const regularAdminSession = await auth.loginWithPassword({ email: regularAdmin.user.email, password: "admin-pass-123" });
      const adminSession = await auth.loginWithPassword({ email: admin.user.email, password: "root-pass-123" });

      const unauthenticated = await request(server, "POST", `/api/admin/users/${target.user.userId}/password`, { password: "new-pass-123" });
      assert.equal(unauthenticated.status, 401);

      const forbidden = await request(
        server,
        "POST",
        `/api/admin/users/${target.user.userId}/password`,
        { password: "short" },
        { "x-auth-session": regularSession.sessionToken },
      );
      assert.equal(forbidden.status, 403);

      const roleForbidden = await request(
        server,
        "POST",
        `/api/admin/users/${target.user.userId}/password`,
        { password: "new-pass-123" },
        { "x-auth-session": regularAdminSession.sessionToken },
      );
      assert.equal(roleForbidden.status, 403);
      assert.equal(roleForbidden.body.code, "ADMIN_PASSWORD_RESET_FORBIDDEN");

      const missing = await request(
        server,
        "POST",
        "/api/admin/users/missing-user/password",
        { password: "new-pass-123" },
        { "x-auth-session": adminSession.sessionToken },
      );
      assert.equal(missing.status, 404);

      const invalid = await request(
        server,
        "POST",
        `/api/admin/users/${target.user.userId}/password`,
        { password: "short" },
        { "x-auth-session": adminSession.sessionToken },
      );
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.code, "INVALID_PASSWORD");
    });
  });
});
