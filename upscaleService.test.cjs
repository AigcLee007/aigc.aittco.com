const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const upscale = require("./upscaleService.cjs");

const png = async (width, height) =>
  `data:image/png;base64,${(await sharp({ create: { width, height, channels: 3, background: "#808080" } }).png().toBuffer()).toString("base64")}`;

const plan = (engineId, factor, width, height, format) => upscale.planFromDimensions({ engineId, factor, format, width, height });
const rejects = (engineId, factor, width, height, format) => {
  try { plan(engineId, factor, width, height, format); } catch (error) { return error.message; }
  return null;
};
const ALL_ENGINES = ["standard", "detail", "commercial", "commercial-creative"];

// Clarity ("detail") is off by default. Tests of its own rules switch it on the way an operator
// would, with UPSCALE_ENABLED_ENGINES, and always restore the environment afterwards.
const withClarity = (run) => {
  const previous = process.env.UPSCALE_ENABLED_ENGINES;
  process.env.UPSCALE_ENABLED_ENGINES = "detail";
  try { return run(); } finally {
    if (previous === undefined) delete process.env.UPSCALE_ENABLED_ENGINES; else process.env.UPSCALE_ENABLED_ENGINES = previous;
  }
};

test("price is upstream cost x 2 (50% margin) at 1 point = 0.04 CNY", () => {
  // 8.3 MP at $0.001/MP = $0.0083 -> 0.0598 CNY -> doubled 0.1195 -> 2.99 points -> rounds up to 3.0
  const result = plan("standard", 1, 3840, 2160, "jpg");
  assert.equal(result.points, 3);
  assert.ok(result.points * upscale.CNY_PER_POINT >= result.costUsd * upscale.USD_TO_CNY * 2, "revenue never falls below twice the upstream cost");
});

test("rounding up never lets revenue drop below the 50% margin, for every engine", () => withClarity(() => {
  for (const engineId of ALL_ENGINES) {
    const engine = upscale.ENGINES[engineId];
    for (const factor of engine.factors) {
      for (const [width, height] of [[256, 256], [640, 480], [1024, 1024], [1500, 1000], [3840, 2160]]) {
        let result;
        try { result = plan(engineId, factor, width, height, engine.formats ? "jpg" : undefined); } catch { continue; }
        const cost = result.costUsd * upscale.USD_TO_CNY;
        const revenue = result.points * upscale.CNY_PER_POINT;
        assert.ok(revenue + 1e-9 >= cost * upscale.MARGIN_MULTIPLIER || result.points === upscale.MIN_POINTS,
          `${engineId} x${factor} ${width}x${height}: revenue ${revenue} vs cost ${cost}`);
      }
    }
  }
}));

test("a tiny image still costs the minimum", () => {
  assert.equal(plan("standard", 1, 64, 64, "jpg").points, upscale.MIN_POINTS);
});

test("standard offers 1 to 8 times and refuses anything past 100 megapixels", () => {
  assert.deepEqual(upscale.ENGINES.standard.factors, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plan("standard", 8, 1024, 1024, "jpg").outputWidth, 8192);
  assert.equal(plan("standard", 8, 1024, 1024, "jpg").points, 24.2);
  // 3x on a 4K image is 74.8 MP: fine. 4x is 133 MP: over the cap.
  assert.ok(plan("standard", 3, 3840, 2160, "jpg").outputPixels < 100_000_000);
  assert.match(rejects("standard", 4, 3840, 2160, "jpg"), /超过「标准高清」的上限/);
  // 10000 x 10000 = exactly 100 MP is allowed, one pixel row more is not.
  assert.doesNotThrow(() => plan("standard", 2, 5000, 5000, "jpg"));
  assert.match(rejects("standard", 2, 5000, 5001, "jpg"), /超过「标准高清」的上限/);
  assert.match(rejects("standard", 9, 512, 512, "jpg"), /仅支持放大 1 \/ 2 \/ 3 \/ 4 \/ 5 \/ 6 \/ 7 \/ 8 倍/);
});

