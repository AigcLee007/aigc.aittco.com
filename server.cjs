const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const fs = require("fs");
const FormData = require("form-data");
const https = require("https");

const localEnvPath = path.join(__dirname, ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

const {
  AuthError,
  getAdminAuthOverview,
  getAdminUserById,
  getRegistrationStatus,
  getSessionUserFromRequest,
  listAdminUsers,
  changeUserPassword,
  loginWithPassword,
  logoutSession,
  registerWithPassword,
  resetPasswordWithEmailCode,
  requestEmailCode,
  requireAdminAccess,
  requireAuthUser,
  requireSuperAdminAccess,
  setUserPassword,
  updateAdminUser,
  verifyEmailCode,
} = require("./authStore.cjs");
const {
  BillingError,
  adjustAccountPoints,
  createRedeemCodes,
  ensureBillingIdentity,
  ensureAccountForUser,
  getAdminBillingOverview,
  getAccountByUserId,
  getAccountLedger,
  getAccountLedgerReport,
  getAccountsByUserIds,
  requireBillingAccount,
  getAccountSummary,
  getBillingPricing,
  listRedeemCodes,
  reservePoints,
  redeemCode,
  refundPoints,
  registerPendingTask,
  settlePendingTask,
  rechargeAccount,
} = require("./billingStore.cjs");
const {
  attachTaskToGenerationRecord,
  clearGenerationRecordsForUser,
  completeGenerationRecord,
  completeGenerationRecordByTaskId,
  createGenerationRecord,
  listGenerationRecordsForUser,
} = require("./generationRecordStore.cjs");
const {
  createManagedImageRoute,
  deleteManagedImageRoute,
  fetchAdminRoutes,
  getImageRouteById,
  getImageRouteCatalog,
  getImageRoutePricing,
  updateManagedImageRoute,
} = require("./imageRouteStore.cjs");
const {
  createManagedImageModel,
  deleteManagedImageModel,
  fetchAdminImageModels,
  getImageModelById,
  getImageModelByRequestModel,
  getImageModelCatalog,
  updateManagedImageModel,
} = require("./imageModelStore.cjs");
const {
  createManagedVideoRoute,
  deleteManagedVideoRoute,
  fetchAdminVideoRoutes,
  getVideoRouteById,
  getVideoRouteCatalog,
  updateManagedVideoRoute,
} = require("./videoRouteStore.cjs");
const {
  createManagedVideoModel,
  deleteManagedVideoModel,
  fetchAdminVideoModels,
  getVideoModelById,
  getVideoModelByRequestModel,
  getVideoModelCatalog,
  updateManagedVideoModel,
} = require("./videoModelStore.cjs");
const {
  listAdminChanges,
  recordAdminChange,
} = require("./adminChangeLogStore.cjs");
const { toPointNumber } = require("./pointMath.cjs");

// Logger Configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "debug_error.log" }),
  ],
});

const app = express();
const PORT = Number.parseInt(String(process.env.PORT || "3355"), 10);
const UPSTREAM_URL = "https://api.bltcy.ai";

// Default upstream kept for balance, video, and prompt helper endpoints.
const SHARED_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  family: 4,
});

const trimTrailingSlash = (value = "") => String(value).replace(/\/+$/, "");
const resolveImageRoute = async (routeId, { includeInactive = false } = {}) => {
  const routeIdValue = String(routeId || "").trim();
  if (routeIdValue) {
    const exactRoute = await getImageRouteById(routeIdValue, {
      includeInactive,
      includeSecrets: true,
    });
    if (exactRoute && (includeInactive || exactRoute.isActive !== false)) {
      return exactRoute;
    }
  }

  const catalog = await getImageRouteCatalog({ includeInactive });
  const fallbackId = catalog.defaultRouteId || catalog.routes?.[0]?.id || "";
  if (!fallbackId) {
    return null;
  }

  return getImageRouteById(fallbackId, {
    includeInactive,
    includeSecrets: true,
  });
};
const resolveVideoRoute = async (routeId, { includeInactive = false } = {}) => {
  const routeIdValue = String(routeId || "").trim();
  if (routeIdValue) {
    const exactRoute = await getVideoRouteById(routeIdValue, {
      includeInactive,
      includeSecrets: true,
    });
    if (exactRoute && (includeInactive || exactRoute.isActive !== false)) {
      return exactRoute;
    }
  }

  const catalog = await getVideoRouteCatalog({ includeInactive });
  const fallbackId = catalog.defaultRouteId || catalog.routes?.[0]?.id || "";
  if (!fallbackId) {
    return null;
  }

  return getVideoRouteById(fallbackId, {
    includeInactive,
    includeSecrets: true,
  });
};
const normalizeAuthorization = (value) => {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return "";

  if (/^Bearer\s+/i.test(cleaned)) {
    const token = cleaned.replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
    return token ? `Bearer ${token}` : "";
  }

  return `Bearer ${cleaned.replace(/\s+/g, "")}`;
};
const allowsDirectUserApiKeyRoute = (route) => {
  return route?.allowUserApiKeyWithoutLogin === true;
};
const shouldUseUserProvidedApiKey = (route, fallbackAuthorization) =>
  allowsDirectUserApiKeyRoute(route) &&
  Boolean(normalizeAuthorization(fallbackAuthorization));
const toPublicImageRouteSizeOverrides = (overrides) => {
  if (!overrides || typeof overrides !== "object") {
    return {};
  }

  return Object.entries(overrides).reduce((accumulator, [rawKey, rawValue]) => {
    const key = String(rawKey || "").trim().toLowerCase();
    const pointCost = toPointNumber(rawValue?.pointCost ?? "", 0);
    if (!["1k", "2k", "4k"].includes(key) || !Number.isFinite(pointCost) || pointCost < 0) {
      return accumulator;
    }
    accumulator[key] = { pointCost };
    return accumulator;
  }, {});
};
const toPublicImageRoute = (route = {}) => ({
  id: String(route.id || "").trim(),
  label: String(route.label || "").trim(),
  modelFamily: String(route.modelFamily || "default").trim(),
  line: String(route.line || "default").trim(),
  transport: String(route.transport || "openai-image").trim(),
  mode: String(route.mode || "async").trim(),
  requiresDataUriReferences: isVisionaryImageRoute(route),
  allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
  pointCost: toPointNumber(route.pointCost || 0),
  sizeOverrides: toPublicImageRouteSizeOverrides(route.sizeOverrides),
  sortOrder: Number(route.sortOrder || 0),
  isActive: route.isActive !== false,
  isDefaultRoute: route.isDefaultRoute === true,
  isDefaultNanoBananaLine: route.isDefaultNanoBananaLine === true,
});
const toPublicVideoRoute = (route = {}) => ({
  id: String(route.id || "").trim(),
  label: String(route.label || "").trim(),
  routeFamily: String(route.routeFamily || "default").trim(),
  line: String(route.line || "default").trim(),
  transport: String(route.transport || "openai-video").trim(),
  mode: String(route.mode || "async").trim(),
  allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
  pointCost: toPointNumber(route.pointCost || 0),
  sortOrder: Number(route.sortOrder || 0),
  isActive: route.isActive !== false,
  isDefaultRoute: route.isDefaultRoute === true,
});
const toPublicImageRouteCatalog = (catalog = {}) => ({
  defaultRouteId: String(catalog.defaultRouteId || "").trim(),
  defaultNanoBananaLine: String(catalog.defaultNanoBananaLine || "line1").trim(),
  routes: Array.isArray(catalog.routes) ? catalog.routes.map((route) => toPublicImageRoute(route)) : [],
});
const toPublicVideoRouteCatalog = (catalog = {}) => ({
  defaultRouteId: String(catalog.defaultRouteId || "").trim(),
  routes: Array.isArray(catalog.routes) ? catalog.routes.map((route) => toPublicVideoRoute(route)) : [],
});
const getRouteAuthorization = (
  route,
  fallbackAuthorization,
  { preferUserProvided = false } = {},
) => {
  const normalizedFallback = normalizeAuthorization(fallbackAuthorization);
  if (preferUserProvided && normalizedFallback) return normalizedFallback;

  const directApiKey = route?.apiKey ? normalizeAuthorization(route.apiKey) : "";
  if (directApiKey) return directApiKey;

  const configured = route?.apiKeyEnv ? process.env[route.apiKeyEnv] : "";
  const normalizedConfigured = normalizeAuthorization(configured);
  if (normalizedConfigured) return normalizedConfigured;

  if (normalizedFallback) return normalizedFallback;

  const envName = route?.apiKeyEnv || "unknown";
  throw new Error(
    `Missing API key for image route ${route?.id || "unknown"} (${envName})`,
  );
};
const applyRoutePathTemplate = (template, params = {}) =>
  String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
    encodeURIComponent(params[key] ?? ""),
  );
const buildRouteUrl = (route, template, params = {}) =>
  `${trimTrailingSlash(route.baseUrl)}${applyRoutePathTemplate(template, params)}`;
const buildImageTaskToken = (routeId, upstreamTaskId) =>
  Buffer.from(
    JSON.stringify({ routeId, upstreamTaskId }),
    "utf8",
  ).toString("base64url");
const buildVideoTaskToken = (routeId, upstreamTaskId) =>
  Buffer.from(
    JSON.stringify({ routeId, upstreamTaskId }),
    "utf8",
  ).toString("base64url");
const parseImageTaskToken = (token) => {
  try {
    const parsed = JSON.parse(
      Buffer.from(String(token || ""), "base64url").toString("utf8"),
    );
    if (parsed?.routeId && parsed?.upstreamTaskId) return parsed;
  } catch (error) {
    return null;
  }
  return null;
};
const fetchVisionaryRecordById = async ({
  route,
  authorization,
  upstreamTaskId,
}) => {
  const listPath = "/openapi/v1/images/generations?page=1&limit=50";
  const response = await requestWithRetry(
    () =>
      axios.get(buildRouteUrl(route, listPath), {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        timeout: 15000,
        httpsAgent: SHARED_HTTPS_AGENT,
      }),
    { retries: 1, delayMs: 250, label: `visionary-list-query-${route.id}` },
  );

  const records = Array.isArray(response?.data?.data) ? response.data.data : [];
  return (
    records.find(
      (item) => String(item?.id || "").trim() === String(upstreamTaskId || "").trim(),
    ) || null
  );
};
const createGeminiDataItems = (images = []) =>
  images.map((value) => {
    if (typeof value === "string" && value.startsWith("data:")) {
      const [, data = ""] = value.split(",", 2);
      return { b64_json: data };
    }
    return { url: value };
  });
const normalizeRouteSizeKey = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1k", "2k", "4k"].includes(normalized) ? normalized : "";
};
const getRequestedRouteSizeKey = (requestBody = {}) => {
  const rawSize =
    requestBody.image_size ||
    requestBody.imageSize ||
    requestBody.size ||
    requestBody.generationConfig?.imageConfig?.imageSize ||
    requestBody.generationConfig?.image_config?.image_size ||
    "";
  return normalizeRouteSizeKey(rawSize);
};
const getRouteSizeOverride = (route, requestBody = {}) => {
  const sizeKey = getRequestedRouteSizeKey(requestBody);
  if (!route || !sizeKey) return null;
  return route?.sizeOverrides?.[sizeKey] || null;
};
const getRouteModelName = (route, requestBody = {}, fallbackModel = "") => {
  const sizeOverride = getRouteSizeOverride(route, requestBody);
  if (sizeOverride?.upstreamModel) {
    return sizeOverride.upstreamModel;
  }
  if (route?.useRequestModel) {
    return requestBody.model || fallbackModel;
  }
  return route?.upstreamModel || requestBody.model || fallbackModel;
};
const isGeminiNativeStylePath = (route) => {
  const generatePath = String(route?.generatePath || "");
  return generatePath.includes("{model}") || /generatecontent/i.test(generatePath);
};
const isVisionaryImageRoute = (route) => {
  const baseUrl = String(route?.baseUrl || "").trim().toLowerCase();
  const generatePath = String(route?.generatePath || "").trim().toLowerCase();
  return baseUrl.includes("visionary.beer") || generatePath.includes("/openapi/v1/images/generations");
};
const isGeminiNativeRoute = (route) =>
  route?.transport === "gemini-native" || isGeminiNativeStylePath(route);
const isOpenAiImageRoute = (route) =>
  route?.transport === "openai-image" && !isGeminiNativeStylePath(route);
const looksLikeBase64Image = (value = "") => {
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact || compact.length < 80) return false;
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact);
};
const guessDataUriMimeType = (base64 = "") => {
  const head = String(base64 || "").slice(0, 16);
  if (head.startsWith("iVBOR")) return "image/png";
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("R0lGOD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/png";
};
const ensureDataUriImage = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/\s+/g, "");
  if (!looksLikeBase64Image(compact)) return trimmed;
  const mimeType = guessDataUriMimeType(compact);
  return `data:${mimeType};base64,${compact}`;
};
const applyVisionaryImageCompat = (requestBody = {}) => {
  const normalizeArray = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => ensureDataUriImage(item)).filter((item) => String(item || "").trim().length > 0);
    }
    const normalized = ensureDataUriImage(value);
    return normalized ? [normalized] : [];
  };

  const imageArray =
    normalizeArray(requestBody.images).length > 0
      ? normalizeArray(requestBody.images)
      : normalizeArray(requestBody.image);
  if (imageArray.length > 0) {
    requestBody.images = imageArray;
    requestBody.image = imageArray;
  }

  if (!requestBody.ratio && requestBody.aspect_ratio) {
    requestBody.ratio = requestBody.aspect_ratio;
  }
  const resolvedImageSize =
    requestBody.imageSize || requestBody.image_size || requestBody.size || "";
  if (resolvedImageSize && !requestBody.imageSize) {
    requestBody.imageSize = String(resolvedImageSize).trim().toUpperCase();
  }
};
const getRoutePointCost = (route, quantity = 1, requestBody = {}) => {
  const sizeOverride = getRouteSizeOverride(route, requestBody);
  const pointCost = toPointNumber(sizeOverride?.pointCost ?? route?.pointCost ?? 0);
  return toPointNumber(Math.max(0, pointCost) * Math.max(1, Number(quantity || 1)), 0);
};
const resolveRequestedImageModel = async (requestBody = {}) => {
  const modelId = String(requestBody?.modelId || "").trim();
  if (modelId) {
    return getImageModelById(modelId, { includeInactive: true });
  }
  return getImageModelByRequestModel(requestBody?.model, { includeInactive: true });
};
const resolveRequestedVideoModel = async (requestBody = {}) => {
  const modelId = String(requestBody?.modelId || "").trim();
  if (modelId) {
    return getVideoModelById(modelId, { includeInactive: true });
  }
  return getVideoModelByRequestModel(requestBody?.model, { includeInactive: true });
};
const EMERGENCY_ADMIN_API_KEYS = [
  process.env.BILLING_ADMIN_API_KEY,
  process.env.ANNOUNCEMENT_ADMIN_API_KEY,
]
  .map((value) => String(value || "").trim())
  .filter(Boolean);
const parsePositivePage = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parsePointValue = (value, fallback = 0) => toPointNumber(value, fallback);
const parsePositivePointValue = (value, fallback = 0) => {
  const point = toPointNumber(value, fallback);
  return point > 0 ? point : 0;
};

