"use strict";

// Image upscaling. Kept separate from the generation routes: an upscale has no
// prompt and no route family, only an engine, an input image and a factor.

const sharp = require("sharp");
const { toPointNumber } = require("./pointMath.cjs");

// 1 point = 0.04 CNY, target margin 50% => price = cost * 2.
const CNY_PER_POINT = 0.04;
const USD_TO_CNY = 7.2;
const MARGIN_MULTIPLIER = 2;
const ONE_MEGAPIXEL = 1_000_000;
// Floor so a tiny image still covers request overhead; points carry one decimal.
const MIN_POINTS = 1;

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64_000_000;
// No result may exceed 100 megapixels (about 10000 x 10000).
const MAX_OUTPUT_PIXELS = 100_000_000;
// Saved results are capped at 50MB (GENERATED_ASSET_MAX_BYTES). A noisy 4096x4096 PNG is
// already ~43MB, so PNG is only offered up to this many output pixels.
const PNG_MAX_OUTPUT_PIXELS = 12_000_000;
const FORMAT_LABELS = { png: "PNG", jpg: "JPG", webp: "WebP" };
// Fal keeps uploads and results only as long as we need to download them.
const FAL_OBJECT_TTL = "1h";

class UpscaleError extends Error {
  constructor(message, { status = 400, code = "UPSCALE_REJECTED" } = {}) {
    super(message);
    this.name = "UpscaleError";
    this.status = status;
    this.code = code;
  }
}

// Each engine: how it is called, what it costs us, and what it accepts.
// costUsdPerMp / costUsdPerImage are fal list prices; check fal.ai when they change.
//   formats: output formats the user may choose (first is the default). Omit if fixed.
//   formatField: how the format is named in the provider request.
const ENGINES = {
  "standard": {
    id: "standard",
    label: "标准高清",
    description: "忠实还原，细节不乱改，适合大多数图片，可放大 1 到 8 倍",
    falModel: "fal-ai/seedvr/upscale/image",
    costUsdPerMp: 0.001,
    factors: [1, 2, 3, 4, 5, 6, 7, 8],
    formats: ["png", "jpg", "webp"],
    maxOutputPixels: MAX_OUTPUT_PIXELS,
    buildInput: ({ imageUrl, factor, format }) => ({
      image_url: imageUrl,
      upscale_mode: "factor",
      upscale_factor: factor,
      output_format: format,
      noise_scale: 0.1,
    }),
  },
  "detail": {
    id: "detail",
    label: "细节增强",
    description: "AI 补充纹理和细节，修复效果最好，可能改动局部；大图只能原尺寸增强",
    falModel: "fal-ai/clarity-upscaler",
    // Off in this release: about $0.03 per output megapixel makes it too costly to offer.
    // Switch it back on with UPSCALE_ENABLED_ENGINES=detail; no code change needed.
    hiddenByDefault: true,
    costUsdPerMp: 0.03,
    factors: [1, 2],
    // Cost scales with output pixels (about $0.50 at the cap). A 4K image is allowed at 1x
    // (about $0.25) but not at 2x (about $1), so the output cap alone decides which factor fits.
    maxOutputPixels: 16_800_000,
    buildInput: ({ imageUrl, factor }) => ({
      image_url: imageUrl,
      upscale_factor: factor,
      creativity: 0.25,
      resemblance: 0.75,
    }),
  },
  "commercial": {
    id: "commercial",
    label: "商用 · 保真",
    description: "只提升分辨率，不重画、不改细节，授权数据训练，适合商用；可放大 2 倍或 4 倍",
    falModel: "bria/increase-resolution",
    costUsdPerImage: 0.04,
    factors: [2, 4],
    formats: ["png", "jpg"],
    // The model accepts up to 8192 x 8192 (67 megapixels).
    maxOutputPixels: 8192 * 8192,
    maxOutputSide: 8192,
    buildInput: ({ imageUrl, factor, format }) => ({
      image_url: imageUrl,
      desired_increase: factor,
      output_type: format === "jpg" ? "jpeg" : "png",
      preserve_alpha: format !== "jpg",
    }),
  },
  "commercial-creative": {
    id: "commercial-creative",
    label: "商用 · 创意",
    description: "重新生成纹理和细节，画面更锐利，会改动原图细节，授权数据训练，适合商用；固定放大 2 倍，输出最高 10 百万像素",
    falModel: "bria/upscale/creative",
    costUsdPerImage: 0.04,
    factors: [2],
    // The model doubles the size and caps its output at 10MP.
    maxOutputPixels: 10_000_000,
    buildInput: ({ imageUrl }) => ({
      image_url: imageUrl,
      preserve_alpha: true,
    }),
  },
};