test("output format: the user chooses it, and PNG drops out when the file would be too large", () => {
  assert.equal(plan("standard", 2, 1024, 1024, "webp").format, "webp");
  assert.equal(plan("standard", 2, 1024, 1024, "jpeg").format, "jpg", "jpeg is accepted as jpg");
  assert.equal(plan("standard", 2, 1024, 1024).format, "png", "default is the first listed format");
  assert.match(rejects("standard", 2, 1024, 1024, "gif"), /支持的输出格式：PNG \/ JPG \/ WebP/);
  // 2x of 4K is 33 MP: PNG would exceed the 50MB save limit, so it is refused with a clear reason.
  assert.match(rejects("standard", 2, 3840, 2160, "png"), /PNG 文件会超过保存上限，请改选 JPG 或 WebP/);
  assert.equal(plan("standard", 2, 3840, 2160).format, "jpg", "with no choice, the default skips PNG when it is too large");
  assert.equal(plan("standard", 1, 3840, 2160, "png").format, "png", "8 MP still fits as PNG");
});

test("the format reaches the provider request", () => {
  const input = (format) => upscale.ENGINES.standard.buildInput({ imageUrl: "https://x", factor: 3, format });
  assert.deepEqual([input("png").output_format, input("jpg").output_format, input("webp").output_format], ["png", "jpg", "webp"]);
  assert.equal(input("png").upscale_factor, 3);
  const bria = (format) => upscale.ENGINES.commercial.buildInput({ imageUrl: "https://x", factor: 4, format });
  assert.deepEqual([bria("png").output_type, bria("jpg").output_type], ["png", "jpeg"]);
  assert.equal(bria("png").desired_increase, 4);
  assert.equal(bria("jpg").preserve_alpha, false, "JPEG has no alpha channel");
});

test("detail allows a 4K image at 1x but not at 2x (when an operator switches it on)", () => withClarity(() => {
  const fourK = plan("detail", 1, 3840, 2160);
  assert.equal(fourK.outputWidth, 3840);
  assert.equal(fourK.points, 89.6);
  assert.ok(fourK.points * upscale.CNY_PER_POINT >= fourK.costUsd * upscale.USD_TO_CNY * 2);
  assert.match(rejects("detail", 2, 3840, 2160), /超过「细节增强」的上限/);
}));

test("Clarity is off by default: not listed, not priced, not accepted", () => {
  const saved = process.env.UPSCALE_ENABLED_ENGINES;
  delete process.env.UPSCALE_ENABLED_ENGINES;
  try {
    assert.deepEqual(upscale.listEngines().map((item) => item.id), ["standard", "commercial", "commercial-creative"]);
    assert.deepEqual(upscale.describeEnginesForImage({ width: 1024, height: 1024 }).map((item) => item.id), ["standard", "commercial", "commercial-creative"]);
    assert.match(rejects("detail", 1, 512, 512), /不支持的放大方式/, "the API refuses it too, not only the picker");
    assert.equal(upscale.getEngine("detail"), null);
  } finally { if (saved !== undefined) process.env.UPSCALE_ENABLED_ENGINES = saved; }
});

test("Clarity can be switched on with UPSCALE_ENABLED_ENGINES, and off again with UPSCALE_DISABLED_ENGINES", () => {
  const env = (enabled, disabled) => ({ UPSCALE_ENABLED_ENGINES: enabled, UPSCALE_DISABLED_ENGINES: disabled });
  const ids = (e) => upscale.listEngines(e).map((item) => item.id);
  assert.ok(ids(env("detail", "")).includes("detail"));
  assert.ok(!ids(env("", "")).includes("detail"));
  assert.ok(!ids(env("detail", "detail")).includes("detail"), "disabling wins over enabling");
  assert.ok(!ids(env("detail", "")).includes("nope"));
  assert.deepEqual(ids(env("DETAIL , ", "")).filter((id) => id === "detail"), ["detail"], "case and spaces are tolerated");
});

test("commercial fidelity: 2x or 4x, flat price, 8192 pixel side limit", () => {
  assert.deepEqual(upscale.ENGINES.commercial.factors, [2, 4]);
  assert.equal(plan("commercial", 2, 1024, 1024, "png").points, 14.5);
  assert.equal(plan("commercial", 4, 1024, 1024, "jpg").points, 14.5, "price is per image, not per pixel");
  assert.equal(plan("commercial", 4, 2048, 2048, "jpg").outputWidth, 8192);
  assert.match(rejects("commercial", 4, 2049, 100, "jpg"), /边长超过 8192/);
  assert.match(rejects("commercial", 4, 2048, 2048, "png"), /请改选 JPG/);
  assert.match(rejects("commercial", 3, 512, 512, "jpg"), /仅支持放大 2 \/ 4 倍/);
});