const parseBillingFilterText = (value) => String(value || "").trim();
const buildAdminActorMeta = async (req) => {
  const actor =
    req?.authUser ||
    (await getSessionUserFromRequest(req).catch(() => null));
  return {
    actorUserId: String(actor?.userId || "").trim() || null,
    actorEmail: String(actor?.email || "").trim().toLowerCase() || null,
    actorDisplayName: String(actor?.displayName || "").trim() || null,
    actorRole: actor?.isSuperAdmin ? "super_admin" : actor?.isAdmin ? "admin" : "user",
  };
};
const logAdminCatalogChange = async (req, change) => {
  try {
    recordAdminChange({
      ...(await buildAdminActorMeta(req)),
      ...change,
    });
  } catch (error) {
    logger.warn("Failed to write admin change log", {
      message: error?.message || String(error),
      change,
    });
  }
};
const buildAdminUserListPayload = async (result) => {
  const userIds = (result?.users || []).map((user) => user.userId);
  const accountMap = await getAccountsByUserIds(userIds);
  return {
    success: true,
    total: Number(result?.total || 0),
    page: Number(result?.page || 1),
    pageSize: Number(result?.pageSize || userIds.length || 20),
    totalPages: Number(result?.totalPages || 1),
    users: (result?.users || []).map((user) => ({
      ...user,
      account: accountMap[user.userId] || null,
    })),
  };
};
const buildAdminUserDetailPayload = async (user, { ledgerPage = 1, ledgerPageSize = 20 } = {}) => {
  const account = await getAccountByUserId(user.userId);
  const ledger = account
    ? await getAccountLedger(account.accountId, {
        page: ledgerPage,
        pageSize: ledgerPageSize,
      })
    : {
        total: 0,
        page: parsePositivePage(ledgerPage, 1),
        pageSize: Math.min(100, parsePositivePage(ledgerPageSize, 20)),
        totalPages: 1,
        entries: [],
      };

  return {
    success: true,
    user,
    account,
    ledger,
    pricing: await getImageRoutePricing(),
  };
};
const mergeAdminRouteRuntimeStats = (catalog, stats = []) => {
  const routeCatalog = Array.isArray(catalog?.routes) ? catalog.routes : [];
  const runtimeById = new Map(
    (Array.isArray(stats) ? stats : []).map((item) => [String(item.routeId || "").trim(), item]),
  );
  const merged = routeCatalog.map((route) => {
    const runtime = runtimeById.get(route.id) || {};
    runtimeById.delete(route.id);
    return {
      routeId: route.id,
      label: route.label,
      description: route.description || "",
      mediaType: route.mediaType || "image",
      modelFamily: route.modelFamily || route.routeFamily || "unknown",
      line: route.line,
      mode: route.mode,
      transport: route.transport,
      baseUrl: route.baseUrl,
      pointCost: toPointNumber(route.pointCost || 0),
      isActive: route.isActive !== false,
      isDefaultRoute: route.isDefaultRoute === true,
      isDefaultNanoBananaLine: route.isDefaultNanoBananaLine === true,
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
      successRate: 0,
      successRateLast24h: 0,
      lastChargeAt: null,
      ...runtime,
    };
  });

  for (const [routeId, runtime] of runtimeById.entries()) {
    merged.push({
      routeId,
      label: routeId || "Unknown Route",
      description: "",
      mediaType: runtime?.mediaType || "unknown",
      modelFamily: "unknown",
      line: runtime?.line || "unknown",
      mode: "unknown",
      transport: "unknown",
      baseUrl: "",
      pointCost: 0,
      isActive: false,
      isDefaultRoute: false,
      isDefaultNanoBananaLine: false,
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
      successRate: 0,
      successRateLast24h: 0,
      lastChargeAt: null,
      ...runtime,
    });
  }

  return merged.sort((left, right) => {
    if (right.requestsLast24h !== left.requestsLast24h) {
      return right.requestsLast24h - left.requestsLast24h;
    }
    if (right.totalCharges !== left.totalCharges) {
      return right.totalCharges - left.totalCharges;
    }
    return String(left.label || left.routeId || "").localeCompare(
      String(right.label || right.routeId || ""),
    );
  });
};
const mergeAdminModelRuntimeStats = (catalog, stats = []) => {
  const modelCatalog = Array.isArray(catalog?.models) ? catalog.models : [];
  const byId = new Map(modelCatalog.map((model) => [String(model.id || "").trim(), model]));
  const byRequestModel = new Map(
    modelCatalog
      .filter((model) => model.requestModel)
      .map((model) => [String(model.requestModel || "").trim(), model]),
  );
  const consumedIds = new Set();
  const mergedFromStats = (Array.isArray(stats) ? stats : []).map((runtime) => {
    const runtimeModelId = String(runtime?.modelId || "").trim();
    const runtimeRequestModel = String(runtime?.requestModel || "").trim();
    const model =
      (runtimeModelId && byId.get(runtimeModelId)) ||
      (runtimeRequestModel && byRequestModel.get(runtimeRequestModel)) ||
      null;
    if (model?.id) consumedIds.add(model.id);
    return {
      modelKey: runtime?.modelKey || model?.id || runtimeRequestModel || "unknown",
      modelId: model?.id || runtimeModelId || null,
      label: model?.label || runtimeRequestModel || runtimeModelId || "Unknown Model",
      description: model?.description || "",
      mediaType: model?.mediaType || runtime?.mediaType || "unknown",
      modelFamily: model?.modelFamily || "unknown",
      routeFamily: model?.routeFamily || "unknown",
      requestModel: model?.requestModel || runtimeRequestModel || "",
      selectorCost: toPointNumber(model?.selectorCost || 0),
      panelLayout: model?.panelLayout || "default",
      sizeBehavior: model?.sizeBehavior || "passthrough",
      isActive: model?.isActive !== false,
      isDefaultModel: model?.isDefaultModel === true,
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
      successRate: 0,
      successRateLast24h: 0,
      lastChargeAt: null,
      ...runtime,
    };
  });

  const idleModels = modelCatalog
    .filter((model) => !consumedIds.has(model.id))
    .map((model) => ({
      modelKey: model.id,
      modelId: model.id,
      label: model.label,
      description: model.description || "",
      mediaType: model.mediaType || "image",
      modelFamily: model.modelFamily,
      routeFamily: model.routeFamily,
      requestModel: model.requestModel || "",
      selectorCost: toPointNumber(model.selectorCost || 0),
      panelLayout: model.panelLayout || "default",
      sizeBehavior: model.sizeBehavior || "passthrough",
      isActive: model.isActive !== false,
      isDefaultModel: model.isDefaultModel === true,
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
      successRate: 0,
      successRateLast24h: 0,
      lastChargeAt: null,
    }));

  return [...mergedFromStats, ...idleModels].sort((left, right) => {
    if (right.requestsLast24h !== left.requestsLast24h) {
      return right.requestsLast24h - left.requestsLast24h;
    }
    if (right.totalCharges !== left.totalCharges) {
      return right.totalCharges - left.totalCharges;
    }
    return String(left.label || left.modelKey || "").localeCompare(
      String(right.label || right.modelKey || ""),
    );
  });
};
const buildAdminDashboardPayload = async () => {
  const [
    authOverview,
    billingOverview,
    imageRouteCatalog,
    imageModelCatalog,
    videoRouteCatalog,
    videoModelCatalog,
  ] = await Promise.all([
    getAdminAuthOverview({
      onlineWindowMinutes: 5,
      recentWindowDays: 7,
    }),
    getAdminBillingOverview({
      recentWindowHours: 24,
    }),
    getImageRouteCatalog({ includeInactive: true }),
    getImageModelCatalog({ includeInactive: true }),
    getVideoRouteCatalog({ includeInactive: true }),
    getVideoModelCatalog({ includeInactive: true }),
  ]);

  const combinedRouteCatalog = {
    defaultRouteId: imageRouteCatalog?.defaultRouteId || "",
    defaultNanoBananaLine: imageRouteCatalog?.defaultNanoBananaLine || "",
    routes: [
      ...((imageRouteCatalog?.routes || []).map((route) => ({
        ...route,
        mediaType: "image",
      }))),
      ...((videoRouteCatalog?.routes || []).map((route) => ({
        ...route,
        modelFamily: route.routeFamily,
        mediaType: "video",
        isDefaultNanoBananaLine: false,
      }))),
    ],
  };
  const combinedModelCatalog = {
    defaultModelId: imageModelCatalog?.defaultModelId || "",
    models: [
      ...((imageModelCatalog?.models || []).map((model) => ({
        ...model,
        mediaType: "image",
      }))),
      ...((videoModelCatalog?.models || []).map((model) => ({
        ...model,
        mediaType: "video",
        panelLayout: "video",
        sizeBehavior: "video",
      }))),
    ],
  };

  const routeStats = mergeAdminRouteRuntimeStats(
    combinedRouteCatalog,
    billingOverview?.routeStats || [],
  );
  const modelStats = mergeAdminModelRuntimeStats(
    combinedModelCatalog,
    billingOverview?.modelStats || [],
  );
  const imageRouteStats = routeStats.filter((item) => item.mediaType === "image");
  const videoRouteStats = routeStats.filter((item) => item.mediaType === "video");
  const imageModelStats = modelStats.filter((item) => item.mediaType === "image");
  const videoModelStats = modelStats.filter((item) => item.mediaType === "video");

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    windows: {
      onlineWindowMinutes: Number(authOverview?.onlineWindowMinutes || 5),
      recentUserWindowDays: Number(authOverview?.recentWindowDays || 7),
      recentRuntimeWindowHours: Number(billingOverview?.recentWindowHours || 24),
    },
    auth: authOverview,
    billing: billingOverview?.overall || null,
    routeCatalog: {
      defaultRouteId: imageRouteCatalog?.defaultRouteId || "",
      defaultNanoBananaLine: imageRouteCatalog?.defaultNanoBananaLine || "",
      totalRoutes: combinedRouteCatalog.routes.length,
      activeRoutes: combinedRouteCatalog.routes.filter((route) => route.isActive !== false).length,
      imageTotalRoutes: Array.isArray(imageRouteCatalog?.routes) ? imageRouteCatalog.routes.length : 0,
      imageActiveRoutes: Array.isArray(imageRouteCatalog?.routes)
        ? imageRouteCatalog.routes.filter((route) => route.isActive !== false).length
        : 0,
      videoTotalRoutes: Array.isArray(videoRouteCatalog?.routes) ? videoRouteCatalog.routes.length : 0,
      videoActiveRoutes: Array.isArray(videoRouteCatalog?.routes)
        ? videoRouteCatalog.routes.filter((route) => route.isActive !== false).length
        : 0,
    },
    modelCatalog: {
      defaultModelId: imageModelCatalog?.defaultModelId || "",
      totalModels: combinedModelCatalog.models.length,
      activeModels: combinedModelCatalog.models.filter((model) => model.isActive !== false).length,
      imageTotalModels: Array.isArray(imageModelCatalog?.models) ? imageModelCatalog.models.length : 0,
      imageActiveModels: Array.isArray(imageModelCatalog?.models)
        ? imageModelCatalog.models.filter((model) => model.isActive !== false).length
        : 0,
      videoTotalModels: Array.isArray(videoModelCatalog?.models) ? videoModelCatalog.models.length : 0,
      videoActiveModels: Array.isArray(videoModelCatalog?.models)
        ? videoModelCatalog.models.filter((model) => model.isActive !== false).length
        : 0,
    },
    routeStats,
    modelStats,
    imageRouteStats,
    videoRouteStats,
    imageModelStats,
    videoModelStats,
  };
};
const sendBillingError = (res, error) => {
  if (error instanceof BillingError) {
    const isAuthError =
      error.code === "ACCOUNT_AUTH_REQUIRED" || error.code === "AUTH_LOGIN_REQUIRED";
    return res.status(isAuthError ? 401 : 400).json({
      error: error.message,
      code: error.code,
      currentPoints: error.currentPoints,
      requiredPoints: error.requiredPoints,
    });
  }
  return null;
};
const parseVideoTaskToken = (token) => {
  try {
    const parsed = JSON.parse(
      Buffer.from(String(token || ""), "base64url").toString("utf8"),
    );
    if (parsed?.routeId && parsed?.upstreamTaskId) return parsed;
  } catch (error) {
    return null;
  }
  return null;
};
const normalizeGenerationUiMode = (value = "canvas") => {
  const normalized = String(value || "canvas").trim().toLowerCase();
  return normalized === "classic" ? "classic" : "canvas";
};
const normalizeGenerationMediaType = (value = "IMAGE") => {
  const normalized = String(value || "IMAGE").trim().toUpperCase();
  return normalized === "VIDEO" ? "VIDEO" : "IMAGE";
};
const dedupeResultUrls = (urls = []) =>
  Array.from(
    new Set(
      (Array.isArray(urls) ? urls : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
const collectResultUrls = (value, bucket = []) => {
  if (!value) return bucket;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:")
    ) {
      bucket.push(trimmed);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectResultUrls(item, bucket));
    return bucket;
  }

  if (typeof value !== "object") return bucket;

  [
    "url",
    "output",
    "image_url",
    "imageUrl",
    "video_url",
    "videoUrl",
    "src",
  ].forEach((key) => {
    if (value[key]) {
      collectResultUrls(value[key], bucket);
    }
  });

  Object.keys(value).forEach((key) => {
    const nestedValue = value[key];
    if (nestedValue && typeof nestedValue === "object") {
      collectResultUrls(nestedValue, bucket);
    }
  });

  return bucket;
};
const extractResultUrlsFromPayload = (payload) =>
  dedupeResultUrls(collectResultUrls(payload, []));
const extractResultStatus = (payload) =>
  String(
    payload?.status || payload?.state || payload?.data?.status || "",
  )
    .trim()
    .toUpperCase();
const buildGenerationRecordPayload = async ({
  req,
  billingAccount = null,
  mediaType = "IMAGE",
  actionName = "",
  prompt = "",
  modelId = null,
  modelName = "",
  route = null,
  quantity = 1,
  aspectRatio = null,
  outputSize = null,
  uiMode = "canvas",
  taskId = null,
  status = "PENDING",
  resultUrls = [],
  previewUrl = null,
  errorMessage = null,
  meta = null,
}) => {
  const authUser = req?.authUser;
  const userId = String(authUser?.userId || "").trim();
  if (!userId) return null;

  const resolvedAccount =
    billingAccount || (await getAccountByUserId(userId).catch(() => null));

  return createGenerationRecord({
    userId,
    accountId: resolvedAccount?.accountId || null,
    ownerEmail:
      String(authUser?.email || resolvedAccount?.ownerEmail || "")
        .trim()
        .toLowerCase() || null,
    uiMode: normalizeGenerationUiMode(uiMode),
    mediaType: normalizeGenerationMediaType(mediaType),
    actionName,
    prompt,
    modelId: modelId || null,
    modelName: modelName || null,
    routeId: route?.id || null,
    routeLabel: route?.label || null,
    taskId: taskId || null,
    status,
    quantity,
    aspectRatio: aspectRatio || null,
    outputSize: outputSize || null,
    previewUrl: previewUrl || null,
    resultUrls,
    errorMessage: errorMessage || null,
    meta: meta || null,
  });
};
const completeGenerationRecordSuccessSafe = async ({
  recordId = null,
  taskId = null,
  resultUrls = [],
  previewUrl = null,
  outputSize = null,
  aspectRatio = null,
  meta = null,
}) => {
  const normalizedUrls = dedupeResultUrls(resultUrls);
  const updates = {
    status: "SUCCESS",
    resultUrls: normalizedUrls,
    previewUrl: previewUrl || normalizedUrls[0] || null,
    outputSize: outputSize || null,
    aspectRatio: aspectRatio || null,
    meta: meta || null,
  };

  if (recordId) {
    await completeGenerationRecord(recordId, updates).catch(() => null);
  }
  if (taskId) {
    await completeGenerationRecordByTaskId(taskId, updates).catch(() => null);
  }
};
const completeGenerationRecordFailureSafe = async ({
  recordId = null,
  taskId = null,
  errorMessage = "",
  outputSize = null,
  aspectRatio = null,
  meta = null,
}) => {
  const updates = {
    status: "FAILED",
    errorMessage: errorMessage || null,
    outputSize: outputSize || null,
    aspectRatio: aspectRatio || null,
    meta: meta || null,
  };

  if (recordId) {
    await completeGenerationRecord(recordId, updates).catch(() => null);
  }
  if (taskId) {
    await completeGenerationRecordByTaskId(taskId, updates).catch(() => null);
  }
};
const sendAuthError = (res, error) => {
  if (error instanceof AuthError) {
    const statusByCode = {
      AUTH_LOGIN_REQUIRED: 401,
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_INVALID_CURRENT_PASSWORD: 400,
      AUTH_PASSWORD_NOT_SET: 400,
      AUTH_USER_DISABLED: 403,
      ADMIN_REQUIRED: 403,
      SUPER_ADMIN_REQUIRED: 403,
      EMAIL_DELIVERY_NOT_CONFIGURED: 500,
      EMAIL_ALREADY_EXISTS: 409,
      EMAIL_CODE_COOLDOWN: 429,
      INVALID_EMAIL: 400,
      INVALID_PASSWORD: 400,
      INVALID_EMAIL_CODE: 400,
      INVALID_USER_ROLE: 400,
      INVALID_USER_STATUS: 400,
      LAST_SUPER_ADMIN_PROTECTED: 400,
      EMAIL_CODE_REQUIRED: 400,
      EMAIL_CODE_PURPOSE_MISMATCH: 400,
      EMAIL_CODE_EXPIRED: 400,
      EMAIL_CODE_INVALID: 400,
      EMAIL_CODE_LOCKED: 429,
      PASSWORD_RESET_USER_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
    };

    return res.status(statusByCode[error.code] || 400).json({
      error: error.message,
      code: error.code,
      waitSeconds: error.waitSeconds,
    });
  }
  return null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const USER_FACING_GENERATION_ERROR_MESSAGE =
  "请检查提示词或参考图，可能触发了安全限制，请更换后重试";
const EXPOSE_ERROR_DETAILS =
  String(process.env.EXPOSE_ERROR_DETAILS || "").trim().toLowerCase() === "true" ||
  String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
const NON_IDEMPOTENT_UPSTREAM_ERROR_MESSAGE =
  "Upstream connection closed after the generation request was sent. Automatic retry is disabled to avoid duplicate billing. Please check the upstream dashboard before retrying manually.";
const isRetryableNetworkError = (error) => {
  if (!error) return false;
  if (error.response) return false;
  const code = String(
    error.code || error.cause?.code || error.cause?.cause?.code || "",
  ).toUpperCase();
  const message = String(error.message || "").toLowerCase();
  const causeMessage = String(
    error.cause?.message || error.cause?.cause?.message || "",
  ).toLowerCase();
  return (
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "EPROTO" ||
    code === "UND_ERR_SOCKET" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "EAI_AGAIN" ||
    message.includes("client network socket disconnected before secure tls connection was established") ||
    message.includes("socket hang up") ||
    message.includes("bad record mac") ||
    message.includes("decryption failed") ||
    message.includes("ssl routines") ||
    message.includes("fetch failed") ||
    causeMessage.includes("client network socket disconnected before secure tls connection was established") ||
    causeMessage.includes("socket hang up") ||
    causeMessage.includes("bad record mac") ||
    causeMessage.includes("decryption failed") ||
    causeMessage.includes("ssl routines") ||
    causeMessage.includes("other side closed") ||
    causeMessage.includes("connect timeout")
  );
};
const toSafeHttpStatus = (status, fallbackStatus = 500) => {
  const numeric = Number.parseInt(String(status || fallbackStatus), 10);
  if (!Number.isFinite(numeric)) return fallbackStatus;
  if (numeric < 400 || numeric > 599) return fallbackStatus;
  return numeric;
};
const buildErrorDetails = (error) => {
  if (!error) return "";
  const parts = [];
  const message = String(error.message || "").trim();
  const code = String(error.code || error.response?.data?.code || "").trim();
  const upstream =
    error.response?.data?.error ||
    error.response?.data?.message ||
    error.response?.statusText ||
    "";

  if (code) parts.push(`code=${code}`);
  if (message) parts.push(`message=${message}`);
  if (upstream) parts.push(`upstream=${String(upstream)}`);

  return parts.join("; ");
};

const sendUserFacingGenerationError = (res, status = 500, error = null) => {
  const payload = {
    error: USER_FACING_GENERATION_ERROR_MESSAGE,
  };

  if (EXPOSE_ERROR_DETAILS) {
    const details = buildErrorDetails(error);
    if (details) {
      payload.details = details;
    }
  }

  return res.status(toSafeHttpStatus(status, 500)).json(payload);
};
const respondWithUserFacingGenerationError = (res, error, fallbackStatus = 500) => {
  if (error instanceof BillingError) {
    const isAuthError =
      error.code === "ACCOUNT_AUTH_REQUIRED" || error.code === "AUTH_LOGIN_REQUIRED";
    return sendUserFacingGenerationError(res, isAuthError ? 401 : 400, error);
  }

  if (error instanceof AuthError) {
    return sendUserFacingGenerationError(
      res,
      error.code === "AUTH_LOGIN_REQUIRED" ? 401 : 400,
      error,
    );
  }

  if (error?.response?.status) {
    return sendUserFacingGenerationError(res, error.response.status, error);
  }

  if (error?.code === "ECONNABORTED") {
    return sendUserFacingGenerationError(res, 504, error);
  }

  if (isRetryableNetworkError(error)) {
    return sendUserFacingGenerationError(res, 502, error);
  }

  return sendUserFacingGenerationError(res, fallbackStatus, error);
};
const requestWithRetry = async (
  fn,
  { retries = 1, delayMs = 500, label = "request" } = {},
) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt >= retries) {
        throw error;
      }
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(
        `[Retry] ${label} attempt ${attempt + 1} failed: ${error.message}. Retrying in ${wait}ms`,
      );
      await sleep(wait);
      attempt += 1;
    }
  }
};

