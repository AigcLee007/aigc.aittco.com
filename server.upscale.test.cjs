const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const sharp = require("sharp");

const png = async (width, height) =>
  `data:image/png;base64,${(await sharp({ create: { width, height, channels: 3, background: "#808080" } }).png().toBuffer()).toString("base64")}`;

test("upscale: quotes, charges, completes, and refunds exactly once on failure", async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT || os.tmpdir(), "upscale-http-"));
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("MYSQL_"))) process.env[key] = "";
  process.env.AUTH_STORE_FILE = path.join(root, "auth.json");
  process.env.BILLING_FILE_PATH = path.join(root, "billing.json");
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  process.env.IMAGE_JOB_POLL_INTERVAL_MS = "10";
  process.env.FAL_KEY = "test-fal-key";
  delete process.env.UPSCALE_DISABLED_ENGINES;

  const auth = require("./authStore.cjs");
  const billing = require("./billingStore.cjs");
  const recordModule = require("./generationRecordStore.cjs");
  const records = new Map();
  recordModule.createGenerationRecord = async (value) => { const record = { ...value, id: `rec-${records.size}` }; records.set(record.id, record); return record; };
  recordModule.attachTaskToGenerationRecord = async (id, taskId) => { Object.assign(records.get(id), { taskId }); };
  recordModule.completeGenerationRecord = async (id, value) => Object.assign(records.get(id), value);
  recordModule.completeGenerationRecordByTaskId = async () => null;
  recordModule.getGenerationRecordByTaskId = async () => null;
  // The real asset service saves the result. Only the download is replaced, because the
  // provider's address is fake; everything after it (store, preview, retention) is real.
  const assetsModule = require("./imageJobAssets.cjs");
  const createAssets = assetsModule.createImageJobAssets;
  const resultImage = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#3a7bd5" } }).jpeg({ quality: 80 }).toBuffer();
  const prepareCalls = [];
  const realAssets = createAssets({ root, download: async () => resultImage, statfs: async () => null });
  assetsModule.createImageJobAssets = () => ({
    ...realAssets,
    prepare: async (args) => { prepareCalls.push({ forceKeep: args.forceKeep, storageMode: args.storageMode }); return realAssets.prepare(args); },
  });

  const app = require("./server.cjs");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    delete app.upscaleEngine;
    await app.imageJobService?.stop();
    await realAssets.drain();
    assetsModule.createImageJobAssets = createAssets;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const reg = await auth.registerWithPassword({ email: "upscale-owner@example.com", password: "upscale-pass-123" });
  const session = await auth.loginWithPassword({ email: reg.user.email, password: "upscale-pass-123" });
  const account = await billing.ensureAccountForUser(reg.user);
  await billing.rechargeAccount(account.accountId, 10);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const headers = { "content-type": "application/json", "x-auth-session": session.sessionToken };
  const call = (url, options = {}) => fetch(`${base()}${url}`, { headers, ...options });
  const points = async () => (await billing.getAccountSummary(account.accountId)).points;
  const poll = async (taskId) => {
    for (let i = 0; i < 200; i++) {
      const state = await (await call(`/api/task/${taskId}`)).json();
      if (["succeeded", "failed"].includes(state.status)) return state;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("upscale job did not finish");
  };

  // The picker is public information: engines and an on/off flag, nothing about the provider.
  const options = await (await fetch(`${base()}/api/upscale/options`)).json();
  assert.equal(options.enabled, true);
  assert.deepEqual(options.engines.map((engine) => engine.id), ["standard", "commercial", "commercial-creative"], "Clarity is off by default");
  assert.deepEqual(options.engines[0].formats, ["png", "jpg", "webp"]);
  assert.deepEqual(options.engines[0].factors, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(/fal|usd|cost/i.test(JSON.stringify(options)), false);

  // A quote needs only the image size, and matches what is charged later.
  const quote = await (await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "standard", factor: 2, format: "webp", width: 1024, height: 1024 }) })).json();
  assert.equal(quote.points, 1.6);
  assert.equal(quote.outputWidth, 2048);
  assert.equal(quote.format, "webp");
  const eight = await (await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "standard", factor: 8, format: "jpg", width: 1024, height: 1024 }) })).json();
  assert.deepEqual([eight.outputWidth, eight.points], [8192, 24.2]);
  const pngTooBig = await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "standard", factor: 8, format: "png", width: 1024, height: 1024 }) });
  assert.equal(pngTooBig.status, 400);
  assert.match((await pngTooBig.json()).error, /PNG 文件会超过保存上限/);
  const overCap = await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "standard", factor: 8, format: "jpg", width: 3840, height: 2160 }) });
  assert.equal(overCap.status, 400, "past 100 megapixels is refused");
  const badQuote = await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "commercial-creative", factor: 2, width: 4000, height: 4000 }) });
  assert.equal(badQuote.status, 400);

  // Validation happens before anything is charged or queued.
  const image = await png(1024, 1024);
  const calls = [];
  app.upscaleEngine = async ({ plan }) => { calls.push([plan.engine.id, plan.factor, plan.format]); return { url: "https://v3.fal.media/out.png" }; };
  const noLogin = await fetch(`${base()}/api/upscale`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, engine: "standard", factor: 2, clientRequestId: "no-login" }) });
  assert.equal(noLogin.status, 401);
  const badEngine = await call("/api/upscale", { method: "POST", body: JSON.stringify({ image, engine: "nope", clientRequestId: "bad-engine" }) });
  assert.equal(badEngine.status, 400);
  const notImage = await call("/api/upscale", { method: "POST", body: JSON.stringify({ image: "data:text/plain;base64,AAAA", engine: "standard", clientRequestId: "not-image" }) });
  assert.equal(notImage.status, 400);
  // A client that still asks for Clarity by name is refused, so hiding it is not just cosmetic.
  const hiddenEngine = await call("/api/upscale", { method: "POST", body: JSON.stringify({ image, engine: "detail", factor: 1, clientRequestId: "hidden-engine" }) });
  assert.equal(hiddenEngine.status, 400);
  assert.match((await hiddenEngine.json()).error, /不支持的放大方式/);
  const hiddenQuote = await fetch(`${base()}/api/upscale/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "detail", factor: 1, width: 512, height: 512 }) });
  assert.equal(hiddenQuote.status, 400);
  const tooBigForCreative = await call("/api/upscale", { method: "POST", body: JSON.stringify({ image: await png(3000, 2000), engine: "commercial-creative", factor: 2, clientRequestId: "too-big" }) });
  assert.equal(tooBigForCreative.status, 400, "output past 10 megapixels is refused by the creative engine");
  const sizedOptions = await (await fetch(base() + "/api/upscale/options?width=3840&height=2160")).json();
  const sized = Object.fromEntries(sizedOptions.engines.map((item) => [item.id, item.usableFactors]));
  assert.deepEqual(sized, { standard: [1, 2, 3], commercial: [2], "commercial-creative": [] });
  assert.equal(await points(), 10, "rejected requests never charge");
  assert.equal(calls.length, 0, "rejected requests never reach the provider");

  // Success: charged once at the quoted price, result link delivered, record completed.
  const body = { image, engine: "standard", factor: 2, format: "jpg", storageMode: "speed", clientRequestId: "ok-1", uiMode: "classic" };
  const accepted = await call("/api/upscale", { method: "POST", body: JSON.stringify(body) });
  assert.equal(accepted.status, 202);
  const ack = await accepted.json();
  assert.match(ack.task_id, /^job-/);
  assert.equal(ack.billing.quotedPoints, 1.6);
  const replay = await call("/api/upscale", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await replay.json()).task_id, ack.task_id, "resubmitting the same request id does not queue or charge twice");
  const done = await poll(ack.task_id);
  assert.equal(done.status, "succeeded");
  // Even though the account asked for fast transfer, an upscale is always kept on the server.
  assert.equal(done.results.length, 1);
  // While saving, the user is given a link on our own site, never the provider's address.
  assert.ok(done.results[0].startsWith("/api/image-job-relay/") || done.results[0].startsWith("/api/image-job-assets/"), "never the provider's address");
  assert.deepEqual(done.direct_urls, [null], "no provider link is offered");
  let saved = done;
  for (let i = 0; i < 100 && saved.storage_status !== "saved"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    saved = await (await call(`/api/task/${ack.task_id}`)).json();
  }
  assert.equal(saved.storage_status, "saved");
  // Follow the link the way the browser does. The relay redirects to the stored copy.
  const stored = await fetch(`${base()}${saved.results[0]}`);
  assert.equal(stored.status, 200);
  assert.equal(stored.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), resultImage, "the file served is the provider's result, now held on our server");
  const finalUrl = new URL(stored.url);
  assert.ok(finalUrl.pathname.startsWith("/api/image-job-assets/"), "the link resolves to our own stored copy");
  const [, , , savedUser, savedTask] = finalUrl.pathname.split("/");
  const savedFiles = await fs.readdir(path.join(root, "assets", savedUser, savedTask));
  assert.ok(savedFiles.includes(".keep"), "the folder is marked so disk pressure cannot shorten the five hours");
  assert.ok(savedFiles.some((name) => name.endsWith(".preview.webp")), "a preview is kept as well");
  assert.equal(finalUrl.searchParams.get("token").split(".")[0] > String(Date.now() + 4.9 * 3600000), true, "the stored link is valid for the full five hours");
  assert.equal(await points(), 8.4);
  assert.deepEqual(calls, [["standard", 2, "jpg"]], "the chosen engine, factor and format reach the provider");
  const okRecord = [...records.values()].find((record) => record.actionName === "upscale");
  assert.ok(okRecord, "the upscale is recorded in the account's generation history");
  assert.equal(okRecord.outputSize, "2048x2048");

  // Provider failure: points come back exactly once and the user sees a plain message.
  app.upscaleEngine = async () => { throw Object.assign(new Error("fal-ai/seedvr upstream exploded: key=abc"), { status: 500 }); };
  const failing = await call("/api/upscale", { method: "POST", body: JSON.stringify({ ...body, clientRequestId: "fail-1" }) });
  assert.equal(failing.status, 202);
  const failed = await poll((await failing.json()).task_id);
  assert.equal(failed.status, "failed");
  assert.equal(/fal|seedvr|key=abc/i.test(JSON.stringify(failed)), false, "provider wording never reaches the user");
  await app.imageJobService.reconcile();
  await app.imageJobService.reconcile();
  assert.equal(await points(), 8.4, "a failed upscale is fully refunded");
  const ledger = await billing.getAccountLedger(account.accountId, { pageSize: 100 });
  assert.equal(ledger.entries.filter((entry) => entry.type === "refund").length, 1, "refunded once, not twice");

  // Not enough points is refused up front, with the price in the message, and nothing is queued.
  await billing.adjustAccountPoints(account.accountId, 0.5 - (await points()), { note: "test: drain balance" });
  assert.equal(await points(), 0.5);
  const broke = await call("/api/upscale", { method: "POST", body: JSON.stringify({ ...body, clientRequestId: "broke-1" }) });
  assert.equal(broke.status, 400);
  const brokeBody = await broke.json();
  assert.equal(brokeBody.code, "INSUFFICIENT_POINTS");
  assert.match(brokeBody.error, /金币不足，当前 0.5，需 1.6/);
  assert.equal((await call("/api/image-jobs/request/broke-1")).status, 404, "no job was queued");
  assert.equal(await points(), 0.5);

  // Switched off: a clear message instead of a queued job that cannot run.
  const savedKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "";
  try {
    const off = await call("/api/upscale", { method: "POST", body: JSON.stringify({ ...body, clientRequestId: "off-1" }) });
    assert.equal(off.status, 503);
    assert.equal((await (await fetch(`${base()}/api/upscale/options`)).json()).enabled, false);
  } finally {
    process.env.FAL_KEY = savedKey;
  }
});
