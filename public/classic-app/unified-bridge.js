(() => {
  const API_BASE_URL = "/api";
  const AUTH_SESSION_STORAGE_KEY = "auth-session-v1";
  const CLASSIC_AUTH_MODE_KEY = "classic-auth-mode";
  const MODEL_STORAGE_KEY = "nb_image_model";
  const LINE_STORAGE_KEY = "nb_line";
  const KEY_STORAGE_KEY = "nb_key";
  const USER_FACING_GENERATION_ERROR_MESSAGE =
    "请检查提示词或参考图，可能触发了安全限制，请更换后重试";
  const SIZE_LABELS = {
    auto: "自动",
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
    prompt_optimize: "提示词优化",
    reverse_prompt: "图片逆推",
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
  const HISTORY_INITIAL_PAGE_SIZE = 15;
  const HISTORY_REFRESH_DEBOUNCE_MS = 2000;
  const HISTORY_REFRESH_MIN_INTERVAL_MS = 10000;
  let remoteHistoryRecordsCache = [];
  let remoteHistoryCursor = {
    sinceCreatedAt: "",
    sinceId: "",
  };
  let historyRefreshTimer = null;
  let lastHistoryRefreshAt = 0;

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
  const classicPromptToolState = {
    config: {
      model: "gemini-3.1-pro-preview",
      optimizeCost: 0.5,
      reverseCost: 1,
    },
    reverseFile: null,
    reverseResult: null,
    reverseTab: "plain",
  };
  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  const getClassicPromptText = () => String(document.getElementById("prompt")?.value || "").trim();
  const setClassicPromptText = (value) => {
    const promptEl = document.getElementById("prompt");
    if (!promptEl) return;
    promptEl.value = String(value || "");
    promptEl.dispatchEvent(new Event("input", { bubbles: true }));
    promptEl.focus();
  };
  const loadClassicPromptToolConfig = async () => {
    try {
      const config = await fetchJson("/prompt-tools/config");
      classicPromptToolState.config = {
        model: String(config.model || "gemini-3.1-pro-preview"),
        optimizeCost: toPointNumber(config.optimizeCost ?? 0.5, 0.5),
        reverseCost: toPointNumber(config.reverseCost ?? 1, 1),
      };
      updateClassicPromptToolLabels();
    } catch (_) {}
  };
  const updateClassicPromptToolLabels = () => {
    const optimizeBtn = document.getElementById("classicOptimizePromptBtn");
    if (optimizeBtn) {
      optimizeBtn.textContent = `✨ 优化 ${formatPointValue(classicPromptToolState.config.optimizeCost)}金币`;
      optimizeBtn.title = `使用 ${classicPromptToolState.config.model} 优化提示词`;
    }
    const reverseBtn = document.getElementById("classicReverseAnalyzeBtn");
    if (reverseBtn) {
      reverseBtn.textContent = `开始分析 · ${formatPointValue(classicPromptToolState.config.reverseCost)}金币`;
    }
    const topReverseBtn = document.getElementById("classicReversePromptBtn");
    if (topReverseBtn) {
      topReverseBtn.title = `图片逆推提示词，${formatPointValue(classicPromptToolState.config.reverseCost)}金币 / 次`;
    }
  };
  const ensureClassicPromptToolSession = () => {
    if (getStoredSessionToken()) return true;
    if (typeof showSoftToast === "function") showSoftToast("请先登录后再使用提示词工具");
    return false;
  };
  const setClassicPromptToolHeader = (title, cost) => {
    const titleEl = document.getElementById("classicPromptToolTitle");
    const subEl = document.getElementById("classicPromptToolSub");
    if (titleEl) titleEl.textContent = title;
    if (subEl) {
      subEl.textContent = `${classicPromptToolState.config.model} · ${formatPointValue(cost)}金币 / 次`;
    }
  };
  const showClassicPromptToolModal = (mode) => {
    const modal = document.getElementById("classicPromptToolModal");
    const optimizePanel = document.getElementById("classicOptimizePanel");
    const reversePanel = document.getElementById("classicReversePanel");
    if (!modal || !optimizePanel || !reversePanel) return;
    optimizePanel.style.display = mode === "optimize" ? "block" : "none";
    reversePanel.style.display = mode === "reverse" ? "block" : "none";
    modal.style.display = "flex";
  };
  window.closeClassicPromptTool = function () {
    const modal = document.getElementById("classicPromptToolModal");
    if (modal) modal.style.display = "none";
  };
  window.handleClassicPromptToolBackdrop = function (event) {
    if (event?.target?.id === "classicPromptToolModal") {
      window.closeClassicPromptTool();
    }
  };
  window.optimizeClassicPrompt = async function () {
    const prompt = getClassicPromptText();
    if (!prompt) {
      if (typeof showSoftToast === "function") showSoftToast("请先输入提示词");
      return;
    }
    if (!ensureClassicPromptToolSession()) return;

    await loadClassicPromptToolConfig();
    setClassicPromptToolHeader("提示词优化", classicPromptToolState.config.optimizeCost);
    showClassicPromptToolModal("optimize");

    const statusEl = document.getElementById("classicOptimizeStatus");
    const optionsEl = document.getElementById("classicOptimizeOptions");
    const btn = document.getElementById("classicOptimizePromptBtn");
    if (statusEl) statusEl.textContent = "正在优化提示词...";
    if (optionsEl) optionsEl.innerHTML = "";
    if (btn) btn.disabled = true;

    try {
      const data = await fetchJson("/optimize-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
        body: JSON.stringify({ prompt, type: "IMAGE" }),
      });
      if (!Array.isArray(data.options) || data.options.length === 0) {
        throw new Error("优化失败：未返回结果");
      }
      if (statusEl) {
        statusEl.textContent = `已扣 ${formatPointValue(data.cost ?? classicPromptToolState.config.optimizeCost)} 金币，余额 ${formatPointValue(data.billing?.remainingPoints ?? bridgeAuthState.account?.points ?? 0)} 点`;
      }
      if (optionsEl) {
        optionsEl.innerHTML = "";
        data.options.forEach((option, index) => {
          const card = document.createElement("div");
          card.className = "classic-optimize-card";
          const title = document.createElement("div");
          title.className = "classic-optimize-title";
          title.textContent = option.style || `优化方案 ${index + 1}`;
          const text = document.createElement("pre");
          text.className = "classic-optimize-text";
          text.textContent = option.prompt || "";
          const actions = document.createElement("div");
          actions.className = "classic-optimize-actions";
          const copyBtn = document.createElement("button");
          copyBtn.className = "classic-inline-tool-btn";
          copyBtn.textContent = "复制";
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(option.prompt || "");
            if (typeof showSoftToast === "function") showSoftToast("已复制优化提示词");
          };
          const useBtn = document.createElement("button");
          useBtn.className = "classic-prompt-primary-btn compact";
          useBtn.textContent = "使用此方案";
          useBtn.onclick = () => {
            setClassicPromptText(option.prompt || "");
            window.closeClassicPromptTool();
          };
          actions.append(copyBtn, useBtn);
          card.append(title, text, actions);
          optionsEl.appendChild(card);
        });
      }
      await refreshClassicSession(false);
    } catch (error) {
      if (statusEl) statusEl.textContent = error?.message || "优化失败，请稍后重试";
    } finally {
      if (btn) btn.disabled = false;
      updateClassicPromptToolLabels();
    }
  };
  window.openClassicReversePrompt = async function (event) {
    if (event?.stopPropagation) event.stopPropagation();
    if (!ensureClassicPromptToolSession()) return;
    await loadClassicPromptToolConfig();
    setClassicPromptToolHeader("图片逆推提示词", classicPromptToolState.config.reverseCost);
    showClassicPromptToolModal("reverse");
    updateClassicPromptToolLabels();
  };
  window.handleClassicReverseFileChange = function (event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      if (typeof showSoftToast === "function") showSoftToast("请上传有效的图片文件");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      if (typeof showSoftToast === "function") showSoftToast("图片大小不能超过 4MB");
      return;
    }
    classicPromptToolState.reverseFile = file;
    classicPromptToolState.reverseResult = null;
    const upload = document.getElementById("classicReverseUpload");
    const previewWrap = document.getElementById("classicReversePreviewWrap");
    const preview = document.getElementById("classicReversePreview");
    const analyzeBtn = document.getElementById("classicReverseAnalyzeBtn");
    const result = document.getElementById("classicReverseResult");
    if (upload) upload.style.display = "none";
    if (previewWrap) previewWrap.style.display = "grid";
    if (result) result.style.display = "none";
    if (analyzeBtn) analyzeBtn.disabled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (preview) preview.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  };
  const getClassicReverseResultText = () => {
    const result = classicPromptToolState.reverseResult;
    if (!result) return "";
    return classicPromptToolState.reverseTab === "json"
      ? JSON.stringify(result.jsonPrompt || {}, null, 2)
      : String(result.plainPrompt || result.prompt || "");
  };
  const renderClassicReverseResult = () => {
    const textEl = document.getElementById("classicReverseResultText");
    const resultWrap = document.getElementById("classicReverseResult");
    const plainTab = document.getElementById("classicPlainPromptTab");
    const jsonTab = document.getElementById("classicJsonPromptTab");
    if (textEl) textEl.textContent = getClassicReverseResultText();
    if (resultWrap) resultWrap.style.display = classicPromptToolState.reverseResult ? "block" : "none";
    if (plainTab) plainTab.classList.toggle("active", classicPromptToolState.reverseTab === "plain");
    if (jsonTab) jsonTab.classList.toggle("active", classicPromptToolState.reverseTab === "json");
  };
  window.setClassicReverseResultTab = function (tab) {
    classicPromptToolState.reverseTab = tab === "json" ? "json" : "plain";
    renderClassicReverseResult();
  };
  window.analyzeClassicReversePrompt = async function () {
    if (!classicPromptToolState.reverseFile) return;
    if (!ensureClassicPromptToolSession()) return;
    const statusEl = document.getElementById("classicReverseStatus");
    const btn = document.getElementById("classicReverseAnalyzeBtn");
    if (statusEl) statusEl.textContent = "正在分析图片...";
    if (btn) btn.disabled = true;
    try {
      const image = await fileToDataUrl(classicPromptToolState.reverseFile);
      const data = await fetchJson("/reverse-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildSessionHeaders(),
        },
        body: JSON.stringify({ image }),
      });
      const plainPrompt = String(data.plainPrompt || data.prompt || "").trim();
      if (!plainPrompt) throw new Error("逆推失败：未返回结果");
      classicPromptToolState.reverseResult = {
        plainPrompt,
        prompt: plainPrompt,
        jsonPrompt: data.jsonPrompt && typeof data.jsonPrompt === "object" ? data.jsonPrompt : { subject: plainPrompt },
      };
      classicPromptToolState.reverseTab = "plain";
      if (statusEl) {
        statusEl.textContent = `已扣 ${formatPointValue(data.cost ?? classicPromptToolState.config.reverseCost)} 金币，余额 ${formatPointValue(data.billing?.remainingPoints ?? bridgeAuthState.account?.points ?? 0)} 点`;
      }
      renderClassicReverseResult();
      await refreshClassicSession(false);
    } catch (error) {
      if (statusEl) statusEl.textContent = error?.message || "分析失败，请稍后重试";
    } finally {
      if (btn) btn.disabled = false;
      updateClassicPromptToolLabels();
    }
  };
  window.copyClassicReverseResult = function () {
    const text = getClassicReverseResultText();
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (typeof showSoftToast === "function") showSoftToast("已复制提示词");
  };
  window.useClassicReverseResult = function () {
    const text = getClassicReverseResultText();
    if (!text) return;
    setClassicPromptText(text);
    window.closeClassicPromptTool();
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
    label: String(raw.label || raw.id || "线路").trim(),
    modelFamily: String(raw.modelFamily || "default").trim(),
    line: String(raw.line || "default").trim(),
    transport: String(raw.transport || "openai-image").trim(),
    mode: String(raw.mode || "async").trim(),
    baseUrl: String(raw.baseUrl || "").trim(),
    generatePath: String(raw.generatePath || "").trim(),
    taskPath: String(raw.taskPath || "").trim(),
    editPath: String(raw.editPath || "").trim(),
    chatPath: String(raw.chatPath || "").trim(),
    upstreamModel: String(raw.upstreamModel || "").trim(),
    useRequestModel: raw.useRequestModel === true,
    requiresDataUriReferences: raw.requiresDataUriReferences === true,
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
  const normalizeRouteLineKey = (value) => {
    const raw = String(value || "").trim();
    const lineMatch = raw.match(/^line\s*([0-9]+)$/i);
    if (lineMatch?.[1]) return `line${lineMatch[1]}`;
    const digitMatch = raw.match(/^([0-9]+)$/);
    if (digitMatch?.[1]) return `line${digitMatch[1]}`;
    return raw.toLowerCase() || "default";
  };
  const getFriendlyRouteLabel = (route) => {
    const line = normalizeRouteLineKey(route?.line);
    const match = line.match(/^line([0-9]+)$/i);
    if (match?.[1]) return `线路 ${match[1]}`;
    if (line.toLowerCase() === "default") return "默认线路";
    return String(route?.label || route?.id || "线路").trim() || "线路";
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
    const storedLine = normalizeRouteLineKey(localStorage.getItem(LINE_STORAGE_KEY) || "");
    const selected =
      visibleRoutes.find((route) => normalizeRouteLineKey(route.line) === storedLine) ||
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
    const preferredLineKey = normalizeRouteLineKey(preferredLine);
    return (
      routes.find((route) => normalizeRouteLineKey(route.line) === preferredLineKey) ||
      routes.find((route) => route.isDefaultRoute) ||
      routes.find((route) => route.isDefaultNanoBananaLine) ||
      routes[0]
    );
  };
  const isGptImage2Model = (model, requestModel = "") => {
    const modelId = String(model?.id || "").trim();
    const resolvedRequestModel = String(requestModel || model?.requestModel || "").trim();
    return modelId === "gpt-image-2" || resolvedRequestModel === "gpt-image-2";
  };
  const isGeminiNativeSyncRoute = (route) =>
    String(route?.transport || "").trim() === "gemini-native" &&
    String(route?.mode || "").trim() === "sync";
  const stripAspectRatioSuffix = (promptText) =>
    String(promptText || "")
      .replace(/\s*--ar\s*\d+\s*[:：]\s*\d+/gi, "")
      .trim();
  const GPT_SIZE_PATTERN = /^\s*(\d+)\s*[xX]\s*(\d+)\s*$/;
  const GPT_RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX]\s*(\d+(?:\.\d+)?)\s*$/;
  const roundToMultiple = (value, multiple) =>
    Math.max(multiple, Math.round(Number(value || 0) / multiple) * multiple);
  const normalizeGptImageSize = (size) => {
    const trimmed = String(size || "").trim();
    const match = trimmed.match(GPT_SIZE_PATTERN);
    if (!match) return trimmed;
    return `${roundToMultiple(Number(match[1]), 16)}x${roundToMultiple(Number(match[2]), 16)}`;
  };
  const parseGptRatio = (ratio) => {
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
    if (normalizedSize === "auto") return "auto";
    if (GPT_SIZE_PATTERN.test(normalizedSize)) return normalizeGptImageSize(normalizedSize);

    const tier = normalizedSize === "4k" ? "4k" : normalizedSize === "2k" ? "2k" : "1k";
    const parsedRatio = parseGptRatio(ratio) || { width: 1, height: 1 };
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
  const getClassicGptSettings = () =>
    typeof window.getClassicGptSettings === "function"
      ? window.getClassicGptSettings()
      : {
          quality: "auto",
          outputFormat: "png",
          outputCompression: null,
          moderation: "auto",
        };
  const getGrokPrompt = (basePrompt, ratio, size, modelName) => {
    if (!String(modelName || "").startsWith("grok-")) return basePrompt;
    return `${basePrompt}，${ratio}，超高品质${String(size || "").toUpperCase()}分辨率`;
  };
  const buildClassicGptPayload = ({
    selectedModel,
    selectedRoute,
    prompt,
    size,
    ratio,
    n = 1,
  }) => {
    const gptSettings = getClassicGptSettings();
    const payload = {
      model: "gpt-image-2",
      modelId: selectedModel.id,
      routeId: selectedRoute.id,
      uiMode: "classic",
      prompt,
      size: calculateClassicGptImageSize(size, ratio),
      quality: gptSettings.quality,
      output_format: gptSettings.outputFormat,
      moderation: gptSettings.moderation,
      n,
    };
    if (gptSettings.outputFormat !== "png" && gptSettings.outputCompression !== null) {
      payload.output_compression = Math.max(
        0,
        Math.min(100, Math.round(Number(gptSettings.outputCompression))),
      );
    }
    return payload;
  };
  const buildClassicGeminiPayload = ({
    selectedModel,
    selectedRoute,
    prompt,
    ratio,
    size,
    quantity,
    referenceImages,
  }) => {
    const parts = [{ text: prompt }];
    referenceImages.forEach((imageValue) => {
      const rawValue = String(imageValue || "").trim();
      if (!rawValue) return;
      const match = rawValue.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      } else {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: rawValue,
          },
        });
      }
    });
    return {
      model: String(selectedModel.requestModel || selectedModel.id || "").trim(),
      modelId: selectedModel.id,
      routeId: selectedRoute.id,
      uiMode: "classic",
      prompt,
      aspect_ratio: ratio,
      image_size: String(size || "1K").trim().toUpperCase(),
      strict_native_config: true,
      n: quantity,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        imageConfig: {
          aspectRatio: ratio,
          imageSize: String(size || "1K").trim().toUpperCase(),
        },
        candidateCount: quantity,
      },
    };
  };
  const createClassicCollageFromSrcs = async (srcs) => {
    if (!Array.isArray(srcs) || srcs.length === 0) return "";
    return new Promise((resolve, reject) => {
      const loadedImages = [];
      let loadedCount = 0;
      let hasError = false;
      srcs.forEach((src) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (hasError) return;
          loadedCount += 1;
          if (loadedCount === srcs.length) renderCollage();
        };
        img.onerror = () => {
          hasError = true;
          reject(new Error("加载参考图失败"));
        };
        img.src = src;
        loadedImages.push(img);
      });
      const renderCollage = () => {
        const gap = 10;
        let maxHeight = 0;
        loadedImages.forEach((img) => {
          maxHeight = Math.max(maxHeight, img.height);
        });
        const scale = maxHeight > 1024 ? 1024 / maxHeight : 1;
        let scaledTotalWidth = 0;
        loadedImages.forEach((img) => {
          scaledTotalWidth += img.width * scale + gap;
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(scaledTotalWidth - gap));
        canvas.height = Math.max(1, Math.round(maxHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 创建失败"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        let currentX = 0;
        loadedImages.forEach((img) => {
          const width = img.width * scale;
          ctx.drawImage(img, currentX, 0, width, img.height * scale);
          currentX += width + gap;
        });
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
    });
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
  const syncClassicPriceUi = () => {
    const updatePriceCard =
      typeof window.updateCurrentPriceCard === "function"
        ? window.updateCurrentPriceCard
        : typeof updateCurrentPriceCard === "function"
          ? updateCurrentPriceCard
          : null;
    if (typeof updatePriceCard === "function") updatePriceCard();

    const priceOverlay = document.getElementById("priceOverlay");
    const isPriceOpen = priceOverlay && priceOverlay.style.display === "flex";
    if (isPriceOpen && typeof window.renderPriceTable === "function") {
      window.renderPriceTable();
    }
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
    if (typeof window.updateClassicRefUploadHint === "function") {
      window.updateClassicRefUploadHint();
    }
    if (typeof window.updateClassicGptSettingsUi === "function") {
      window.updateClassicGptSettingsUi();
    }
    syncClassicPriceUi();
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
  const fetchGenerationRecords = async ({
    mediaType = "all",
    status = "all",
    page = 1,
    pageSize = HISTORY_INITIAL_PAGE_SIZE,
    sinceCreatedAt = "",
    sinceId = "",
  } = {}) => {
    const params = new URLSearchParams();
    params.set("mediaType", String(mediaType || "all"));
    params.set("status", String(status || "all"));
    params.set("page", String(page || 1));
    params.set("pageSize", String(pageSize || HISTORY_INITIAL_PAGE_SIZE));
    if (sinceCreatedAt) params.set("sinceCreatedAt", String(sinceCreatedAt));
    if (sinceId) params.set("sinceId", String(sinceId));
    return fetchJson(`/generation-records?${params.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        ...buildSessionHeaders(),
      },
    });
  };
  const deleteGenerationRecords = async ({ mediaType = "all" } = {}) =>
    fetchJson(`/generation-records?mediaType=${encodeURIComponent(mediaType)}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...buildSessionHeaders(),
      },
    });
  const dedupeHistoryRecords = (records = []) => {
    const seen = new Set();
    const ordered = [];
    (Array.isArray(records) ? records : []).forEach((record) => {
      const recordId = String(record?.id || "").trim();
      const urlKey = String(record?.resultUrls?.[0] || record?.previewUrl || "").trim();
      const key = urlKey || recordId || `${record?.createdAt || ""}:${record?.previewUrl || ""}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      ordered.push(record);
    });
    ordered.sort((a, b) => {
      const aTime = String(a?.createdAt || "");
      const bTime = String(b?.createdAt || "");
      return bTime.localeCompare(aTime);
    });
    return ordered;
  };
  const getHistoryCursorFromRecords = (records = []) => {
    const first = Array.isArray(records) ? records[0] : null;
    return {
      sinceCreatedAt: String(first?.createdAt || "").trim(),
      sinceId: String(first?.id || "").trim(),
    };
  };
  const isHistoryTabVisible = () => {
    const historyTab = document.getElementById("tab-gallery");
    return Boolean(historyTab && historyTab.classList.contains("active"));
  };
  const scheduleRemoteHistoryRefresh = () => {
    if (!isSessionAuthenticated()) return;
    if (!isHistoryTabVisible()) return;
    if (historyRefreshTimer) return;

    historyRefreshTimer = window.setTimeout(async () => {
      historyRefreshTimer = null;
      if (!isSessionAuthenticated() || !isHistoryTabVisible()) return;
      const elapsed = Date.now() - lastHistoryRefreshAt;
      if (elapsed < HISTORY_REFRESH_MIN_INTERVAL_MS) {
        scheduleRemoteHistoryRefresh();
        return;
      }
      await loadHistory({ incremental: true, force: false });
    }, HISTORY_REFRESH_DEBOUNCE_MS);
  };
  const formatHistoryClock = (isoString) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
  const readLocalClassicHistoryRecords = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("nb_history") || "[]");
      return (Array.isArray(raw) ? raw : [])
        .map((item) => {
          const fullUrl =
            typeof item === "string"
              ? item
              : String(item?.fullUrl || item?.url || "").trim();
          if (!fullUrl) return null;
          const previewUrl =
            typeof item === "string"
              ? (typeof getClassicLine4ThumbUrl === "function" && getClassicLine4ThumbUrl(item)) || item
              : String(item?.previewUrl || item?.displayUrl || item?.url || fullUrl).trim();
          const completedAt =
            typeof item === "object" && item?.completedAt
              ? String(item.completedAt)
              : typeof item === "object" && item?.createdAt
                ? String(item.createdAt)
                : new Date().toISOString();
          return {
            id: `local:${typeof item === "object" && item?.id ? item.id : fullUrl}`,
            resultUrls: [fullUrl],
            previewUrl: previewUrl || fullUrl,
            prompt: typeof item === "object" ? String(item.prompt || "") : "",
            createdAt: completedAt,
            completedAt,
            localOnly: true,
          };
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  };
  const mergeRemoteAndLocalHistoryRecords = (records = []) =>
    dedupeHistoryRecords([...readLocalClassicHistoryRecords(), ...(Array.isArray(records) ? records : [])]);
  const renderRemoteHistoryGrid = async (records = []) => {
    if (typeof clearHistoryObjectUrlRefs === "function") {
      clearHistoryObjectUrlRefs();
    }
    const grid = document.getElementById("historyGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const mergedRecords = mergeRemoteAndLocalHistoryRecords(records);

    if (!Array.isArray(mergedRecords) || mergedRecords.length === 0) {
      grid.innerHTML =
        '<div style="color:var(--text-sub); grid-column:1/-1; text-align:center; padding:20px; font-size:12px;">暂无历史记录</div>';
      return;
    }

    mergedRecords.forEach((record) => {
      const originalUrl = String(record.resultUrls?.[0] || record.previewUrl || "").trim();
      const url = String(record.previewUrl || originalUrl || "").trim();
      if (!originalUrl) return;
      const recordId = String(record.id || "").trim();
      const prompt = String(record.prompt || "");
      const encodedPrompt = encodeURIComponent(prompt || "");
      const promptLabel = prompt ? `提示词：${prompt}` : "提示词：无记录";
      const promptTooltip = prompt ? `<div class="history-prompt-tip">${escapeHtml(promptLabel)}</div>` : "";
      const time = formatHistoryClock(record.completedAt || record.createdAt);

      const div = document.createElement("div");
      div.className = "result-item history-item";
      div.title = promptLabel;
      div.dataset.fullUrl = originalUrl;
      div.dataset.displayUrl = url;
      div.innerHTML = `
        <img src="${url}" loading="lazy" onclick="openLightbox(this.closest('.history-item').dataset.fullUrl || this.src)">
        ${time ? `<div class="history-time-tag">${time}</div>` : ""}
        <div class="history-cache-badge syncing">缓存中</div>
        ${promptTooltip}
        <div class="item-overlay">
          <button class="overlay-btn history-icon-btn" data-label="放大" onclick="openLightbox(this.closest('.history-item').dataset.fullUrl || this.closest('.history-item').querySelector('img').src)">🔍</button>
          <button class="overlay-btn history-icon-btn" data-label="保存" onclick="downloadSingleImg(this.closest('.history-item').dataset.fullUrl || this.closest('.history-item').querySelector('img').src)">💾</button>
          <button class="overlay-btn history-icon-btn" data-label="重生" onclick="regenerateFromHistory('${encodedPrompt}')">♻️</button>
          <button class="overlay-btn history-icon-btn" data-label="垫图" onclick="useAsRef(this.closest('.history-item').dataset.fullUrl || this.closest('.history-item').querySelector('img').src)">🧩</button>
          <button class="overlay-btn history-icon-btn" data-label="链接" onclick="copyImgUrl(this.closest('.history-item').dataset.fullUrl || '${originalUrl}')">🔗</button>
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
              cacheHistoryImage(recordId, originalUrl).then((ok) => {
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
  const legacySwitchTab =
    typeof switchTab === "function" ? switchTab.bind(window) : null;

  if (legacySwitchTab) {
    switchTab = function (tabName) {
      legacySwitchTab(tabName);
      if (isSessionAuthenticated() && String(tabName || "").trim().toLowerCase() === "gallery") {
        void loadHistory({ incremental: false, force: true });
      }
    };
  }

  saveToHistory = function (url, promptText = "", previewUrl = "") {
    if (legacySaveToHistory) {
      legacySaveToHistory(url, promptText, previewUrl);
    }
    if (!isSessionAuthenticated()) {
      return undefined;
    }
    scheduleRemoteHistoryRefresh();
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

  loadHistory = async function ({ incremental = false, force = true } = {}) {
    if (!isSessionAuthenticated()) {
      remoteHistoryRecordsCache = [];
      remoteHistoryCursor = {
        sinceCreatedAt: "",
        sinceId: "",
      };
      return legacyLoadHistory ? legacyLoadHistory() : undefined;
    }

    try {
      const useIncremental =
        incremental &&
        Boolean(remoteHistoryCursor.sinceCreatedAt) &&
        (!force || isHistoryTabVisible());
      const result = await fetchGenerationRecords({
        mediaType: "image",
        status: "success",
        page: 1,
        pageSize: HISTORY_INITIAL_PAGE_SIZE,
        sinceCreatedAt: useIncremental ? remoteHistoryCursor.sinceCreatedAt : "",
        sinceId: useIncremental ? remoteHistoryCursor.sinceId : "",
      });
      const incoming = Array.isArray(result?.records) ? result.records : [];
      remoteHistoryRecordsCache = useIncremental
        ? dedupeHistoryRecords([...incoming, ...remoteHistoryRecordsCache]).slice(0, 200)
        : dedupeHistoryRecords(incoming);
      remoteHistoryCursor = getHistoryCursorFromRecords(remoteHistoryRecordsCache);
      lastHistoryRefreshAt = Date.now();
      await renderRemoteHistoryGrid(remoteHistoryRecordsCache);
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
          if (typeof window.ensureClassicLiveTaskForPending === "function") {
            window.ensureClassicLiveTaskForPending({
              taskId: record.taskId,
              prompt: record.prompt || "",
              size: String(record.outputSize || "1K"),
              modelLabel: record.modelId || record.model || "",
              routeLabel: record.routeId || record.route || "",
              index: index + 1,
              status: "running",
              createdAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
            });
          }
          if (remotePendingPollRegistry.has(record.taskId)) return;
          remotePendingPollRegistry.add(record.taskId);
          pollSingleTask(record.taskId, "", String(record.outputSize || "1K"), index + 1, {
            trackUi: false,
            route: getCurrentRoute(),
            taskId: record.taskId,
            promptSnapshot: record.prompt || "",
            modelLabel: record.modelId || record.model || "",
            routeLabel: record.routeId || record.route || "",
          });
        });
    } catch (error) {
      console.warn("[Classic Bridge] restore remote pending tasks failed:", error);
    }
  };
  submitSingleTask = async function (payload, key, size, index, options = {}) {
    const liveTaskIds = Array.isArray(options.liveTaskIds)
      ? options.liveTaskIds.filter(Boolean)
      : options.liveTaskId
        ? [options.liveTaskId]
        : [];
    const liveTaskForSlot = (slot = 0) => liveTaskIds[slot] || liveTaskIds[0] || "";
    const promptSnapshot = String(
      options.promptSnapshot || document.getElementById("prompt")?.value?.trim() || "",
    );
    const failLiveTasks = (message) => {
      if (typeof window.failClassicLiveTask !== "function") return;
      const ids = liveTaskIds.length > 0 ? liveTaskIds : [options.taskId].filter(Boolean);
      ids.forEach((liveId) => {
        window.failClassicLiveTask(liveId, message, {
          prompt: promptSnapshot,
          size,
          modelLabel: options.modelLabel || "",
          routeLabel: options.routeLabel || "",
        });
      });
    };
    try {
      const route = options.route || getCurrentRoute();
      const endpoint = String(options.endpoint || CONFIG.submitUrl || "/api/generate").trim();
      const response = await fetch(endpoint, {
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
        const promptText = promptSnapshot;
        const expectedCount = Math.max(1, Number(options.expectedCount || directImageUrls.length || 1));
        directImageUrls.forEach((imageUrl, imageIndex) => {
          const liveTaskId = liveTaskForSlot(imageIndex);
          if (liveTaskId && typeof window.completeClassicLiveTask === "function") {
            window.completeClassicLiveTask(liveTaskId, imageUrl, {
              prompt: promptText,
              size,
              modelLabel: options.modelLabel || "",
              routeLabel: options.routeLabel || "",
            });
          }
          if (canUpdateMainUi(options.runToken, options.trackUi !== false)) {
            appendImageToGrid(imageUrl, size, null, {
              runToken: options.runToken,
              trackUi: options.trackUi !== false,
              liveTaskId,
              promptSnapshot: promptText,
              modelLabel: options.modelLabel || "",
              routeLabel: options.routeLabel || "",
            });
          } else {
            saveToHistory(imageUrl, promptText);
          }
        });
        const missingCount = Math.max(0, expectedCount - directImageUrls.length);
        for (let missingIndex = 0; missingIndex < missingCount; missingIndex += 1) {
          const liveTaskId = liveTaskForSlot(directImageUrls.length + missingIndex);
          if (liveTaskId && typeof window.failClassicLiveTask === "function") {
            window.failClassicLiveTask(liveTaskId, USER_FACING_GENERATION_ERROR_MESSAGE, {
              prompt: promptText,
              size,
              modelLabel: options.modelLabel || "",
              routeLabel: options.routeLabel || "",
            });
          }
          if (!canUpdateMainUi(options.runToken, options.trackUi !== false)) break;
          handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
        }
        return;
      }

      const taskId = data.task_id || data.id || data.data?.task_id || "";
      if (!taskId) {
        throw new Error(`任务 ${index} 未获取到ID`);
      }

      const directKeyForTask = shouldUseDirectApiKeyForRoute(route, key) ? key : "";
      const liveTaskId = liveTaskForSlot(0);
      if (typeof window.promoteClassicLiveTask === "function") {
        window.promoteClassicLiveTask(liveTaskId || taskId, taskId, {
          prompt: promptSnapshot,
          size,
          modelLabel: options.modelLabel || "",
          routeLabel: options.routeLabel || "",
          status: "running",
        });
      }
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
        liveTaskIds,
        liveTaskId,
        taskId,
      });
    } catch (error) {
      console.error("[Classic Bridge] submit task failed:", error);
      failLiveTasks(USER_FACING_GENERATION_ERROR_MESSAGE);
      if (!canUpdateMainUi(options.runToken, options.trackUi !== false)) return;
      const expectedCount = Math.max(1, Number(options.expectedCount || 1));
      for (let failureIndex = 0; failureIndex < expectedCount; failureIndex += 1) {
        handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
      }
    } finally {
      if (typeof options.onSubmitSettled === "function") {
        try {
          options.onSubmitSettled();
        } catch (_) {}
      }
    }
  };
  pollSingleTask = async function (taskId, key, size, index, options = {}) {
    let errorCount = 0;
    const maxErrors = 5;
    let successNoUrlCount = 0;
    const maxSuccessNoUrlCount = 3;
    const startedAt = Date.now();
    const maxPollMs = 10 * 60 * 1000;
    const trackUi = options.trackUi !== false;
    const liveTaskIds = Array.isArray(options.liveTaskIds)
      ? options.liveTaskIds.filter(Boolean)
      : options.liveTaskId
        ? [options.liveTaskId]
        : [];
    const promptSnapshot = String(
      options.promptSnapshot || document.getElementById("prompt")?.value?.trim() || "",
    );
    const liveTaskForSlot = (slot = 0) => liveTaskIds[slot] || liveTaskIds[0] || taskId;
    const completeLiveTask = (imageUrl, slot = 0) => {
      if (typeof window.completeClassicLiveTask !== "function") return;
      window.completeClassicLiveTask(liveTaskForSlot(slot), imageUrl, {
        taskId,
        prompt: promptSnapshot,
        size,
        modelLabel: options.modelLabel || "",
        routeLabel: options.routeLabel || "",
      });
    };
    const failLiveTask = (message) => {
      if (typeof window.failClassicLiveTask !== "function") return;
      const ids = liveTaskIds.length > 0 ? liveTaskIds : [taskId];
      ids.forEach((liveId) => {
        window.failClassicLiveTask(liveId, message, {
          taskId,
          prompt: promptSnapshot,
          size,
          modelLabel: options.modelLabel || "",
          routeLabel: options.routeLabel || "",
        });
      });
    };

    const checkLoop = setInterval(async () => {
      try {
        if (Date.now() - startedAt > maxPollMs) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          failLiveTask("查询超时，任务状态未完成");
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
          failLiveTask("任务已失效或未找到");
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
          completeLiveTask(imageUrls[0], 0);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            appendImageToGrid(imageUrls[0], size, null, {
              runToken: options.runToken,
              trackUi,
              liveTaskId: liveTaskForSlot(0),
              taskId,
              promptSnapshot,
              modelLabel: options.modelLabel || "",
              routeLabel: options.routeLabel || "",
            });
          } else {
            saveToHistory(imageUrls[0], promptSnapshot);
          }
          return;
        }

        if (statusRaw === "SUCCESS" || statusRaw === "SUCCEEDED" || statusRaw === "COMPLETED") {
          successNoUrlCount += 1;
          if (successNoUrlCount >= maxSuccessNoUrlCount) {
            clearInterval(checkLoop);
            removePendingTask(taskId);
            removePendingTaskFromGallery(taskId);
            failLiveTask("任务成功但未返回图片链接");
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
          failLiveTask("生成失败");
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
          failLiveTask("查询连接持续失败");
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(USER_FACING_GENERATION_ERROR_MESSAGE, size);
          }
        }
      }
    }, 5000);
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
    btn.innerHTML = "提交中...";
    imgContainer.style.display = "flex";
    manualBtn.style.display = "none";
    errPlaceholder.style.display = "none";
    resultGrid.innerHTML = "";
    resultGrid.className = "result-grid classic-legacy-result-grid";
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
    const normalizedRequestSize = String(size || "1K").trim().toLowerCase();
    const promptWithoutAr = stripAspectRatioSuffix(promptBaseText);
    const gptImage2Model = isGptImage2Model(selectedModel, requestModel);
    const currentPrompt = gptImage2Model ? promptWithoutAr : `${promptWithoutAr} --ar ${ratio}`.trim();

    if (submitReferenceIndices.length > 0) {
      submitReferenceIndices = submitReferenceIndices.slice();
    }

    const normalizedRefImages = submitRefImages
      .map((imgData) => String(imgData || "").trim())
      .filter((imgData) => imgData.length > 0);
    const rawBase64Images = normalizedRefImages.map((imgData) =>
      imgData.includes(",") ? imgData.split(",")[1] : imgData,
    );

    const modelLabel = selectedModel.label || selectedModel.name || selectedModel.id || requestModel;
    const routeLabel =
      typeof getClassicLineLabel === "function"
        ? getClassicLineLabel(selectedRoute.line, selectedRoute.label)
        : selectedRoute.label || selectedRoute.name || selectedRoute.id || "";
    const releaseSubmitButton = () => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = "INITIATE // 开始生产";
      }
      if (statusText && activeTasksCount > 0) {
        statusText.innerText = "任务已提交，可继续创作下一组";
        statusText.style.color = "var(--banana)";
      }
    };
    const createSubmitSettledTracker = (total) => {
      const expectedTotal = Math.max(1, Number(total || 1));
      let settledCount = 0;
      let released = false;
      return () => {
        settledCount += 1;
        if (!released && settledCount >= expectedTotal) {
          released = true;
          releaseSubmitButton();
        }
      };
    };
    const createLiveTask = (taskIndex) => {
      if (typeof window.createClassicLiveTask !== "function") return "";
      return window.createClassicLiveTask({
        prompt: promptBaseText,
        modelLabel,
        routeLabel,
        size,
        ratio,
        index: taskIndex,
        quantity: batchSize,
        referenceCount: normalizedRefImages.length,
        status: "submitting",
      });
    };

    if (isGeminiNativeSyncRoute(selectedRoute)) {
      const markSubmitSettled = createSubmitSettledTracker(1);
      const liveTaskIds = Array.from({ length: batchSize }, (_, taskIndex) =>
        createLiveTask(taskIndex + 1),
      ).filter(Boolean);
      submitSingleTask(
        buildClassicGeminiPayload({
          selectedModel,
          selectedRoute,
          prompt: currentPrompt,
          ratio,
          size,
          quantity: batchSize,
          referenceImages: normalizedRefImages,
        }),
        key,
        size,
        1,
        {
          route: selectedRoute,
          modelId: selectedModel.id,
          model: requestModel,
          runToken,
          trackUi: true,
          endpoint: "/api/gemini/generate",
          expectedCount: batchSize,
          liveTaskIds,
          promptSnapshot: promptBaseText,
          modelLabel,
          routeLabel,
          onSubmitSettled: markSubmitSettled,
        },
      );
      return;
    }

    if (gptImage2Model) {
      const markSubmitSettled = createSubmitSettledTracker(batchSize);
      for (let i = 0; i < batchSize; i += 1) {
        const liveTaskId = createLiveTask(i + 1);
        setTimeout(() => {
          const payload = buildClassicGptPayload({
            selectedModel,
            selectedRoute,
            prompt: currentPrompt,
            size,
            ratio,
            n: 1,
          });
          if (submitReferenceIndices.length > 0) {
            payload.reference_indices = submitReferenceIndices.slice();
          }
          if (normalizedRefImages.length > 0) {
            payload.images = normalizedRefImages.slice();
          }
          submitSingleTask(payload, key, size, i + 1, {
            route: selectedRoute,
            modelId: selectedModel.id,
            model: requestModel,
            runToken,
            trackUi: true,
            endpoint: normalizedRefImages.length > 0 ? "/api/edit" : CONFIG.submitUrl,
            expectedCount: 1,
            liveTaskId,
            liveTaskIds: liveTaskId ? [liveTaskId] : [],
            promptSnapshot: promptBaseText,
            modelLabel,
            routeLabel,
            onSubmitSettled: markSubmitSettled,
          });
        }, i * 180);
      }
      return;
    }

    const promptForRequest = getGrokPrompt(currentPrompt, ratio, size, requestModel);
    const payloadBase = {
      modelId: selectedModel.id,
      routeId: selectedRoute.id,
      uiMode: "classic",
      model: requestModel,
      prompt: promptForRequest,
      size: normalizedRequestSize,
      aspect_ratio: ratio,
      n: 1,
    };
    if (submitReferenceIndices.length > 0) {
      payloadBase.reference_indices = submitReferenceIndices.slice();
    }
    if (normalizedRefImages.length > 0) {
      const isDoubaoModel = String(selectedModel?.sizeBehavior || "").startsWith("doubao");
      const isGrokModel = String(requestModel || "").startsWith("grok-");
      if (isDoubaoModel) {
        payloadBase.image = rawBase64Images.slice();
      } else if (isGrokModel) {
        const grokRefMode =
          typeof getGrokRefMode === "function" ? getGrokRefMode() : "stable_fusion";
        const rawPrimaryImage = rawBase64Images[0];
        const isMultiRef = rawBase64Images.length > 1;
        payloadBase.reference_mode = grokRefMode;
        payloadBase.image =
          grokRefMode === "classic_multi" && isMultiRef
            ? rawBase64Images.slice()
            : rawPrimaryImage;
        payloadBase.images = rawBase64Images.slice();
        payloadBase.reference_image = rawPrimaryImage;
        payloadBase.reference_images = rawBase64Images.slice();
      } else {
        let collageBase64 = "";
        try {
          collageBase64 = await createClassicCollageFromSrcs(normalizedRefImages);
        } catch (error) {
          console.error("[Classic Bridge] create reference collage failed:", error);
          activeTasksCount = 0;
          clearInterval(progressInterval);
          if (bar) bar.style.display = "none";
          if (statusText) {
            statusText.innerText = "参考图处理失败，请重新上传后再试";
            statusText.style.color = "#FFD60A";
          }
          releaseSubmitButton();
          return;
        }
        const collageRaw = collageBase64.includes(",") ? collageBase64.split(",")[1] : collageBase64;
        payloadBase.prompt =
          normalizedRefImages.length > 1
            ? `[多图参考] 输入是 ${normalizedRefImages.length} 张图片的拼贴。${currentPrompt}`
            : currentPrompt;
        payloadBase.image = collageRaw;
        payloadBase.images = [collageRaw];
      }
    }

    const markSubmitSettled = createSubmitSettledTracker(batchSize);
    for (let i = 0; i < batchSize; i += 1) {
      const liveTaskId = createLiveTask(i + 1);
      setTimeout(() => {
        submitSingleTask(
          {
            ...payloadBase,
            n: 1,
          },
          key,
          size,
          i + 1,
          {
            route: selectedRoute,
            modelId: selectedModel.id,
            model: requestModel,
            runToken,
            trackUi: true,
            liveTaskId,
            liveTaskIds: liveTaskId ? [liveTaskId] : [],
            promptSnapshot: promptBaseText,
            modelLabel,
            routeLabel,
            onSubmitSettled: markSubmitSettled,
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

    await Promise.allSettled([
      loadRegistrationStatus(),
      loadClassicCatalogs(),
      loadClassicPromptToolConfig(),
      refreshClassicSession(false),
    ]);
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