const createTransientHttpsAgent = () =>
  new https.Agent({
    keepAlive: false,
    maxSockets: 1,
    family: 4,
    maxCachedSessions: 0,
  });

const extractAuthorizationToken = (authorization = "") =>
  String(authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const buildUpstreamJsonRequestConfig = (
  authorization,
  {
    httpsAgent = SHARED_HTTPS_AGENT,
    closeConnection = false,
    includeGoogleApiKey = false,
  } = {},
) => ({
  headers: {
    Authorization: authorization,
    ...(includeGoogleApiKey
      ? { "x-goog-api-key": extractAuthorizationToken(authorization) }
      : {}),
    "Content-Type": "application/json",
    "Accept-Encoding": "identity",
    ...(closeConnection ? { Connection: "close" } : {}),
  },
  timeout: 600000,
  httpsAgent,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

const createHttpResponseError = (status, data) => {
  const message =
    data?.error?.message ||
    data?.message ||
    (typeof data === "string" ? data : `HTTP Error ${status}`);
  const error = new Error(message);
  error.response = { status, data };
  return error;
};

const postJsonWithFetch = async ({
  endpoint,
  body,
  authorization,
  label,
  closeConnection = false,
  includeGoogleApiKey = false,
}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        ...(includeGoogleApiKey
          ? { "x-goog-api-key": extractAuthorizationToken(authorization) }
          : {}),
        "Content-Type": "application/json",
        ...(closeConnection ? { Connection: "close" } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_error) {
      data = rawText;
    }

    if (!response.ok) {
      throw createHttpResponseError(response.status, data);
    }

    return {
      status: response.status,
      data,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after 600000ms (${label})`);
      timeoutError.code = "ECONNABORTED";
      throw timeoutError;
    }
    if (!error.response) {
      const causeCode = String(
        error?.cause?.code || error?.cause?.cause?.code || "",
      ).trim();
      const causeMessage = String(
        error?.cause?.message || error?.cause?.cause?.message || "",
      ).trim();
      if (causeCode && !error.code) {
        error.code = causeCode;
      }
      if (causeMessage && String(error.message || "").trim().toLowerCase() === "fetch failed") {
        error.message = `fetch failed: ${causeMessage}`;
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const postJsonWithTlsFallback = async ({
  endpoint,
  body,
  authorization,
  label,
  includeGoogleApiKey = false,
}) => {
  return axios.post(
    endpoint,
    body,
    buildUpstreamJsonRequestConfig(authorization, {
      httpsAgent: createTransientHttpsAgent(),
      closeConnection: true,
      includeGoogleApiKey,
    }),
  );
};

const executeGeminiNativeGenerate = async ({
  route,
  requestBody,
  fallbackAuthorization,
  logTag = "Gemini Generate",
}) => {
  const { aspect_ratio, image_size, thinking_level, output_format } = requestBody;
  const strictNativeConfig = requestBody.strict_native_config === true;
  const model = getRouteModelName(route, requestBody, "gemini-3-pro-image-preview");

  let prompt = requestBody.prompt;
  if (!prompt && requestBody.contents?.[0]?.parts) {
    const textPart = requestBody.contents[0].parts.find((part) => !!part.text);
    if (textPart) prompt = textPart.text;
  }

  if (!prompt || !String(prompt).trim()) {
    throw new Error("Prompt is required");
  }

  const processImagePart = (img, { camelCase = false } = {}) => {
    let base64Data = img;
    let mimeType = "image/jpeg";

    if (typeof img === "string" && img.startsWith("data:")) {
      const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    if (camelCase) {
      return {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };
    }

    return {
      inline_data: {
        mime_type: mimeType,
        data: base64Data,
      },
    };
  };

  const camelParts = [{ text: prompt }];
  const snakeParts = [{ text: prompt }];
  const seenImageParts = new Set();
  const appendImagePart = (img) => {
    if (Array.isArray(img)) {
      img.forEach((item) => appendImagePart(item));
      return;
    }
    if (typeof img !== "string") return;
    const normalized = String(img || "").trim();
    if (!normalized) return;
    if (seenImageParts.has(normalized)) return;
    seenImageParts.add(normalized);
    camelParts.push(processImagePart(normalized, { camelCase: true }));
    snakeParts.push(processImagePart(normalized));
  };

  if (Array.isArray(requestBody.images)) {
    requestBody.images.forEach((img) => {
      appendImagePart(img);
    });
  }

  if (requestBody.image !== undefined && requestBody.image !== null) {
    appendImagePart(requestBody.image);
  }

  if (requestBody.contents?.[0]?.parts) {
    requestBody.contents[0].parts.forEach((part) => {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        appendImagePart(
          `data:${inlineData.mimeType || inlineData.mime_type || "image/jpeg"};base64,${inlineData.data}`,
        );
      }
    });
  }

  const finalImageSize = (
    requestBody.image_size ||
    requestBody.imageSize ||
    requestBody.generationConfig?.imageConfig?.imageSize ||
    requestBody.generationConfig?.image_config?.image_size ||
    "1K"
  ).toUpperCase();
  const finalAspectRatio =
    requestBody.aspect_ratio ||
    requestBody.aspectRatio ||
    requestBody.generationConfig?.imageConfig?.aspectRatio ||
    requestBody.generationConfig?.image_config?.aspect_ratio ||
    "1:1";
  const candidateCount =
    requestBody.n ||
    requestBody.candidateCount ||
    requestBody.generationConfig?.candidateCount ||
    requestBody.generationConfig?.candidate_count ||
    1;
  const normalizedAspectRatio = finalAspectRatio === "Smart" ? "1:1" : finalAspectRatio;
  const endpoint = buildRouteUrl(route, route.generatePath, { model });
  const authorization = getRouteAuthorization(route, fallbackAuthorization);
  const buildGeminiBodies = (resolvedImageSize) => {
    const camelBody = {
      contents: [{ parts: camelParts }],
      generationConfig: {
        responseModalities:
          output_format === "IMAGE_ONLY" ? ["IMAGE"] : ["IMAGE", "TEXT"],
        candidateCount,
        imageConfig: {
          aspectRatio: normalizedAspectRatio,
          imageSize: resolvedImageSize,
        },
      },
    };

    if (thinking_level) {
      camelBody.generationConfig.thinkingConfig = {
        thinkingLevel: String(thinking_level).toUpperCase(),
      };
    }

    const snakeBody = {
      contents: [{ parts: snakeParts }],
      generationConfig: {
        response_modalities:
          output_format === "IMAGE_ONLY" ? ["IMAGE"] : ["IMAGE", "TEXT"],
        candidate_count: candidateCount,
        image_config: {
          aspect_ratio: normalizedAspectRatio,
          image_size: resolvedImageSize,
        },
      },
    };

    const debugBody = JSON.parse(JSON.stringify(camelBody));
    if (debugBody.contents?.[0]?.parts) {
      debugBody.contents[0].parts = debugBody.contents[0].parts.map((part) => {
        if (part.inlineData) {
          return {
            inlineData: {
              mimeType: part.inlineData.mimeType,
              data: "[BASE64...]",
            },
          };
        }
        return part;
      });
    }

    return {
      camelBody,
      snakeBody,
      noConfigBody: { contents: camelBody.contents },
      debugBody,
    };
  };

  const executeGeminiPayloadSequence = async (resolvedImageSize) => {
    const { camelBody, snakeBody, noConfigBody, debugBody } =
      buildGeminiBodies(resolvedImageSize);
    console.log(`[${logTag}] Model: ${model}, Endpoint: ${endpoint}`);
    console.log(
      `[${logTag}] Primary Gemini Payload (camelCase):`,
      JSON.stringify(debugBody, null, 2),
    );

    try {
      return await postJsonWithTlsFallback({
        endpoint,
        body: camelBody,
        authorization,
        label: `${logTag}-${route.id}-camel-${resolvedImageSize}`,
        includeGoogleApiKey: true,
      });
    } catch (firstErr) {
      if (firstErr.response?.status === 400) {
        console.log(
          `[${logTag}] camelCase request failed with 400, trying snake_case Gemini payload...`,
        );

        try {
          return await postJsonWithTlsFallback({
            endpoint,
            body: snakeBody,
            authorization,
            label: `${logTag}-${route.id}-snake-${resolvedImageSize}`,
            includeGoogleApiKey: true,
          });
        } catch (secondErr) {
          if (secondErr.response?.status === 400) {
            if (strictNativeConfig) {
              throw secondErr;
            }

            console.log(
              `[${logTag}] snake_case also failed, trying without generationConfig...`,
            );
            return postJsonWithTlsFallback({
              endpoint,
              body: noConfigBody,
              authorization,
              label: `${logTag}-${route.id}-no-config-${resolvedImageSize}`,
              includeGoogleApiKey: true,
            });
          }
          throw secondErr;
        }
      }
      throw firstErr;
    }
  };

  const response = await executeGeminiPayloadSequence(finalImageSize);

  const candidates = response.data?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini native response is empty");
  }

  const resultImages = [];
  let resultText = "";

  for (const candidate of candidates) {
    if (!candidate.content?.parts) continue;
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || "image/png";
        resultImages.push(`data:${mimeType};base64,${part.inlineData.data}`);
      } else if (part.inline_data?.data) {
        const mimeType = part.inline_data.mime_type || "image/png";
        resultImages.push(`data:${mimeType};base64,${part.inline_data.data}`);
      } else if (part.text) {
        resultText += part.text;
      }
    }
  }

  if (resultImages.length === 0) {
    const error = new Error("Gemini native response did not include images");
    error.resultText = resultText;
    throw error;
  }

  return {
    success: true,
    images: resultImages,
    text: resultText || undefined,
    data: createGeminiDataItems(resultImages),
  };
};

// Security Middleware
// Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Totally disable CSP to allow blob: and data: images
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
  })
);

// ==================== Rate Limiting Configuration ====================
// For PUBLIC SERVICE: Per-user limits to ensure fair resource distribution

// Import the ipKeyGenerator helper for proper IPv6 support
const { ipKeyGenerator } = rateLimit;

// Helper: Extract user identifier (API Key or IP with proper IPv6 handling)
const getUserKey = (req) => {
  const authSession = String(req.headers["x-auth-session"] || "").trim();
  const apiKey = req.headers['authorization'];
  if (authSession.length > 20) return authSession;
  // Use API key if available, otherwise fall back to IP (with IPv6 support)
  return apiKey && apiKey.length > 10 ? apiKey : ipKeyGenerator(req);
};

// Global fallback limiter (per user)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1500,                  // 1500 requests per user per 15 minutes (increased for public service)
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests. Please try again later.",
});

// Polling endpoints - per user, high frequency
const pollingLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 50,                    // 50 requests per user per minute (allows ~2-3 concurrent tasks per user)
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Polling requests are too frequent. Please try again later.",
});

// Generation endpoints - per user, moderate limits
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 generation requests per user per minute
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Generation requests are too frequent. Please try again later.",
});

// Announcement endpoint - per IP, very lenient (read-only)
const announcementLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                   // 100 requests per IP per minute
  keyGenerator: ipKeyGenerator, // Use official helper for IPv6 support
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Announcement service temporarily unavailable"
});

// Apply global limiter only to API routes, not static files
app.use("/api", globalLimiter);

app.use(cors());
app.use(express.json({ limit: "50mb" })); // Support large Base64 request payloads.
app.use(async (req, _res, next) => {
  try {
    req.authUser = await getSessionUserFromRequest(req);
  } catch (error) {
    console.error("[Auth] Session middleware error:", error.message);
    req.authUser = null;
  }
  next();
});

app.post("/api/auth/request-email-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const result = await requestEmailCode(email, { purpose: "login" });
    res.json({
      success: true,
      email: result.email,
      expiresInSeconds: result.expiresInSeconds,
      previewCode: result.previewCode,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to send verification code" });
  }
});

app.get("/api/auth/registration-status", async (_req, res) => {
  try {
    const status = await getRegistrationStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load registration status" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const displayName = String(req.body?.displayName || "").trim();
    const registerResult = await registerWithPassword({
      email,
      password,
      displayName,
    });
    await ensureAccountForUser(registerResult.user);
    res.json({
      success: true,
      sessionToken: registerResult.sessionToken,
      user: registerResult.user,
      createdSuperAdmin: registerResult.createdSuperAdmin === true,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to register account" });
  }
});

app.post("/api/auth/login/password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const loginResult = await loginWithPassword({ email, password });
    await ensureAccountForUser(loginResult.user);
    res.json({
      success: true,
      sessionToken: loginResult.sessionToken,
      user: loginResult.user,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to sign in" });
  }
});

app.post("/api/auth/login/email", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const code = String(req.body?.code || "").trim();
    const loginResult = await verifyEmailCode(email, code, { purpose: "login" });
    await ensureAccountForUser(loginResult.user);
    res.json({
      success: true,
      sessionToken: loginResult.sessionToken,
      user: loginResult.user,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to sign in" });
  }
});

app.post("/api/auth/password/forgot", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const result = await requestEmailCode(email, { purpose: "password_reset" });
    res.json({
      success: true,
      email: result.email,
      expiresInSeconds: result.expiresInSeconds,
      previewCode: result.previewCode,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to send password reset code" });
  }
});

app.post("/api/auth/password/reset", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const code = String(req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    const resetResult = await resetPasswordWithEmailCode(email, code, password);
    await ensureAccountForUser(resetResult.user);
    res.json({
      success: true,
      sessionToken: resetResult.sessionToken,
      user: resetResult.user,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to reset password" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    res.json({
      success: true,
      authenticated: true,
      user,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to fetch session" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    await logoutSession(req);
    res.json({ success: true });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to sign out" });
  }
});

app.post("/api/auth/password", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const password = String(req.body?.password || "");
    const nextUser = await setUserPassword(user, password);
    req.authUser = nextUser;
    res.json({
      success: true,
      user: nextUser,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to set password" });
  }
});

app.post("/api/auth/password/change", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const nextUser = await changeUserPassword(user, currentPassword, newPassword);
    req.authUser = nextUser;
    res.json({
      success: true,
      user: nextUser,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to change password" });
  }
});

app.post("/api/account/ensure", async (req, res) => {
  try {
    const identity = await ensureBillingIdentity(req);
    const user = await requireAuthUser(req);
    res.json({
      success: true,
      account: identity.account,
      user,
      pricing: await getImageRoutePricing(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to initialize billing account" });
  }
});

app.get("/api/account/me", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const account = await requireBillingAccount(req);
    const accountSummary = await getAccountSummary(account.accountId);
    res.json({
      success: true,
      user,
      account: accountSummary,
      ledger: await getAccountLedger(accountSummary.accountId, {
        page: parsePositivePage(req.query?.ledgerPage, 1),
        pageSize: parsePositivePage(req.query?.ledgerPageSize, 20),
      }),
      pricing: await getImageRoutePricing(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to fetch billing account" });
  }
});

app.get("/api/account/billing-center", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const account = await requireBillingAccount(req);
    const accountSummary = await getAccountSummary(account.accountId);
    const report = await getAccountLedgerReport(accountSummary.accountId, {
      page: parsePositivePage(req.query?.page, 1),
      pageSize: parsePositivePage(req.query?.pageSize, 20),
      startDate: parseBillingFilterText(req.query?.startDate),
      endDate: parseBillingFilterText(req.query?.endDate),
      type: parseBillingFilterText(req.query?.type),
      modelId: parseBillingFilterText(req.query?.modelId),
      routeId: parseBillingFilterText(req.query?.routeId),
    });

    res.json({
      success: true,
      user,
      account: accountSummary,
      summary: report.summary,
      ledger: report.ledger,
      filters: report.filters,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to fetch billing center data" });
  }
});

app.get("/api/generation-records", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const mediaType = String(req.query?.mediaType || "all").trim().toUpperCase();
    const status = String(req.query?.status || "all").trim().toUpperCase();
    const page = parsePositivePage(req.query?.page, 1);
    const pageSize = Math.min(100, parsePositivePage(req.query?.pageSize, 50));

    const result = await listGenerationRecordsForUser(user.userId, {
      mediaType,
      status,
      page,
      pageSize,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to fetch generation records" });
  }
});

app.delete("/api/generation-records", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const mediaType = String(req.query?.mediaType || "all").trim().toUpperCase();
    const result = await clearGenerationRecordsForUser(user.userId, {
      mediaType,
    });
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to clear generation records" });
  }
});

app.post("/api/account/recharge", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);

    const accountId = String(req.body?.accountId || "").trim();
    const points = parsePositivePointValue(req.body?.points, 0);
    const note = String(req.body?.note || "").trim();

    if (!accountId) {
      return res.status(400).json({ error: "accountId is required" });
    }
    if (!Number.isFinite(points) || points <= 0) {
      return res.status(400).json({ error: "points must be greater than zero" });
    }

    const account = await rechargeAccount(accountId, points, note);
    res.json({
      success: true,
      account,
      pricing: await getImageRoutePricing(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to recharge account" });
  }
});

app.post("/api/account/adjust", async (req, res) => {
  try {
    const actor = await requireSuperAdminAccess(req);
    const accountId = String(req.body?.accountId || "").trim();
    const delta = parsePointValue(req.body?.delta, 0);
    const note = String(req.body?.note || "").trim();

    if (!accountId) {
      return res.status(400).json({ error: "accountId is required" });
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: "delta must be a non-zero number" });
    }

    const account = await adjustAccountPoints(accountId, delta, {
      note,
      reason: "super_admin_adjust",
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
    });

    await logAdminCatalogChange(req, {
      action: "billing.adjust_points",
      entityType: "billing_account",
      entityId: account.accountId,
      summary: `${delta > 0 ? "Added" : "Removed"} ${toPointNumber(Math.abs(delta), 0)} points`,
      detail: {
        accountId: account.accountId,
        delta,
        note,
      },
    });

    res.json({
      success: true,
      account,
      pricing: await getImageRoutePricing(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to adjust account points" });
  }
});

app.post("/api/account/redeem", async (req, res) => {
  try {
    const user = await requireAuthUser(req);
    const account = await requireBillingAccount(req);
    const code = String(req.body?.code || "").trim();

    if (!code) {
      return res.status(400).json({ error: "code is required" });
    }

    const result = await redeemCode(account.accountId, code, {
      userId: user.userId,
      email: user.email,
    });

    res.json({
      success: true,
      user,
      account: result.account,
      redeemedCode: result.redeemCode,
      ledger: await getAccountLedger(result.account.accountId, {
        page: parsePositivePage(req.body?.ledgerPage, 1),
        pageSize: parsePositivePage(req.body?.ledgerPageSize, 20),
      }),
      pricing: await getImageRoutePricing(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to redeem code" });
  }
});

app.get("/api/admin/redeem-codes", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    res.json({
      success: true,
      ...(await listRedeemCodes({
        page: parsePositivePage(req.query?.page, 1),
        pageSize: parsePositivePage(req.query?.pageSize, 20),
        status: String(req.query?.status || "all").trim(),
      })),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load redeem codes" });
  }
});

app.post("/api/admin/redeem-codes", async (req, res) => {
  try {
    const actor = await requireSuperAdminAccess(req);
    const points = parsePositivePointValue(req.body?.points, 0);
    const quantity = Number.parseInt(String(req.body?.quantity || 1), 10);
    const note = String(req.body?.note || "").trim();

    if (!Number.isFinite(points) || points <= 0) {
      return res.status(400).json({ error: "points must be greater than zero" });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "quantity must be greater than zero" });
    }

    const codes = await createRedeemCodes({
      points,
      quantity,
      note,
      createdByUserId: actor?.userId,
      createdByEmail: actor?.email,
    });

    await logAdminCatalogChange(req, {
      action: "billing.create_redeem_codes",
      entityType: "redeem_code_batch",
      entityId: codes[0]?.normalizedCode || "batch",
      summary: `Created ${codes.length} redeem code(s) worth ${points} points`,
      detail: {
        quantity: codes.length,
        points,
        note,
        codes: codes.map((item) => item.code),
      },
    });

    res.json({
      success: true,
      codes,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to create redeem codes" });
  }
});

app.get("/api/admin/users", async (req, res) => {
  try {
    await requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS);
    const result = await listAdminUsers({
      search: String(req.query?.search || "").trim(),
      page: parsePositivePage(req.query?.page, 1),
      pageSize: parsePositivePage(req.query?.pageSize, 20),
    });
    res.json(await buildAdminUserListPayload(result));
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load users" });
  }
});

app.get("/api/admin/users/:userId", async (req, res) => {
  try {
    await requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS);
    const userId = String(req.params.userId || "").trim();
    const user = await getAdminUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User does not exist" });
    }
    res.json(
      await buildAdminUserDetailPayload(user, {
        ledgerPage: parsePositivePage(req.query?.ledgerPage, 1),
        ledgerPageSize: parsePositivePage(req.query?.ledgerPageSize, 20),
      }),
    );
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load user detail" });
  }
});

app.patch("/api/admin/users/:userId", async (req, res) => {
  try {
    const actor = await requireSuperAdminAccess(req);
    const userId = String(req.params.userId || "").trim();
    const user = await updateAdminUser(actor, userId, {
      displayName: req.body?.displayName,
      role: req.body?.role,
      status: req.body?.status,
    });
    res.json(
      await buildAdminUserDetailPayload(user, {
        ledgerPage: parsePositivePage(req.query?.ledgerPage, 1),
        ledgerPageSize: parsePositivePage(req.query?.ledgerPageSize, 20),
      }),
    );
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to update user" });
  }
});

app.get("/api/admin/dashboard", async (req, res) => {
  try {
    await requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS);
    res.json(await buildAdminDashboardPayload());
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load admin dashboard" });
  }
});

app.get("/api/admin/change-logs", async (req, res) => {
  try {
    await requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS);
    res.json({
      success: true,
      entries: listAdminChanges({
        limit: Math.min(100, parsePositivePage(req.query?.limit, 30)),
      }),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load change logs" });
  }
});

app.get("/api/image-routes/catalog", async (_req, res) => {
  try {
    const catalog = await getImageRouteCatalog();
    res.json({
      success: true,
      ...toPublicImageRouteCatalog(catalog),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load image route catalog" });
  }
});

app.get("/api/image-models/catalog", async (_req, res) => {
  try {
    const catalog = await getImageModelCatalog();
    res.json({
      success: true,
      ...catalog,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load image model catalog" });
  }
});

app.get("/api/video-routes/catalog", async (_req, res) => {
  try {
    const catalog = await getVideoRouteCatalog();
    res.json({
      success: true,
      ...toPublicVideoRouteCatalog(catalog),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load video route catalog" });
  }
});

app.get("/api/video-models/catalog", async (_req, res) => {
  try {
    const catalog = await getVideoModelCatalog();
    res.json({
      success: true,
      ...catalog,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load video model catalog" });
  }
});

app.get("/api/admin/image-models", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const catalog = await getImageModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminImageModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load admin image models" });
  }
});

app.post("/api/admin/image-models", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const model = await createManagedImageModel(req.body || {});
    await logAdminCatalogChange(req, {
      action: "create",
      entityType: "image-model",
      entityId: model.id,
      summary: `新增图片模型 ${model.label || model.id}`,
      detail: { after: model },
    });
    const catalog = await getImageModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      model,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminImageModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to create image model" });
  }
});

app.patch("/api/admin/image-models/:modelId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const modelId = String(req.params.modelId || "").trim();
    const before = await getImageModelById(modelId, { includeInactive: true });
    const model = await updateManagedImageModel(modelId, req.body || {});
    await logAdminCatalogChange(req, {
      action: "update",
      entityType: "image-model",
      entityId: model.id,
      summary: `更新图片模型 ${model.label || model.id}`,
      detail: {
        before,
        patch: req.body || {},
        after: model,
      },
    });
    const catalog = await getImageModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      model,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminImageModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to update image model" });
  }
});

app.delete("/api/admin/image-models/:modelId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const modelId = String(req.params.modelId || "").trim();
    const before = await getImageModelById(modelId, { includeInactive: true });
    await deleteManagedImageModel(modelId);
    await logAdminCatalogChange(req, {
      action: "delete",
      entityType: "image-model",
      entityId: modelId,
      summary: `删除图片模型 ${before?.label || modelId}`,
      detail: { before },
    });
    const catalog = await getImageModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      deletedModelId: modelId,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminImageModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to delete image model" });
  }
});

app.get("/api/admin/image-routes", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const routes = await fetchAdminRoutes();
    const catalog = await getImageRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      defaultRouteId: catalog.defaultRouteId,
      defaultNanoBananaLine: catalog.defaultNanoBananaLine,
      routes,
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load admin image routes" });
  }
});

app.post("/api/admin/image-routes", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const route = await createManagedImageRoute(req.body || {});
    await logAdminCatalogChange(req, {
      action: "create",
      entityType: "image-route",
      entityId: route.id,
      summary: `新增图片线路 ${route.label || route.id}`,
      detail: { after: route },
    });
    const catalog = await getImageRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      route,
      defaultRouteId: catalog.defaultRouteId,
      defaultNanoBananaLine: catalog.defaultNanoBananaLine,
      routes: await fetchAdminRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to create image route" });
  }
});

app.patch("/api/admin/image-routes/:routeId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const routeId = String(req.params.routeId || "").trim();
    const before = await getImageRouteById(routeId, {
      includeInactive: true,
      includeSecrets: false,
    });
    const route = await updateManagedImageRoute(routeId, req.body || {});
    await logAdminCatalogChange(req, {
      action: "update",
      entityType: "image-route",
      entityId: route.id,
      summary: `更新图片线路 ${route.label || route.id}`,
      detail: {
        before,
        patch: req.body || {},
        after: route,
      },
    });
    const catalog = await getImageRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      route,
      defaultRouteId: catalog.defaultRouteId,
      defaultNanoBananaLine: catalog.defaultNanoBananaLine,
      routes: await fetchAdminRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to update image route" });
  }
});

app.delete("/api/admin/image-routes/:routeId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const routeId = String(req.params.routeId || "").trim();
    const before = await getImageRouteById(routeId, {
      includeInactive: true,
      includeSecrets: false,
    });
    await deleteManagedImageRoute(routeId);
    await logAdminCatalogChange(req, {
      action: "delete",
      entityType: "image-route",
      entityId: routeId,
      summary: `删除图片线路 ${before?.label || routeId}`,
      detail: { before },
    });
    const catalog = await getImageRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      deletedRouteId: routeId,
      defaultRouteId: catalog.defaultRouteId,
      defaultNanoBananaLine: catalog.defaultNanoBananaLine,
      routes: await fetchAdminRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to delete image route" });
  }
});

app.get("/api/admin/video-models", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const catalog = await getVideoModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminVideoModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load admin video models" });
  }
});

app.post("/api/admin/video-models", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const model = await createManagedVideoModel(req.body || {});
    await logAdminCatalogChange(req, {
      action: "create",
      entityType: "video-model",
      entityId: model.id,
      summary: `新增视频模型 ${model.label || model.id}`,
      detail: { after: model },
    });
    const catalog = await getVideoModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      model,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminVideoModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to create video model" });
  }
});

app.patch("/api/admin/video-models/:modelId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const modelId = String(req.params.modelId || "").trim();
    const before = await getVideoModelById(modelId, { includeInactive: true });
    const model = await updateManagedVideoModel(modelId, req.body || {});
    await logAdminCatalogChange(req, {
      action: "update",
      entityType: "video-model",
      entityId: model.id,
      summary: `更新视频模型 ${model.label || model.id}`,
      detail: {
        before,
        patch: req.body || {},
        after: model,
      },
    });
    const catalog = await getVideoModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      model,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminVideoModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to update video model" });
  }
});

app.delete("/api/admin/video-models/:modelId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const modelId = String(req.params.modelId || "").trim();
    const before = await getVideoModelById(modelId, { includeInactive: true });
    await deleteManagedVideoModel(modelId);
    await logAdminCatalogChange(req, {
      action: "delete",
      entityType: "video-model",
      entityId: modelId,
      summary: `删除视频模型 ${before?.label || modelId}`,
      detail: { before },
    });
    const catalog = await getVideoModelCatalog({ includeInactive: true });
    res.json({
      success: true,
      deletedModelId: modelId,
      defaultModelId: catalog.defaultModelId,
      models: await fetchAdminVideoModels(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to delete video model" });
  }
});

app.get("/api/admin/video-routes", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const catalog = await getVideoRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      defaultRouteId: catalog.defaultRouteId,
      routes: await fetchAdminVideoRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(500).json({ error: error.message || "Failed to load admin video routes" });
  }
});

app.post("/api/admin/video-routes", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const route = await createManagedVideoRoute(req.body || {});
    await logAdminCatalogChange(req, {
      action: "create",
      entityType: "video-route",
      entityId: route.id,
      summary: `新增视频线路 ${route.label || route.id}`,
      detail: { after: route },
    });
    const catalog = await getVideoRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      route,
      defaultRouteId: catalog.defaultRouteId,
      routes: await fetchAdminVideoRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to create video route" });
  }
});

app.patch("/api/admin/video-routes/:routeId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const routeId = String(req.params.routeId || "").trim();
    const before = await getVideoRouteById(routeId, {
      includeInactive: true,
      includeSecrets: false,
    });
    const route = await updateManagedVideoRoute(routeId, req.body || {});
    await logAdminCatalogChange(req, {
      action: "update",
      entityType: "video-route",
      entityId: route.id,
      summary: `更新视频线路 ${route.label || route.id}`,
      detail: {
        before,
        patch: req.body || {},
        after: route,
      },
    });
    const catalog = await getVideoRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      route,
      defaultRouteId: catalog.defaultRouteId,
      routes: await fetchAdminVideoRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to update video route" });
  }
});

app.delete("/api/admin/video-routes/:routeId", async (req, res) => {
  try {
    await requireSuperAdminAccess(req);
    const routeId = String(req.params.routeId || "").trim();
    const before = await getVideoRouteById(routeId, {
      includeInactive: true,
      includeSecrets: false,
    });
    await deleteManagedVideoRoute(routeId);
    await logAdminCatalogChange(req, {
      action: "delete",
      entityType: "video-route",
      entityId: routeId,
      summary: `删除视频线路 ${before?.label || routeId}`,
      detail: { before },
    });
    const catalog = await getVideoRouteCatalog({ includeInactive: true });
    res.json({
      success: true,
      deletedRouteId: routeId,
      defaultRouteId: catalog.defaultRouteId,
      routes: await fetchAdminVideoRoutes(),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    res.status(400).json({ error: error.message || "Failed to delete video route" });
  }
});

// ==================== Balance API ====================
app.get("/api/balance/info", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    const startDate = "2023-01-01";
    const now = new Date();
    now.setDate(now.getDate() + 1);
    const endDate = now.toISOString().split("T")[0];

    const [subRes, usageRes] = await Promise.all([
      axios.get(`${UPSTREAM_URL}/v1/dashboard/billing/subscription`, {
        headers: { Authorization: userKey },
      }),
      axios.get(
        `${UPSTREAM_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
        {
          headers: { Authorization: userKey },
        },
      ),
    ]);

    const subData = subRes.data;
    const usageData = usageRes.data;

    const POINTS_MULTIPLIER = 25;
    let totalQuotaUsd = parseFloat(subData.hard_limit_usd || 0);
    let usedAmountUsd = 0;
    if (usageData && usageData.total_usage !== undefined) {
      usedAmountUsd = parseFloat(usageData.total_usage) / 100;
    }

    let remainingBalanceUsd = totalQuotaUsd - usedAmountUsd;
    if (remainingBalanceUsd < 0) remainingBalanceUsd = 0;

    // Convert upstream balance to internal points.
    const total_points = Math.floor(totalQuotaUsd * POINTS_MULTIPLIER);
    const used_points = Math.floor(usedAmountUsd * POINTS_MULTIPLIER);
    const remaining_points = total_points - used_points;

    res.json({
      success: true,
      status_valid: remainingBalanceUsd > 0.05,
      remaining_points: remaining_points,
      used_points: used_points,
      total_points: total_points,
    });
  } catch (error) {
    console.error("Balance Check Error:", error.message);
    if (error.response && error.response.status === 401) {
      res.status(401).json({ error: "Invalid or expired API Key" });
    } else {
      res.status(500).json({ error: "Failed to fetch balance info" });
    }
  }
});