test("commercial creative: fixed 2x, output capped at 10 megapixels", () => {
  assert.equal(plan("commercial-creative", 2, 1024, 1024).points, 14.5);
  assert.match(rejects("commercial-creative", 2, 2048, 2048), /超过「商用 · 创意」的上限/);
  assert.match(rejects("commercial-creative", 1, 512, 512), /仅支持放大 2 倍/);
  assert.equal(upscale.ENGINES["commercial-creative"].formats, undefined, "format is fixed by the provider");
  assert.equal(plan("commercial-creative", 2, 1024, 1024).format, null);
});

test("factor defaults to the engine's largest", () => {
  assert.equal(plan("standard", undefined, 512, 512, "jpg").factor, 8);
  assert.equal(plan("commercial", undefined, 512, 512, "jpg").factor, 4);
});

test("unknown or disabled engines are rejected", () => {
  assert.match(rejects("nope", 2, 512, 512), /不支持的放大方式/);
  const previous = process.env.UPSCALE_DISABLED_ENGINES;
  process.env.UPSCALE_DISABLED_ENGINES = "detail";
  try {
    assert.match(rejects("detail", 2, 512, 512), /不支持的放大方式/);
    assert.deepEqual(upscale.listEngines().map((item) => item.id), ["standard", "commercial", "commercial-creative"]);
  } finally {
    if (previous === undefined) delete process.env.UPSCALE_DISABLED_ENGINES; else process.env.UPSCALE_DISABLED_ENGINES = previous;
  }
});

test("dimensions come from the file, not from the client", async () => {
  const result = await upscale.planUpscale({ imageDataUrl: await png(300, 200), engineId: "standard", factor: 2, format: "jpg" });
  assert.deepEqual([result.width, result.height, result.outputWidth, result.outputHeight], [300, 200, 600, 400]);
});

test("non-image and oversized payloads are rejected before any work", async () => {
  await assert.rejects(upscale.planUpscale({ imageDataUrl: "data:text/plain;base64,AAAA", engineId: "standard" }), /PNG、JPG 或 WebP/);
  await assert.rejects(upscale.planUpscale({ imageDataUrl: "https://example.com/a.png", engineId: "standard" }), /PNG、JPG 或 WebP/);
  await assert.rejects(upscale.planUpscale({ imageDataUrl: "data:image/png;base64,AAAA", engineId: "standard" }), /无法识别这张图片/);
  const huge = `data:image/png;base64,${"A".repeat(Math.ceil((31 * 1024 * 1024 * 4) / 3))}`;
  await assert.rejects(upscale.planUpscale({ imageDataUrl: huge, engineId: "standard" }), /文件过大/);
});

test("public quote never exposes upstream cost or model names", () => {
  const quote = upscale.toPublicQuote(plan("standard", 2, 1000, 1000, "webp"));
  assert.deepEqual(Object.keys(quote).sort(), ["engine", "factor", "format", "inputHeight", "inputWidth", "outputHeight", "outputWidth", "points"]);
  assert.equal(quote.format, "webp");
  assert.equal(/fal|usd|cost|seedvr|clarity|bria/i.test(JSON.stringify(quote)), false);
  for (const engine of upscale.listEngines()) assert.equal(/fal|usd|cost|seedvr|clarity|bria|swinir/i.test(JSON.stringify(engine)), false, engine.id);
});

test("the fal runner uploads, subscribes with the right model and format, and returns the https result", async () => {
  const calls = [];
  const fakeClient = {
    storage: { upload: async (blob, options) => { calls.push(["upload", blob.type, options.lifecycle.expiresIn]); return "https://v3.fal.media/in.png"; } },
    subscribe: async (model, options) => { calls.push(["subscribe", model, options.input.image_url, options.input.upscale_factor, options.input.output_format]); return { requestId: "req-1", data: { image: { url: "https://v3.fal.media/out.png" } } }; },
  };
  const credentialsSeen = [];
  const run = upscale.createFalRunner({ apiKey: "test-key", createClient: (config) => { credentialsSeen.push(config.credentials); return fakeClient; } });
  const result = await run({ plan: await upscale.planUpscale({ imageDataUrl: await png(100, 100), engineId: "standard", factor: 5, format: "webp" }), signal: undefined });
  assert.equal(result.url, "https://v3.fal.media/out.png");
  assert.deepEqual(calls[0], ["upload", "image/png", "1h"]);
  assert.deepEqual(calls[1], ["subscribe", "fal-ai/seedvr/upscale/image", "https://v3.fal.media/in.png", 5, "webp"]);
  assert.deepEqual(credentialsSeen, ["test-key"]);
  const bria = await upscale.planUpscale({ imageDataUrl: await png(100, 100), engineId: "commercial", factor: 4, format: "jpg" });
  calls.length = 0;
  await run({ plan: bria });
  assert.equal(calls[1][1], "bria/increase-resolution");
});

