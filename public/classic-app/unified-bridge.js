(() => {
  const API_BASE_URL =
    typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:3355/api"
      : "/api";
  const AUTH_SESSION_STORAGE_KEY = "auth-session-v1";
  const CLASSIC_AUTH_MODE_KEY = "classic-auth-mode";
  const MODEL_STORAGE_KEY = "nb_image_model";
  const LINE_STORAGE_KEY = "nb_line";
  const KEY_STORAGE_KEY = "nb_key";
  const USER_FACING_GENERATION_ERROR_MESSAGE =
    "请检查提示词或参考图，可能触发了安全限制，请更换后重试";
  const SIZE_LABELS = {
    "1k": "1K (标准)",
    "2k": "2K (高清)",
    "3k": "3K (高精)",
    "4k": "4K (超清)",
  };
  const MODEL_ICONS = {
    banana: "🍌🍌",
    "banana-zap": "🍌⚡",
    sparkles: "✨",
    layers: "🧩",
    zap: "⚡",
    none: "",
  };

  const LEDGER_TYPE_LABELS = {
    signup: "注册赠送",
    recharge: "管理员充值",
    charge: "生成扣点",
    refund: "失败退款",
    admin_credit: "管理员加点",
    admin_debit: "管理员减点",
    redeem_code: "兑换码到账",
  };
  const POSITIVE_LEDGER_TYPES = new Set([
    "signup",
    "recharge",
    "refund",
    "admin_credit",
    "redeem_code",
  ]);

  let bridgeModelCatalog = {
    defaultModelId: "",
    models: [],
  };
  let bridgeRouteCatalog = {
    defaultRouteId: "",
    defaultNanoBananaLine: "line1",
    routes: [],
  };
  let bridgeAuthState = {
    user: null,
    account: null,
    ledger: null,
    redeemedCode: null,
    registrationStatus: null,
    passwordPanelOpen: false,
  };
  const remotePendingPollRegistry = new Set();

  const cleanUrl = (url) => String(url || "").replace(/\/$/, "");
  const escapeHtmlText = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const sanitizeApiKey = (value) =>
    String(value || "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim();
  const normalizeAuthorization = (value) => {
    const cleaned = sanitizeApiKey(value);
    if (!cleaned) return "";
    return /^Bearer\s+/i.test(cleaned) ? cleaned : `Bearer ${cleaned}`;
  };
  const toPointNumber = (value, fallback = 0) => {
    const parsed = Number.parseFloat(String(value ?? fallback));
    const numeric = Number.isFinite(parsed) ? parsed : Number.parseFloat(String(fallback || 0));
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 10) / 10;
  };
  const formatPointValue = (value) => toPointNumber(value, 0).toFixed(1);
  const formatCoinLabel = (value) => {
    const numeric = toPointNumber(value, 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    return `${formatPointValue(numeric)} 🪙`;
  };
  const getStoredSessionToken = () => {
    try {
      return String(localStorage.getItem(AUTH_SESSION_STORAGE_KEY) || "").trim() || null;
    } catch (_) {
      return null;
    }
  };
  const setStoredSessionToken = (token) => {
    try {
      const cleaned = String(token || "").trim();
      if (cleaned) {
        localStorage.setItem(AUTH_SESSION_STORAGE_KEY, cleaned);
      } else if (false) {
        localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      }
      window.dispatchEvent(new Event("auth-session-change"));
    } catch (_) {}
  };
  const clearStoredSessionToken = () => setStoredSessionToken("");
  const getStoredApiKey = () => {
    const input = document.getElementById("apiKey");
    const inputValue = sanitizeApiKey(input?.value || "");
    if (inputValue) return inputValue;
    try {
      return sanitizeApiKey(localStorage.getItem(KEY_STORAGE_KEY) || "");
    } catch (_) {
      return "";
    }
  };
  const setStoredApiKey = (nextValue) => {
    const cleaned = sanitizeApiKey(nextValue);
    const input = document.getElementById("apiKey");
    if (input && input.value !== cleaned) input.value = cleaned;
    try {
      if (cleaned) {
        localStorage.setItem(KEY_STORAGE_KEY, cleaned);
      } else {
        localStorage.removeItem(KEY_STORAGE_KEY);
      }
    } catch (_) {}
    if (typeof updateApiStatusUI === "function") {
      updateApiStatusUI(Boolean(cleaned));
    }
  };
  const buildSessionHeaders = () => {
    const token = getStoredSessionToken();
    return token ? { "X-Auth-Session": token } : {};
  };
  const buildApiKeyHeaders = (apiKey) => {
    const authorization = normalizeAuthorization(apiKey);
    return authorization ? { Authorization: authorization } : {};
  };
  const isSessionAuthenticated = () => Boolean(getStoredSessionToken() && bridgeAuthState.user);
  const isApiKeyCompatibilityMode = () => !isSessionAuthenticated() && Boolean(getStoredApiKey());
  const showAuthStatus = (message, kind = "info") => {
    ["classicAuthStatus", "classicAuthLoggedInStatus"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(message || "");
      el.classList.remove("is-error", "is-success");
      if (kind === "error") el.classList.add("is-error");
      if (kind === "success") el.classList.add("is-success");
    });
  };
  const clearAuthStatus = () => showAuthStatus("");
  const fetchJson = async (path, options = {}) => {
    const response = await fetch(`${cleanUrl(API_BASE_URL)}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || data?.message || "Request failed");
    }
    return data;
  };
  const formatClassicPoints = (value) => `${formatPointValue(value)} 点`;
  const formatClassicDateTime = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  };
  const isPositiveLedgerType = (type) => POSITIVE_LEDGER_TYPES.has(String(type || "").trim());
  const getClassicLedgerTypeLabel = (type) =>
    LEDGER_TYPE_LABELS[String(type || "").trim()] || String(type || "点数流水").trim() || "点数流水";
  const getClassicLedgerMetaText = (entry) => {
    if (!entry?.meta || typeof entry.meta !== "object") return "";
    const meta = entry.meta;
    return [
      String(meta.note || "").trim(),
      String(meta.code || "").trim(),
      String(meta.routeId || "").trim(),
      String(meta.taskId || "").trim(),
    ]
      .filter(Boolean)
      .join(" / ");
  };
  const setClassicRedeemStatus = (message = "", kind = "info") => {
    const el = document.getElementById("classicRedeemStatus");
    if (!el) return;
    el.textContent = String(message || "");
    el.classList.remove("is-error", "is-success");
    if (kind === "error") el.classList.add("is-error");
    if (kind === "success") el.classList.add("is-success");
  };
  const renderClassicRedeemResult = () => {
    const panel = document.getElementById("classicRedeemResult");
    if (!panel) return;

    const redeemedCode = bridgeAuthState.redeemedCode;
    if (!bridgeAuthState.user || !redeemedCode?.code) {
      panel.style.display = "none";
      panel.textContent = "";
      return;
    }

    panel.style.display = "block";
    panel.textContent = `最近兑换：${formatClassicPoints(redeemedCode.points)} / ${redeemedCode.code} / ${formatClassicDateTime(redeemedCode.redeemedAt)}`;
  };
  const renderClassicLedger = () => {
    const list = document.getElementById("classicLedgerList");
    const emptyState = document.getElementById("classicLedgerEmptyState");
    if (!list || !emptyState) return;

    if (!bridgeAuthState.user) {
      list.innerHTML = "";
      emptyState.style.display = "none";
      return;
    }

    const entries = Array.isArray(bridgeAuthState.ledger?.entries) ? bridgeAuthState.ledger.entries : [];
    if (entries.length === 0) {
      list.innerHTML = "";
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    list.innerHTML = entries
      .map((entry) => {
        const positive = isPositiveLedgerType(entry.type);
        const metaText = getClassicLedgerMetaText(entry);
        const deltaText = `${positive ? "+" : "-"}${formatPointValue(entry.points || 0)}`;
        return `
          <div class="classic-ledger-item">
            <div class="classic-ledger-top">
              <div class="classic-ledger-title">${escapeHtmlText(getClassicLedgerTypeLabel(entry.type))}</div>
              <div class="classic-ledger-delta ${positive ? "positive" : "negative"}">${escapeHtmlText(deltaText)}</div>
            </div>
            <div class="classic-ledger-bottom">
              <span>${escapeHtmlText(formatClassicDateTime(entry.createdAt))}</span>
              <span>余额 ${escapeHtmlText(formatClassicPoints(entry.balanceAfter))}</span>
            </div>
            ${metaText ? `<div class="classic-ledger-meta">${escapeHtmlText(metaText)}</div>` : ""}
          </div>
        `;
      })
      .join("");
  };
  const normalizeModel = (raw = {}) => ({
    id: String(raw.id || "").trim(),
    label: String(raw.label || raw.id || "Image Model").trim(),
    description: String(raw.description || "").trim(),
    modelFamily: String(raw.modelFamily || raw.id || "default").trim(),
    routeFamily: String(raw.routeFamily || raw.modelFamily || "default").trim(),
    requestModel: String(raw.requestModel || "").trim(),
    selectorCost: toPointNumber(raw.selectorCost || 0, 0),
    iconKind: String(raw.iconKind || "none").trim(),
    panelLayout: String(raw.panelLayout || "default").trim(),
    sizeBehavior: String(raw.sizeBehavior || "passthrough").trim(),
    defaultSize: String(raw.defaultSize || "1k").trim().toLowerCase(),
    sizeOptions: Array.isArray(raw.sizeOptions)
      ? raw.sizeOptions.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : ["1k"],
    extraAspectRatios: Array.isArray(raw.extraAspectRatios)
      ? raw.extraAspectRatios.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    showSizeSelector: raw.showSizeSelector !== false,
    supportsCustomRatio: raw.supportsCustomRatio !== false,
    isActive: raw.isActive !== false,
    isDefaultModel: raw.isDefaultModel === true,
    sortOrder: Number(raw.sortOrder || 0),
  });
  const normalizeSizeKey = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return ["1k", "2k", "4k"].includes(normalized) ? normalized : "";
  };
  const normalizeTransport = (route) =>
    String(route?.transport || "openai-image").trim().toLowerCase();
  const normalizeRouteMode = (route) => String(route?.mode || "async").trim().toLowerCase();
  const isGeminiNativeClassicRoute = (route) => normalizeTransport(route) === "gemini-native";
  const isGptImage2ClassicModel = (model, route) =>
    String(model?.id || "").trim() === "gpt-image-2" ||
    String(model?.requestModel || "").trim() === "gpt-image-2" ||
    String(route?.modelFamily || "").trim() === "gpt-image-2";
  const GPT_SIZE_PATTERN = /^(\d+)\s*x\s*(\d+)$/i;
  const GPT_RATIO_PATTERN = /^(\d+)\s*:\s*(\d+)$/;
  const roundToMultiple = (value, step = 16) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return step;
    }
    return Math.max(step, Math.round(numeric / step) * step);
  };
  const normalizeClassicGptImageSize = (size) => {
    const trimmed = String(size || "").trim().toLowerCase();
    const match = trimmed.match(GPT_SIZE_PATTERN);
    if (!match) return trimmed;
    const width = roundToMultiple(Number(match[1]), 16);
    const height = roundToMultiple(Number(match[2]), 16);
    return `${width}x${height}`;
  };
  const parseClassicGptRatio = (ratio) => {
    const match = String(ratio || "").trim().match(GPT_RATIO_PATTERN);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  };
  const calculateClassicGptImageSize = (size, ratio) => {
    const normalizedSize = String(size || "").trim().toLowerCase();
    if (!normalizedSize || normalizedSize === "auto") return "auto";
    if (GPT_SIZE_PATTERN.test(normalizedSize)) {
      return normalizeClassicGptImageSize(normalizedSize);
    }

    const tier =
      normalizedSize === "4k" ? "4k" : normalizedSize === "2k" ? "2k" : "1k";
    const parsedRatio = parseClassicGptRatio(ratio) || { width: 1, height: 1 };
    const ratioWidth = parsedRatio.width;
    const ratioHeight = parsedRatio.height;

    if (ratioWidth === ratioHeight) {
      const side = tier === "1k" ? 1024 : tier === "2k" ? 2048 : 3840;
      return `${side}x${side}`;
    }

    if (tier === "1k") {
      const shortSide = 1024;
      const width =
        ratioWidth > ratioHeight
          ? roundToMultiple((shortSide * ratioWidth) / ratioHeight, 16)
          : shortSide;
      const height =
        ratioWidth > ratioHeight
          ? shortSide
          : roundToMultiple((shortSide * ratioHeight) / ratioWidth, 16);
      return `${width}x${height}`;
    }

    const longSide = tier === "2k" ? 2048 : 3840;
    const width =
      ratioWidth > ratioHeight
        ? longSide
        : roundToMultiple((longSide * ratioWidth) / ratioHeight, 16);
    const height =
      ratioWidth > ratioHeight
        ? roundToMultiple((longSide * ratioHeight) / ratioWidth, 16)
        : longSide;
    return `${width}x${height}`;
  };
  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string" && reader.result.trim()) {
          resolve(reader.result);
          return;
        }
        reject(new Error("Failed to convert blob to data URL"));
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });
  const normalizeReferenceToDataUrl = async (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    if (normalized.startsWith("data:image/")) return normalized;
    if (
      normalized.startsWith("http://") ||
      normalized.startsWith("https://") ||
      normalized.startsWith("blob:") ||
      normalized.startsWith("/")
    ) {
      const response = await fetch(normalized);
      if (!response.ok) {
        throw new Error(`Failed to load reference image: ${response.status}`);
      }
      const blob = await response.blob();
      return blobToDataUrl(blob);
    }
    return `data:image/png;base64,${normalized}`;
  };
  const parseDataUrlImage = (value) => {
    const match = String(value || "")
      .trim()
      .match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return {
      mimeType: match[1],
      data: match[2],
    };
  };
  const normalizeSizeOverrides = (overrides) => {
    const next = {};
    if (!overrides || typeof overrides !== "object") {
      return next;
    }

    Object.entries(overrides).forEach(([rawKey, rawValue]) => {
      const key = normalizeSizeKey(rawKey);
      const parsedPointCost = Number.parseFloat(String(rawValue?.pointCost ?? ""));
      if (!key || !Number.isFinite(parsedPointCost) || parsedPointCost < 0) {
        return;
      }
      const pointCost = toPointNumber(parsedPointCost, 0);
      next[key] = { pointCost };
    });

    return next;
  };
  const normalizeRoute = (raw = {}) => ({
    id: String(raw.id || "").trim(),
    label: String(raw.label || raw.id || "Route").trim(),
    modelFamily: String(raw.modelFamily || "default").trim(),
    line: String(raw.line || "default").trim(),
    transport: String(raw.transport || "openai-image").trim(),
    mode: String(raw.mode || "async").trim(),
    pointCost: toPointNumber(raw.pointCost || 0, 0),
    sizeOverrides: normalizeSizeOverrides(raw.sizeOverrides),
    isActive: raw.isActive !== false,
    isDefaultRoute: raw.isDefaultRoute === true,
    isDefaultNanoBananaLine: raw.isDefaultNanoBananaLine === true,
    allowUserApiKeyWithoutLogin: raw.allowUserApiKeyWithoutLogin === true,
    sortOrder: Number(raw.sortOrder || 0),
  });
  const getAllModels = () =>
    [...(bridgeModelCatalog.models || [])]
      .filter((model) => model.id && model.isActive !== false)
      .sort((left, right) => {
        if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
          return (left.sortOrder || 0) - (right.sortOrder || 0);
        }
        return left.label.localeCompare(right.label);
      });
  const getRoutesForModel = (modelId) => {
    const model =
      getAllModels().find((item) => item.id === modelId) ||
      bridgeModelCatalog.models.find((item) => item.id === modelId) ||
      null;
    const family = String(model?.routeFamily || model?.modelFamily || "default").trim() || "default";
    return [...(bridgeRouteCatalog.routes || [])]
      .filter((route) => route.isActive !== false && route.modelFamily === family)
      .sort((left, right) => {
        if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
          return (left.sortOrder || 0) - (right.sortOrder || 0);
        }
        return left.label.localeCompare(right.label);
      });
  };
  const getVisibleModels = () => {
    const models = getAllModels();
    if (!isApiKeyCompatibilityMode()) return models;
    return models.filter((model) =>
      getRoutesForModel(model.id).some((route) => route.allowUserApiKeyWithoutLogin === true),
    );
  };
  const getFriendlyRouteLabel = (route) => {
    const line = String(route?.line || "").trim();
    const match = line.match(/^line\s*([0-9]+)$/i);
    if (match?.[1]) return `Line ${match[1]}`;
    if (line.toLowerCase() === "default") return "默认线路";
    return String(route?.label || route?.id || "Route").trim() || "Route";
  };
  const getCurrentModel = () => {
    const visibleModels = getVisibleModels();
    const storedValue =
      String(localStorage.getItem(MODEL_STORAGE_KEY) || imageModel || bridgeModelCatalog.defaultModelId || "").trim();
    const selected =
      visibleModels.find((model) => model.id === storedValue) ||
      visibleModels.find((model) => model.id === bridgeModelCatalog.defaultModelId) ||
      visibleModels[0] ||
      null;
    if (selected) {
      imageModel = selected.id;
      localStorage.setItem(MODEL_STORAGE_KEY, selected.id);
    }
    return selected;
  };
  const getVisibleRoutesForCurrentModel = () => {
    const currentModel = getCurrentModel();
    if (!currentModel) return [];
    const routes = getRoutesForModel(currentModel.id);
    if (!isApiKeyCompatibilityMode()) return routes;
    return routes.filter((route) => route.allowUserApiKeyWithoutLogin === true);
  };
  const getCurrentRoute = () => {
    const visibleRoutes = getVisibleRoutesForCurrentModel();
    if (visibleRoutes.length === 0) return null;
    const storedLine = String(localStorage.getItem(LINE_STORAGE_KEY) || "").trim();
    const selected =
      visibleRoutes.find((route) => route.line === storedLine) ||
      visibleRoutes.find((route) => route.isDefaultRoute) ||
      visibleRoutes.find((route) => route.isDefaultNanoBananaLine) ||
      visibleRoutes[0];
    if (selected) {
      localStorage.setItem(LINE_STORAGE_KEY, selected.line);
    }
    return selected;
  };
  const getCurrentSelectedSize = () => {
    const selectedValue = String(
      document.getElementById("sizePill")?.getAttribute("data-selected-value") || "",
    )
      .trim()
      .toLowerCase();
    const model = getCurrentModel();
    const options =
      Array.isArray(model?.sizeOptions) && model.sizeOptions.length > 0
        ? model.sizeOptions
        : [model?.defaultSize || "1k"];
    return options.includes(selectedValue) ? selectedValue : options[0];
  };
  const buildClassicGeminiSubmitPlan = async ({
    prompt,
    ratio,
    size,
    selectedModel,
    selectedRoute,
    submitRefImages,
  }) => {
    const parts = [{ text: prompt }];
    const normalizedDataUrls = (
      await Promise.all((submitRefImages || []).map((value) => normalizeReferenceToDataUrl(value)))
    ).filter(Boolean);

    normalizedDataUrls.forEach((dataUrl) => {
      const parsed = parseDataUrlImage(dataUrl);
      if (!parsed) return;
      parts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        },
      });
    });

    return {
      submitUrl: `${cleanUrl(API_BASE_URL)}/gemini/generate`,
      payload: {
        uiMode: "classic",
        routeId: selectedRoute.id,
        modelId: selectedModel.id,
        model: selectedModel.requestModel || selectedModel.id,
        prompt,
        aspect_ratio: ratio,
        image_size: size,
        strict_native_config: true,
        n: 1,
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          imageConfig: {
            aspectRatio: ratio,
            imageSize: size,
          },
          candidateCount: 1,
        },
      },
    };
  };
  const buildClassicGptSubmitPlan = async ({
    prompt,
    ratio,
    size,
    selectedModel,
    selectedRoute,
    submitRefImages,
  }) => {
    const normalizedSize = calculateClassicGptImageSize(size, ratio);
    const normalizedDataUrls = (
      await Promise.all((submitRefImages || []).map((value) => normalizeReferenceToDataUrl(value)))
    ).filter(Boolean);
    const payload = {
      uiMode: "classic",
      routeId: selectedRoute.id,
      modelId: selectedModel.id,
      model: "gpt-image-2",
      prompt,
      size: normalizedSize,
      quality: "auto",
      output_format: "png",
      moderation: "auto",
      n: 1,
    };

    if (normalizedDataUrls.length > 0) {
      payload.images = normalizedDataUrls;
      return {
        submitUrl: `${cleanUrl(API_BASE_URL)}/edit`,
        payload,
      };
    }

    return {
      submitUrl: `${cleanUrl(API_BASE_URL)}/generate`,
      payload,
    };
  };
  const getRoutePointCost = (route, size) => {
    const normalizedSize = normalizeSizeKey(size);
    const overrideRaw = normalizedSize ? route?.sizeOverrides?.[normalizedSize]?.pointCost : "";
    const overridePointCost = normalizedSize
      ? Number.parseFloat(String(overrideRaw ?? ""))
      : Number.NaN;
    if (Number.isFinite(overridePointCost) && overridePointCost >= 0) {
      return toPointNumber(overridePointCost, 0);
    }
    return toPointNumber(route?.pointCost || 0, 0);
  };
  const getDisplayRouteForModel = (modelId, preferredLine = "") => {
    const routes = getRoutesForModel(modelId).filter((route) =>
      isApiKeyCompatibilityMode() ? route.allowUserApiKeyWithoutLogin === true : true,
    );
    if (routes.length === 0) return null;
    return (
      routes.find((route) => route.line === String(preferredLine || "").trim()) ||
      routes.find((route) => route.isDefaultRoute) ||
      routes.find((route) => route.isDefaultNanoBananaLine) ||
      routes[0]
    );
  };
  const renderModelMenu = () => {
    const pill = document.getElementById("modelPill");
    if (!pill) return;
    const menu = pill.querySelector(".dropdown-menu");
    if (!menu) return;

    const models = getVisibleModels();
    const selectedSize = getCurrentSelectedSize();
    const preferredLine = String(localStorage.getItem(LINE_STORAGE_KEY) || "").trim();
    if (models.length === 0) {
      menu.innerHTML = '<div class="dropdown-item active" data-value=""><span>暂无可用模型</span></div>';
      pill.setAttribute("data-selected-value", "");
      const triggerLabel = pill.querySelector(".trigger-label");
      const triggerVal = pill.querySelector(".trigger-val");
      if (triggerLabel) triggerLabel.innerText = "请先登录或保存可用 Key";
      if (triggerVal) {
        triggerVal.innerText = "";
        triggerVal.style.display = "none";
      }
      return;
    }

    const selected = getCurrentModel();
    menu.innerHTML = models
      .map((model) => {
        const displayRoute = getDisplayRouteForModel(model.id, preferredLine);
        const costLabel = formatCoinLabel(
          displayRoute ? getRoutePointCost(displayRoute, selectedSize) : model.selectorCost,
        );
        const icon = MODEL_ICONS[model.iconKind] || "";
        const activeClass = selected?.id === model.id ? " active" : "";
        return `
          <div class="dropdown-item${activeClass}" data-value="${escapeHtmlText(model.id)}" onclick="selectPill('modelPill', this)">
            <span>${escapeHtmlText(icon ? `${icon} ${model.label}` : model.label)}</span>
            ${costLabel ? `<span class="item-cost">${escapeHtmlText(costLabel)}</span>` : ""}
          </div>
        `;
      })
      .join("");

    pill.setAttribute("data-selected-value", selected?.id || "");
    const triggerLabel = pill.querySelector(".trigger-label");
    const triggerVal = pill.querySelector(".trigger-val");
    const icon = MODEL_ICONS[selected?.iconKind] || "";
    if (triggerLabel) {
      triggerLabel.innerText = selected ? `${icon ? `${icon} ` : ""}${selected.label}` : "暂无可用模型";
    }
    if (triggerVal) {
      const selectedRoute = selected ? getDisplayRouteForModel(selected.id, preferredLine) : null;
      const selectedCost = formatCoinLabel(
        selectedRoute ? getRoutePointCost(selectedRoute, selectedSize) : selected?.selectorCost || 0,
      );
      triggerVal.innerText = selectedCost;
      triggerVal.style.display = selectedCost ? "inline" : "none";
    }
  };
  const renderLineMenu = () => {
    const lineModule = document.getElementById("lineModule");
    const pill = document.getElementById("linePill");
    if (!lineModule || !pill) return;
    const menu = pill.querySelector(".dropdown-menu");
    if (!menu) return;

    const routes = getVisibleRoutesForCurrentModel();
    if (routes.length <= 1) {
      lineModule.style.display = "none";
      if (routes[0]) {
        localStorage.setItem(LINE_STORAGE_KEY, routes[0].line);
        pill.setAttribute("data-selected-value", routes[0].line);
      }
      return;
    }

    const selected = getCurrentRoute();
    lineModule.style.display = "flex";
    menu.innerHTML = routes
      .map((route) => {
        const activeClass = selected?.id === route.id ? " active" : "";
        return `
          <div class="dropdown-item${activeClass}" data-value="${escapeHtmlText(route.line)}" onclick="selectPill('linePill', this)">
            <span>${escapeHtmlText(getFriendlyRouteLabel(route))}</span>
          </div>
        `;
      })
      .join("");

    pill.setAttribute("data-selected-value", selected?.line || "");
    const triggerLabel = pill.querySelector(".trigger-label");
    if (triggerLabel) {
      triggerLabel.innerText = selected ? getFriendlyRouteLabel(selected) : "选择线路";
    }
  };
  const renderSizeMenu = () => {
    const pill = document.getElementById("sizePill");
    if (!pill) return;
    const module = pill.closest(".tech-module");
    const menu = pill.querySelector(".dropdown-menu");
    if (!menu || !module) return;

    const model = getCurrentModel();
    const options =
      Array.isArray(model?.sizeOptions) && model.sizeOptions.length > 0
        ? model.sizeOptions
        : [model?.defaultSize || "1k"];
    const currentValue = getCurrentSelectedSize();
    const shouldShow = model?.showSizeSelector !== false && options.length > 1;

    module.style.display = shouldShow ? "" : "none";
    menu.innerHTML = options
      .map((sizeOption) => {
        const normalized = String(sizeOption || "").trim().toLowerCase();
        const activeClass = normalized === currentValue ? " active" : "";
        const label = SIZE_LABELS[normalized] || normalized.toUpperCase();
        return `<div class="dropdown-item${activeClass}" data-value="${escapeHtmlText(normalized.toUpperCase())}" onclick="selectPill('sizePill', this)">${escapeHtmlText(label)}</div>`;
      })
      .join("");

    pill.setAttribute("data-selected-value", currentValue.toUpperCase());
    const triggerLabel = pill.querySelector(".trigger-label");
    if (triggerLabel) {
      triggerLabel.innerText = SIZE_LABELS[currentValue] || currentValue.toUpperCase();
    }
  };
  const updateRatioAvailabilityForModel = () => {
    const pill = document.getElementById("ratioPill");
    if (!pill) return;
    const model = getCurrentModel();
    const extraRatios = new Set((model?.extraAspectRatios || []).map((item) => String(item || "").trim()));
    pill.querySelectorAll(".gemini-only-ratio").forEach((option) => {
      const ratio = String(option.getAttribute("data-value") || "").trim();
      option.style.display = extraRatios.has(ratio) ? "flex" : "none";
    });

    const currentRatio = String(pill.getAttribute("data-selected-value") || "16:9").trim();
    const currentOption = pill.querySelector(`.dropdown-item[data-value="${currentRatio}"]`);
    if (currentOption && currentOption.style.display === "none") {
      const defaultOption = pill.querySelector('.dropdown-item[data-value="16:9"]');
      if (defaultOption) {
        selectPill("ratioPill", defaultOption);
      }
    }
  };
  const updateBrandHeader = () => {
    const currentModel = getCurrentModel();
    const titleEl = document.getElementById("brandTitleText");
    const subEl = document.getElementById("brandSubText");
    const badgeEl = document.getElementById("brandBadge4k");

    if (titleEl) {
      titleEl.textContent = currentModel?.label || "Classic Create";
    }
    if (subEl) {
      if (isSessionAuthenticated()) {
        subEl.textContent = "统一账户已连接，当前使用主站登录与点数";
      } else if (getStoredApiKey()) {
        subEl.textContent = "旧 Key 兼容模式已启用，可直连兼容线路";
      } else {
        subEl.textContent = "登录后可使用全部模型；旧 API Key 兼容部分线路";
      }
    }
    if (badgeEl) {
      const supports4k = (currentModel?.sizeOptions || []).includes("4k");
      badgeEl.style.display = supports4k ? "inline-flex" : "none";
    }
  };
  const updateLegacyAdminVisibility = () => {
    const adminSection = document.getElementById("adminNoticeSection");
    if (adminSection) adminSection.style.display = "none";
  };
  const applyAccountSummaryToProfile = (account) => {
    const balanceArea = document.getElementById("balanceDisplayArea");
    const remainEl = document.getElementById("p_remain");
    const spentEl = document.getElementById("p_used");
    if (!account) {
      if (balanceArea) balanceArea.style.display = "none";
      return;
    }
    if (remainEl) remainEl.innerText = `${formatPointValue(account.points || 0)} 🪙`;
    if (spentEl) spentEl.innerText = `${formatPointValue(account.totalSpent || 0)} 🪙`;
    if (balanceArea) balanceArea.style.display = "block";
  };
  const renderAuthMode = () => {
    const mode = String(localStorage.getItem(CLASSIC_AUTH_MODE_KEY) || "login").trim();
    const displayNameInput = document.getElementById("classicAuthDisplayName");
    const passwordInput = document.getElementById("classicAuthPassword");
    const resetFields = document.getElementById("classicAuthResetFields");
    const hint = document.getElementById("classicAuthHint");
    const submitBtn = document.getElementById("classicAuthSubmitBtn");
    const loginBtn = document.getElementById("classicAuthModeLoginBtn");
    const registerBtn = document.getElementById("classicAuthModeRegisterBtn");
    const forgotBtn = document.getElementById("classicAuthModeForgotBtn");
    if (displayNameInput) {
      displayNameInput.style.display = mode === "register" ? "block" : "none";
      if (mode !== "register") displayNameInput.value = "";
    }
    if (passwordInput) {
      passwordInput.style.display = mode === "forgot" ? "none" : "block";
      if (mode === "forgot") passwordInput.value = "";
    }
    if (resetFields) {
      resetFields.style.display = mode === "forgot" ? "block" : "none";
      if (mode !== "forgot") {
        ["classicAuthResetCode", "classicAuthResetPassword", "classicAuthResetConfirmPassword"].forEach((id) => {
          const field = document.getElementById(id);
          if (field) field.value = "";
        });
      }
    }
    if (hint) {
      hint.textContent =
        mode === "register"
          ? "注册成功后会自动登录，并立即绑定点数账户。"
          : mode === "forgot"
            ? "通过邮箱验证码重置密码，成功后会自动登录当前账号。"
            : "登录后可直接使用站内点数、全部模型与后台配置的全部线路。旧 API Key 仍可兼容部分直连线路。";
    }
    if (submitBtn) {
      submitBtn.innerHTML =
        mode === "register"
          ? '<span style="font-size: 16px">🆕</span> 注册账户'
          : '<span style="font-size: 16px">🔐</span> 密码登录';
    }
    if (submitBtn) {
      submitBtn.innerHTML =
        mode === "register"
          ? '<span style="font-size: 16px">📝</span> 注册账户'
          : mode === "forgot"
            ? '<span style="font-size: 16px">🔑</span> 重置密码'
            : '<span style="font-size: 16px">🔐</span> 密码登录';
    }
    if (loginBtn) loginBtn.classList.toggle("active", mode === "login");
    if (registerBtn) registerBtn.classList.toggle("active", mode === "register");
    if (forgotBtn) forgotBtn.classList.toggle("active", mode === "forgot");
  };
  const renderAuthState = () => {
    const loggedOut = document.getElementById("classicAuthLoggedOut");
    const loggedIn = document.getElementById("classicAuthLoggedIn");
    const adminEntry = document.getElementById("classicAdminEntryBtn");
    const redeemInput = document.getElementById("classicRedeemCodeInput");
    const apiConfigModule = document.getElementById("classicApiConfigModule");
    const passwordTitle = document.getElementById("classicPasswordCardTitle");
    const passwordHint = document.getElementById("classicPasswordCardHint");
    const currentPasswordRow = document.getElementById("classicCurrentPasswordRow");
    const passwordSubmitBtn = document.getElementById("classicPasswordSubmitBtn");
    const passwordToggleBtn = document.getElementById("classicPasswordToggleBtn");
    const passwordPanelBody = document.getElementById("classicPasswordPanelBody");
    const rechargedEl = document.getElementById("classicAuthRecharged");
    const roleBadge = document.getElementById("classicAuthRoleBadge");
    const roleTextEl = document.getElementById("classicAuthRoleText");
    const userIdEl = document.getElementById("classicAuthUserId");
    const lastLoginEl = document.getElementById("classicAuthLastLogin");
    const adminManageCard = document.getElementById("classicAdminManageCard");
    const user = bridgeAuthState.user;
    const account = bridgeAuthState.account;

    if (loggedOut) loggedOut.style.display = user ? "none" : "block";
    if (loggedIn) loggedIn.style.display = user ? "block" : "none";
    if (apiConfigModule) apiConfigModule.style.display = user ? "none" : "block";
    renderAuthMode();

    if (user) {
      const nameEl = document.getElementById("classicAuthUserName");
      const metaEl = document.getElementById("classicAuthUserMeta");
      const remainEl = document.getElementById("classicAuthRemain");
      const spentEl = document.getElementById("classicAuthSpent");
      if (nameEl) nameEl.textContent = user.displayName || user.email || "已登录用户";
      if (metaEl) {
        metaEl.textContent = user.email || "-";
      }
      if (remainEl) remainEl.textContent = `${formatPointValue(account?.points || 0)} 🪙`;
      if (spentEl) spentEl.textContent = `${formatPointValue(account?.totalSpent || 0)} 🪙`;
      if (rechargedEl) rechargedEl.textContent = `${formatPointValue(account?.totalRecharged || 0)} 🪙`;
      const roleText = user.isSuperAdmin ? "超级管理员" : user.isAdmin ? "管理员" : "普通用户";
      if (roleTextEl) roleTextEl.textContent = `角色：${roleText}`;
      if (userIdEl) userIdEl.textContent = `用户 ID：${user.userId || "-"}`;
      if (lastLoginEl) {
        lastLoginEl.textContent = `最近登录：${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "首次登录"}`;
      }
      if (roleBadge) {
        roleBadge.textContent = roleText;
        roleBadge.style.display = user.isAdmin || user.isSuperAdmin ? "inline-flex" : "none";
        roleBadge.classList.toggle("is-super", Boolean(user.isSuperAdmin));
      }
      if (adminEntry) {
        adminEntry.style.display = user.isAdmin || user.isSuperAdmin ? "inline-flex" : "none";
      }
      if (adminManageCard) {
        adminManageCard.style.display = user.isAdmin || user.isSuperAdmin ? "block" : "none";
      }
      if (passwordTitle) {
        passwordTitle.textContent = user.passwordConfigured ? "修改密码" : "设置密码";
      }
      if (passwordHint) {
        passwordHint.textContent = user.passwordConfigured
          ? "输入当前密码后即可更新。修改成功后，新密码会立即生效。"
          : "当前账号还没有密码。设置完成后，以后可以直接使用邮箱和密码登录。";
      }
      if (currentPasswordRow) {
        currentPasswordRow.style.display = user.passwordConfigured ? "block" : "none";
      }
      if (passwordSubmitBtn) {
        passwordSubmitBtn.innerHTML = user.passwordConfigured
          ? '<span style="font-size: 16px">🔐</span> 修改密码'
          : '<span style="font-size: 16px">🔐</span> 设置密码';
      }
      if (passwordToggleBtn) {
        passwordToggleBtn.innerHTML = bridgeAuthState.passwordPanelOpen
          ? '<span style="font-size: 16px">🔒</span> 收起'
          : user.passwordConfigured
            ? '<span style="font-size: 16px">🔐</span> 修改密码'
            : '<span style="font-size: 16px">🔐</span> 设置密码';
      }
      if (passwordPanelBody) {
        passwordPanelBody.classList.toggle("is-open", Boolean(bridgeAuthState.passwordPanelOpen));
      }
      if (redeemInput && redeemInput.value && bridgeAuthState.redeemedCode?.code) {
        redeemInput.value = "";
      }
      applyAccountSummaryToProfile(account);
    } else {
      bridgeAuthState.passwordPanelOpen = false;
      if (adminEntry) adminEntry.style.display = "none";
      if (adminManageCard) adminManageCard.style.display = "none";
      if (redeemInput) redeemInput.value = "";
      setClassicRedeemStatus("");
      applyAccountSummaryToProfile(null);
      ["classicCurrentPassword", "classicNewPassword", "classicConfirmPassword"].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.value = "";
      });
      if (rechargedEl) rechargedEl.textContent = "0 🪙";
      if (roleBadge) {
        roleBadge.style.display = "none";
        roleBadge.classList.remove("is-super");
      }
      if (roleTextEl) roleTextEl.textContent = "角色：-";
      if (userIdEl) userIdEl.textContent = "用户 ID：-";
      if (lastLoginEl) lastLoginEl.textContent = "最近登录：-";
      if (passwordPanelBody) {
        passwordPanelBody.classList.remove("is-open");
      }
      if (passwordToggleBtn) {
        passwordToggleBtn.innerHTML = '<span style="font-size: 16px">🔐</span> 修改密码';
      }
    }
    renderClassicRedeemResult();
    renderClassicLedger();
  };
  toggleClassicPasswordPanel = function (nextState) {
    if (!isSessionAuthenticated()) {
      showAuthStatus("请先登录后再修改密码", "error");
      switchTab("profile");
      return;
    }
    if (typeof nextState === "boolean") {
      bridgeAuthState.passwordPanelOpen = nextState;
    } else {
      bridgeAuthState.passwordPanelOpen = !bridgeAuthState.passwordPanelOpen;
    }
    renderAuthState();
  };
  const renderCatalogUi = () => {
    renderModelMenu();
    renderLineMenu();
    renderSizeMenu();
    updateRatioAvailabilityForModel();
    updateBrandHeader();
    updateLegacyAdminVisibility();
  };
  window.refreshClassicCatalogUi = renderCatalogUi;
  const loadClassicCatalogs = async () => {
    const [modelsData, routesData] = await Promise.all([
      fetchJson("/image-models/catalog", {
        headers: {
          "Content-Type": "application/json",
        },
      }),
      fetchJson("/image-routes/catalog", {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    ]);

    bridgeModelCatalog = {
      defaultModelId: String(modelsData.defaultModelId || "").trim(),
      models: Array.isArray(modelsData.models) ? modelsData.models.map(normalizeModel) : [],
    };
    bridgeRouteCatalog = {
      defaultRouteId: String(routesData.defaultRouteId || "").trim(),
      defaultNanoBananaLine: String(routesData.defaultNanoBananaLine || "line1").trim(),
      routes: Array.isArray(routesData.routes) ? routesData.routes.map(normalizeRoute) : [],
    };

    renderCatalogUi();
  };
  const loadRegistrationStatus = async () => {
    try {
      bridgeAuthState.registrationStatus = await fetchJson("/auth/registration-status", {
        headers: { "Content-Type": "application/json" },
      });
    } catch (_) {
      bridgeAuthState.registrationStatus = null;
    }
  };
  const showBalanceFromAccount = (account) => {
    if (!account) return;
    if (typeof showBalanceModal === "function") {
      showBalanceModal({
        remaining_points: toPointNumber(account.points || 0, 0),
        used_points: toPointNumber(account.totalSpent || 0, 0),
        total_points: toPointNumber(account.totalRecharged || account.points || 0, 0),
      });
    }
  };
  switchClassicAuthMode = function (mode) {
    const nextMode = mode === "register" || mode === "forgot" ? mode : "login";
    localStorage.setItem(CLASSIC_AUTH_MODE_KEY, nextMode);
    renderAuthMode();
    clearAuthStatus();
  };
  refreshClassicSession = async function (showToast = false) {
    const token = getStoredSessionToken();
    if (!token) {
      bridgeAuthState.user = null;
      bridgeAuthState.account = null;
      bridgeAuthState.ledger = null;
      bridgeAuthState.redeemedCode = null;
      renderAuthState();
      renderCatalogUi();
      updateApiGuidePrompt();
      void loadHistory();
      void restorePendingTasks();
      if (showToast) showSoftToast("当前未登录");
      return null;
    }

    try {
      const sessionData = await fetchJson("/auth/session", {
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
      });
      bridgeAuthState.user = sessionData.user || null;

      const accountData = await fetchJson("/account/me?ledgerPage=1&ledgerPageSize=20", {
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
      });
      bridgeAuthState.account = accountData.account || null;
      bridgeAuthState.ledger = accountData.ledger || null;
      bridgeAuthState.redeemedCode = accountData.redeemedCode || null;
      renderAuthState();
      renderCatalogUi();
      updateApiGuidePrompt();
      void loadHistory();
      void restorePendingTasks();
      if (showToast) showSoftToast("账户状态已同步");
      return accountData;
    } catch (error) {
      console.warn("[Classic Bridge] refresh session failed:", error);
      clearStoredSessionToken();
      bridgeAuthState.user = null;
      bridgeAuthState.account = null;
      bridgeAuthState.ledger = null;
      bridgeAuthState.redeemedCode = null;
      renderAuthState();
      renderCatalogUi();
      updateApiGuidePrompt();
      void loadHistory();
      void restorePendingTasks();
      if (showToast) showSoftToast("登录状态已失效，请重新登录");
      return null;
    }
  };
  requestClassicPasswordResetCode = async function () {
    const email = String(document.getElementById("classicAuthEmail")?.value || "").trim();
    const requestBtn = document.getElementById("classicAuthSendResetCodeBtn");
    const originalHtml = requestBtn?.innerHTML || "";

    if (!email) {
      showAuthStatus("请输入邮箱地址", "error");
      return;
    }

    clearAuthStatus();
    if (requestBtn) {
      requestBtn.disabled = true;
      requestBtn.innerHTML = '<span style="font-size: 16px">⏳</span> 发送中...';
    }

    try {
      const response = await fetchJson("/auth/password/forgot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      showAuthStatus("重置验证码已发送，请检查邮箱", "success");
      if (response.previewCode) {
        showSoftToast(`开发模式验证码：${response.previewCode}`);
      }
    } catch (error) {
      console.error("[Classic Bridge] password reset code request failed:", error);
      showAuthStatus(error?.message || "发送重置验证码失败，请稍后再试", "error");
    } finally {
      if (requestBtn) {
        requestBtn.disabled = false;
        requestBtn.innerHTML = originalHtml;
      }
    }
  };
  submitClassicAuth = async function () {
    const mode = String(localStorage.getItem(CLASSIC_AUTH_MODE_KEY) || "login").trim();
    const email = String(document.getElementById("classicAuthEmail")?.value || "").trim();
    const password = String(document.getElementById("classicAuthPassword")?.value || "");
    const displayName = String(document.getElementById("classicAuthDisplayName")?.value || "").trim();
    const resetCode = String(document.getElementById("classicAuthResetCode")?.value || "").trim();
    const resetPassword = String(document.getElementById("classicAuthResetPassword")?.value || "");
    const resetConfirmPassword = String(document.getElementById("classicAuthResetConfirmPassword")?.value || "");
    const submitBtn = document.getElementById("classicAuthSubmitBtn");
    const originalHtml = submitBtn?.innerHTML || "";
    if (!email) {
      showAuthStatus("请输入邮箱地址", "error");
      return;
    }
    if (mode === "register" && !displayName) {
      showAuthStatus("注册时请填写显示名称", "error");
      return;
    }
    if ((mode === "login" || mode === "register") && !password) {
      showAuthStatus("请输入密码", "error");
      return;
    }
    if (mode === "forgot") {
      if (!resetCode) {
        showAuthStatus("请输入重置验证码", "error");
        return;
      }
      if (!resetPassword) {
        showAuthStatus("请输入新密码", "error");
        return;
      }
      if (resetPassword !== resetConfirmPassword) {
        showAuthStatus("两次输入的新密码不一致", "error");
        return;
      }
      const passwordInput = document.getElementById("classicAuthPassword");
      if (passwordInput) {
        passwordInput.value = resetPassword;
      }
    }

    if (!email) {
      showAuthStatus("请输入邮箱地址", "error");
      return;
    }
    if (!password) {
      showAuthStatus("请输入密码", "error");
      return;
    }
    if (mode === "register" && !displayName) {
      showAuthStatus("注册时请填写显示名称", "error");
      return;
    }

    clearAuthStatus();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span style="font-size: 16px">⏳</span> 提交中...';
    }

    try {
      const endpoint =
        mode === "register"
          ? "/auth/register"
          : mode === "forgot"
            ? "/auth/password/reset"
            : "/auth/login/password";
      const payload =
        mode === "register"
          ? { email, password, displayName }
          : mode === "forgot"
            ? { email, code: resetCode, password: resetPassword }
            : { email, password };

      const response = await fetchJson(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setStoredSessionToken(response.sessionToken || "");
      bridgeAuthState.user = response.user || null;
      showAuthStatus(mode === "register" ? "注册成功，正在同步账户..." : "登录成功，正在同步账户...", "success");
      await refreshClassicSession(false);
      switchTab("create");
      showSoftToast(mode === "register" ? "注册成功，已进入经典版创作界面" : "登录成功");
    } catch (error) {
      console.error("[Classic Bridge] auth submit failed:", error);
      showAuthStatus(error?.message || "登录失败，请稍后重试", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  };
  submitClassicPasswordChange = async function () {
    if (!isSessionAuthenticated()) {
      showAuthStatus("请先登录后再修改密码", "error");
      switchTab("profile");
      return;
    }

    const user = bridgeAuthState.user;
    const currentPassword = String(document.getElementById("classicCurrentPassword")?.value || "");
    const newPassword = String(document.getElementById("classicNewPassword")?.value || "");
    const confirmPassword = String(document.getElementById("classicConfirmPassword")?.value || "");
    const submitBtn = document.getElementById("classicPasswordSubmitBtn");
    const originalHtml = submitBtn?.innerHTML || "";

    if (user?.passwordConfigured && !currentPassword) {
      showAuthStatus("请输入当前密码", "error");
      return;
    }
    if (!newPassword) {
      showAuthStatus("请输入新密码", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showAuthStatus("两次输入的新密码不一致", "error");
      return;
    }

    clearAuthStatus();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span style="font-size: 16px">⏳</span> 保存中...';
    }

    try {
      const response = await fetchJson(
        user?.passwordConfigured ? "/auth/password/change" : "/auth/password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildSessionHeaders(),
          },
          body: JSON.stringify(
            user?.passwordConfigured
              ? { currentPassword, newPassword }
              : { password: newPassword },
          ),
        },
      );

      bridgeAuthState.user = response.user || bridgeAuthState.user;
      bridgeAuthState.passwordPanelOpen = false;
      ["classicCurrentPassword", "classicNewPassword", "classicConfirmPassword"].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.value = "";
      });
      renderAuthState();
      showAuthStatus(user?.passwordConfigured ? "密码修改成功" : "密码设置成功", "success");
      showSoftToast(user?.passwordConfigured ? "密码修改成功" : "密码设置成功");
    } catch (error) {
      console.error("[Classic Bridge] password change failed:", error);
      showAuthStatus(error?.message || "密码保存失败，请稍后重试", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  };
  logoutClassicSession = async function () {
    try {
      const token = getStoredSessionToken();
      if (token) {
        await fetch(`${cleanUrl(API_BASE_URL)}/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildSessionHeaders(),
          },
        }).catch(() => null);
      }
    } finally {
      clearStoredSessionToken();
      bridgeAuthState.user = null;
      bridgeAuthState.account = null;
      bridgeAuthState.ledger = null;
      bridgeAuthState.redeemedCode = null;
      renderAuthState();
      renderCatalogUi();
      updateApiGuidePrompt();
      void loadHistory();
      void restorePendingTasks();
      showSoftToast("已退出登录");
    }
  };
  redeemClassicCode = async function () {
    if (!isSessionAuthenticated()) {
      setClassicRedeemStatus("请先登录后再兑换点数", "error");
      switchTab("profile");
      return;
    }

    const input = document.getElementById("classicRedeemCodeInput");
    const submitBtn = document.getElementById("classicRedeemSubmitBtn");
    const code = String(input?.value || "").trim();
    const originalHtml = submitBtn?.innerHTML || "";

    if (!code) {
      setClassicRedeemStatus("请输入兑换码", "error");
      return;
    }

    setClassicRedeemStatus("");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span style="font-size: 16px">⏳</span> 兑换中...';
    }

    try {
      const response = await fetchJson("/account/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
        body: JSON.stringify({
          code,
          ledgerPage: 1,
          ledgerPageSize: 20,
        }),
      });

      bridgeAuthState.account = response.account || null;
      bridgeAuthState.ledger = response.ledger || null;
      bridgeAuthState.redeemedCode = response.redeemedCode || null;
      renderAuthState();
      if (input) input.value = "";
      setClassicRedeemStatus(
        `兑换成功，已到账 ${formatPointValue(response.redeemedCode?.points || 0)} 点`,
        "success",
      );
      showSoftToast(`兑换成功，已到账 ${formatPointValue(response.redeemedCode?.points || 0)} 点`);
    } catch (error) {
      console.error("[Classic Bridge] redeem code failed:", error);
      setClassicRedeemStatus(error?.message || "兑换失败，请稍后重试", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  };
  checkAdminStatus = function () {
    updateLegacyAdminVisibility();
  };
  updateModelUI = function () {
    renderCatalogUi();
  };
  updateApiGuidePrompt = function (force = false) {
    if (isSessionAuthenticated() || getStoredApiKey()) {
      if (typeof setApiGuideAutoPromptDismissed === "function") {
        setApiGuideAutoPromptDismissed(false);
      }
      if (typeof closeApiGuideModal === "function") closeApiGuideModal({ rememberDismiss: false });
      return;
    }
    if (!force && typeof isApiGuideAutoPromptDismissed === "function" && isApiGuideAutoPromptDismissed()) {
      return;
    }
    if (typeof showApiGuideModal !== "function") return;
    showApiGuideModal({
      title: "先登录或输入旧 API Key",
      desc: "经典版现在已经接入主站账户系统。登录后可使用全部模型；如果你仍想沿用旧 Key，也可以在“我的”页保存后使用兼容线路。",
      primaryText: "去账户中心",
      secondaryText: "稍后",
      action: "custom",
      autoPrompt: true,
      onPrimary: () => {
        switchTab("profile");
        const emailInput = document.getElementById("classicAuthEmail");
        if (emailInput) emailInput.focus();
        if (typeof closeApiGuideModal === "function") closeApiGuideModal({ rememberDismiss: true });
      },
    });
  };
  checkBalance = async function () {
    const apiKey = getStoredApiKey();
    const btn = document.getElementById("checkBalanceBtn");
    const originalText = btn?.innerHTML || "";

    if (!apiKey && !isSessionAuthenticated()) {
      showApiGuideModal({
        title: "请先登录或输入旧 API Key",
        desc: "登录后可以查看站内点数；若你仍想查询旧 Key 的额度，请先在下方保存 API Key。",
        primaryText: "去账户中心",
        secondaryText: "稍后",
        action: "custom",
        onPrimary: () => {
          switchTab("profile");
          const emailInput = document.getElementById("classicAuthEmail");
          const keyInput = document.getElementById("apiKey");
          if (emailInput) emailInput.focus();
          else if (keyInput) keyInput.focus();
          closeApiGuideModal();
        },
      });
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerText = "查询中...";
      btn.style.opacity = "0.7";
    }

    try {
      if (isSessionAuthenticated()) {
        const accountData = await refreshClassicSession(false);
        if (!accountData?.account) {
          throw new Error("Unable to read the current account balance");
        }
        showBalanceFromAccount(accountData.account);
      } else if (apiKey) {
        const response = await fetch(`/api/balance/info`, {
          headers: {
            "Content-Type": "application/json",
            ...buildApiKeyHeaders(apiKey),
          },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || data?.message || "API 请求失败");
        }
        showBalanceModal(data);
      } else {
        const accountData = await refreshClassicSession(false);
        if (!accountData?.account) {
          throw new Error("无法读取当前账户点数");
        }
        showBalanceFromAccount(accountData.account);
      }
    } catch (error) {
      console.error("[Classic Bridge] check balance failed:", error);
      showApiGuideModal({
        title: "查询失败",
        desc: error?.message || "查询失败，请稍后重试",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    } finally {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    }
  };
  saveApiKeyAndBack = function () {
    const keyInput = document.getElementById("apiKey");
    const cleanedKey = sanitizeApiKey(keyInput?.value || "");
    if (keyInput && keyInput.value !== cleanedKey) keyInput.value = cleanedKey;
    setStoredApiKey(cleanedKey);
    if (typeof setApiGuideAutoPromptDismissed === "function") {
      setApiGuideAutoPromptDismissed(false);
    }
    renderCatalogUi();
    updateApiGuidePrompt();
    switchTab("create");
    showApiGuideModal({
      title: cleanedKey ? "保存成功" : "已清空旧 Key",
      desc: cleanedKey
        ? "旧 API Key 已保存。系统会优先展示可兼容这把 Key 的线路。"
        : "旧 API Key 已清空。你现在可以改用登录账户和站内点数。",
      primaryText: "返回创作",
      showSecondary: false,
      action: "close",
    });
  };
  const shouldUseDirectApiKeyForRoute = (route, apiKey) =>
    !isSessionAuthenticated() && route?.allowUserApiKeyWithoutLogin === true && Boolean(apiKey);
  const buildGenerateHeaders = (route, apiKey) => {
    if (isSessionAuthenticated()) {
      return {
        "Content-Type": "application/json",
        ...buildSessionHeaders(),
      };
    }

    if (shouldUseDirectApiKeyForRoute(route, apiKey)) {
      return {
        "Content-Type": "application/json",
        ...buildApiKeyHeaders(apiKey),
      };
    }

    return {
      "Content-Type": "application/json",
    };
  };
  const extractImmediateImageUrls = (payload) => {
    const directUrls = [];
    const pushUrl = (value) => {
      if (typeof value === "string" && value.trim()) {
        directUrls.push(value.trim());
      }
    };
    pushUrl(payload?.url);
    pushUrl(payload?.image_url);
    if (Array.isArray(payload?.images)) {
      payload.images.forEach(pushUrl);
    }
    if (Array.isArray(payload?.data)) {
      payload.data.forEach((item) => {
        pushUrl(item?.url);
        pushUrl(item?.image_url);
      });
    }
    if (typeof findAllUrlsInObject === "function") {
      findAllUrlsInObject(payload, directUrls);
    }
    return Array.from(new Set(directUrls.filter(Boolean)));
  };
  const fetchGenerationRecords = async ({ mediaType = "all", status = "all", page = 1, pageSize = 100 } = {}) =>
    fetchJson(
      `/generation-records?mediaType=${encodeURIComponent(mediaType)}&status=${encodeURIComponent(status)}&page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`,
      {
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
      },
    );
  const deleteGenerationRecords = async ({ mediaType = "all" } = {}) =>
    fetchJson(`/generation-records?mediaType=${encodeURIComponent(mediaType)}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...buildSessionHeaders(),
      },
    });
  const formatHistoryClock = (isoString) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
  const renderRemoteHistoryGrid = async (records = []) => {
    if (typeof clearHistoryObjectUrlRefs === "function") {
      clearHistoryObjectUrlRefs();
    }
    const grid = document.getElementById("historyGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!Array.isArray(records) || records.length === 0) {
      grid.innerHTML =
        '<div style="color:var(--text-sub); grid-column:1/-1; text-align:center; padding:20px; font-size:12px;">暂无历史记录</div>';
      return;
    }

    records.forEach((record) => {
      const url = String(record.previewUrl || record.resultUrls?.[0] || "").trim();
      if (!url) return;
      const recordId = String(record.id || "").trim();
      const prompt = String(record.prompt || "");
      const encodedPrompt = encodeURIComponent(prompt || "");
      const promptLabel = prompt ? `提示词：${prompt}` : "提示词：无记录";
      const promptTooltip = prompt ? `<div class="history-prompt-tip">${escapeHtml(promptLabel)}</div>` : "";
      const time = formatHistoryClock(record.completedAt || record.createdAt);

      const div = document.createElement("div");
      div.className = "result-item history-item";
      div.title = promptLabel;
      div.innerHTML = `
        <img src="${url}" loading="lazy" onclick="openLightbox(this.src)">
        ${time ? `<div class="history-time-tag">${time}</div>` : ""}
        <div class="history-cache-badge syncing">缓存中</div>
        ${promptTooltip}
        <div class="item-overlay">
          <button class="overlay-btn history-icon-btn" data-label="放大" onclick="openLightbox(this.closest('.history-item').querySelector('img').src)">🔍</button>
          <button class="overlay-btn history-icon-btn" data-label="保存" onclick="downloadSingleImg(this.closest('.history-item').querySelector('img').src)">💾</button>
          <button class="overlay-btn history-icon-btn" data-label="重生" onclick="regenerateFromHistory('${encodedPrompt}')">♻️</button>
          <button class="overlay-btn history-icon-btn" data-label="垫图" onclick="useAsRef(this.closest('.history-item').querySelector('img').src)">🧩</button>
          <button class="overlay-btn history-icon-btn" data-label="链接" onclick="copyImgUrl('${url}')">🔗</button>
        </div>
      `;
      grid.appendChild(div);

      if (typeof setHistoryCacheBadge === "function") {
        setHistoryCacheBadge(div, "cloud");
      }

      if (typeof getCachedHistoryImage === "function") {
        getCachedHistoryImage(recordId).then((blob) => {
          if (!blob) {
            if (typeof cacheHistoryImage === "function") {
              cacheHistoryImage(recordId, url).then((ok) => {
                if (ok && typeof setHistoryCacheBadge === "function") {
                  setHistoryCacheBadge(div, "local");
                }
              });
            }
            return;
          }

          const localUrl = URL.createObjectURL(blob);
          const img = div.querySelector("img");
          if (img) img.src = localUrl;
          if (Array.isArray(historyObjectUrls)) historyObjectUrls.push(localUrl);
          if (typeof setHistoryCacheBadge === "function") {
            setHistoryCacheBadge(div, "local");
          }
        });
      }
    });
  };
  const renderRemotePendingTasks = (records = []) => {
    const grid = document.getElementById("pendingTasksGrid");
    const container = document.getElementById("pendingTasksContainer");
    if (!grid || !container) return;

    grid.innerHTML = "";

    const tasks = (Array.isArray(records) ? records : []).filter((record) => record?.taskId);
    if (tasks.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    tasks.forEach((record, index) => {
      addPendingTaskToGallery(record.taskId, index + 1);
    });
  };
  const legacySaveToHistory =
    typeof saveToHistory === "function" ? saveToHistory.bind(window) : null;
  const legacyClearHistory =
    typeof clearHistory === "function" ? clearHistory.bind(window) : null;
  const legacyLoadHistory =
    typeof loadHistory === "function" ? loadHistory.bind(window) : null;
  const legacySavePendingTask =
    typeof savePendingTask === "function" ? savePendingTask.bind(window) : null;
  const legacyRemovePendingTask =
    typeof removePendingTask === "function" ? removePendingTask.bind(window) : null;
  const legacyRestorePendingTasks =
    typeof restorePendingTasks === "function" ? restorePendingTasks.bind(window) : null;

  saveToHistory = function (url, promptText = "") {
    if (!isSessionAuthenticated()) {
      return legacySaveToHistory ? legacySaveToHistory(url, promptText) : undefined;
    }
    setTimeout(() => {
      void loadHistory();
    }, 120);
    return undefined;
  };

  clearHistory = function () {
    if (!isSessionAuthenticated()) {
      return legacyClearHistory ? legacyClearHistory() : undefined;
    }

    showApiGuideModal({
      title: "清空云端历史记录？",
      desc: "该操作会清空当前账号在经典版和画布版共用的历史记录，且不可撤销。",
      primaryText: "确认清空",
      secondaryText: "取消",
      action: "custom",
      onPrimary: async () => {
        try {
          await deleteGenerationRecords({ mediaType: "image" });
          if (typeof clearCachedHistoryImages === "function") {
            await clearCachedHistoryImages();
          }
          if (typeof clearHistoryObjectUrlRefs === "function") {
            clearHistoryObjectUrlRefs();
          }
          await loadHistory();
          closeApiGuideModal();
          showSoftToast("云端历史已清空");
        } catch (error) {
          showApiGuideModal({
            title: "清空失败",
            desc: error?.message || "清空云端历史失败，请稍后重试",
            primaryText: "我知道了",
            showSecondary: false,
            action: "close",
          });
        }
      },
    });
  };

  loadHistory = async function () {
    if (!isSessionAuthenticated()) {
      return legacyLoadHistory ? legacyLoadHistory() : undefined;
    }

    try {
      const result = await fetchGenerationRecords({
        mediaType: "image",
        status: "success",
        page: 1,
        pageSize: 100,
      });
      await renderRemoteHistoryGrid(Array.isArray(result?.records) ? result.records : []);
    } catch (error) {
      console.warn("[Classic Bridge] load remote history failed:", error);
      if (legacyLoadHistory) {
        legacyLoadHistory();
      }
    }
  };

  savePendingTask = function (taskId, key, size, index, mode = "single", model = "") {
    if (!isSessionAuthenticated()) {
      return legacySavePendingTask
        ? legacySavePendingTask(taskId, key, size, index, mode, model)
        : undefined;
    }
    return undefined;
  };

  removePendingTask = function (taskId) {
    if (!isSessionAuthenticated()) {
      return legacyRemovePendingTask ? legacyRemovePendingTask(taskId) : undefined;
    }
    return undefined;
  };

  restorePendingTasks = async function () {
    if (!isSessionAuthenticated()) {
      return legacyRestorePendingTasks ? legacyRestorePendingTasks() : undefined;
    }

    try {
      const result = await fetchGenerationRecords({
        mediaType: "image",
        status: "pending",
        page: 1,
        pageSize: 100,
      });
      const records = Array.isArray(result?.records) ? result.records : [];
      renderRemotePendingTasks(records);
      records
        .filter((record) => record?.taskId)
        .forEach((record, index) => {
          if (remotePendingPollRegistry.has(record.taskId)) return;
          remotePendingPollRegistry.add(record.taskId);
          pollSingleTask(record.taskId, "", String(record.outputSize || "1K"), index + 1, {
            trackUi: false,
            route: getCurrentRoute(),
          });
        });
    } catch (error) {
      console.warn("[Classic Bridge] restore remote pending tasks failed:", error);
    }
  };
  submitSingleTask = async function (payload, key, size, index, options = {}) {
    try {
      const route = options.route || getCurrentRoute();
      const submitUrl = options.submitUrl || CONFIG.submitUrl;
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: buildGenerateHeaders(route, key),
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(USER_FACING_GENERATION_ERROR_MESSAGE);
      }
      if (data.warning) {
        showSoftToast(String(data.warning));
      }

      const directImageUrls = extractImmediateImageUrls(data);
      if (directImageUrls.length > 0) {
        const promptText = document.getElementById("prompt")?.value?.trim() || "";
        directImageUrls.forEach((imageUrl) => {
          if (canUpdateMainUi(options.runToken, options.trackUi !== false)) {
            appendImageToGrid(imageUrl, size, null, {
              runToken: options.runToken,
              trackUi: options.trackUi !== false,
            });
          } else {
            saveToHistory(imageUrl, promptText);
          }
        });
        return;
      }

      const taskId = data.task_id || data.id || data.data?.task_id || "";
      if (!taskId) {
        throw new Error(`任务 ${index} 未获取到ID`);
      }

      const directKeyForTask = shouldUseDirectApiKeyForRoute(route, key) ? key : "";
      savePendingTask(
        taskId,
        directKeyForTask,
        size,
        index,
        options.mode,
        payload.model,
      );
      addPendingTaskToGallery(taskId, index);
      pollSingleTask(taskId, directKeyForTask, size, index, {
        ...options,
        route,
      });
    } catch (error) {
      console.error("[Classic Bridge] submit task failed:", error);
      if (!canUpdateMainUi(options.runToken, options.trackUi !== false)) return;
      handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
    }
  };
  pollSingleTask = async function (taskId, key, size, index, options = {}) {
    let errorCount = 0;
    const maxErrors = 5;
    let successNoUrlCount = 0;
    const maxSuccessNoUrlCount = 3;
    const startedAt = Date.now();
    const maxPollMs = 8 * 60 * 1000;
    const trackUi = options.trackUi !== false;

    const checkLoop = setInterval(async () => {
      try {
        if (Date.now() - startedAt > maxPollMs) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
          }
          return;
        }

        const queryUrl = CONFIG.queryUrl.replace("{id}", taskId) + `?_t=${Date.now()}`;
        const response = await fetch(queryUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(isSessionAuthenticated() ? buildSessionHeaders() : buildApiKeyHeaders(key)),
          },
        });

        if (response.status === 404) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
          }
          return;
        }

        if (!response.ok) {
          errorCount += 1;
          if (errorCount >= maxErrors) {
            throw new Error("多次查询失败，任务可能已丢失");
          }
          return;
        }

        const rawJson = await response.json().catch(() => ({}));
        errorCount = 0;
        const statusRaw = String(
          rawJson.status || rawJson.state || rawJson.data?.status || "",
        ).toUpperCase();

        const imageUrls = extractImmediateImageUrls(rawJson);
        if (imageUrls.length > 0) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            appendImageToGrid(imageUrls[0], size, null, {
              runToken: options.runToken,
              trackUi,
            });
          } else {
            saveToHistory(imageUrls[0], document.getElementById("prompt")?.value?.trim() || "");
          }
          return;
        }

        if (statusRaw === "SUCCESS" || statusRaw === "SUCCEEDED" || statusRaw === "COMPLETED") {
          successNoUrlCount += 1;
          if (successNoUrlCount >= maxSuccessNoUrlCount) {
            clearInterval(checkLoop);
            removePendingTask(taskId);
            removePendingTaskFromGallery(taskId);
            if (canUpdateMainUi(options.runToken, trackUi)) {
              handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
            }
          }
          return;
        }

        if (statusRaw === "FAILURE" || statusRaw === "FAILED") {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
          }
        }
      } catch (error) {
        console.warn(`[Classic Bridge] Poll task ${index} warning:`, error);
        errorCount += 1;
        if (errorCount >= maxErrors) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
          }
        }
      }
    }, 2000);
  };
  runGen = async function () {
    const key = getStoredApiKey();
    const promptInput = document.getElementById("prompt");
    const rawPrompt = String(promptInput?.value || "").trim();
    const tagState = typeof parsePromptTagState === "function" ? parsePromptTagState() : null;
    const promptBaseText = String(tagState?.promptWithoutTags || rawPrompt || "").trim();
    let ratio = String(document.getElementById("ratioPill")?.getAttribute("data-selected-value") || "16:9").trim();
    if (ratio === "auto") {
      ratio = smartRatio || "1:1";
    }
    const size = String(document.getElementById("sizePill")?.getAttribute("data-selected-value") || "1K")
      .trim()
      .toUpperCase();
    const batchSize =
      Number.parseInt(String(document.getElementById("qtyPill")?.getAttribute("data-selected-value") || "1"), 10) || 1;

    const btn = document.getElementById("genBtn");
    const statusText = document.getElementById("statusText");
    const bar = document.getElementById("progressBar");
    const fill = document.getElementById("progressFill");
    const imgContainer = document.getElementById("imgContainer");
    const manualBtn = document.getElementById("manualLinkBtn");
    const errPlaceholder = document.getElementById("errorPlaceholder");
    const resultGrid = document.getElementById("resultGrid");

    const selectedModel = getCurrentModel();
    const selectedRoute = getCurrentRoute();
    const hasSession = isSessionAuthenticated();
    const usingDirectKey = shouldUseDirectApiKeyForRoute(selectedRoute, key);

    if (!usingDirectKey && !hasSession) {
      showApiGuideModal({
        title: "请先登录或输入旧 API Key",
        desc: "当前所选模型或线路需要使用站内账户。你可以先登录，也可以在“我的”页保存旧 API Key 后使用兼容线路。",
        primaryText: "去账户中心",
        secondaryText: "稍后",
        action: "custom",
        onPrimary: () => {
          switchTab("profile");
          const emailInput = document.getElementById("classicAuthEmail");
          const keyInput = document.getElementById("apiKey");
          if (emailInput) emailInput.focus();
          else if (keyInput) keyInput.focus();
          closeApiGuideModal();
        },
      });
      return;
    }

    if (!selectedModel || !selectedRoute) {
      showApiGuideModal({
        title: "暂无可用模型",
        desc: "当前访问方式下没有可用的模型或线路，请先登录，或改用兼容旧 Key 的线路。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
      return;
    }

    if (!promptBaseText) {
      showApiGuideModal({
        title: "请先输入提示词",
        desc: "提示词为空时无法开始生成。请先输入你想要的画面描述后再点击开始生产。",
        primaryText: "去填写提示词",
        action: "prompt",
      });
      return;
    }

    btn.disabled = true;
    imgContainer.style.display = "none";
    manualBtn.style.display = "none";
    errPlaceholder.style.display = "none";
    resultGrid.innerHTML = "";
    resultGrid.className = "result-grid";
    bar.style.display = "block";
    fill.style.width = "0%";
    statusText.innerText = "Initializing Unified Tasks...";
    statusText.style.color = "var(--banana)";

    activeRunToken += 1;
    const runToken = activeRunToken;
    currentRunSize = size;
    totalBatchSize = batchSize;
    activeTasksCount = batchSize;
    completedTasksCount = 0;
    loadedImageCount = 0;
    startFakeProgress();

    let finalPrompt = promptBaseText;
    if (size === "4K") {
      finalPrompt += ", (best quality, 4k resolution, ultra detailed, masterpiece)";
    }

    let submitRefImages = refImages.slice();
    let submitReferenceIndices = [];
    if (tagState?.hasAnyTag && PromptTagsUtil) {
      const resolved = PromptTagsUtil.resolveReferencesByIndices(refImages, tagState.referenceIndices);
      submitReferenceIndices = resolved.validIndices || [];
      if (submitReferenceIndices.length > 0) {
        submitRefImages = resolved.selectedImages || [];
      }
    }

    const requestModel = selectedModel.requestModel || selectedModel.id;
    const payloadBase = {
      modelId: selectedModel.id,
      routeId: selectedRoute.id,
      uiMode: "classic",
      model: requestModel,
      prompt: finalPrompt,
      size,
      image_size: size,
      aspect_ratio: ratio,
      n: 1,
    };

    if (submitReferenceIndices.length > 0) {
      payloadBase.reference_indices = submitReferenceIndices.slice();
    }

    if (submitRefImages.length > 0) {
      const normalizedRefImages = submitRefImages
        .map((imgData) => String(imgData || "").trim())
        .filter((imgData) => imgData.length > 0);
      const rawBase64Images = normalizedRefImages.map((imgData) =>
        imgData.includes(",") ? imgData.split(",")[1] : imgData,
      );
      const useDataUriReferences = selectedRoute?.requiresDataUriReferences === true;
      const finalRefImages = useDataUriReferences ? normalizedRefImages : rawBase64Images;
      payloadBase.image = finalRefImages;
      payloadBase.images = finalRefImages;
    }

    let submitPlan = {
      submitUrl: CONFIG.submitUrl,
      payload: payloadBase,
    };

    if (isGptImage2ClassicModel(selectedModel, selectedRoute)) {
      submitPlan = await buildClassicGptSubmitPlan({
        prompt: finalPrompt,
        ratio,
        size: size.toLowerCase(),
        selectedModel,
        selectedRoute,
        submitRefImages,
      });
    } else if (isGeminiNativeClassicRoute(selectedRoute)) {
      submitPlan = await buildClassicGeminiSubmitPlan({
        prompt: finalPrompt,
        ratio,
        size,
        selectedModel,
        selectedRoute,
        submitRefImages,
      });
    }

    for (let i = 0; i < batchSize; i += 1) {
      setTimeout(() => {
        submitSingleTask(
          {
            ...submitPlan.payload,
            n: 1,
          },
          key,
          size,
          i + 1,
          {
            submitUrl: submitPlan.submitUrl,
            route: selectedRoute,
            modelId: selectedModel.id,
            model: submitPlan.payload.model || requestModel,
            runToken,
            trackUi: true,
          },
        );
      }, i * 180);
    }
  };

  const initClassicBridge = async () => {
    try {
      CONFIG.queryUrl = "/api/task/{id}";
    } catch (_) {}

    renderAuthMode();
    renderAuthState();
    updateLegacyAdminVisibility();
    setStoredApiKey(getStoredApiKey());

    const authInputs = [
      document.getElementById("classicAuthDisplayName"),
      document.getElementById("classicAuthEmail"),
      document.getElementById("classicAuthPassword"),
      document.getElementById("classicAuthResetCode"),
      document.getElementById("classicAuthResetPassword"),
      document.getElementById("classicAuthResetConfirmPassword"),
    ].filter(Boolean);
    authInputs.forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitClassicAuth();
        }
      });
    });
    ["classicCurrentPassword", "classicNewPassword", "classicConfirmPassword"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitClassicPasswordChange();
        }
      });
    });

    const apiKeyInput = document.getElementById("apiKey");
    if (apiKeyInput) {
      apiKeyInput.addEventListener("input", () => {
        setStoredApiKey(apiKeyInput.value);
        renderCatalogUi();
        updateApiGuidePrompt();
      });
    }

    const redeemInput = document.getElementById("classicRedeemCodeInput");
    if (redeemInput) {
      redeemInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          redeemClassicCode();
        }
      });
    }

    window.addEventListener("auth-session-change", () => {
      void refreshClassicSession(false);
    });

    await Promise.allSettled([loadRegistrationStatus(), loadClassicCatalogs(), refreshClassicSession(false)]);
    renderAuthState();
    renderCatalogUi();
    updateApiGuidePrompt();
    await loadHistory();
    await restorePendingTasks();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void initClassicBridge();
    });
  } else {
    void initClassicBridge();
  }
})();