// UPSCALE_DISABLED_ENGINES="commercial" switches an engine off; engines marked hiddenByDefault
// stay off until UPSCALE_ENABLED_ENGINES names them. Both are checked on every request, so a
// hidden engine is refused by the API too, not only left out of the picker.
const idList = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const isEngineEnabled = (engine, env = process.env) => {
  if (idList(env.UPSCALE_DISABLED_ENGINES).includes(engine.id)) return false;
  if (engine.hiddenByDefault) return idList(env.UPSCALE_ENABLED_ENGINES).includes(engine.id);
  return true;
};
const isUpscaleConfigured = (env = process.env) => Boolean(String(env.FAL_KEY || "").trim());

const listEngines = (env = process.env) =>
  Object.values(ENGINES)
    .filter((engine) => isEngineEnabled(engine, env))
    .map(({ id, label, description, factors, formats, maxInputPixels, maxOutputPixels }) => ({
      id, label, description, factors, formats: formats || null,
      maxInputPixels: maxInputPixels || null,
      maxOutputPixels: maxOutputPixels || null,
    }));

const getEngine = (engineId, env = process.env) => {
  const engine = ENGINES[String(engineId || "").trim()];
  return engine && isEngineEnabled(engine, env) ? engine : null;
};

const parseDataUrl = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new UpscaleError("请上传 PNG、JPG 或 WebP 格式的图片");
  // Reject before decoding: the base64 text is about 4/3 of the bytes.
  if (match[2].length > Math.ceil((MAX_INPUT_BYTES * 4) / 3) + 8) {
    throw new UpscaleError("图片文件过大，请压缩后再试");
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new UpscaleError("图片内容为空");
  if (buffer.length > MAX_INPUT_BYTES) throw new UpscaleError("图片文件过大，请压缩后再试");
  return { buffer, mime: match[1].toLowerCase() };
};

// Reads dimensions without decoding pixels; limitInputPixels guards decompression bombs.
const readDimensions = async (buffer) => {
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const width = Number(meta.width);
    const height = Number(meta.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error("no dimensions");
    }
    return { width, height };
  } catch (_error) {
    throw new UpscaleError("无法识别这张图片，请换一张再试");
  }
};

const normalizeFactor = (engine, factorInput) => {
  const factor = Number(factorInput === undefined || factorInput === null || factorInput === "" ? engine.factors[engine.factors.length - 1] : factorInput);
  if (!engine.factors.includes(factor)) {
    throw new UpscaleError(`「${engine.label}」仅支持放大 ${engine.factors.join(" / ")} 倍`);
  }
  return factor;
};

// What the user is charged. Cost is rounded up to a whole output megapixel step
// so a tiny image still pays for the minimum work, then doubled for the margin.
const upstreamCostUsd = (engine, outputPixels) => {
  if (engine.costUsdPerImage) return engine.costUsdPerImage;
  return (outputPixels / ONE_MEGAPIXEL) * engine.costUsdPerMp;
};