// ==================== Image Generation ====================
app.post("/api/generate", generateLimiter, async (req, res) => {
  let billingAccount = null;
  let billingCharge = null;
  let localTaskId = null;
  let chargeRouteId = null;
  let generationRecord = null;
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const requestBody = { ...(req.body || {}) };
    const uiMode = normalizeGenerationUiMode(requestBody.uiMode);
    const route = await resolveImageRoute(requestBody.routeId);
    const requestedImageModel = await resolveRequestedImageModel(requestBody);
    const useUserProvidedApiKey = shouldUseUserProvidedApiKey(
      route,
      fallbackAuthorization,
    );
    const shouldUseBilling = !useUserProvidedApiKey;
    if (!route) {
      return sendUserFacingGenerationError(res, 400);
    }

    delete requestBody.uiMode;
    const pointCost = shouldUseBilling ? getRoutePointCost(route, requestBody.n, requestBody) : 0;
    if (shouldUseBilling) {
      billingAccount = await requireBillingAccount(req);
      chargeRouteId = route.id;
    }

    delete requestBody.routeId;
    delete requestBody.modelId;
    requestBody.model = getRouteModelName(
      route,
      requestBody,
      requestedImageModel?.requestModel || requestBody.model,
    );

    if (isGeminiNativeRoute(route)) {
      if (shouldUseBilling) {
        billingCharge = await reservePoints(billingAccount.accountId, pointCost, {
          action: "generate",
          routeId: route.id,
          mode: route.mode,
          model: requestBody.model,
          modelId: requestedImageModel?.id || null,
        });
      }

      generationRecord = await buildGenerationRecordPayload({
        req,
        billingAccount,
        mediaType: "IMAGE",
        actionName: "generate",
        prompt: requestBody.prompt,
        modelId: requestedImageModel?.id || null,
        modelName: requestedImageModel?.label || requestBody.model,
        route,
        quantity: requestBody.n,
        aspectRatio: requestBody.aspect_ratio || requestBody.aspectRatio || null,
        outputSize: requestBody.image_size || requestBody.size || null,
        uiMode,
        status: "PENDING",
        meta: {
          transport: route.transport,
          routeMode: route.mode,
        },
      });

      try {
        const result = await executeGeminiNativeGenerate({
          route,
          requestBody,
          fallbackAuthorization,
          logTag: "Generate",
        });
        await completeGenerationRecordSuccessSafe({
          recordId: generationRecord?.id,
          resultUrls: extractResultUrlsFromPayload(result),
          outputSize: requestBody.image_size || requestBody.size || null,
          aspectRatio: requestBody.aspect_ratio || requestBody.aspectRatio || null,
          meta: {
            transport: route.transport,
            routeMode: route.mode,
          },
        });
        return res.json(
          shouldUseBilling
            ? {
                ...result,
                billing: {
                  deductedPoints: pointCost,
                  remainingPoints: billingCharge.account.points,
                },
              }
            : result,
        );
      } catch (error) {
        if (shouldUseBilling && billingCharge?.chargeId) {
          await refundPoints(billingAccount.accountId, billingCharge.chargeId, {
            reason: "request_failed",
            routeId: route.id,
          });
        }
        await completeGenerationRecordFailureSafe({
          recordId: generationRecord?.id,
          errorMessage: error.message,
          outputSize: requestBody.image_size || requestBody.size || null,
          aspectRatio: requestBody.aspect_ratio || requestBody.aspectRatio || null,
          meta: {
            transport: route.transport,
            routeMode: route.mode,
          },
        });
        throw error;
      }
    }

    if (!isOpenAiImageRoute(route)) {
      return sendUserFacingGenerationError(res, 400);
    }

    const userKey = getRouteAuthorization(route, fallbackAuthorization, {
      preferUserProvided: useUserProvidedApiKey,
    });
    const isGrokModel = requestBody.model?.startsWith("grok");

    const toRawBase64 = (value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("data:")) {
        const commaIndex = trimmed.indexOf(",");
        if (commaIndex > -1) return trimmed.slice(commaIndex + 1);
      }
      if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("blob:")
      ) {
        return null;
      }
      return trimmed;
    };

    const collectNormalizedImages = (body) => {
      const items = [];
      const pushOne = (value) => {
        const normalized = toRawBase64(value);
        if (normalized) items.push(normalized);
      };
      const pushMany = (value) => {
        if (Array.isArray(value)) value.forEach(pushOne);
      };
      pushOne(body.image);
      pushOne(body.reference_image);
      pushOne(body.image_url);
      pushOne(body.reference_image_url);
      pushMany(body.images);
      pushMany(body.reference_images);
      pushMany(body.image_urls);
      pushMany(body.reference_image_urls);
      return Array.from(new Set(items));
    };

    if (isGrokModel) {
      const hasAnyReferenceField = [
        "image",
        "images",
        "reference_image",
        "reference_images",
        "image_url",
        "image_urls",
        "reference_image_url",
        "reference_image_urls",
      ].some((key) => requestBody[key] !== undefined);

      if (hasAnyReferenceField) {
        const normalizedImages = collectNormalizedImages(requestBody);
        if (normalizedImages.length > 0) {
          requestBody.image = normalizedImages[0];
          requestBody.images = normalizedImages;
          requestBody.reference_image = normalizedImages[0];
          requestBody.reference_images = normalizedImages;
          if (!requestBody.reference_mode) {
            requestBody.reference_mode = "stable_fusion";
          }
        }
      }

      delete requestBody.image_url;
      delete requestBody.image_urls;
      delete requestBody.reference_image_url;
      delete requestBody.reference_image_urls;
    }

    if (isVisionaryImageRoute(route)) {
      applyVisionaryImageCompat(requestBody);
    }

    const DOUBAO_RESOLUTIONS = {
      "1K": {
        "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800",
        "9:16": "800x1424", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672"
      },
      "2K": {
        "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2848x1600",
        "9:16": "1600x2848", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344"
      },
      "3K": {
        "1:1": "3072x3072", "4:3": "3456x2592", "3:4": "2592x3456", "16:9": "4096x2304",
        "9:16": "2304x4096", "2:3": "2496x3744", "3:2": "3744x2496", "21:9": "4704x2016"
      },
      "4K": {
        "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "16:9": "5504x3040",
        "9:16": "3040x5504", "2:3": "3328x4992", "3:2": "4992x3328", "21:9": "6240x2656"
      }
    };

    const isSyncLine = requestBody.isSync === true;
    if (isSyncLine) {
      delete requestBody.isSync;
    }

    const sizeBehavior = String(requestedImageModel?.sizeBehavior || "").trim();
    const isDoubaoOrTurbo =
      sizeBehavior === "doubao-v5" ||
      sizeBehavior === "doubao-v45" ||
      sizeBehavior === "z-image-turbo" ||
      requestBody.model?.startsWith("doubao") ||
      requestBody.model === "z-image-turbo";

    if (isDoubaoOrTurbo) {
      if (
        (sizeBehavior === "doubao-v5" ||
          sizeBehavior === "doubao-v45" ||
          requestBody.model?.startsWith("doubao")) &&
        Array.isArray(requestBody.image)
      ) {
        requestBody.sequential_image_generation = "auto";
        requestBody.response_format = "url";
      }

      if (requestBody.size && !requestBody.size.includes("x")) {
        let sizeKey = requestBody.size.toUpperCase();
        const ratio = requestBody.aspect_ratio || "1:1";

        if (sizeBehavior === "doubao-v5" || requestBody.model.includes("5-0")) {
          if (sizeKey === "1K") sizeKey = "2K";
          if (sizeKey === "4K") sizeKey = "3K";
          if (!["2K", "3K"].includes(sizeKey)) sizeKey = "2K";
        } else if (sizeBehavior === "doubao-v45" || requestBody.model.includes("4-5")) {
          if (sizeKey === "1K") sizeKey = "2K";
          if (sizeKey === "3K") sizeKey = "2K";
          if (!["2K", "4K"].includes(sizeKey)) sizeKey = "2K";
        } else if (sizeBehavior === "z-image-turbo" || requestBody.model === "z-image-turbo") {
          sizeKey = "1K";
        }

        if (DOUBAO_RESOLUTIONS[sizeKey] && DOUBAO_RESOLUTIONS[sizeKey][ratio]) {
          requestBody.size = DOUBAO_RESOLUTIONS[sizeKey][ratio];
          console.log(`[Resolution] Mapped ${sizeKey} ${ratio} to ${requestBody.size}`);
        } else {
          requestBody.size = sizeKey;
        }
      }
    }

    const grokImageDebug = isGrokModel
      ? {
          imageLen: typeof requestBody.image === "string" ? requestBody.image.length : 0,
          imagesCount: Array.isArray(requestBody.images) ? requestBody.images.length : 0,
          referenceImageLen:
            typeof requestBody.reference_image === "string" ? requestBody.reference_image.length : 0,
          referenceImagesCount: Array.isArray(requestBody.reference_images)
            ? requestBody.reference_images.length
            : 0,
          imagePrefix:
            typeof requestBody.image === "string" ? requestBody.image.slice(0, 24) : String(typeof requestBody.image),
        }
      : undefined;

    console.log("[Generate] Proxying request:", {
      routeId: route.id,
      modelId: requestedImageModel?.id || null,
      model: requestBody.model,
      size: requestBody.size,
      ratio: requestBody.aspect_ratio,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image,
      isSync: isSyncLine,
      imageType: Array.isArray(requestBody.image) ? "Array" : typeof requestBody.image,
      grokImageDebug,
    });

    const upstreamUrl = isSyncLine
      ? buildRouteUrl(route, route.chatPath || "/v1/chat/completions", {
          model: requestBody.model,
        })
      : buildRouteUrl(route, route.generatePath, {
          model: requestBody.model,
        });

    let finalRequestBody = requestBody;
    if (isSyncLine) {
      finalRequestBody = {
        model: requestBody.model,
        messages: [{ role: "user", content: requestBody.prompt }],
        stream: false,
      };
    }

    if (shouldUseBilling) {
      billingCharge = await reservePoints(billingAccount.accountId, pointCost, {
        action: "generate",
        routeId: route.id,
        mode: isSyncLine ? "sync" : route.mode,
        model: requestBody.model,
        modelId: requestedImageModel?.id || null,
      });
    }

    generationRecord = await buildGenerationRecordPayload({
      req,
      billingAccount,
      mediaType: "IMAGE",
      actionName: "generate",
      prompt: requestBody.prompt,
      modelId: requestedImageModel?.id || null,
      modelName: requestedImageModel?.label || requestBody.model,
      route,
      quantity: requestBody.n,
      aspectRatio: requestBody.aspect_ratio || null,
      outputSize: requestBody.size || requestBody.image_size || null,
      uiMode,
      status: "PENDING",
      meta: {
        transport: route.transport,
        routeMode: isSyncLine ? "sync" : route.mode,
      },
    });

    const response = await requestWithRetry(
      () =>
        axios.post(upstreamUrl, finalRequestBody, {
          headers: {
            Authorization: userKey,
            "Content-Type": "application/json",
          },
          timeout: 600000,
          httpsAgent: SHARED_HTTPS_AGENT,
        }),
      { retries: 1, delayMs: 700, label: `generate-${route.id}` },
    );

    if (isSyncLine) {
      const syncImmediateResultUrls = extractResultUrlsFromPayload(response.data);
      const syncUpstreamStatus = extractResultStatus(response.data);
      if (
        syncImmediateResultUrls.length > 0 &&
        ["SUCCEEDED", "SUCCESS", "COMPLETED"].includes(syncUpstreamStatus)
      ) {
        const immediatePayload = {
          ...response.data,
          url:
            response.data?.url ||
            response.data?.image_url ||
            syncImmediateResultUrls[0] ||
            null,
          image_url:
            response.data?.image_url ||
            response.data?.url ||
            syncImmediateResultUrls[0] ||
            null,
          images: Array.isArray(response.data?.images)
            ? response.data.images
            : syncImmediateResultUrls,
        };
        await completeGenerationRecordSuccessSafe({
          recordId: generationRecord?.id,
          resultUrls: syncImmediateResultUrls,
          previewUrl: syncImmediateResultUrls[0] || null,
          outputSize: requestBody.size || requestBody.image_size || null,
          aspectRatio: requestBody.aspect_ratio || null,
          meta: {
            transport: route.transport,
            routeMode: "sync",
            upstreamStatus: syncUpstreamStatus,
            settled: "sync_immediate_result",
          },
        });
        return res.json(
          shouldUseBilling
            ? {
                ...immediatePayload,
                billing: {
                  deductedPoints: pointCost,
                  remainingPoints: billingCharge?.account?.points,
                },
              }
            : immediatePayload,
        );
      }

      const syncUpstreamTaskId =
        response.data?.id ||
        response.data?.task_id ||
        response.data?.data?.task_id;
      const shouldTreatSyncAsPendingTask =
        syncUpstreamTaskId &&
        ["PROCESSING", "PENDING", "RUNNING", "QUEUED", "IN_PROGRESS"].includes(syncUpstreamStatus);
      if (shouldTreatSyncAsPendingTask) {
        localTaskId = buildImageTaskToken(route.id, syncUpstreamTaskId);
        if (shouldUseBilling) {
          await registerPendingTask(localTaskId, {
            accountId: billingAccount.accountId,
            chargeId: billingCharge?.chargeId || null,
            points: pointCost,
            routeId: route.id,
            action: "generate",
          });
        }
        if (generationRecord?.id) {
          await attachTaskToGenerationRecord(generationRecord.id, localTaskId);
        }

        const normalizedResponse = shouldUseBilling
          ? {
              ...response.data,
              id: localTaskId,
              task_id: localTaskId,
              billing: {
                deductedPoints: pointCost,
                remainingPoints: billingCharge?.account?.points,
              },
            }
          : {
              ...response.data,
              id: localTaskId,
              task_id: localTaskId,
            };

        if (normalizedResponse.data && typeof normalizedResponse.data === "object") {
          normalizedResponse.data = {
            ...normalizedResponse.data,
            task_id: localTaskId,
          };
        }

        return res.json(normalizedResponse);
      }

      const chatContent = response.data.choices?.[0]?.message?.content || "";
      console.log("[Generate] Chat response content:", chatContent.substring(0, 100));

      const urlMatch = chatContent.match(/https?:\/\/[^\s^)^>]+/);
      const syncResultUrl = urlMatch ? urlMatch[0] : chatContent;
      await completeGenerationRecordSuccessSafe({
        recordId: generationRecord?.id,
        resultUrls: syncResultUrl ? [syncResultUrl] : [],
        previewUrl: syncResultUrl || null,
        outputSize: requestBody.size || requestBody.image_size || null,
        aspectRatio: requestBody.aspect_ratio || null,
        meta: {
          transport: route.transport,
          routeMode: "sync",
        },
      });
      if (urlMatch) {
        return res.json(
          shouldUseBilling
            ? {
                url: syncResultUrl,
                billing: {
                  deductedPoints: pointCost,
                  remainingPoints: billingCharge?.account?.points,
                },
              }
            : { url: urlMatch[0] },
        );
      }
      return res.json(
        shouldUseBilling
          ? {
              url: syncResultUrl,
              billing: {
                deductedPoints: pointCost,
                remainingPoints: billingCharge?.account?.points,
              },
            }
          : { url: chatContent },
      );
    }

    console.log("[Generate] Upstream response:", response.data);
    const immediateResultUrls = extractResultUrlsFromPayload(response.data);
    const upstreamStatus = extractResultStatus(response.data);
    const shouldTreatAsImmediateResult =
      immediateResultUrls.length > 0 &&
      (
        isVisionaryImageRoute(route) ||
        ["SUCCEEDED", "SUCCESS", "COMPLETED"].includes(upstreamStatus)
      );
    if (shouldTreatAsImmediateResult) {
      const immediatePayload = {
        ...response.data,
        url:
          response.data?.url ||
          response.data?.image_url ||
          immediateResultUrls[0] ||
          null,
        image_url:
          response.data?.image_url ||
          response.data?.url ||
          immediateResultUrls[0] ||
          null,
        images: Array.isArray(response.data?.images)
          ? response.data.images
          : immediateResultUrls,
      };
      await completeGenerationRecordSuccessSafe({
        recordId: generationRecord?.id,
        resultUrls: immediateResultUrls,
        previewUrl: immediateResultUrls[0] || null,
        outputSize: requestBody.size || requestBody.image_size || null,
        aspectRatio: requestBody.aspect_ratio || null,
        meta: {
          transport: route.transport,
          routeMode: route.mode,
          upstreamStatus,
          settled: "immediate_result",
        },
      });
      return res.json(
        shouldUseBilling
          ? {
              ...immediatePayload,
              billing: {
                deductedPoints: pointCost,
                remainingPoints: billingCharge?.account?.points,
              },
            }
          : immediatePayload,
      );
    }

    const upstreamTaskId =
      response.data?.id ||
      response.data?.task_id ||
      response.data?.data?.task_id;

    if (upstreamTaskId) {
      localTaskId = buildImageTaskToken(route.id, upstreamTaskId);
      if (shouldUseBilling) {
        await registerPendingTask(localTaskId, {
          accountId: billingAccount.accountId,
          chargeId: billingCharge?.chargeId || null,
          points: pointCost,
          routeId: route.id,
          action: "generate",
        });
      }
      if (generationRecord?.id) {
        await attachTaskToGenerationRecord(generationRecord.id, localTaskId);
      }
      const normalizedResponse = shouldUseBilling
        ? {
            ...response.data,
            id: localTaskId,
            task_id: localTaskId,
            billing: {
              deductedPoints: pointCost,
              remainingPoints: billingCharge?.account?.points,
            },
          }
        : {
            ...response.data,
            id: localTaskId,
            task_id: localTaskId,
          };

      if (normalizedResponse.data && typeof normalizedResponse.data === "object") {
        normalizedResponse.data = {
          ...normalizedResponse.data,
          task_id: localTaskId,
        };
      }

      return res.json(normalizedResponse);
    }

    await completeGenerationRecordSuccessSafe({
      recordId: generationRecord?.id,
      resultUrls: extractResultUrlsFromPayload(response.data),
      outputSize: requestBody.size || requestBody.image_size || null,
      aspectRatio: requestBody.aspect_ratio || null,
      meta: {
        transport: route.transport,
        routeMode: route.mode,
      },
    });

    res.json(
      shouldUseBilling
        ? {
            ...response.data,
            billing: {
              deductedPoints: pointCost,
              remainingPoints: billingCharge?.account?.points,
            },
          }
        : response.data,
    );
  } catch (error) {
    if (billingCharge?.chargeId && billingAccount?.accountId && !localTaskId) {
      await refundPoints(billingAccount.accountId, billingCharge.chargeId, {
        reason: "request_failed",
        routeId: chargeRouteId,
      });
    }
    await completeGenerationRecordFailureSafe({
      recordId: generationRecord?.id,
      taskId: localTaskId || null,
      errorMessage: error.message,
    });
    console.error("[Generate] Error:", error.message);
    logger.error({
      timestamp: new Date().toISOString(),
      type: "Generate Error",
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    respondWithUserFacingGenerationError(res, error, 500);
  }
});
app.post("/api/edit", generateLimiter, async (req, res) => {
  let billingAccount = null;
  let billingCharge = null;
  let localTaskId = null;
  let chargeRouteId = null;
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const requestBody = { ...(req.body || {}) };
    const requestedRoute = await resolveImageRoute(requestBody.routeId);
    const requestedImageModel = await resolveRequestedImageModel(requestBody);
    const route = requestedRoute?.editPath
      ? requestedRoute
      : await resolveImageRoute(undefined);
    const useUserProvidedApiKey = shouldUseUserProvidedApiKey(
      route,
      fallbackAuthorization,
    );
    const shouldUseBilling = !useUserProvidedApiKey;

    if (!route) {
      return sendUserFacingGenerationError(res, 400);
    }

    const pointCost = shouldUseBilling ? getRoutePointCost(route, requestBody.n, requestBody) : 0;
    if (shouldUseBilling) {
      billingAccount = await requireBillingAccount(req);
      chargeRouteId = route.id;
    }

    delete requestBody.routeId;
    delete requestBody.modelId;
    requestBody.model = getRouteModelName(
      route,
      requestBody,
      requestedImageModel?.requestModel || requestBody.model,
    );

    console.log("[Edit] Proxying request:", {
      routeId: route.id,
      modelId: requestedImageModel?.id || null,
      model: requestBody.model,
      size: requestBody.size,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image,
      hasMask: !!requestBody.mask,
    });

    const formData = new FormData();
    formData.append("model", requestBody.model);
    formData.append("prompt", requestBody.prompt);

    if (requestBody.n) formData.append("n", String(requestBody.n));
    if (requestBody.size) formData.append("size", requestBody.size);
    if (requestBody.image_size) formData.append("image_size", requestBody.image_size);
    if (requestBody.aspect_ratio) formData.append("aspect_ratio", requestBody.aspect_ratio);

    if (requestBody.image) {
      const imgBuffer = Buffer.from(requestBody.image, "base64");
      formData.append("image", imgBuffer, {
        filename: "image.png",
        contentType: "image/png",
      });
    }

    if (requestBody.mask) {
      const maskBuffer = Buffer.from(requestBody.mask, "base64");
      formData.append("mask", maskBuffer, {
        filename: "mask.png",
        contentType: "image/png",
      });
    }

    const authorization = getRouteAuthorization(route, fallbackAuthorization, {
      preferUserProvided: useUserProvidedApiKey,
    });
    if (shouldUseBilling) {
      billingCharge = await reservePoints(billingAccount.accountId, pointCost, {
        action: "edit",
        routeId: route.id,
        mode: route.mode,
        model: requestBody.model,
        modelId: requestedImageModel?.id || null,
      });
    }
    const response = await requestWithRetry(
      () =>
        axios.post(
          buildRouteUrl(route, route.editPath || "/v1/images/edits?async=true"),
          formData,
          {
            headers: {
              Authorization: authorization,
              ...formData.getHeaders(),
            },
            timeout: 600000,
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 1, delayMs: 700, label: `edit-${route.id}` },
    );

    console.log("[Edit] Upstream response:", response.data);
    const upstreamTaskId =
      response.data?.id ||
      response.data?.task_id ||
      response.data?.data?.task_id;

    if (upstreamTaskId) {
      localTaskId = buildImageTaskToken(route.id, upstreamTaskId);
      if (shouldUseBilling) {
        await registerPendingTask(localTaskId, {
          accountId: billingAccount.accountId,
          chargeId: billingCharge?.chargeId || null,
          points: pointCost,
          routeId: route.id,
          action: "edit",
        });
      }
      const normalizedResponse = shouldUseBilling
        ? {
            ...response.data,
            id: localTaskId,
            task_id: localTaskId,
            billing: {
              deductedPoints: pointCost,
              remainingPoints: billingCharge?.account?.points,
            },
          }
        : {
            ...response.data,
            id: localTaskId,
            task_id: localTaskId,
          };

      if (normalizedResponse.data && typeof normalizedResponse.data === "object") {
        normalizedResponse.data = {
          ...normalizedResponse.data,
          task_id: localTaskId,
        };
      }

      return res.json(normalizedResponse);
    }

    res.json(
      shouldUseBilling
        ? {
            ...response.data,
            billing: {
              deductedPoints: pointCost,
              remainingPoints: billingCharge?.account?.points,
            },
          }
        : response.data,
    );
  } catch (error) {
    if (billingCharge?.chargeId && billingAccount?.accountId && !localTaskId) {
      await refundPoints(billingAccount.accountId, billingCharge.chargeId, {
        reason: "request_failed",
        routeId: chargeRouteId,
      });
    }
    console.error("[Edit] Error:", error.message);
    respondWithUserFacingGenerationError(res, error, 500);
  }
});
app.get("/api/proxy/image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("Url is required");

  // Validate URL to prevent arbitrary proxying if possible, or at least check protocol
  if (!imageUrl.startsWith('http')) {
    return res.status(400).send("Invalid URL protocol");
  }

  try {
    console.log("[Image Proxy] Fetching:", imageUrl.substring(0, 100) + "...");
    const response = await requestWithRetry(
      () =>
        axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          httpsAgent: SHARED_HTTPS_AGENT,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
          }
        }),
      { retries: 2, delayMs: 400, label: "image-proxy" },
    );

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Buffer is better for res.send
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error("[Image Proxy] Error:", error.message);
    res.status(500).send("Failed to proxy image: " + error.message);
  }
});