test("the runner fails clearly without a key or without a returned image", async () => {
  const input = await upscale.planUpscale({ imageDataUrl: await png(100, 100), engineId: "standard", factor: 2, format: "jpg" });
  const previous = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  try {
    await assert.rejects(upscale.createFalRunner({ createClient: () => ({}) })({ plan: input }), (error) => error.code === "UPSCALE_NOT_CONFIGURED" && error.status === 503);
  } finally {
    if (previous !== undefined) process.env.FAL_KEY = previous;
  }
  const withResult = (data) => ({ storage: { upload: async () => "https://v3.fal.media/in.png" }, subscribe: async () => ({ data }) });
  await assert.rejects(upscale.createFalRunner({ apiKey: "k", createClient: () => withResult({}) })({ plan: input }), (error) => error.code === "UPSCALE_NO_RESULT");
  await assert.rejects(upscale.createFalRunner({ apiKey: "k", createClient: () => withResult({ image: { url: "http://evil.local/x.png" } }) })({ plan: input }), (error) => error.code === "UPSCALE_NO_RESULT");
});

test("pickFactor opens on the largest factor that fits the image", () => withClarity(() => {
  assert.equal(upscale.pickFactor({ engineId: "detail", width: 1024, height: 1024 }), 2);
  assert.equal(upscale.pickFactor({ engineId: "detail", width: 3840, height: 2160 }), 1);
  assert.equal(upscale.pickFactor({ engineId: "detail", width: 5000, height: 5000 }), null);
  assert.equal(upscale.pickFactor({ engineId: "commercial-creative", width: 3840, height: 2160 }), null);
  assert.equal(upscale.pickFactor({ engineId: "commercial", width: 3840, height: 2160 }), 2, "4K fits fidelity mode at 2x (7680 side) but not 4x");
  assert.equal(upscale.pickFactor({ engineId: "standard", width: 3840, height: 2160 }), 3, "100 MP leaves room for 3x on a 4K image");
}));

test("the picker only offers factors and formats the server would accept", () => withClarity(() => {
  const view = (width, height) => Object.fromEntries(upscale.describeEnginesForImage({ width, height }).map((item) => [item.id, item]));
  const small = view(1024, 1024);
  assert.deepEqual(small.standard.usableFactors, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(small.commercial.usableFactors, [2, 4]);
  assert.deepEqual(small["commercial-creative"].usableFactors, [2]);
  const large = view(3840, 2160);
  assert.deepEqual(large.standard.usableFactors, [1, 2, 3]);
  assert.deepEqual(large.detail.usableFactors, [1]);
  assert.deepEqual(large.commercial.usableFactors, [2]);
  assert.deepEqual(large["commercial-creative"].usableFactors, []);
  assert.equal(large["commercial-creative"].defaultFactor, null);
  // The strong check: whatever the picker lists must be accepted, and everything else refused.
  for (const [width, height] of [[1024, 1024], [3840, 2160], [2048, 2048], [4096, 4096], [600, 400]]) {
    for (const item of upscale.describeEnginesForImage({ width, height })) {
      for (const factor of item.factors) {
        const offered = item.usableFactors.includes(factor);
        const formats = item.formats ? item.formats : [undefined];
        const accepted = (format) => !rejects(item.id, factor, width, height, format);
        if (offered) {
          assert.ok(formats.some(accepted), `${item.id} ${width}x${height} x${factor} is offered but nothing is accepted`);
          if (item.formats) for (const format of item.formats) {
            assert.equal(item.formatsByFactor[String(factor)].includes(format), accepted(format), `${item.id} ${width}x${height} x${factor} ${format}`);
          }
        } else {
          assert.equal(formats.some(accepted), false, `${item.id} ${width}x${height} x${factor} is hidden but would be accepted`);
        }
      }
    }
  }
}));