const pointsForCost = (costUsd) => {
  const costCny = costUsd * USD_TO_CNY;
  const points = (costCny * MARGIN_MULTIPLIER) / CNY_PER_POINT;
  // Points have one decimal; round up so rounding never eats the margin.
  return Math.max(MIN_POINTS, toPointNumber(Math.ceil(points * 10) / 10, MIN_POINTS));
};

// Formats this engine offers for an output of this size. PNG is dropped for very large
// outputs because the file would exceed the save limit; the user then picks JPG or WebP.
const formatsFor = (engine, outputPixels) => {
  if (!engine.formats) return [];
  return engine.formats.filter((format) => format !== "png" || outputPixels <= PNG_MAX_OUTPUT_PIXELS);
};

const normalizeFormat = (engine, formatInput, outputPixels) => {
  const allowed = formatsFor(engine, outputPixels);
  if (!engine.formats) return null;
  const wanted = String(formatInput ?? "").trim().toLowerCase().replace("jpeg", "jpg");
  if (!wanted) {
    if (!allowed.length) throw new UpscaleError("输出格式不可用");
    return allowed[0];
  }
  if (!engine.formats.includes(wanted)) {
    throw new UpscaleError(`「${engine.label}」支持的输出格式：${engine.formats.map((item) => FORMAT_LABELS[item]).join(" / ")}`);
  }
  if (!allowed.includes(wanted)) {
    throw new UpscaleError(`图片放大后较大，${FORMAT_LABELS[wanted]} 文件会超过保存上限，请改选 ${allowed.map((item) => FORMAT_LABELS[item]).join(" 或 ")}`);
  }
  return wanted;
};

// Decides whether an image of this size is allowed and what it costs. Pure, so the
// price quoted before upload and the price charged afterwards come from one place.
const planFromDimensions = ({ engineId, factor, format, width, height }) => {
  const engine = getEngine(engineId);
  if (!engine) throw new UpscaleError("不支持的放大方式");
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) throw new UpscaleError("无法识别图片尺寸");
  const chosenFactor = normalizeFactor(engine, factor);
  const inputPixels = w * h;
  const outputPixels = inputPixels * chosenFactor * chosenFactor;

  if (inputPixels > MAX_INPUT_PIXELS) throw new UpscaleError("图片尺寸过大，请先缩小后再试");
  if (engine.maxInputPixels && inputPixels > engine.maxInputPixels) {
    throw new UpscaleError(`「${engine.label}」仅支持约 ${Math.round(engine.maxInputPixels / ONE_MEGAPIXEL)} 百万像素以内的图片，请换用「标准高清」`);
  }
  if (engine.maxOutputPixels && outputPixels > engine.maxOutputPixels) {
    throw new UpscaleError(`放大后约 ${Math.round(outputPixels / ONE_MEGAPIXEL)} 百万像素，超过「${engine.label}」的上限，请换用其他方式或减小放大倍数`);
  }
  if (engine.maxOutputSide && Math.max(w, h) * chosenFactor > engine.maxOutputSide) {
    throw new UpscaleError(`放大后边长超过 ${engine.maxOutputSide} 像素，超过「${engine.label}」的上限，请减小放大倍数`);
  }
  const chosenFormat = normalizeFormat(engine, format, outputPixels);

  const costUsd = upstreamCostUsd(engine, outputPixels);
  return {
    engine,
    factor: chosenFactor,
    format: chosenFormat,
    width: w,
    height: h,
    inputPixels,
    outputPixels,
    outputWidth: w * chosenFactor,
    outputHeight: h * chosenFactor,
    costUsd,
    points: pointsForCost(costUsd),
  };
};

// Largest factor this engine allows for an image of this size, so the picker can open on a
// choice that works. Null when no factor fits.
const pickFactor = ({ engineId, width, height }) => {
  const engine = getEngine(engineId);
  if (!engine) throw new UpscaleError("不支持的放大方式");
  for (const factor of [...engine.factors].sort((a, b) => b - a)) {
    try {
      planFromDimensions({ engineId, factor, width, height });
      return factor;
    } catch (error) {
      if (!(error instanceof UpscaleError)) throw error;
    }
  }
  return null;
};