// ==================== Image Task Polling ====================
app.get("/api/task/:taskId", pollingLimiter, async (req, res) => {
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const encodedTask = String(req.params.taskId || "").trim();
    const decodedTask = parseImageTaskToken(encodedTask);
    const route =
      (decodedTask?.routeId
        ? await getImageRouteById(decodedTask.routeId, {
            includeInactive: true,
            includeSecrets: true,
          })
        : null) || (await resolveImageRoute(undefined, { includeInactive: true }));

    const upstreamTaskId = decodedTask?.upstreamTaskId || encodedTask;
    const authorization = getRouteAuthorization(route, fallbackAuthorization, {
      preferUserProvided: shouldUseUserProvidedApiKey(route, fallbackAuthorization),
    });
    let responseData = null;

    if (isVisionaryImageRoute(route)) {
      const record = await fetchVisionaryRecordById({
        route,
        authorization,
        upstreamTaskId,
      });
      responseData =
        record || {
          id: upstreamTaskId,
          results: [],
          progress: 0,
          status: "processing",
          failure_reason: "",
          error: "",
        };
    } else {
      if (!route?.taskPath || !isOpenAiImageRoute(route)) {
        return sendUserFacingGenerationError(res, 400);
      }

      const pollUrl = buildRouteUrl(route, route.taskPath, { taskId: upstreamTaskId });
      const response = await requestWithRetry(
        () =>
          axios.get(pollUrl, {
            headers: {
              Authorization: authorization,
              "Content-Type": "application/json",
            },
            timeout: 10000,
            httpsAgent: SHARED_HTTPS_AGENT,
          }),
        { retries: 2, delayMs: 350, label: `task-poll-${route.id}` },
      );
      responseData = response.data;
    }

    const taskStatus = String(
      responseData?.status || responseData?.state || responseData?.data?.status || "",
    ).toUpperCase();
    if (["SUCCESS", "SUCCEEDED", "COMPLETED"].includes(taskStatus)) {
      await settlePendingTask(encodedTask, "SUCCESS");
      await completeGenerationRecordSuccessSafe({
        taskId: encodedTask,
        resultUrls: extractResultUrlsFromPayload(responseData),
        meta: {
          polledAt: new Date().toISOString(),
          source: "image_task_poll",
        },
      });
    } else if (["FAILURE", "FAILED"].includes(taskStatus)) {
      await settlePendingTask(encodedTask, "FAILED");
      await completeGenerationRecordFailureSafe({
        taskId: encodedTask,
        errorMessage:
          responseData?.error ||
          responseData?.message ||
          responseData?.fail_reason ||
          "Image task failed",
        meta: {
          polledAt: new Date().toISOString(),
          source: "image_task_poll",
        },
      });
    }

    res.json(responseData);
  } catch (error) {
    console.error("[Task Poll] Error:", error.message);
    respondWithUserFacingGenerationError(res, error, 500);
  }
});
app.post("/api/gemini/generate", generateLimiter, async (req, res) => {
  let billingAccount = null;
  let billingCharge = null;
  let chargeRouteId = null;
  let generationRecord = null;
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const requestBody = { ...(req.body || {}) };
    const uiMode = normalizeGenerationUiMode(requestBody.uiMode);
    const route = await resolveImageRoute(requestBody.routeId);
    const requestedImageModel = await resolveRequestedImageModel(requestBody);

    if (!route || !isGeminiNativeRoute(route)) {
      return sendUserFacingGenerationError(res, 400);
    }

    billingAccount = await requireBillingAccount(req);
    const pointCost = getRoutePointCost(route, requestBody.n, requestBody);
    chargeRouteId = route.id;

    delete requestBody.routeId;
    delete requestBody.modelId;
    delete requestBody.uiMode;
    requestBody.model = getRouteModelName(
      route,
      requestBody,
      requestedImageModel?.requestModel || requestBody.model,
    );
    billingCharge = await reservePoints(billingAccount.accountId, pointCost, {
      action: "gemini_generate",
      routeId: route.id,
      mode: route.mode,
      model: requestBody.model,
      modelId: requestedImageModel?.id || null,
    });

    generationRecord = await buildGenerationRecordPayload({
      req,
      billingAccount,
      mediaType: "IMAGE",
      actionName: "gemini_generate",
      prompt: requestBody.prompt,
      modelId: requestedImageModel?.id || null,
      modelName: requestedImageModel?.label || requestBody.model,
      route,
      quantity: requestBody.n,
      aspectRatio: requestBody.aspect_ratio || requestBody.aspectRatio || null,
      outputSize: requestBody.image_size || requestBody.size || null,
      uiMode,
      status: "PENDING",
      meta: {
        transport: route.transport,
        routeMode: route.mode,
      },
    });

    const result = await executeGeminiNativeGenerate({
      route,
      requestBody,
      fallbackAuthorization,
      logTag: "Gemini Generate",
    });

    await completeGenerationRecordSuccessSafe({
      recordId: generationRecord?.id,
      resultUrls: extractResultUrlsFromPayload(result),
      outputSize: requestBody.image_size || requestBody.size || null,
      aspectRatio: requestBody.aspect_ratio || requestBody.aspectRatio || null,
      meta: {
        transport: route.transport,
        routeMode: route.mode,
      },
    });

    res.json({
      ...result,
      billing: {
        deductedPoints: pointCost,
        remainingPoints: billingCharge?.account?.points,
      },
    });
  } catch (error) {
    if (billingCharge?.chargeId) {
      await refundPoints(billingAccount.accountId, billingCharge.chargeId, {
        reason: "request_failed",
        routeId: chargeRouteId,
      });
    }
    await completeGenerationRecordFailureSafe({
      recordId: generationRecord?.id,
      errorMessage: error.message,
    });
    console.error("[Gemini Generate] Error:", error.message);
    if (error.cause) {
      console.error("[Gemini Generate] Error Cause:", {
        message: error.cause.message,
        code: error.cause.code,
        name: error.cause.name,
      });
    }
    if (error.response?.data) {
      console.error(
        "[Gemini Generate] Upstream response:",
        JSON.stringify(error.response.data),
      );
    }
    logger.error({
      timestamp: new Date().toISOString(),
      type: "Gemini Generate Error",
      message: error.message,
      status: error.response?.status,
      response: error.response?.data,
    });
    respondWithUserFacingGenerationError(res, error, 500);
  }
});
// ==================== Video Generation ====================
app.post("/api/video/generate", generateLimiter, async (req, res) => {
  let generationRecord = null;
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const requestBody = req.body;
    const uiMode = normalizeGenerationUiMode(requestBody?.uiMode);
    const route = await resolveVideoRoute(requestBody?.routeId);
    const requestedVideoModel = await resolveRequestedVideoModel(requestBody);
    if (!route) {
      return sendUserFacingGenerationError(res, 400);
    }

    delete requestBody.routeId;
    delete requestBody.modelId;
    delete requestBody.uiMode;
    requestBody.model = getRouteModelName(
      route,
      requestBody,
      requestedVideoModel?.requestModel || requestBody.model,
    );

    const useUserProvidedApiKey = shouldUseUserProvidedApiKey(
      route,
      fallbackAuthorization,
    );
    const userKey = getRouteAuthorization(route, fallbackAuthorization, {
      preferUserProvided: useUserProvidedApiKey,
    });

    // Detailed File Logging
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "Video Request",
      routeId: route.id,
      modelId: requestedVideoModel?.id || null,
      keys: Object.keys(requestBody),
      has_image_url: !!requestBody.image_url,
      has_image: !!requestBody.image,
      prompt: requestBody.prompt,
      model: requestBody.model,
      options: {
        aspect_ratio: requestBody.aspect_ratio,
        hd: requestBody.hd,
        duration: requestBody.duration,
      },
    };

    logger.info(logEntry);

    console.log("[Video Generate] Proxying request:", {
      routeId: route.id,
      modelId: requestedVideoModel?.id || null,
      model: requestBody.model,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image_url || !!requestBody.image,
    });

    // ---- Grok Video compatibility mapping ----
    // Grok upstream expects different field names, so normalize the request body before forwarding it.
    const upstreamBody = { ...requestBody };
    if (upstreamBody.model && String(upstreamBody.model).startsWith('grok-video')) {
      // aspect_ratio -> ratio
      if (upstreamBody.aspect_ratio !== undefined) {
        upstreamBody.ratio = upstreamBody.aspect_ratio;
        delete upstreamBody.aspect_ratio;
      }
      // hd -> resolution (720P / 1080P)
      upstreamBody.resolution = upstreamBody.hd ? '1080P' : '720P';
      delete upstreamBody.hd;
      // duration -> integer
      if (upstreamBody.duration !== undefined) {
        upstreamBody.duration = parseInt(upstreamBody.duration, 10);
      }
      // image / image_url -> images array
      if (upstreamBody.image || upstreamBody.image_url) {
        upstreamBody.images = [upstreamBody.image || upstreamBody.image_url];
        delete upstreamBody.image;
        delete upstreamBody.image_url;
      }
      console.log("[Video Generate] Grok remapped body:", JSON.stringify(Object.keys(upstreamBody)));
    }

    generationRecord = await buildGenerationRecordPayload({
      req,
      billingAccount: null,
      mediaType: "VIDEO",
      actionName: "video_generate",
      prompt: requestBody.prompt,
      modelId: requestedVideoModel?.id || null,
      modelName: requestedVideoModel?.label || requestBody.model,
      route,
      quantity: 1,
      aspectRatio: requestBody.aspect_ratio || upstreamBody.ratio || null,
      outputSize: upstreamBody.resolution || (requestBody.hd ? "1080P" : "720P"),
      uiMode,
      status: "PENDING",
      meta: {
        transport: route.transport,
        routeMode: route.mode,
        duration: requestBody.duration || null,
      },
    });

    const response = await requestWithRetry(
      () =>
        axios.post(
          buildRouteUrl(route, route.generatePath || "/v2/videos/generations"),
          upstreamBody,
          {
            headers: {
              Authorization: userKey,
              "Content-Type": "application/json",
            },
            timeout: 900000, // 900 seconds (15 minutes)
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 1, delayMs: 700, label: `video-generate-${route.id}` },
    );

    console.log("[Video Generate] Upstream response:", response.data);
    const upstreamTaskId =
      response.data?.id ||
      response.data?.task_id ||
      response.data?.data?.task_id;

    if (upstreamTaskId) {
      const localTaskId = buildVideoTaskToken(route.id, upstreamTaskId);
      if (generationRecord?.id) {
        await attachTaskToGenerationRecord(generationRecord.id, localTaskId);
      }
      const normalizedResponse = {
        ...response.data,
        id: localTaskId,
        task_id: localTaskId,
      };

      if (normalizedResponse.data && typeof normalizedResponse.data === "object") {
        normalizedResponse.data = {
          ...normalizedResponse.data,
          task_id: localTaskId,
        };
      }

      return res.json(normalizedResponse);
    }

    await completeGenerationRecordSuccessSafe({
      recordId: generationRecord?.id,
      resultUrls: extractResultUrlsFromPayload(response.data),
      outputSize: upstreamBody.resolution || (requestBody.hd ? "1080P" : "720P"),
      aspectRatio: requestBody.aspect_ratio || upstreamBody.ratio || null,
      meta: {
        transport: route.transport,
        routeMode: route.mode,
        duration: requestBody.duration || null,
      },
    });

    res.json(response.data);
  } catch (error) {
    await completeGenerationRecordFailureSafe({
      recordId: generationRecord?.id,
      errorMessage: error.message,
    });
    console.error("[Video Generate] Error:", error.message);
    respondWithUserFacingGenerationError(res, error, 500);
  }
});

// ==================== Video Task Polling ====================
app.get("/api/video/task/:taskId", pollingLimiter, async (req, res) => {
  try {
    const fallbackAuthorization = req.headers["authorization"];
    const encodedTaskId = String(req.params.taskId || "").trim();
    const decodedTask = parseVideoTaskToken(encodedTaskId);
    const route =
      (decodedTask?.routeId
        ? await getVideoRouteById(decodedTask.routeId, {
            includeInactive: true,
            includeSecrets: true,
          })
        : null) || (await resolveVideoRoute(undefined, { includeInactive: true }));

    if (!route?.taskPath) {
      return sendUserFacingGenerationError(res, 400);
    }

    const useUserProvidedApiKey = shouldUseUserProvidedApiKey(
      route,
      fallbackAuthorization,
    );
    const userKey = getRouteAuthorization(route, fallbackAuthorization, {
      preferUserProvided: useUserProvidedApiKey,
    });
    const upstreamTaskId = decodedTask?.upstreamTaskId || encodedTaskId;
    const url = buildRouteUrl(route, route.taskPath, { taskId: upstreamTaskId });
    console.log(`[Video Task Poll] Requesting: ${url}`);

    const response = await requestWithRetry(
      () =>
        axios.get(url, {
          headers: {
            Authorization: userKey,
            "Content-Type": "application/json",
          },
          timeout: 10000,
          httpsAgent: SHARED_HTTPS_AGENT,
        }),
      { retries: 2, delayMs: 350, label: `video-task-poll-${route.id}` },
    );

    logger.info({
      timestamp: new Date().toISOString(),
      type: "Poll Response",
      taskId: upstreamTaskId,
      responsePreview: JSON.stringify(response.data).substring(0, 1000),
    });

    console.log(
      "[Video Task Poll] Response:",
      JSON.stringify(response.data).substring(0, 500),
    );

    const taskStatus = extractResultStatus(response.data);
    if (["SUCCESS", "SUCCEEDED", "COMPLETED"].includes(taskStatus)) {
      await completeGenerationRecordSuccessSafe({
        taskId: encodedTaskId,
        resultUrls: extractResultUrlsFromPayload(response.data),
        meta: {
          polledAt: new Date().toISOString(),
          source: "video_task_poll",
        },
      });
    } else if (["FAILURE", "FAILED"].includes(taskStatus)) {
      await completeGenerationRecordFailureSafe({
        taskId: encodedTaskId,
        errorMessage:
          response.data?.error ||
          response.data?.message ||
          response.data?.fail_reason ||
          "Video task failed",
        meta: {
          polledAt: new Date().toISOString(),
          source: "video_task_poll",
        },
      });
    }

    res.json(response.data);
  } catch (error) {
    console.error("[Video Task Poll] Error:", error.message);
    respondWithUserFacingGenerationError(res, error, 500);
  }
});