// Same plan, from the real image bytes. Dimensions come from the file header, never from the client.
const planUpscale = async ({ imageDataUrl, engineId, factor, format }) => {
  const { buffer, mime } = parseDataUrl(imageDataUrl);
  const { width, height } = await readDimensions(buffer);
  return { ...planFromDimensions({ engineId, factor, format, width, height }), buffer, mime };
};

// For the picker: each engine with the factors that actually work for this image size,
// so the UI never offers a choice the server would refuse.
const describeEnginesForImage = ({ width, height }, env = process.env) =>
  listEngines(env).map((engine) => {
    const usable = engine.factors.filter((factor) => {
      try { planFromDimensions({ engineId: engine.id, factor, width, height }); return true; }
      catch (error) { if (error instanceof UpscaleError) return false; throw error; }
    });
    const definition = ENGINES[engine.id];
    // Formats depend on the output size, so they are listed per factor.
    const formatsByFactor = definition.formats
      ? Object.fromEntries(usable.map((factor) => [factor, formatsFor(definition, width * height * factor * factor)]))
      : null;
    return { ...engine, usableFactors: usable, defaultFactor: usable.length ? usable[usable.length - 1] : null, formatsByFactor };
  });

// Safe to send to the browser: no cost in dollars, no upstream model names.
const toPublicQuote = (plan) => ({
  engine: plan.engine.id,
  factor: plan.factor,
  format: plan.format,
  inputWidth: plan.width,
  inputHeight: plan.height,
  outputWidth: plan.outputWidth,
  outputHeight: plan.outputHeight,
  points: plan.points,
});

// fal accepts a data URI for image inputs, but large uploads are safer through its storage.
const loadFalClient = () => {
  // Required lazily so a missing FAL_KEY never breaks server start-up.
  const { createFalClient } = require("@fal-ai/client");
  return createFalClient;
};

const createFalRunner = ({ apiKey, createClient = loadFalClient() } = {}) => {
  return async ({ plan, signal }) => {
    // Read at call time so a key added to the environment applies without code changes.
    const key = String(apiKey ?? process.env.FAL_KEY ?? "").trim();
    if (!key) throw new UpscaleError("高清放大暂未开通，请联系管理员", { status: 503, code: "UPSCALE_NOT_CONFIGURED" });
    const fal = createClient({ credentials: key });
    const blob = new Blob([plan.buffer], { type: plan.mime });
    const imageUrl = await fal.storage.upload(blob, { lifecycle: { expiresIn: FAL_OBJECT_TTL } });
    const result = await fal.subscribe(plan.engine.falModel, {
      input: plan.engine.buildInput({ imageUrl, factor: plan.factor, format: plan.format, outputPixels: plan.outputPixels }),
      pollInterval: 1500,
      abortSignal: signal,
      storageSettings: { expiresIn: FAL_OBJECT_TTL },
    });
    const data = result?.data || {};
    const url = data.image?.url || data.images?.[0]?.url || "";
    if (!/^https:\/\//i.test(url)) throw new UpscaleError("放大服务没有返回图片，本次费用已退回", { status: 502, code: "UPSCALE_NO_RESULT" });
    return { url, requestId: result?.requestId || null };
  };
};

module.exports = {
  ENGINES,
  CNY_PER_POINT,
  USD_TO_CNY,
  MARGIN_MULTIPLIER,
  UpscaleError,
  createFalRunner,
  getEngine,
  isUpscaleConfigured,
  listEngines,
  MIN_POINTS,
  describeEnginesForImage,
  pickFactor,
  formatsFor,
  planFromDimensions,
  planUpscale,
  toPublicQuote,
  pointsForCost,
  upstreamCostUsd,
};