// ==================== Shared Prompt Tool Helpers ====================
// Shared model fallback for prompt tools
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-po-preview",
  "gemini-3-flash-preview",
];

function buildGeminiGenerateEndpoint(model) {
  return `https://api.bltcy.ai/v1beta/models/${model}:generateContent`;
}

async function postGeminiWithFallback({
  models,
  payload,
  userKey,
  timeout,
  logTag,
  extraAxiosConfig = {},
}) {
  let lastError;
  for (const model of models) {
    const endpoint = buildGeminiGenerateEndpoint(model);
    try {
      const response = await requestWithRetry(
        () =>
          axios.post(
            endpoint,
            payload,
            {
              headers: {
                Authorization: userKey,
                "Content-Type": "application/json",
              },
              timeout,
              httpsAgent: SHARED_HTTPS_AGENT,
              ...extraAxiosConfig,
            },
          ),
        { retries: 1, delayMs: 500, label: `${logTag}-${model}` },
      );

      if (model !== models[0]) {
        console.warn(`[${logTag}] Fallback succeeded with model: ${model}`);
      }

      return { response, model };
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.code || "unknown";
      console.warn(`[${logTag}] Model ${model} failed:`, status);
    }
  }

  throw lastError;
}

app.post("/api/optimize-prompt", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || String(userKey).length < 10) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    const { prompt, type = "IMAGE" } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const geminiModels = [...GEMINI_FALLBACK_MODELS];
    const isVideo = String(type).toUpperCase() === "VIDEO";
    const systemInstruction = isVideo
      ? "You are a professional video prompt optimizer. Return exactly 3 Chinese prompt options in JSON array format: [{\"style\":\"...\",\"prompt\":\"...\"}]. No markdown."
      : "You are a professional image prompt optimizer. Return exactly 3 Chinese prompt options in JSON array format: [{\"style\":\"...\",\"prompt\":\"...\"}]. No markdown.";

    const { response, model: usedModel } = await postGeminiWithFallback({
      models: geminiModels,
      payload: {
        contents: [{ parts: [{ text: String(prompt) }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      },
      userKey,
      timeout: 30000,
      logTag: "Optimize",
    });

    if (usedModel !== geminiModels[0]) {
      console.log(`[Optimize] Fallback model in use: ${usedModel}`);
    }

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(500).json({ error: "Optimize failed: empty response" });
    }

    let options;
    try {
      let cleaned = String(rawText).trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();
      options = JSON.parse(cleaned);
      if (!Array.isArray(options) || options.length === 0) throw new Error("Invalid options format");
    } catch (parseError) {
      return res.json({
        success: true,
        options: [{ style: "优化结果", prompt: String(rawText).trim() }],
      });
    }

    return res.json({ success: true, options });
  } catch (error) {
    console.error("[Optimize] Error:", error.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data?.error?.message || "Optimize request failed" });
    }
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Optimize request timeout" });
    }
    return res.status(500).json({ error: error.message || "Optimize request failed" });
  }
});

// ==================== Reverse Prompt API ====================
app.post("/api/reverse-prompt", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || String(userKey).length < 10) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    const image = req.body?.image;
    if (!image) {
      return res.status(400).json({ error: "Image is required" });
    }

    const base64Image = String(image).replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    const geminiModels = [...GEMINI_FALLBACK_MODELS];
    const systemInstruction =
      "You are a senior visual designer. Analyze the input image and output one detailed Chinese generation prompt. Output plain text only.";

    const { response, model: usedModel } = await postGeminiWithFallback({
      models: geminiModels,
      payload: {
        contents: [
          {
            parts: [
              { text: "Generate one detailed Chinese prompt from this image." },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image,
                },
              },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      },
      userKey,
      timeout: 300000,
      logTag: "Reverse",
      extraAxiosConfig: {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    });

    if (usedModel !== geminiModels[0]) {
      console.log(`[Reverse] Fallback model in use: ${usedModel}`);
    }

    const resultPrompt = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultPrompt) {
      return res.status(500).json({ error: "Reverse failed: empty response" });
    }

    return res.json({ success: true, prompt: String(resultPrompt).trim() });
  } catch (error) {
    console.error("[Reverse] Error:", error.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data?.error?.message || "Reverse request failed" });
    }
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Reverse request timeout" });
    }
    return res.status(500).json({ error: error.message || "Reverse request failed" });
  }
});

// ==================== Announcement APIs ====================
const ANNOUNCEMENT_FILE = path.join(__dirname, 'announcement.json');
const ANNOUNCEMENT_UPLOAD_ROOT = path.join(__dirname, 'uploads');
const ANNOUNCEMENT_UPLOAD_DIR = path.join(ANNOUNCEMENT_UPLOAD_ROOT, 'announcements');
const sortAnnouncements = (items = []) =>
  [...items].sort((a, b) => {
    const ap = a?.pinned === true ? 1 : 0;
    const bp = b?.pinned === true ? 1 : 0;
    if (ap !== bp) return bp - ap; // pinned first
    return new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime();
  });

const normalizeAnnouncement = (item) => {
  const nowIso = new Date().toISOString();
  const imageList = Array.isArray(item?.images)
    ? item.images
        .map((url) => String(url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('/uploads/'))
    : [];
  return {
    id: String(item?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    date: item?.date || nowIso,
    title: item?.title || "系统公告",
    content: item?.content || "",
    active: item?.active === true,
    pinned: item?.pinned === true,
    images: imageList
  };
};
const readAnnouncementList = () => {
  if (!fs.existsSync(ANNOUNCEMENT_FILE)) return [];
  const data = fs.readFileSync(ANNOUNCEMENT_FILE, 'utf8').trim();
  if (!data) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    console.error("[Announcement] Parse Error:", error);
    return [];
  }
  let items = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && Array.isArray(parsed.items)) {
    items = parsed.items;
  } else if (parsed && typeof parsed === 'object') {
    items = [parsed];
  }
  return items
    .map(normalizeAnnouncement)
    .filter((item) => item.content && String(item.content).trim().length > 0);
};
const writeAnnouncementList = (items) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeAnnouncement);
  const sorted = sortAnnouncements(normalized);
  fs.writeFileSync(ANNOUNCEMENT_FILE, JSON.stringify(sorted, null, 2), 'utf8');
  return sorted;
};
const verifyAnnouncementAdmin = async (req) => {
  try {
    await requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        status: error.code === "AUTH_LOGIN_REQUIRED" ? 401 : 403,
        error: error.message,
      };
    }
    return { ok: false, status: 500, error: "Administrator verification failed" };
  }
};

const parseDataUrlImage = (value) => {
  const raw = String(value || "").trim();
  const m = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  const extMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extMap[mime];
  if (!ext) return null;
  const base64 = m[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return null;
  return { mime, ext, buffer };
};

// Admin image upload for announcements (supports multiple base64 data URLs)
app.post("/api/announcement/images", async (req, res) => {
  try {
    const auth = await verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) {
      return res.status(400).json({ error: "Please upload at least one image" });
    }
    if (images.length > 9) {
      return res.status(400).json({ error: "You can upload up to 9 images" });
    }

    fs.mkdirSync(ANNOUNCEMENT_UPLOAD_DIR, { recursive: true });

    const urls = [];
    for (let i = 0; i < images.length; i++) {
      const parsed = parseDataUrlImage(images[i]);
      if (!parsed) {
        return res.status(400).json({ error: `Image ${i + 1} format is invalid` });
      }
      // 10MB per image
      if (parsed.buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: `Image ${i + 1} exceeds the 10MB limit` });
      }
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i + 1}.${parsed.ext}`;
      const filePath = path.join(ANNOUNCEMENT_UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, parsed.buffer);
      urls.push(`/uploads/announcements/${filename}`);
    }

    return res.json({ success: true, urls });
  } catch (error) {
    console.error("[Announcement] Upload Image Error:", error);
    return res.status(500).json({ error: "公告图片上传失败" });
  }
});
// Public announcement list returns active items only; admin can request all items with `all=1`.
app.get("/api/announcements", announcementLimiter, async (req, res) => {
  try {
    const allItems = sortAnnouncements(readAnnouncementList());
    const wantsAll = String(req.query?.all || "").toLowerCase() === '1' || String(req.query?.all || "").toLowerCase() === 'true';
    if (wantsAll) {
      const auth = await verifyAnnouncementAdmin(req);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    }

    const search = String(req.query?.search || "").trim().toLowerCase();
    const pageRaw = Number.parseInt(String(req.query?.page || "1"), 10);
    const pageSizeRaw = Number.parseInt(String(req.query?.pageSize || "10"), 10);
    const page = Number.isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);
    const pageSize = Number.isNaN(pageSizeRaw) ? 10 : Math.min(50, Math.max(1, pageSizeRaw));

    const visibilityFiltered = wantsAll ? allItems : allItems.filter((item) => item.active);
    const searched = search
      ? visibilityFiltered.filter((item) =>
          `${item.title || ""} ${item.content || ""}`.toLowerCase().includes(search)
        )
      : visibilityFiltered;

    const total = searched.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const items = searched.slice(start, start + pageSize);

    return res.json({
      items,
      total,
      page: safePage,
      pageSize,
      totalPages,
      search
    });
  } catch (error) {
    console.error("[Announcement] List Error:", error);
    res.status(500).json({ error: "无法读取公告列表" });
  }
});

// Legacy single announcement endpoint
app.get("/api/announcement", announcementLimiter, (req, res) => {
  try {
    const activeItems = sortAnnouncements(readAnnouncementList().filter((item) => item.active));
    if (activeItems.length === 0) {
      return res.json({ active: false, content: "", id: "", title: "", date: "", pinned: false });
    }
    res.json(activeItems[0]);
  } catch (error) {
    console.error("[Announcement] Read Error:", error);
    res.status(500).json({ error: "无法读取公告数据" });
  }
});
// Create announcement (Admin)
app.post("/api/announcement", async (req, res) => {
  try {
    const auth = await verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { content, title, active, pinned, images } = req.body;
    const safeContent = String(content || "").trim();
    if (!safeContent) {
      return res.status(400).json({ error: "公告内容不能为空" });
    }
    const newAnnouncement = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
      title: String(title || "系统公告"),
      content: safeContent,
      active: active === true,
      pinned: pinned === true,
      images: Array.isArray(images) ? images : []
    };
    const allItems = readAnnouncementList();
    const nextItems = writeAnnouncementList([newAnnouncement, ...allItems]);
    console.log("[Announcement] Created:", newAnnouncement.id);
    res.json({ success: true, announcement: newAnnouncement, items: nextItems });
  } catch (error) {
    console.error("[Announcement] Write Error:", error);
    res.status(500).json({ error: "发布公告失败" });
  }
});

// Update announcement fields (Admin) - supports pinned/active/title/content
app.patch("/api/announcement/:id", async (req, res) => {
  try {
    const auth = await verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const targetId = String(req.params.id || "");
    if (!targetId) {
      return res.status(400).json({ error: "缺少公告 ID" });
    }

    const allItems = readAnnouncementList();
    const idx = allItems.findIndex((item) => item.id === targetId);
    if (idx < 0) {
      return res.status(404).json({ error: "Announcement does not exist or was deleted" });
    }

    const current = normalizeAnnouncement(allItems[idx]);
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "pinned")) {
      next.pinned = req.body.pinned === true;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "active")) {
      next.active = req.body.active === true;
    }
    if (typeof req.body?.title === "string") {
      next.title = req.body.title.trim() || current.title;
    }
    if (typeof req.body?.content === "string") {
      const content = req.body.content.trim();
      if (!content) return res.status(400).json({ error: "公告内容不能为空" });
      next.content = content;
    }
    if (Array.isArray(req.body?.images)) {
      next.images = req.body.images;
    }
    next.date = new Date().toISOString();

    const merged = [...allItems];
    merged[idx] = next;
    const items = writeAnnouncementList(merged);

    return res.json({ success: true, announcement: next, items });
  } catch (error) {
    console.error("[Announcement] Patch Error:", error);
    res.status(500).json({ error: "更新公告失败" });
  }
});
// Delete announcement (Admin)
app.delete("/api/announcement/:id", async (req, res) => {
  try {
    const auth = await verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const targetId = String(req.params.id || "");
    if (!targetId) {
      return res.status(400).json({ error: "缺少公告 ID" });
    }
    const allItems = readAnnouncementList();
    const nextItems = allItems.filter((item) => item.id !== targetId);
    if (nextItems.length === allItems.length) {
      return res.status(404).json({ error: "Announcement does not exist or was deleted" });
    }
    writeAnnouncementList(nextItems);
    console.log("[Announcement] Deleted:", targetId);
    res.json({ success: true, deletedId: targetId, items: nextItems });
  } catch (error) {
    console.error("[Announcement] Delete Error:", error);
    res.status(500).json({ error: "删除公告失败" });
  }
});

// ==================== Static Files ====================
app.use('/uploads', express.static(ANNOUNCEMENT_UPLOAD_ROOT));
app.use(express.static(path.join(__dirname, 'dist')));

app.get(['/create/classic', '/create/classic/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'classic-app', 'index.html'));
});

app.get(['/create/canvas', '/create/canvas/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ==================== Health Check ====================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Handle React routing, return all requests to React app
// MUST be the last route
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`   Upstream API: ${UPSTREAM_URL}`);
});
