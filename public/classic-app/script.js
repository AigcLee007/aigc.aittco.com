// public/script.js

// --- 核心配置 ---
const CONFIG = {
  submitUrl: "/api/generate",
  queryUrl: "/api/check/{id}",
  model: "nano-banana-2",
};
let refImages = [];
let smartRatio = null;
let progressInterval = null;
let draggedIdx = null; // 用于参考图拖拽排序的全局索引追踪
let imageModel = localStorage.getItem('nb_image_model') || 'nano-banana';
let suppressThumbPreviewUntil = 0;
let historyObjectUrls = [];
const GROK_REF_MODE_KEY = "nb_grok_ref_mode";
const PromptTagsUtil = window.PromptTagsUtil || null;
const MAX_REF_IMAGES = 10;
const NOTICE_READ_TS_KEY = "nb_notice_last_read_ts";
const NOTICE_POPUP_DISMISSED_KEY = "nb_notice_popup_dismissed_id";
const CREATE_MODE_STORAGE_KEY = "preferred-create-ui";

try {
  localStorage.setItem(CREATE_MODE_STORAGE_KEY, "classic");
} catch (_) {}

const HISTORY_CACHE_DB = "nb_history_cache_db";
const HISTORY_CACHE_STORE = "images";

function openHistoryCacheDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HISTORY_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_CACHE_STORE)) {
        db.createObjectStore(HISTORY_CACHE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fetchAsBlob(src) {
  return fetch(src).then((res) => {
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return res.blob();
  });
}

async function cacheHistoryImage(recordId, src) {
  if (!recordId || !src) return false;
  try {
    const blob = await fetchAsBlob(src);
    const db = await openHistoryCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_CACHE_STORE, "readwrite");
      tx.objectStore(HISTORY_CACHE_STORE).put({
        id: recordId,
        blob,
        updatedAt: Date.now(),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (e) {
    console.warn("cacheHistoryImage failed:", e);
    return false;
  }
}

async function getCachedHistoryImage(recordId) {
  if (!recordId) return null;
  try {
    const db = await openHistoryCacheDB();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_CACHE_STORE, "readonly");
      const req = tx.objectStore(HISTORY_CACHE_STORE).get(recordId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return data?.blob || null;
  } catch (e) {
    console.warn("getCachedHistoryImage failed:", e);
    return null;
  }
}

async function removeCachedHistoryImage(recordId) {
  if (!recordId) return;
  try {
    const db = await openHistoryCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_CACHE_STORE, "readwrite");
      tx.objectStore(HISTORY_CACHE_STORE).delete(recordId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("removeCachedHistoryImage failed:", e);
  }
}

async function clearCachedHistoryImages() {
  try {
    const db = await openHistoryCacheDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_CACHE_STORE, "readwrite");
      tx.objectStore(HISTORY_CACHE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("clearCachedHistoryImages failed:", e);
  }
}

function genHistoryId() {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clearHistoryObjectUrlRefs() {
  historyObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  historyObjectUrls = [];
}

function parseAspectRatio(ratioText) {
  const txt = String(ratioText || "").trim();
  const m = txt.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return { w: 1, h: 1, text: "1:1" };
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return { w: 1, h: 1, text: "1:1" };
  return { w, h, text: `${w}:${h}` };
}

function buildGrokSizeInstruction(size, ratioValue, smartRatioValue) {
  const qualityBase = { "1K": 1024, "2K": 2048, "4K": 3840 }[size] || 1024;
  const ratioRaw = ratioValue === "auto" ? (smartRatioValue || "1:1") : ratioValue;
  const ratio = parseAspectRatio(ratioRaw);

  let width;
  let height;
  if (ratio.w >= ratio.h) {
    height = qualityBase;
    width = Math.round((qualityBase * ratio.w) / ratio.h);
  } else {
    width = qualityBase;
    height = Math.round((qualityBase * ratio.h) / ratio.w);
  }

  // 统一到 64 的倍数，减少模型端尺寸归整误差
  width = Math.max(512, Math.round(width / 64) * 64);
  height = Math.max(512, Math.round(height / 64) * 64);

  // 上游兼容保护：避免分辨率过大导致任务失败
  const maxEdge = size === "4K" ? 4096 : size === "2K" ? 2304 : 1344;
  const currentMax = Math.max(width, height);
  if (currentMax > maxEdge) {
    const scale = maxEdge / currentMax;
    width = Math.max(512, Math.round((width * scale) / 64) * 64);
    height = Math.max(512, Math.round((height * scale) / 64) * 64);
  }

  return {
    ratioText: ratio.text,
    sizeText: size,
    width,
    height,
  };
}

function setHistoryCacheBadge(cardEl, status) {
  if (!cardEl) return;
  const badge = cardEl.querySelector(".history-cache-badge");
  if (!badge) return;
  badge.classList.remove("local", "cloud", "syncing");
  if (status === "local") {
    badge.classList.add("local");
    badge.textContent = "已本地保存";
  } else if (status === "cloud") {
    badge.classList.add("cloud");
    badge.textContent = "云端链接";
  } else {
    badge.classList.add("syncing");
    badge.textContent = "缓存中";
  }
}

// 并发控制变量
let activeTasksCount = 0;
let completedTasksCount = 0;
let totalBatchSize = 0;
let currentRunSize = "1K";
let loadedImageCount = 0;
let activeRunToken = 0;
let mentionOptions = [];
let mentionActiveIndex = 0;
let promptTagUiInited = false;
let hoveredRefThumbIndex = -1;
let noticeItems = [];

function canUpdateMainUi(runToken, trackUi = true) {
  if (!trackUi) return false;
  if (!runToken) return true;
  return runToken === activeRunToken;
}

function showSoftToast(message, ms = 2200) {
  const el = document.getElementById("softToast");
  if (!el || !message) return;
  el.textContent = String(message);
  el.style.display = "block";
  clearTimeout(showSoftToast._timer);
  showSoftToast._timer = setTimeout(() => {
    el.style.display = "none";
  }, ms);
}

function getPromptInput() {
  return document.getElementById("prompt");
}

function parsePromptTagState() {
  if (!PromptTagsUtil) {
    return {
      hasAnyTag: false,
      rawTags: [],
      referenceIndices: [],
      duplicateIndices: [],
      invalidIndices: [],
      promptWithoutTags: getPromptInput()?.value?.trim() || "",
    };
  }
  const promptVal = getPromptInput()?.value || "";
  return PromptTagsUtil.parsePromptReferenceTags(promptVal, refImages.length);
}

function updateRefCountBadge() {
  const badge = document.getElementById("refCountBadge");
  if (!badge) return;
  const current = Array.isArray(refImages) ? refImages.length : 0;
  badge.textContent = `${current}/${MAX_REF_IMAGES}`;
}

function updateRefMentionSummary(state) {
  const summaryEl = document.getElementById("refMentionSummary");
  if (!summaryEl) return;
  const parsed = state || parsePromptTagState();
  const referenced = Array.isArray(parsed.referenceIndices) ? parsed.referenceIndices : [];
  const invalid = Array.isArray(parsed.invalidIndices) ? parsed.invalidIndices : [];

  if (referenced.length === 0 && invalid.length === 0) {
    summaryEl.style.display = "none";
    summaryEl.textContent = "";
    summaryEl.classList.remove("warn");
    return;
  }

  const parts = [];
  if (referenced.length > 0) {
    parts.push(`已引用：${referenced.map((n) => `图${n}`).join("、")}`);
  }
  if (invalid.length > 0) {
    const invalidText = invalid
      .map((item) => Number(item?.index))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => `图${n}`)
      .join("、");
    if (invalidText) parts.push(`越界：${invalidText}`);
  }

  summaryEl.textContent = parts.join("  |  ");
  summaryEl.style.display = "block";
  summaryEl.classList.toggle("warn", invalid.length > 0);
}

function refreshReferencedThumbHighlight() {
  const state = parsePromptTagState();
  const set = new Set(state.referenceIndices || []);
  document.querySelectorAll("#thumbGrid .thumb-wrapper").forEach((el) => {
    const idx = Number(el.getAttribute("data-ref-index"));
    if (!idx) return;
    if (set.has(idx)) el.classList.add("ref-tag-active");
    else el.classList.remove("ref-tag-active");
  });
  updateRefMentionSummary(state);
}

function syncRefThumbHoverState() {
  const wrappers = document.querySelectorAll("#thumbGrid .thumb-wrapper");
  wrappers.forEach((el, idx) => {
    if (idx === hoveredRefThumbIndex) {
      el.classList.add("thumb-hover-active");
    } else {
      el.classList.remove("thumb-hover-active");
    }
  });
}

function setPromptMentionOpenState(isOpen) {
  const promptModule = document.querySelector(".prompt-module");
  if (!promptModule) return;
  promptModule.classList.toggle("mention-open", !!isOpen);
}

function autoFillFigureAfterAt(prompt, evt) {
  if (!prompt || !evt) return false;
  if (evt.isComposing) return false;
  if (evt.inputType !== "insertText") return false;
  const ch = String(evt.data || "");
  if (ch !== "@" && ch !== "＠") return false;

  const caret = prompt.selectionStart || 0;
  const val = prompt.value || "";
  const atPos = caret - 1;
  if (atPos < 0) return false;

  const currentChar = val[atPos];
  if (currentChar !== "@" && currentChar !== "＠") return false;
  const prev = atPos > 0 ? val[atPos - 1] : "";
  const next = atPos + 1 < val.length ? val[atPos + 1] : "";

  // 避免邮箱等英文场景误触发（如 abc@）
  if (/[A-Za-z0-9._-]/.test(prev) && !next) return false;

  const normalizedAt = "@";
  const nextVal =
    val.slice(0, atPos) +
    normalizedAt +
    "图" +
    val.slice(atPos + 1);

  prompt.value = nextVal;
  const nextCaret = atPos + 2;
  prompt.setSelectionRange(nextCaret, nextCaret);
  return true;
}

function hidePromptMentionMenu() {
  const menu = document.getElementById("promptMentionMenu");
  if (!menu) return;
  menu.style.display = "none";
  setPromptMentionOpenState(false);
  mentionOptions = [];
  mentionActiveIndex = 0;
}

function renderPromptMentionMenu() {
  const prompt = getPromptInput();
  const menu = document.getElementById("promptMentionMenu");
  if (!prompt || !menu || !PromptTagsUtil) return;

  const caret = prompt.selectionStart || 0;
  const context = PromptTagsUtil.getMentionContext(prompt.value, caret);
  if (!context) {
    hidePromptMentionMenu();
    return;
  }

  const options = PromptTagsUtil.getMentionOptions(refImages.length, context.query);
  if (!options.length) {
    hidePromptMentionMenu();
    return;
  }

  mentionOptions = options;
  if (mentionActiveIndex >= mentionOptions.length) mentionActiveIndex = 0;

  menu.innerHTML = mentionOptions
    .map((opt, idx) => {
      const activeClass = idx === mentionActiveIndex ? "active" : "";
      return `<div class="prompt-mention-item ${activeClass}" data-ref-index="${opt.index}">@引用 ${opt.label}</div>`;
    })
    .join("");

  menu.querySelectorAll(".prompt-mention-item").forEach((item) => {
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const idx = Number(item.getAttribute("data-ref-index"));
      if (!idx) return;
      insertPromptReferenceTag(idx);
      hidePromptMentionMenu();
    });
  });

  menu.style.display = "block";
  setPromptMentionOpenState(true);
}

function insertPromptReferenceTag(refIndex) {
  const prompt = getPromptInput();
  if (!prompt || !PromptTagsUtil) return;
  const caret = prompt.selectionStart || 0;
  const next = PromptTagsUtil.buildPromptWithInsertedTag(prompt.value, caret, refIndex);
  prompt.value = next.text;
  const nextCaret = Math.max(0, Math.min(next.text.length, next.caret));
  prompt.focus();
  prompt.setSelectionRange(nextCaret, nextCaret);
  refreshReferencedThumbHighlight();
}

function hideRefContextMenu() {
  const menu = document.getElementById("refContextMenu");
  if (!menu) return;
  menu.style.display = "none";
  menu.innerHTML = "";
}

function openRefContextMenu(event, refIndex) {
  event.preventDefault();
  const menu = document.getElementById("refContextMenu");
  if (!menu) return;
  menu.innerHTML = `<button type="button" class="ref-context-item">@引用 图${refIndex}</button>`;
  const btn = menu.querySelector(".ref-context-item");
  btn?.addEventListener("click", () => {
    insertPromptReferenceTag(refIndex);
    hideRefContextMenu();
  });
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.display = "block";
  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, vw - rect.width - 8);
  const top = Math.min(event.clientY, vh - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function initPromptTagUi() {
  if (promptTagUiInited) return;
  promptTagUiInited = true;
  const prompt = getPromptInput();
  if (!prompt) return;

  const syncUi = (e) => {
    if (e?.type === "input") {
      autoFillFigureAfterAt(prompt, e);
    }
    refreshReferencedThumbHighlight();
    renderPromptMentionMenu();
  };

  prompt.addEventListener("input", syncUi);
  prompt.addEventListener("click", syncUi);
  prompt.addEventListener("keyup", syncUi);
  prompt.addEventListener("blur", () => setTimeout(hidePromptMentionMenu, 120));
  prompt.addEventListener("keydown", (e) => {
    const menu = document.getElementById("promptMentionMenu");
    const isOpen = !!menu && menu.style.display !== "none" && mentionOptions.length > 0;
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionActiveIndex = (mentionActiveIndex + 1) % mentionOptions.length;
      renderPromptMentionMenu();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionActiveIndex = (mentionActiveIndex - 1 + mentionOptions.length) % mentionOptions.length;
      renderPromptMentionMenu();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const active = mentionOptions[mentionActiveIndex];
      if (active) insertPromptReferenceTag(active.index);
      hidePromptMentionMenu();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hidePromptMentionMenu();
    }
  });

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("promptMentionMenu");
    if (!menu) return;
    if (menu.contains(e.target) || e.target === prompt) return;
    hidePromptMentionMenu();
  });
  window.addEventListener("scroll", hideRefContextMenu, true);
  window.addEventListener("resize", hideRefContextMenu);
}

// --- [New] 通用药丸下拉框控件 ---
window.togglePill = function(event, pillId) {
  event.stopPropagation();
  const pill = document.getElementById(pillId);
  const menu = pill.querySelector('.dropdown-menu');
  const arrow = pill.querySelector('.arrow');
  const module = pill.closest('.tech-module');
  if (module) module.classList.toggle('dropdown-open');
  
  // 关闭其他所有下拉框
  document.querySelectorAll('.dropdown-menu').forEach(m => {
    if (m !== menu) m.classList.remove('show');
  });
  document.querySelectorAll('.tech-module.dropdown-open').forEach(mod => {
    if (mod !== module) mod.classList.remove('dropdown-open');
  });
  document.querySelectorAll('.pill-trigger .arrow').forEach(a => {
    if (a !== arrow) a.style.transform = '';
  });

  const isOpen = menu.classList.toggle('show');
  if (!isOpen && module) module.classList.remove('dropdown-open');
  updateDropdownOpenState();
  if (arrow) arrow.style.transform = isOpen ? 'rotate(180deg)' : '';
};

window.selectPill = function(pillId, element, costLabel = null) {
  const pill = document.getElementById(pillId);
  const triggerLabel = pill.querySelector('.trigger-label');
  const triggerVal = pill.querySelector('.trigger-val');
  const val = element.getAttribute('data-value');

  // 更新选中态
  pill.querySelectorAll('.dropdown-item').forEach(item => item.classList.remove('active'));
  element.classList.add('active');

  // 更新 Trigger 显示 (支持图标)
  const itemContent = element.querySelector('div')?.innerHTML || element.innerHTML;
  if (pillId === 'ratioPill') {
    // 比例专门处理，保持图标文字结构
    pill.querySelector('.trigger-left').innerHTML = itemContent;
  } else {
    triggerLabel.innerText = element.querySelector('span:not(.item-cost)')?.innerText || element.innerText;
  }
  if (triggerVal) {
    triggerVal.innerText = costLabel || "";
    triggerVal.style.display = costLabel ? "inline" : "none";
  }

  // 将值写回组件属性便于后续读取
  pill.setAttribute('data-selected-value', val);

  // 触发特定联动逻辑
  if (pillId === 'modelPill') {
    imageModel = val;
    localStorage.setItem('nb_image_model', val);
    updateModelUI();
  } else if (pillId === 'linePill') {
    localStorage.setItem('nb_line', val);
  } else if (pillId === 'grokRefModePill') {
    const mode = val === "classic_multi" ? "classic_multi" : "stable_fusion";
    localStorage.setItem(GROK_REF_MODE_KEY, mode);
  }

  if (pillId === 'modelPill' || pillId === 'linePill' || pillId === 'sizePill') {
    if (typeof window.refreshClassicCatalogUi === 'function') {
      window.refreshClassicCatalogUi();
    }
  }

  // 关闭菜单
  const menu = pill.querySelector('.dropdown-menu');
  const arrow = pill.querySelector('.arrow');
  menu.classList.remove('show');
  const module = pill.closest('.tech-module');
  if (module) module.classList.remove('dropdown-open');
  updateDropdownOpenState();
  if (arrow) arrow.style.transform = '';
};

// 全局点击关闭下拉
document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.tech-module.dropdown-open').forEach(mod => mod.classList.remove('dropdown-open'));
  updateDropdownOpenState();
  document.querySelectorAll('.pill-trigger .arrow').forEach(a => a.style.transform = '');
  hideRefContextMenu();
});

function updateDropdownOpenState() {
  const hasOpenDropdown = !!document.querySelector('.dropdown-menu.show');
  document.body.classList.toggle('dropdown-open-active', hasOpenDropdown);
}

function updateModelUI() {
  const modelPill = document.getElementById('modelPill');
  if (!modelPill) return;
  const items = modelPill.querySelectorAll('.dropdown-item');
  
  items.forEach(item => {
    if (item.dataset.value === imageModel) {
      item.classList.add('active');
      const triggerLabel = modelPill.querySelector('.trigger-label');
      const triggerVal = modelPill.querySelector('.trigger-val');
      if (triggerLabel) {
        triggerLabel.innerText = item.querySelector('span:not(.item-cost)')?.innerText || item.innerText;
      }
      if (triggerVal) {
        triggerVal.innerText = item.querySelector('.item-cost')?.innerText || "";
      }
      modelPill.setAttribute('data-selected-value', imageModel);
    } else {
      item.classList.remove('active');
    }
  });

  const titleEl = document.getElementById('brandTitleText');
  const subEl = document.getElementById('brandSubText');
  const badge4k = document.getElementById('brandBadge4k');
  const lineModule = document.getElementById('lineModule');
  const grokRefModeModule = document.getElementById('grokRefModeModule');

  // 根据模型切换线路选择器显示逻辑，其他保持静态
  if (lineModule) {
    lineModule.style.display = (imageModel === 'nano-banana') ? 'flex' : 'none';
  }
  if (grokRefModeModule) {
    grokRefModeModule.style.display = String(imageModel).startsWith("grok-") ? "flex" : "none";
  }

  const ratioPill = document.getElementById('ratioPill');
  if (ratioPill) {
    const restrictedRatios = ['4:1', '1:4', '8:1', '1:8'];
    ratioPill.querySelectorAll('.gemini-only-ratio').forEach(opt => {
      opt.style.display = (imageModel === 'nano-banana') ? 'none' : 'flex';
    });

    const currentRatio = ratioPill.getAttribute('data-selected-value');
    if (imageModel === 'nano-banana' && restrictedRatios.includes(currentRatio)) {
      const defaultItem = ratioPill.querySelector('[data-value="16:9"]');
      if (defaultItem) selectPill('ratioPill', defaultItem);
    }
  }
}

function getGrokRefMode() {
  const mode = localStorage.getItem(GROK_REF_MODE_KEY) || "stable_fusion";
  return mode === "classic_multi" ? "classic_multi" : "stable_fusion";
}

function initGrokRefModeUI() {
  const pill = document.getElementById("grokRefModePill");
  if (!pill) return;
  const mode = getGrokRefMode();
  const item = pill.querySelector(`.dropdown-item[data-value="${mode}"]`);
  if (item) {
    selectPill("grokRefModePill", item);
  } else {
    const fallback = pill.querySelector('.dropdown-item[data-value="stable_fusion"]');
    if (fallback) selectPill("grokRefModePill", fallback);
  }
}

// 页面加载时初始化保存状态
document.addEventListener('DOMContentLoaded', () => {
  // 初始化模型显示
  updateModelUI();
  initGrokRefModeUI();

  // 同步已保存的线路值
  const savedLine = localStorage.getItem('nb_line') || '1';
  const linePill = document.getElementById('linePill');
  const lineItem = linePill?.querySelector(`[data-value="${savedLine}"]`);
  if (lineItem) selectPill('linePill', lineItem);
});

// --- Theme Logic ---
function initTheme() {
  const saved = localStorage.getItem("nb_theme") || "dark";
  applyTheme(saved);
}
function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}
function applyTheme(theme) {
  const btn = document.getElementById("themeBtn");
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    btn.innerHTML = "☀️";
    btn.style.background = "#fff";
  } else {
    document.documentElement.removeAttribute("data-theme");
    btn.innerHTML = "🌙";
    btn.style.background = "rgba(30,30,35,0.6)";
  }
  localStorage.setItem("nb_theme", theme);
}

// --- 切换 Key 显示/隐藏 ---
function toggleKeyVisibility() {
  const input = document.getElementById("apiKey");
  const btn = document.getElementById("eyeBtn");
  const eyeOpenPath = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
  const eyeClosedPath = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

  if (input.type === "password") {
    input.type = "text";
    btn.innerHTML = eyeClosedPath;
    btn.style.color = "var(--accent-blue)";
  } else {
    input.type = "password";
    btn.innerHTML = eyeOpenPath;
    btn.style.color = "";
  }
}

window.addEventListener("load", () => {
  initTheme();
  loadHistory();
  updateModelUI(); // 初始化模型 UI 状态
  initPromptTagUi();
  refreshReferencedThumbHighlight();
  const savedKey = localStorage.getItem("nb_key");
  if (savedKey) {
    document.getElementById("apiKey").value = savedKey;
    document.getElementById("apiStatus").classList.add("active");
  }
});

document.getElementById("apiKey").addEventListener("input", (e) => {
  const val = e.target.value;
  localStorage.setItem("nb_key", val);
  const status = document.getElementById("apiStatus");
  val.length > 10
    ? status.classList.add("active")
    : status.classList.remove("active");

  // --- [新增] 管理员权限识别 ---
  checkAdminStatus(val);
});

// 管理员 Key
const ADMIN_KEY = "sk-K9OJf52OughwT8vizrDKJpvMebzutpbKVXxxhYe8EZFF0nm7";

function checkAdminStatus(key) {
  const adminSection = document.getElementById("adminNoticeSection");
  if (!adminSection) return;
  if (key === ADMIN_KEY) {
    adminSection.style.display = "block";
  } else {
    adminSection.style.display = "none";
  }
}

function clearPrompt() {
  const promptArea = document.getElementById("prompt");
  if (!promptArea.value) return;
  showApiGuideModal({
    title: "清空提示词？",
    desc: "当前输入的提示词将被清空。",
    primaryText: "确认清空",
    secondaryText: "取消",
    action: "custom",
    onPrimary: () => {
      promptArea.value = "";
      closeApiGuideModal();
    },
  });
}

function clearRefImages() {
  if (refImages.length === 0) return;
  showApiGuideModal({
    title: "清空参考图？",
    desc: "确定要清空所有参考图吗？",
    primaryText: "确认清空",
    secondaryText: "取消",
    action: "custom",
    onPrimary: () => {
      refImages = [];
      smartRatio = null;
      updateRatioOptions();
      renderThumbs();
      document.getElementById("uploadPlaceholder").style.display = "block";
      closeApiGuideModal();
    },
  });
}

// 余额查询逻辑
async function checkBalance() {
  let keyRaw = document.getElementById("apiKey").value;
  const apiKey = keyRaw.replace(/[^\x00-\x7F]/g, "").trim();

  if (!apiKey) {
    showApiGuideModal({
      title: "请先输入 API 密钥",
      desc: "请先在输入框填写密钥，再进行余额查询。",
      primaryText: "去输入密钥",
      secondaryText: "稍后",
      action: "key",
    });
    return;
  }

  const btn = document.getElementById("checkBalanceBtn");
  const originalText = btn.innerHTML;
  btn.innerText = "查询中...";
  btn.disabled = true;
  btn.style.opacity = "0.7";

  try {
    const res = await fetch(`/api/balance/info`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errorData = await res.json();
      const rawMsg = errorData?.error || errorData?.message || "API 请求失败";
      const msg =
        typeof rawMsg === "string"
          ? rawMsg
          : JSON.stringify(rawMsg, null, 0) || "API 请求失败";
      throw new Error(msg);
    }
    
    const data = await res.json();
    showBalanceModal(data);
  } catch (error) {
    console.error(error);
    const rawMsg = error?.message || "查询失败，请稍后重试";
    const msg =
      typeof rawMsg === "string"
        ? rawMsg
        : JSON.stringify(rawMsg, null, 0) || "查询失败，请稍后重试";
    showApiGuideModal({
      title: "查询失败",
      desc: msg,
      primaryText: "我知道了",
      showSecondary: false,
      action: "close",
    });
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";
  }
}

function saveApiKeyAndBack() {
  let keyRaw = document.getElementById("apiKey").value;
  const key = keyRaw.replace(/[^\x00-\x7F]/g, "").trim();
  if (keyRaw !== key) document.getElementById("apiKey").value = key;

  if (!key) {
    showApiGuideModal({
      title: "请先输入 API Key",
      desc: "密钥不能为空，请输入后再保存。",
      primaryText: "去输入密钥",
      secondaryText: "稍后",
      action: "key",
    });
    return;
  }

  localStorage.setItem("nb_key", key);
  updateApiStatusUI(true);
  checkAdminStatus(key);
  switchTab("create");
  showApiGuideModal({
    title: "保存成功",
    desc: "密钥已保存，已返回创作页面。",
    primaryText: "开始创作",
    showSecondary: false,
    action: "close",
  });
}

function showBalanceModal(data) {
  const modal = document.getElementById("balanceModal");
  const card = document.getElementById("balanceCard");

  const remainingPoints = data.remaining_points || 0;
  const usedPoints = data.used_points || 0;
  const totalPoints = data.total_points || 0;

  document.getElementById("b_status").innerText =
    remainingPoints > 1 ? "已激活" : "额度不足";
  document.getElementById("b_status").style.color =
    remainingPoints > 1 ? "#34C759" : "#FF3B30";
    
  document.getElementById("b_remain").innerText = `${remainingPoints} 🪙`;
  document.getElementById("b_used").innerText = `${usedPoints} 🪙`;
  document.getElementById("b_total").innerText = `${totalPoints} 🪙`;

  // 同步刷新“我的”页上的可见内容
  const pRemain = document.getElementById("p_remain");
  const pUsed = document.getElementById("p_used");
  const balanceArea = document.getElementById("balanceDisplayArea");
  
  if (pRemain) pRemain.innerText = `${remainingPoints} 🪙`;
  if (pUsed) pUsed.innerText = `${usedPoints} 🪙`;
  if (balanceArea) balanceArea.style.display = "block";

  modal.style.display = "flex";
  setTimeout(() => card.classList.add("show"), 10);
}

function closeBalanceModal(e) {
  if (e.target.id === "balanceModal") {
    const card = document.getElementById("balanceCard");
    card.classList.remove("show");
    setTimeout(() => {
      document.getElementById("balanceModal").style.display = "none";
    }, 300);
  }
}

function openSupportModal() {
  const modal = document.getElementById("supportModal");
  if (modal) modal.style.display = "flex";
}

function closeSupportModal() {
  const modal = document.getElementById("supportModal");
  if (modal) modal.style.display = "none";
}

// 图片压缩与上传逻辑
function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 1024;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function buildGrokReferenceFusionImage(imageList) {
  const loaded = await Promise.all(
    imageList.map(
      (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        }),
    ),
  );

  const base = loaded[0];
  const baseW = Math.max(768, Math.min(1536, base.width || 1024));
  const baseH = Math.max(768, Math.min(1536, base.height || 1024));

  const canvas = document.createElement("canvas");
  canvas.width = baseW;
  canvas.height = baseH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawCover = (img, x, y, w, h, alpha = 1) => {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  };

  // 主构图：第一张全幅铺底
  drawCover(loaded[0], 0, 0, baseW, baseH, 1);

  // 其余参考图：融合到边角区域，避免明显拼贴感
  const slotW = Math.round(baseW * 0.36);
  const slotH = Math.round(baseH * 0.36);
  const gap = Math.round(Math.min(baseW, baseH) * 0.03);
  const slots = [
    { x: gap, y: gap },
    { x: baseW - slotW - gap, y: gap },
    { x: gap, y: baseH - slotH - gap },
    { x: baseW - slotW - gap, y: baseH - slotH - gap },
    { x: Math.round((baseW - slotW) / 2), y: gap },
    { x: Math.round((baseW - slotW) / 2), y: baseH - slotH - gap },
  ];

  for (let i = 1; i < loaded.length; i++) {
    const img = loaded[i];
    const slot = slots[(i - 1) % slots.length];
    const alpha = 0.72 - Math.min(i - 1, 3) * 0.08;
    drawCover(img, slot.x, slot.y, slotW, slotH, Math.max(0.45, alpha));
  }

  // 轻微暗角统一融合
  const vignette = ctx.createRadialGradient(
    baseW / 2,
    baseH / 2,
    Math.min(baseW, baseH) * 0.25,
    baseW / 2,
    baseH / 2,
    Math.max(baseW, baseH) * 0.8,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, baseW, baseH);

  return canvas.toDataURL("image/jpeg", 0.9);
}

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");

function openFilePicker(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const fi = document.getElementById("fileInput");
  if (!fi) return;
  // 每次点击前清空，确保同一文件也能触发 change
  fi.value = "";
  fi.click();
}

dropZone.addEventListener("click", (e) => {
  const target = e.target;
  // Avoid opening file picker when user is interacting with existing thumbnails.
  if (target.closest(".thumb-close") || target.closest(".thumb-wrapper")) return;
  openFilePicker(e);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("drag-over"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
fileInput.addEventListener("click", (e) => e.stopPropagation());

// Paste upload support: paste image from clipboard directly into REF area workflow.
document.addEventListener("paste", (e) => {
  const active = document.activeElement;
  const isTyping =
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable);
  if (isTyping) return;

  const items = Array.from(e.clipboardData?.items || []);
  const imageFiles = items
    .filter((item) => item.type && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (imageFiles.length === 0) return;
  e.preventDefault();
  handleFiles(imageFiles);
});

// --- 补回丢失的触发上传函数 ---
window.triggerUpload = openFilePicker;

async function handleFiles(files) {
  console.log("handleFiles -> files count:", files.length);
  const placeholder = document.getElementById("uploadPlaceholder");
  const isFirstBatch = refImages.length === 0;
  const allFiles = Array.from(files || []).filter(
    (f) => !!f && typeof f.type === "string" && f.type.startsWith("image/"),
  );
  const remainingSlots = MAX_REF_IMAGES - refImages.length;

  if (remainingSlots <= 0) {
    showSoftToast(`参考图最多 ${MAX_REF_IMAGES} 张`);
    return;
  }
  if (allFiles.length === 0) {
    return;
  }
  const acceptedFiles = allFiles.slice(0, remainingSlots);
  const ignoredCount = allFiles.length - acceptedFiles.length;

  try {
    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i];
      console.log(`Processing file [${i}]:`, file.name);
      try {
        const compressedBase64 = await compressImage(file);
        if (compressedBase64) {
          refImages.push(compressedBase64);
          console.log(`Successfully compressed file [${i}]`);
        } else {
          console.error(`Compression failed for file [${i}]: returned null`);
        }
      } catch (e) {
        console.error(`Error processing file [${i}]:`, e);
      }
    }

    // 再次清理无效值，确保数据纯净
    refImages = refImages.filter(img => img !== null && img !== undefined);
    console.log("Final refImages count after processing:", refImages.length);

    if (ignoredCount > 0) {
      showSoftToast(`最多 ${MAX_REF_IMAGES} 张，已忽略 ${ignoredCount} 张`);
    }

    if (isFirstBatch && refImages.length > 0) {
      console.log("Triggering smart ratio detection for first image...");
      await detectAndSetSmartRatio(refImages[0]);
    } else {
      updateRatioOptions();
    }

    console.log("Current refImages count:", refImages.length);
    renderThumbs();
    if (placeholder) {
      placeholder.style.display = refImages.length > 0 ? "none" : "block";
    }
  } catch (err) {
    console.error("handleFiles Error:", err);
  } finally {
    const fileInput = document.getElementById("fileInput");
    if (fileInput) fileInput.value = "";
  }
}

// --- 【新增核心函数】检测首张图比例并更新 UI ---
async function detectAndSetSmartRatio(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    const timeout = setTimeout(() => {
      console.warn("Smart Ratio Detection Timeout");
      resolve();
    }, 3000);

    img.onload = () => {
      clearTimeout(timeout);
      const w = img.width;
      const h = img.height;
      function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
      const commonGcd = gcd(w, h);
      smartRatio = `${w / commonGcd}:${h / commonGcd}`;
      console.log("Detected Smart Ratio:", smartRatio);
      updateRatioOptions(true);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timeout);
      console.error("Smart Ratio Detection Error");
      resolve();
    };
    img.src = base64;
  });
}

// --- 【新增核心函数】更新比例下拉框 ---
function updateRatioOptions(forceSelectSmart = false) {
  const ratioPill = document.getElementById("ratioPill");
  if (!ratioPill) return;
  const menu = ratioPill.querySelector('.dropdown-menu');
  let autoItem = menu.querySelector('.dropdown-item[data-value="auto"]');

  if (refImages.length > 0 && smartRatio) {
    if (!autoItem) {
      autoItem = document.createElement("div");
      autoItem.className = "dropdown-item";
      autoItem.setAttribute("data-value", "auto");
      autoItem.onclick = function() { selectPill('ratioPill', this); };
      menu.insertBefore(autoItem, menu.firstChild);
    }
    autoItem.innerHTML = `<div style="display: flex; align-items: center; gap: 10px;">
                            <div class="ratio-icon r-1-1" style="border-style: dashed; opacity: 0.5;"></div> 
                            <span>智能 (${smartRatio})</span>
                          </div>`;
    if (forceSelectSmart) {
      selectPill('ratioPill', autoItem);
    }
  } else {
    if (autoItem) {
      if (ratioPill.getAttribute('data-selected-value') === "auto") {
        const defaultItem = menu.querySelector('[data-value="16:9"]');
        if (defaultItem) selectPill('ratioPill', defaultItem);
      }
      autoItem.remove();
    }
    smartRatio = null;
  }
}

// --- 更新：参考图渲染 (支持点击放大) ---
function renderThumbs() {
  console.log("renderThumbs -> count:", refImages.length);
  const grid = document.getElementById("thumbGrid");
  const placeholder = document.getElementById("uploadPlaceholder");
  if (!grid) {
    console.error("thumbGrid element not found!");
    return;
  }
  grid.innerHTML = "";
  updateRefCountBadge();
  if (hoveredRefThumbIndex >= refImages.length) {
    hoveredRefThumbIndex = -1;
  }
  const promptState = parsePromptTagState();
  const referencedSet = new Set(promptState.referenceIndices || []);
  updateRefMentionSummary(promptState);

  const applyReorder = async (targetIdx) => {
    if (draggedIdx === null) return;
    if (targetIdx === null || Number.isNaN(targetIdx)) return;
    if (targetIdx < 0 || targetIdx >= refImages.length) return;
    if (draggedIdx === targetIdx) return;

    const item = refImages.splice(draggedIdx, 1)[0];
    refImages.splice(targetIdx, 0, item);

    if (draggedIdx === 0 || targetIdx === 0) {
      await detectAndSetSmartRatio(refImages[0]);
    }
    renderThumbs();
  };

  refImages.forEach((src, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "thumb-wrapper";
    wrapper.title = "点击放大预览";
    const refIndex = idx + 1;
    wrapper.setAttribute("data-ref-index", String(refIndex));
    if (referencedSet.has(refIndex)) wrapper.classList.add("ref-tag-active");
    
    // --- 拖拽排序逻辑开始 (高确定性方案) ---
    wrapper.draggable = true;
    wrapper.onmouseenter = () => {
      hoveredRefThumbIndex = idx;
      syncRefThumbHoverState();
    };
    wrapper.onmouseleave = () => {
      if (hoveredRefThumbIndex === idx) {
        hoveredRefThumbIndex = -1;
        syncRefThumbHoverState();
      }
    };
    
    wrapper.ondragstart = (e) => {
      draggedIdx = idx; // 记录全局索引
      wrapper.classList.add("dragging");
      hoveredRefThumbIndex = idx;
      syncRefThumbHoverState();
      e.dataTransfer.effectAllowed = "move";
    };
    
    wrapper.ondragover = (e) => {
      e.preventDefault(); 
      wrapper.classList.add("drag-over");
      e.dataTransfer.dropEffect = "move";
    };
    
    wrapper.ondragleave = () => {
      wrapper.classList.remove("drag-over");
    };
    
    wrapper.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove("drag-over");
      await applyReorder(idx);
      draggedIdx = null;
      suppressThumbPreviewUntil = Date.now() + 180;
    };
    
    wrapper.ondragend = () => {
      wrapper.classList.remove("dragging");
      draggedIdx = null;
      hoveredRefThumbIndex = -1;
      syncRefThumbHoverState();
      suppressThumbPreviewUntil = Date.now() + 180;
    };
    // --- 拖拽排序逻辑结束 ---

    const img = document.createElement("img");
    img.src = src;
    img.className = "mini-thumb";
    img.draggable = false; // 禁用图片的默认拖拽行为，由容器控制
    
    const closeBtn = document.createElement("div");
    closeBtn.className = "thumb-close";
    closeBtn.innerHTML = "×";
    closeBtn.title = "删除此图";
    closeBtn.onclick = async (e) => {
      e.stopPropagation();
      const wasFirst = idx === 0;
      const removedRefIndex = idx + 1;
      const promptEl = getPromptInput();
      hoveredRefThumbIndex = -1;
      refImages.splice(idx, 1);

      if (promptEl && PromptTagsUtil) {
        const remapped = PromptTagsUtil.remapPromptTagsAfterDelete(promptEl.value, removedRefIndex);
        if (remapped !== promptEl.value) {
          promptEl.value = remapped;
          showSoftToast(`已同步更新提示词中的 @图${removedRefIndex} 引用`);
        }
      }

      // 如果删除了第一张，且还有剩余，重新计算比例
      if (wasFirst && refImages.length > 0) {
        await detectAndSetSmartRatio(refImages[0]);
      } else if (refImages.length === 0) {
        smartRatio = null;
        updateRatioOptions();
      }

      renderThumbs();
      if (refImages.length === 0) placeholder.style.display = "block";
    };
    wrapper.onclick = () => {
      if (Date.now() < suppressThumbPreviewUntil) return;
      openLightbox(src);
    };

    wrapper.oncontextmenu = (e) => {
      openRefContextMenu(e, refIndex);
    };

    const indexBadge = document.createElement("div");
    indexBadge.className = "thumb-index-badge";
    indexBadge.textContent = `图${refIndex}`;

    wrapper.appendChild(img);
    wrapper.appendChild(indexBadge);
    wrapper.appendChild(closeBtn);
    grid.appendChild(wrapper);
  });

  syncRefThumbHoverState();

  grid.ondragover = (e) => {
    e.preventDefault();
    if (draggedIdx === null) return;

    const wrappers = Array.from(grid.querySelectorAll(".thumb-wrapper"));
    if (wrappers.length === 0) return;

    let nearestIdx = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    wrappers.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDistance) {
        minDistance = d2;
        nearestIdx = i;
      }
    });

    wrappers.forEach((el) => el.classList.remove("drag-over"));
    wrappers[nearestIdx].classList.add("drag-over");
    grid.dataset.dropIndex = String(nearestIdx);
  };

  grid.ondragleave = () => {
    grid.querySelectorAll(".thumb-wrapper").forEach((el) => el.classList.remove("drag-over"));
  };

  grid.ondrop = async (e) => {
    e.preventDefault();
    if (draggedIdx === null) return;
    const targetIdx = parseInt(grid.dataset.dropIndex || "", 10);
    await applyReorder(targetIdx);
    draggedIdx = null;
    grid.querySelectorAll(".thumb-wrapper").forEach((el) => el.classList.remove("drag-over"));
    suppressThumbPreviewUntil = Date.now() + 180;
  };
  
  // 自动处理占位符显示 (受控模式)
  if (refImages.length > 0) {
    placeholder.style.display = "none";
    console.log("renderThumbs: Hiding placeholder, displaying thumbnails.");
  } else {
    placeholder.style.display = "block";
    console.log("renderThumbs: Showing placeholder (no images).");
  }
}

// --- 并发生成逻辑 ---
async function runGen() {
  let keyRaw = document.getElementById("apiKey").value;
  const key = keyRaw.replace(/[^\x00-\x7F]/g, "").trim();
  if (keyRaw !== key) document.getElementById("apiKey").value = key;

  const promptInput = document.getElementById("prompt");
  const rawPrompt = promptInput.value.trim();
  const tagState = parsePromptTagState();
  const promptBaseText = String(tagState.promptWithoutTags || rawPrompt || "").trim();
  
  // --- 获取所有药丸参数 ---
  let ratio = document.getElementById('ratioPill')?.getAttribute('data-selected-value') || '16:9';
  const size = document.getElementById('sizePill')?.getAttribute('data-selected-value') || '1K';
  const batchSize = parseInt(document.getElementById('qtyPill')?.getAttribute('data-selected-value')) || 1;

  const btn = document.getElementById("genBtn");
  const statusText = document.getElementById("statusText");
  const bar = document.getElementById("progressBar");
  const fill = document.getElementById("progressFill");
  const imgContainer = document.getElementById("imgContainer");
  const manualBtn = document.getElementById("manualLinkBtn");
  const errPlaceholder = document.getElementById("errorPlaceholder");
  const resultGrid = document.getElementById("resultGrid");

    if (!key) {
    showApiGuideModal({
      title: "请先输入 API Key",
      desc: "你还没有配置可用密钥，请先到“我的”页面填写 API Key，再回来开始生图。",
      primaryText: "去输入密钥",
      action: "key",
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

  // UI 初始化
  btn.disabled = true;
  imgContainer.style.display = "none";
  manualBtn.style.display = "none";
  errPlaceholder.style.display = "none";

  // 清空结果
  resultGrid.innerHTML = "";
  resultGrid.className = "result-grid";

  // 进度条初始化
  bar.style.display = "block";
  fill.style.width = "0%";
  statusText.innerText = "Initializing Concurrent Tasks...";
  statusText.style.color = "var(--banana)";

  // 运行态变量
  activeRunToken += 1;
  const runToken = activeRunToken;
  currentRunSize = size;

  // 准备基础参数

  let finalPrompt = promptBaseText;
  if (size === "4K")
    finalPrompt +=
      ", (best quality, 4k resolution, ultra detailed, masterpiece)";
  // --- 根据图片模型选择 API model ---
  let selectedModel;
  
  // 模型映射表
  const MODEL_MAP = {
    'nano-banana': 'nano-banana-2',
    'nano-banana-2': 'gemini-3.1-flash-image-preview',
    'grok-4.2': 'grok-4.2-image',
    'grok-4.1': 'grok-4.1-image'
  };

  selectedModel = MODEL_MAP[imageModel] || 'nano-banana-2';
  const isGrokModel = String(selectedModel).startsWith("grok-");
  const expectedRenderCount = isGrokModel ? 2 : batchSize;

  if (expectedRenderCount > 1) resultGrid.classList.add("multi");
  totalBatchSize = expectedRenderCount;
  activeTasksCount = expectedRenderCount;
  completedTasksCount = 0;
  loadedImageCount = 0;
  startFakeProgress();

  if (isGrokModel) {
    let effectiveRatio = ratio;
    if (ratio === "auto") {
      effectiveRatio = smartRatio || "";
      if (!effectiveRatio) {
        const ratioLabel = document.querySelector("#ratioPill .trigger-label")?.innerText || "";
        const m = ratioLabel.match(/(\d+\s*:\s*\d+)/);
        effectiveRatio = m ? m[1].replace(/\s+/g, "") : "1:1";
      }
    }
    finalPrompt = `${promptBaseText}，${effectiveRatio}，超高品质${size}分辨率`;
  }

  let submitRefImages = refImages.slice();
  let submitReferenceIndices = [];
  if (tagState.hasAnyTag) {
    const resolved = PromptTagsUtil
      ? PromptTagsUtil.resolveReferencesByIndices(refImages, tagState.referenceIndices)
      : { selectedImages: refImages.slice(), validIndices: [], ignoredIndices: [] };
    submitReferenceIndices = resolved.validIndices || [];
    if (submitReferenceIndices.length > 0) {
      submitRefImages = resolved.selectedImages || [];
    } else if (refImages.length > 0) {
      submitRefImages = refImages.slice();
      showSoftToast("未匹配到有效 @图N，已回退全量参考图");
    }

    if ((tagState.invalidIndices || []).length > 0) {
      const invalidLabel = tagState.invalidIndices
        .map((x) => `图${x.index}`)
        .filter(Boolean)
        .join("、");
      if (invalidLabel) showSoftToast(`部分引用越界已忽略：${invalidLabel}`);
    } else if ((resolved.ignoredIndices || []).length > 0) {
      showSoftToast(`部分引用越界已忽略：${resolved.ignoredIndices.map((x) => `图${x}`).join("、")}`);
    }
  }

  // 针对 NB Pro (nano-banana-2) 处理画质后缀
  if (selectedModel === 'nano-banana-2') {
    if (size === "2K") selectedModel = "nano-banana-2-2k";
    else if (size === "4K") selectedModel = "nano-banana-2-4k";
  }
  const basePayload = {
    model: selectedModel, // 这里使用动态选择的模型，不再使用 CONFIG.model
    prompt: finalPrompt,
    size: size.toLowerCase(), // 保持原有的转小写逻辑用于 API 参数 (1k/2k/4k)
    aspect_ratio: ratio,
    n: isGrokModel ? 2 : 1,
  };
  if (submitReferenceIndices.length > 0) {
    basePayload.reference_indices = submitReferenceIndices.slice();
  }

  if (submitRefImages.length > 0) {
    const fullImages = submitRefImages.map((imgData) =>
      imgData.startsWith("data:") ? imgData : `data:image/jpeg;base64,${imgData}`,
    );
    const rawBase64Images = submitRefImages.map(
      (imgData) => imgData.split(",")[1] || imgData,
    );

    if (isGrokModel) {
      const grokRefMode = getGrokRefMode();
      // Grok 可切换策略：
      // stable_fusion（推荐）：多图先融合再作为主参考；
      // classic_multi：主图 + 多参考字段直传。
      const grokMainImage = fullImages[0];
      if (grokRefMode === "classic_multi") {
        basePayload.image = grokMainImage;
        basePayload.images = fullImages;
        basePayload.reference_image = grokMainImage;
        basePayload.reference_images = fullImages;
      } else {
        let grokSubmitImage = grokMainImage;
        if (fullImages.length > 1) {
          try {
            grokSubmitImage = await buildGrokReferenceFusionImage(fullImages);
          } catch (e) {
            console.warn("buildGrokReferenceFusionImage failed, fallback to first image:", e);
            grokSubmitImage = grokMainImage;
          }
        }
        basePayload.image = grokSubmitImage;
        basePayload.images = fullImages;
        basePayload.reference_image = grokSubmitImage;
        basePayload.reference_images = fullImages;
      }
      if (fullImages.length > 1) {
        basePayload.prompt +=
          "\n\n要求：以第一张参考图为主体构图，同时融合其余参考图关键元素；输出必须是单张完整画面，禁止拼贴、分屏、九宫格。";
      }
    } else {
      // Nano / Gemini 兼容原有多图数组格式
      basePayload.image = rawBase64Images;
    }
  }

  // 读取线路选择
  const line = (imageModel === 'nano-banana') ? (document.getElementById('linePill')?.getAttribute('data-selected-value') || '1') : '1';

  // Grok：单次请求，前端双占位，轮询后映射到2张图
  if (isGrokModel) {
    submitSingleTask(basePayload, key, size, 1, {
      mode: "grok_dual",
      expectedCount: 2,
      model: selectedModel,
      runToken,
      trackUi: true,
    });
    return;
  }

  // 非 Grok：保持原逻辑
  for (let i = 0; i < batchSize; i++) {
    setTimeout(() => {
      if (line === '2' && imageModel === 'nano-banana') {
        const targetModel = 'gemini-3-pro-image-preview';
        submitGeminiTask(basePayload, key, size, i + 1, targetModel, runToken);
      } else if (line === '3' && imageModel === 'nano-banana') {
        let line3Model = 'gemini-3.1-flash-image-preview';
        if (size === "2K") line3Model = 'gemini-3.1-flash-image-preview-2k';
        else if (size === "4K") line3Model = 'gemini-3.1-flash-image-preview-4k';
        const line3Payload = { ...basePayload, model: line3Model };
        submitSingleTask(line3Payload, key, size, i + 1, { runToken, trackUi: true });
      } else {
        submitSingleTask(basePayload, key, size, i + 1, { runToken, trackUi: true });
      }
    }, i * 200);
  }
}

function updateStatus(msg) {
  const statusText = document.getElementById("statusText");
  if (statusText) {
    statusText.innerText = msg;
    statusText.style.color = "#FF3B30"; // 失败时显示红色
  }
}

async function submitGeminiTask(basePayload, key, size, index, targetModel, runToken = 0) {
  try {
    const ratioVal = document.getElementById('ratioPill')?.getAttribute('data-selected-value') || '16:9';
    const parts = [{ text: basePayload.prompt }];
    if (basePayload.image && Array.isArray(basePayload.image)) {
      basePayload.image.forEach(imgData => {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imgData
          }
        });
      });
    }

    const payload = {
      model: targetModel, // 显式传入目标模型
      contents: [{ parts: parts }],
      generationConfig: {
        imageConfig: {
          imageSize: size, // 1K, 2K, 4K
          aspectRatio: ratioVal === "auto" ? smartRatio : ratioVal.split(' ')[0]
        }
      }
    };

    const res = await fetch('/api/gemini-generate', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    let data;
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      throw new Error(text.substring(0, 100) || "服务器未返回有效 JSON 响应");
    }

    if (!res.ok) throw new Error(data.error?.message || "Gemini 接口请求失败");

    // 响应处理: 提取同步 Base64
    const base64Data = data.candidates[0].content.parts[0].inlineData.data;
    const imgUrl = `data:image/jpeg;base64,${base64Data}`;
    
    // 将同步返回的图片直接追加到结果区
    if (canUpdateMainUi(runToken, true)) {
      appendImageToGrid(imgUrl, size, null, { runToken, trackUi: true });
    } else {
      saveToHistory(imgUrl, document.getElementById("prompt")?.value?.trim() || "");
    }
    
  } catch (error) {
    console.error(`Gemini Task ${index} Failed:`, error);
    if (canUpdateMainUi(runToken, true)) {
      updateStatus(`线路三任务 ${index} 失败: ` + error.message);
      activeTasksCount--;
      completedTasksCount++;
      checkAllDone(size);
    }
  }
}

function createGrokPlaceholders(taskId, count = 2) {
  const grid = document.getElementById("resultGrid");
  const imgContainer = document.getElementById("imgContainer");
  if (!grid || !imgContainer) return [];

  imgContainer.style.display = "flex";
  if (count > 1) grid.classList.add("multi");

  const nodes = [];
  for (let slot = 1; slot <= count; slot++) {
    const id = `grok-slot-${taskId}-${slot}`;
    let wrapper = document.getElementById(id);
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = id;
      wrapper.className = "result-item-wrapper pending-task";
      wrapper.innerHTML = `
        <div class="loader"></div>
        <div>Grok 生成中...</div>
        <div style="font-size:10px; opacity:0.7">Task: ${String(taskId).slice(-6)} · #${slot}</div>
      `;
      grid.appendChild(wrapper);
    }
    nodes.push(wrapper);
  }
  return nodes;
}

function parseStandardImageUrls(rawJson) {
  let root = rawJson;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch (_) {
      root = {};
    }
  }

  let dataNode = root?.data;
  if (typeof dataNode === "string") {
    try {
      dataNode = JSON.parse(dataNode);
    } catch (_) {
      dataNode = {};
    }
  }

  let dataList = dataNode?.data;
  if (typeof dataList === "string") {
    try {
      const parsed = JSON.parse(dataList);
      dataList = Array.isArray(parsed) ? parsed : parsed?.data;
    } catch (_) {
      dataList = [];
    }
  }
  if (!Array.isArray(dataList) && Array.isArray(dataList?.data)) {
    dataList = dataList.data;
  }
  if (!Array.isArray(dataList)) {
    dataList = [];
  }

  const rawUrls = dataList
    .map((item) => (typeof item?.url === "string" ? item.url.trim() : ""))
    .filter((u) => !!u);

  const urls = [];
  const seen = new Set();
  rawUrls.forEach((u) => {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  });

  return { rawUrls, urls };
}

function logGrokResponseSnippet(taskId, model, rawJson, parsedUrls = [], rawUrls = []) {
  const snippet = {
    taskId,
    model,
    status: rawJson?.status || rawJson?.state || "",
    fail_reason: rawJson?.fail_reason || rawJson?.data?.fail_reason || "",
    urls: parsedUrls,
    rawUrls,
    data_preview: Array.isArray(rawJson?.data?.data) ? rawJson.data.data.slice(0, 3) : rawJson?.data,
  };
  console.warn("[GROK_DUAL_RESPONSE]", snippet);
}

function markSlotFailed(slotNode, message, size) {
  if (!slotNode) {
    completedTasksCount++;
    activeTasksCount--;
    checkAllDone(size || currentRunSize);
    return;
  }
  slotNode.className = "result-item-wrapper pending-task";
  slotNode.innerHTML = `
    <div style="font-size:24px; line-height:1">⚠️</div>
    <div>${message}</div>
  `;
  completedTasksCount++;
  activeTasksCount--;
  checkAllDone(size || currentRunSize);
}

function handleRenderFailure(msg, size) {
  activeTasksCount--;
  completedTasksCount++;
  checkAllDone(size || currentRunSize);
  const statusText = document.getElementById("statusText");
  if (statusText) {
    statusText.innerText = `Warning: ${msg}`;
    statusText.style.color = "#FFD60A";
  }
}

async function submitSingleTask(payload, key, size, index, options = {}) {
  try {
    const res = await fetch(CONFIG.submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data.error?.message || data.message || `任务 ${index} 提交失败`,
      );
    if (data.warning) {
      showSoftToast(String(data.warning));
    }

    const taskId =
      data.task_id || data.id || (data.data ? data.data.task_id : null);
    if (!taskId) throw new Error(`任务 ${index} 未获取到ID`);

    console.log(`Task ${index} Started:`, taskId);

    // [Persistence] Save Task ID
    savePendingTask(taskId, key, size, index, options.mode, payload.model);

    // 【新增】将任务同步到画廊显示（即使是正常创作也显示在画廊）
    addPendingTaskToGallery(taskId, index);

    const pollOptions = { ...options };
    if (options.mode === "grok_dual" && options.trackUi !== false) {
      pollOptions.expectedCount = options.expectedCount || 2;
      pollOptions.slotNodes = createGrokPlaceholders(taskId, pollOptions.expectedCount);
    }
    pollSingleTask(taskId, key, size, index, pollOptions);
  } catch (e) {
    console.error(e);
    if (!canUpdateMainUi(options.runToken, options.trackUi !== false)) {
      return;
    }
    if (options.mode === "grok_dual") {
      const msg = e?.message || "Grok 任务提交失败";
      markSlotFailed(null, msg, size);
      markSlotFailed(null, msg, size);
      updateStatus(`Grok 提交失败: ${msg}`);
    } else {
      handleSingleError(e.message, size);
    }
  }
}

async function pollSingleTask(taskId, key, size, index, options = {}) {
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
        const msg = "查询超时，任务状态未收敛";
        if (canUpdateMainUi(options.runToken, trackUi)) {
          if (options.mode === "grok_dual") {
            const slots = options.slotNodes || [];
            markSlotFailed(slots[0] || null, msg, size);
            markSlotFailed(slots[1] || null, msg, size);
          } else {
            handleSingleError(`任务 ${index} ${msg}`, size);
          }
        }
        return;
      }

      const queryUrl =
        CONFIG.queryUrl.replace("{id}", taskId) + `?_t=${Date.now()}`;
      const res = await fetch(queryUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
      });

      // --- [新增] 处理异常状态码 ---
      if (res.status === 404) {
        console.warn(`Task ${taskId} not found (404). Abandoning.`);
        clearInterval(checkLoop);
        removePendingTask(taskId);
        removePendingTaskFromGallery(taskId); // 【新增】从画廊移除占位图
        if (!canUpdateMainUi(options.runToken, trackUi)) {
          return;
        }
        if (options.mode === "grok_dual") {
          const slots = options.slotNodes || [];
          const msg = "任务已失效或未找到 (404)";
          if (slots.length > 0) {
            slots.forEach((slot) => markSlotFailed(slot, msg, size));
          } else {
            markSlotFailed(null, msg, size);
            markSlotFailed(null, msg, size);
          }
          updateStatus(`Grok 任务 ${index} 失败: ${msg}`);
        } else {
          handleSingleError(`任务 ${index} 已失效或未找到 (404)`, size);
        }
        return;
      }

      if (!res.ok) {
        errorCount++;
        if (errorCount >= maxErrors) {
          throw new Error("多次查询失败，任务可能已丢失");
        }
        return; // 等待下次轮询
      }

      const rawJson = await res.json();
      errorCount = 0; // 成功获取 JSON 则重置错误计数
      let statusRaw = (rawJson.status || rawJson.state || "").toUpperCase();
      if (!statusRaw || statusRaw === "UNKNOWN") {
        if (rawJson.data && rawJson.data.status)
          statusRaw = rawJson.data.status.toUpperCase();
      }

      if (options.mode === "grok_dual") {
        const parsed = parseStandardImageUrls(rawJson);
        const imageUrls = parsed.urls;
        const rawUrls = parsed.rawUrls;

        if (rawUrls.length > 1 && imageUrls.length === 1) {
          console.warn(`[GROK_DUAL_DUPLICATE_ONLY] taskId=${taskId} model=${options.model || ""} duplicateUrl=${imageUrls[0] || ""}`);
        }

        if (imageUrls.length > 0) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            const slots = options.slotNodes || [];
            const slotA = slots[0] || null;
            const slotB = slots[1] || null;
            appendImageToGrid(imageUrls[0], size, slotA, { runToken: options.runToken, trackUi: true });
            if (imageUrls.length > 1) {
              appendImageToGrid(imageUrls[1], size, slotB, { runToken: options.runToken, trackUi: true });
            } else {
              markSlotFailed(slotB, "仅返回1张图", size);
              logGrokResponseSnippet(taskId, options.model || "", rawJson, imageUrls, rawUrls);
            }
          } else {
            const promptText = document.getElementById("prompt")?.value?.trim() || "";
            if (imageUrls[0]) saveToHistory(imageUrls[0], promptText);
            if (imageUrls[1]) saveToHistory(imageUrls[1], promptText);
          }
          return;
        }

        if (statusRaw === "SUCCESS" || statusRaw === "SUCCEEDED") {
          successNoUrlCount++;
          if (successNoUrlCount < maxSuccessNoUrlCount) {
            return;
          }
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            const slots = options.slotNodes || [];
            markSlotFailed(slots[0] || null, "返回结构异常", size);
            markSlotFailed(slots[1] || null, "返回结构异常", size);
            updateStatus(`Grok 返回结构异常，taskId=${taskId}`);
          }
          logGrokResponseSnippet(taskId, options.model || "", rawJson, imageUrls, rawUrls);
          return;
        }

        if (statusRaw === "FAILURE" || statusRaw === "FAILED") {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            const slots = options.slotNodes || [];
            markSlotFailed(slots[0] || null, "生成失败", size);
            markSlotFailed(slots[1] || null, "生成失败", size);
          }
          logGrokResponseSnippet(taskId, options.model || "", rawJson, imageUrls, rawUrls);
          return;
        }

        return;
      }

      const parsedStandard = parseStandardImageUrls(rawJson);
      const imageUrls = parsedStandard.urls.length > 0
        ? parsedStandard.urls
        : findAllUrlsInObject(rawJson);

      // 成功
      if (imageUrls && imageUrls.length > 0) {
        clearInterval(checkLoop);
        removePendingTask(taskId); // [Persistence] Remove
        removePendingTaskFromGallery(taskId); // 【新增】从画廊移除占位图
        if (canUpdateMainUi(options.runToken, trackUi)) {
          appendImageToGrid(imageUrls[0], size, null, { runToken: options.runToken, trackUi: true });
        } else {
          const promptText = document.getElementById("prompt")?.value?.trim() || "";
          saveToHistory(imageUrls[0], promptText);
        }
        return;
      }

      // 成功但无图：最多再等几轮，避免上游先回 SUCCESS 后补 url
      if (statusRaw === "SUCCESS" || statusRaw === "SUCCEEDED") {
        successNoUrlCount++;
        if (successNoUrlCount >= maxSuccessNoUrlCount) {
          clearInterval(checkLoop);
          removePendingTask(taskId);
          removePendingTaskFromGallery(taskId);
          console.warn(`[TASK_SUCCESS_NO_URL] taskId=${taskId} model=${options.model || ""} urls=${JSON.stringify(parsedStandard.urls || [])}`);
          if (canUpdateMainUi(options.runToken, trackUi)) {
            handleSingleError(`任务 ${index} 返回成功但未提供图片链接`, size);
          }
        }
        return;
      }

      // 失败
      if (statusRaw === "FAILURE" || statusRaw === "FAILED") {
        clearInterval(checkLoop);
        removePendingTask(taskId); // [Persistence] Remove
        removePendingTaskFromGallery(taskId); // 【新增】从画廊移除占位图
        if (canUpdateMainUi(options.runToken, trackUi)) {
          handleSingleError(`任务 ${index} 生成失败`, size);
        }
      }
    } catch (err) {
      console.warn(`Poll task ${index} warning:`, err);
      // 累计错误次数
      errorCount++;
      if (errorCount >= maxErrors) {
        clearInterval(checkLoop);
        removePendingTask(taskId);
        removePendingTaskFromGallery(taskId); // 【新增】从画廊移除占位图
        if (!canUpdateMainUi(options.runToken, trackUi)) {
          return;
        }
        if (options.mode === "grok_dual") {
          const slots = options.slotNodes || [];
          const msg = "查询连接持续失败";
          markSlotFailed(slots[0] || null, msg, size);
          markSlotFailed(slots[1] || null, msg, size);
          updateStatus(`Grok 任务 ${index} ${msg}`);
        } else {
          handleSingleError(`任务 ${index} 查询连接持续失败`, size);
        }
      }
    }
  }, 2000);
}

// --- Persistence Helpers ---
function savePendingTask(taskId, key, size, index, mode = "single", model = "") {
  let tasks = JSON.parse(localStorage.getItem("nb_pending_tasks") || "[]");
  // Avoid duplicates
  if (!tasks.find((t) => t.id === taskId)) {
    tasks.push({ id: taskId, key, size, index, time: Date.now(), mode, model });
    localStorage.setItem("nb_pending_tasks", JSON.stringify(tasks));
  }
}

function removePendingTask(taskId) {
  let tasks = JSON.parse(localStorage.getItem("nb_pending_tasks") || "[]");
  tasks = tasks.filter((t) => t.id !== taskId);
  localStorage.setItem("nb_pending_tasks", JSON.stringify(tasks));
}

function restorePendingTasks() {
  let tasks = [];
  try {
    tasks = JSON.parse(localStorage.getItem("nb_pending_tasks") || "[]");
  } catch (e) {
    return;
  }

  // --- 过滤掉超过 10 分钟的任务 (TTL) ---
  const now = Date.now();
  const TTL = 10 * 60 * 1000;
  const validTasks = tasks.filter((t) => now - (t.time || 0) < TTL);

  if (validTasks.length !== tasks.length) {
    localStorage.setItem("nb_pending_tasks", JSON.stringify(validTasks));
  }

  if (validTasks.length > 0) {
    console.log(`Resuming ${validTasks.length} tasks in Gallery...`);

    validTasks.forEach((t) => {
      // 在画廊中恢复占位图
      addPendingTaskToGallery(t.id, t.index);
      if (t.mode === "grok_dual") {
        pollSingleTask(t.id, t.key, t.size, t.index, {
          mode: "grok_dual",
          expectedCount: 2,
          model: t.model || "",
          trackUi: false,
        });
      } else {
        pollSingleTask(t.id, t.key, t.size, t.index, { trackUi: false });
      }
    });

    // 提示用户
    console.log("Tasks resumed in Gallery tab.");
  }
}

// --- 【新增UI函数】画廊任务占位符管理 ---
function addPendingTaskToGallery(taskId, index) {
  const container = document.getElementById("pendingTasksContainer");
  const grid = document.getElementById("pendingTasksGrid");
  if (!container || !grid) return;

  // 避免重复添加
  if (document.getElementById(`pending-${taskId}`)) return;

  container.style.display = "block";

  const div = document.createElement("div");
  div.id = `pending-${taskId}`;
  div.className = "result-item history-item pending-task";
  div.innerHTML = `
        <div class="loader"></div>
        <div style="margin-top:5px">任务正在生成...</div>
        <div style="font-size:10px; opacity:0.6">ID: ${taskId.slice(-6)}</div>
    `;
  grid.appendChild(div);
}

function removePendingTaskFromGallery(taskId) {
  const div = document.getElementById(`pending-${taskId}`);
  if (div) {
    div.remove();
  }

  // 没有待处理任务时自动隐藏容器
  const grid = document.getElementById("pendingTasksGrid");
  if (grid && grid.children.length === 0) {
    const container = document.getElementById("pendingTasksContainer");
    if (container) container.style.display = "none";
  }
}

function handleSingleError(msg, size) {
  activeTasksCount--;
  completedTasksCount++;
  checkAllDone(size || currentRunSize);
  const statusText = document.getElementById("statusText");

  // [Fix] Friendly Quota Error
  if (
    msg.includes("token quota is not enough") ||
    msg.includes("insufficient quota")
  ) {
    msg = "你的密钥额度不足，需要充值了";
  }

  // [Fix] Content Safety / Generic Failure Advice
  // Checked: '生成失败' (via poll), '提交失败' (via submit), 'FAILURE' (status)
  if (
    msg.includes("失败") ||
    msg.includes("FAILURE") ||
    msg.includes("FAILED")
  ) {
    // Avoid duplicating the advice if it's already there (though unlikely)
    if (!msg.includes("安全限制")) {
      msg += " (请检查提示词或参考图，可能触发了安全限制，请更换后重试)";
    }
  }

  statusText.innerText = `Warning: ${msg}`;
  statusText.style.color = "#FFD60A";
}

// --- 新功能：网络图片转 Base64 ---
function urlToBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous"; // 允许跨域读取
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      // 限制最大尺寸防止 Base64 爆表
      const maxDim = 1024;
      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("图片跨域或加载失败"));
    img.src = url;
  });
}

// --- 新功能：一键设为参考图 ---
async function useAsRef(url, btnElement) {
  const hasBtn = !!btnElement;
  const originalText = hasBtn ? btnElement.innerHTML : "";
  if (hasBtn) {
    btnElement.innerHTML = "处理中...";
    btnElement.disabled = true;
  }

  try {
    const base64 = await urlToBase64(url);

    // 核心逻辑：清空旧的，加入新的
    refImages = [base64];
    await detectAndSetSmartRatio(base64);

    // 更新 UI
    renderThumbs();
    document.getElementById("uploadPlaceholder").style.display = "none";

    // 视觉反馈
    if (hasBtn) {
      btnElement.innerHTML = "✓ OK";
      btnElement.style.background = "var(--success-green)";
    } else {
      showApiGuideModal({
        title: "已设为参考图",
        desc: "已将该图片加入参考图区域。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    }

    // 滚动到参考图区域提示用户
    document
      .querySelector(".upload-box")
      .scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(() => {
      if (hasBtn) {
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
        btnElement.style.background = "";
      }
    }, 2000);
  } catch (e) {
    console.error(e);
    showApiGuideModal({
      title: "设为参考图失败",
      desc: "浏览器安全限制导致失败，请手动下载后上传。",
      primaryText: "我知道了",
      showSecondary: false,
      action: "close",
    });
    if (hasBtn) {
      btnElement.innerHTML = "失败";
      setTimeout(() => {
        btnElement.innerHTML = originalText;
        btnElement.disabled = false;
      }, 2000);
    }
  }
}

// --- 把单张图片插入到网格 ---
function appendImageToGrid(url, size, targetWrapper = null, options = {}) {
  const grid = document.getElementById("resultGrid");
  const imgContainer = document.getElementById("imgContainer");
  const promptVal = document.getElementById("prompt")?.value?.trim() || "";
  const trackUi = options.trackUi !== false;
  const runToken = options.runToken || 0;

  const wrapper = targetWrapper || document.createElement("div");
  wrapper.className = "result-item-wrapper";
  wrapper.innerHTML = "";

  const img = document.createElement("img");
  img.src = url;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";

  img.onload = () => {
    img.dataset.loaded = "1";
    saveToHistory(url, promptVal);
    if (!canUpdateMainUi(runToken, trackUi)) return;
    loadedImageCount++;
    completedTasksCount++;
    activeTasksCount--;
    checkAllDone(size);
  };
  img.onerror = () => {
    if (!canUpdateMainUi(runToken, trackUi)) return;
    wrapper.className = "result-item-wrapper pending-task";
    wrapper.innerHTML = `
      <div style="font-size:24px; line-height:1">⚠️</div>
      <div>图片加载失败</div>
      <div style="font-size:11px; opacity:0.8; margin-top:4px;">链接可能已失效，建议重新生成</div>
    `;
    console.warn(`[IMAGE_LOAD_FAILED] size=${size} url=${url}`);
    handleRenderFailure("图片加载失败，可能是返回链接失效，请重试生成", size);
  };

  const overlay = document.createElement("div");
  overlay.className = "item-overlay";

  const zoomBtn = document.createElement("button");
  zoomBtn.className = "overlay-btn";
  zoomBtn.innerHTML = "🔍 放大";
  zoomBtn.onclick = () => openLightbox(url);

  const downBtn = document.createElement("button");
  downBtn.className = "overlay-btn";
  downBtn.innerHTML = "⬇️ 保存";
  downBtn.onclick = () => downloadSingleImg(url);

  // 新增按钮：一键设为参考图
  const reuseBtn = document.createElement("button");
  reuseBtn.className = "overlay-btn";
  reuseBtn.innerHTML = "🎨 垫图";
  reuseBtn.title = "用这张图作为参考图继续修改";
  reuseBtn.onclick = (e) => {
    useAsRef(url, reuseBtn);
  };

  overlay.appendChild(zoomBtn);
  overlay.appendChild(downBtn);
  overlay.appendChild(reuseBtn); // 加入新按钮
  wrapper.appendChild(img);
  wrapper.appendChild(overlay);

  if (!targetWrapper) {
    grid.appendChild(wrapper);
  }
  imgContainer.style.display = "flex";
}

function checkAllDone(size) {
  const statusText = document.getElementById("statusText");
  const bar = document.getElementById("progressBar");
  const fill = document.getElementById("progressFill");
  const btn = document.getElementById("genBtn");

  if (activeTasksCount > 0) {
    statusText.innerText = `Processing... (${completedTasksCount}/${totalBatchSize} Ready)`;
    statusText.style.color = "var(--banana)";
  } else {
    clearInterval(progressInterval);
    fill.style.width = "100%";
    bar.style.display = "none";
    btn.disabled = false;
    btn.innerHTML = "INITIATE // 开始生产";
    if (loadedImageCount > 0) {
      statusText.innerText = `ALL TASKS COMPLETE [${size} x ${totalBatchSize}]`;
      statusText.style.color = "#32c864";
    } else {
      statusText.innerText = `TASK FINISHED, NO IMAGE LOADED [${size} x ${totalBatchSize}]`;
      statusText.style.color = "#FFD60A";
    }
  }
}

function startFakeProgress() {
  if (progressInterval) clearInterval(progressInterval);
  const fill = document.getElementById("progressFill");
  const statusText = document.getElementById("statusText");
  let currentPercent = 0;

  progressInterval = setInterval(() => {
    if (activeTasksCount === 0) return;

    let step = 0;
    if (currentPercent < 50) step = 0.6 + Math.random();
    else if (currentPercent < 80) step = 0.1;
    else if (currentPercent < 95) step = 0.05;
    else step = 0;

    if (currentPercent < 95) {
      currentPercent += step;
      fill.style.width = currentPercent + "%";
      statusText.innerText = `Processing... ${Math.floor(currentPercent)}%`;
    }
  }, 100);
}

function findAllUrlsInObject(obj, foundUrls = []) {
  if (!obj) return foundUrls;
  if (Array.isArray(obj)) {
    obj.forEach((item) => {
      if (
        typeof item === "string" &&
        (item.startsWith("http") || item.startsWith("data:image/"))
      )
        foundUrls.push(item);
      else findAllUrlsInObject(item, foundUrls);
    });
    return foundUrls;
  }
  if (typeof obj === "object") {
    if (typeof obj.b64_json === "string" && obj.b64_json.trim()) {
      foundUrls.push(`data:image/png;base64,${obj.b64_json.trim()}`);
    }
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        const val = obj[key];
        if (
          typeof val === "string" &&
          (val.startsWith("http") || val.startsWith("data:image/"))
        ) {
          const isImageKey = /url|image|output|result/i.test(key);
          const isImageExt = /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(val);
          const isDataImage = val.startsWith("data:image/");
          if (isImageKey || isImageExt || isDataImage) foundUrls.push(val);
        } else if (typeof val === "object") {
          findAllUrlsInObject(val, foundUrls);
        }
      }
    }
  }
  return [...new Set(foundUrls)];
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveToHistory(url, promptText = "") {
  if (url.length > 5000) return;
  try {
    let history = JSON.parse(localStorage.getItem("nb_history") || "[]");
    if (history.length > 0 && typeof history[0] === "string") history = [];
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const cleanPrompt = String(promptText || "").trim();
    const newRecord = { id: genHistoryId(), url: url, time: timeStr, prompt: cleanPrompt };
    if (history.length > 0 && history[0].url === url) return;
    history.unshift(newRecord);
    // [Mod] Increased History Limit to 20
    const removed = history.length > 20 ? history.slice(20) : [];
    if (history.length > 20) history = history.slice(0, 20);
    localStorage.setItem("nb_history", JSON.stringify(history));
    loadHistory();
    cacheHistoryImage(newRecord.id, url).then((ok) => {
      if (ok) loadHistory();
    });
    removed.forEach((item) => removeCachedHistoryImage(item?.id));
  } catch (e) {}
}

function clearHistory() {
  showApiGuideModal({
    title: "清空历史记录？",
    desc: "该操作不可撤销，确定要清空所有历史记录吗？",
    primaryText: "确认清空",
    secondaryText: "取消",
    action: "custom",
    onPrimary: () => {
      localStorage.removeItem("nb_history");
      clearCachedHistoryImages();
      clearHistoryObjectUrlRefs();
      loadHistory();
      closeApiGuideModal();
    },
  });
}

function loadHistory() {
  clearHistoryObjectUrlRefs();
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("nb_history") || "[]");
  } catch (e) {
    return;
  }
  let migrated = false;
  history = history.map((item) => {
    if (typeof item === "string") {
      migrated = true;
      return { id: genHistoryId(), url: item, time: "", prompt: "" };
    }
    if (!item?.id) {
      migrated = true;
      return { ...item, id: genHistoryId() };
    }
    return item;
  });
  if (migrated) {
    localStorage.setItem("nb_history", JSON.stringify(history));
  }
  const grid = document.getElementById("historyGrid");
  grid.innerHTML = "";

  const applyReorder = async (targetIdx) => {
    if (draggedIdx === null) return;
    if (targetIdx === null || Number.isNaN(targetIdx)) return;
    if (targetIdx < 0 || targetIdx >= refImages.length) return;
    if (draggedIdx === targetIdx) return;

    const item = refImages.splice(draggedIdx, 1)[0];
    refImages.splice(targetIdx, 0, item);

    if (draggedIdx === 0 || targetIdx === 0) {
      await detectAndSetSmartRatio(refImages[0]);
    }
    renderThumbs();
  };

  if (history.length === 0) {
    grid.innerHTML =
      '<div style="color:var(--text-sub); grid-column:1/-1; text-align:center; padding:20px; font-size:12px;">暂无历史记录</div>';
    return;
  }

  history.forEach((item) => {
    const url = typeof item === "string" ? item : item.url;
    const recordId = typeof item === "object" ? item.id : "";
    // Check for time property, fallback to specific logic or empty
    const time = typeof item === "object" && item.time ? item.time : "";
    const prompt = typeof item === "object" && item.prompt ? String(item.prompt) : "";
    const encodedPrompt = encodeURIComponent(prompt || "");
    const promptLabel = prompt ? `提示词：${prompt}` : "提示词：无记录";
    const promptTooltip = prompt ? `<div class="history-prompt-tip">${escapeHtml(promptLabel)}</div>` : "";

    const div = document.createElement("div");
    div.className = "result-item history-item"; // Inherit overlay styles
    div.title = promptLabel;

    div.innerHTML = `
            <img src="${url}" loading="lazy" onclick="openLightbox(this.src)">
            <!-- Timestamp Display -->
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
    setHistoryCacheBadge(div, "cloud");

    if (recordId) {
      getCachedHistoryImage(recordId).then((blob) => {
        if (!blob) {
          setHistoryCacheBadge(div, "cloud");
          return;
        }
        const localUrl = URL.createObjectURL(blob);
        historyObjectUrls.push(localUrl);
        const imgEl = div.querySelector("img");
        if (imgEl) imgEl.src = localUrl;
        setHistoryCacheBadge(div, "local");
      });
    }
  });
}

function regenerateFromHistory(encodedPrompt) {
  const prompt = decodeURIComponent(encodedPrompt || "");
  switchTab("create");
  const promptInput = document.getElementById("prompt");
  if (promptInput) {
    promptInput.value = prompt;
    promptInput.focus();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// New Helper: Copy URL (Robust Version)
function copyImgUrl(url) {
  if (!url) return;

  // Plan A: Modern API (Secure Context only)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        showApiGuideModal({
          title: "复制成功",
          desc: "图片链接已复制到剪贴板。",
          primaryText: "我知道了",
          showSecondary: false,
          action: "close",
        });
      })
      .catch(() => {
        fallbackCopy(url);
      });
  } else {
    // Plan B: Legacy Fallback for HTTP/LAN
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Ensure it's not visible but part of DOM
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);

  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    if (successful) {
      showApiGuideModal({
        title: "复制成功",
        desc: "图片链接已复制 (LAN 模式)。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    } else {
      showApiGuideModal({
        title: "复制失败",
        desc: "当前环境不支持自动复制，请手动复制链接。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    }
  } catch (err) {
    showApiGuideModal({
      title: "复制失败",
      desc: "当前环境不支持自动复制，请手动复制链接。",
      primaryText: "我知道了",
      showSecondary: false,
      action: "close",
    });
  }

  document.body.removeChild(textArea);
}

// New Helper: Use as Ref (Pad)
function useAsRefByFetch(url) {
  // Switch to Create Tab
  switchTab("create");

  // Create a file object (simulated) or just fetch it
  // For simplicity, we can fetch it and add to the dropZone logic,
  // OR we can just add a visual indicator.
  // Let's try to fetch and add to input if possible, or just open the file dialog.
  // simpler: Fetch blob -> File -> DataTransfer -> Input

  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const file = new File([blob], "ref_image.png", { type: "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const fileInput = document.getElementById("fileInput");
      if (fileInput) {
        fileInput.files = dataTransfer.files;
        // Trigger change event to reuse existing logic
        const event = new Event("change");
        fileInput.dispatchEvent(event);
      }
    })
    .catch((err) => {
      console.error(err);
      showApiGuideModal({
        title: "垫图失败",
        desc: "请手动下载后上传参考图。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    });
}

function openLightbox(src) {
  if (!src) return;
  document.getElementById("lbImg").src = src;
  document.getElementById("lightbox").style.display = "flex";
}
function closeLightbox() {
  document.getElementById("lightbox").style.display = "none";
}

async function downloadSingleImg(src) {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NanoBanana_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    window.open(src, "_blank");
  }
}

// --- Mobile Navigation Logic ---
function switchTab(tabName) {
  // 1. Switch Tab Content
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));

  const target = document.getElementById(`tab-${tabName}`);
  if (target) target.classList.add("active");

  // 2. Update Bottom Nav State
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => item.classList.remove("active"));

  if (tabName === "create") navItems[0].classList.add("active");
  else if (tabName === "gallery") navItems[1].classList.add("active");
  else if (tabName === "profile") navItems[2].classList.add("active");

  // 3. Update Desktop Nav State (New)
  document
    .querySelectorAll(".d-nav-item")
    .forEach((el) => el.classList.remove("active"));
  const dTarget = document.getElementById(`d-nav-${tabName}`);
  if (dTarget) dTarget.classList.add("active");

  // --- [新增] 仅在手机端“我的”页面显示主题切换按钮 ---
  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) {
    if (window.innerWidth <= 768) {
      if (tabName === "profile") {
        themeBtn.style.display = "flex";
      } else {
        themeBtn.style.display = "none";
      }
    } else {
      // PC 端保持 CSS 默认显示 (flex)
      themeBtn.style.display = "flex";
    }
  }

  // 4. Scroll Top
  window.scrollTo({ top: 0, behavior: "auto" });
}

function hasValidApiKey() {
  const key = (localStorage.getItem("nb_key") || "").trim();
  return key.length > 10;
}

const API_GUIDE_DISMISSED_KEY = "classic-api-guide-dismissed-v1";

function isApiGuideAutoPromptDismissed() {
  try {
    return sessionStorage.getItem(API_GUIDE_DISMISSED_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function setApiGuideAutoPromptDismissed(nextValue) {
  try {
    if (nextValue) {
      sessionStorage.setItem(API_GUIDE_DISMISSED_KEY, "1");
    } else {
      sessionStorage.removeItem(API_GUIDE_DISMISSED_KEY);
    }
  } catch (_) {}
}

let apiGuideAction = "key";
let apiGuideOnPrimary = null;
let apiGuideOnSecondary = null;

function showApiGuideModal(config = {}) {
  const modal = document.getElementById("apiGuideModal");
  if (!modal) return;
  const titleEl = document.getElementById("apiGuideTitle");
  const descEl = document.getElementById("apiGuideDesc");
  const primaryBtn = document.getElementById("apiGuidePrimaryBtn");
  const secondaryBtn = document.getElementById("apiGuideSecondaryBtn");

  const title = config.title || "请先输入 API Key";
  const desc = config.desc || "首次使用请先配置密钥。";
  const primaryText = config.primaryText || "去设置";
  const secondaryText = config.secondaryText || "稍后";
  const showSecondary = config.showSecondary !== false;
  const icon = config.icon || "✨";
  apiGuideAction = config.action || "key";
  apiGuideOnPrimary = typeof config.onPrimary === "function" ? config.onPrimary : null;
  apiGuideOnSecondary = typeof config.onSecondary === "function" ? config.onSecondary : null;
  modal.dataset.autoPrompt = config.autoPrompt === true ? "1" : "0";

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (primaryBtn) primaryBtn.textContent = primaryText;
  if (secondaryBtn) {
    secondaryBtn.textContent = secondaryText;
    secondaryBtn.style.display = showSecondary ? "inline-flex" : "none";
  }
  const iconEl = modal.querySelector(".api-guide-icon");
  if (iconEl) iconEl.textContent = icon;

  modal.style.display = "flex";
}

function closeApiGuideModal(options = {}) {
  const modal = document.getElementById("apiGuideModal");
  const shouldRememberDismissal =
    options.rememberDismiss === true ||
    (modal?.dataset?.autoPrompt === "1" && options.rememberDismiss !== false);

  if (modal) modal.style.display = "none";
  if (modal) modal.dataset.autoPrompt = "0";
  if (shouldRememberDismissal) {
    setApiGuideAutoPromptDismissed(true);
  }
  apiGuideOnPrimary = null;
  apiGuideOnSecondary = null;
}

function updateApiGuidePrompt(force = false) {
  if (hasValidApiKey()) {
    setApiGuideAutoPromptDismissed(false);
    closeApiGuideModal({ rememberDismiss: false });
    return;
  }
  if (!force && isApiGuideAutoPromptDismissed()) {
    return;
  }
  showApiGuideModal({
    title: "欢迎使用，先完成 1 步配置",
    desc: "检测到你还没有输入 API Key。先在“我的”页填写密钥，完成后即可直接开始生图。",
    primaryText: "去输入密钥",
    action: "key",
    autoPrompt: true,
  });
}

window.goToKeyInput = function () {
  switchTab("profile");
  const input = document.getElementById("apiKey");
  if (input) {
    input.focus();
    input.select();
  }
  closeApiGuideModal({ rememberDismiss: true });
};

window.goToPromptInput = function () {
  switchTab("create");
  const input = document.getElementById("prompt");
  if (input) input.focus();
  closeApiGuideModal({ rememberDismiss: true });
};

window.handleApiGuidePrimary = function () {
  if (apiGuideOnPrimary) {
    apiGuideOnPrimary();
    return;
  }
  if (apiGuideAction === "prompt") {
    window.goToPromptInput();
    return;
  }
  if (apiGuideAction === "close") {
    closeApiGuideModal();
    return;
  }
  window.goToKeyInput();
};

window.handleApiGuideSecondary = function () {
  if (apiGuideOnSecondary) {
    apiGuideOnSecondary();
    return;
  }
  closeApiGuideModal({ rememberDismiss: true });
};

function confirmByModal({ title, desc, primaryText = "确定", secondaryText = "取消" }) {
  return new Promise((resolve) => {
    showApiGuideModal({
      title,
      desc,
      primaryText,
      secondaryText,
      action: "custom",
      onPrimary: () => {
        resolve(true);
        closeApiGuideModal();
      },
      onSecondary: () => {
        resolve(false);
        closeApiGuideModal();
      },
    });
  });
}

window.closeApiGuideModal = closeApiGuideModal;

// 自动跳转与初始化逻辑
window.addEventListener("load", () => {
  initTheme();
  loadHistory();
  initPromptTagUi();
  refreshReferencedThumbHighlight();

  // Sync Key UI
  const savedKey = localStorage.getItem("nb_key");
  if (savedKey) {
    const keyInput = document.getElementById("apiKey");
    if (keyInput) keyInput.value = savedKey;
    updateApiStatusUI(true);
    checkAdminStatus(savedKey); // --- [新增] 同步管理员权限识别 ---
  }

  // 【修改】手机端默认始终进入“创作”(Create) 页面
  if (window.innerWidth <= 768) {
    setTimeout(() => switchTab("create"), 50);
  } else {
    // Desktop default checks could go here
  }

  updateThemeBtn();

  // [Persistence] Check for recovered tasks
  restorePendingTasks();

  // --- [新增] 加载公告 ---
  loadAnnouncement();
  setTimeout(updateApiGuidePrompt, 120);
  // 为旧历史补一次本地缓存（异步后台执行）
  tryBackfillHistoryCache();
});

async function tryBackfillHistoryCache() {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("nb_history") || "[]");
  } catch {
    return;
  }
  for (const item of history) {
    if (!item?.id || !item?.url) continue;
    const exists = await getCachedHistoryImage(item.id);
    if (exists) continue;
    await cacheHistoryImage(item.id, item.url);
  }
}

// 监听 API Key 输入
const apiKeyInput = document.getElementById("apiKey");
if (apiKeyInput) {
  apiKeyInput.addEventListener("input", (e) => {
    const val = e.target.value;
    localStorage.setItem("nb_key", val);
    updateApiStatusUI(val.length > 10);
    updateApiGuidePrompt();
  });
}

function updateApiStatusUI(isActive) {
  const status = document.getElementById("apiStatus");
  if (status) {
    if (isActive) status.classList.add("active");
    else status.classList.remove("active");
  }
}


// --- 主题切换辅助逻辑 ---

function updateThemeBtn() {
  const btn = document.getElementById("themeBtnInline");
  const current = document.documentElement.getAttribute("data-theme");
  if (btn) {
    btn.innerHTML = current === "light" ? "☀️" : "🌙";
  }
}

// Override toggleTheme
const originalToggleTheme = toggleTheme;
toggleTheme = function () {
  originalToggleTheme();
  updateThemeBtn();
};

// --- 公告中心逻辑 ---
function normalizeAnnouncementItems(data) {
  let items = [];
  if (Array.isArray(data?.items)) {
    items = data.items.slice();
  } else if (Array.isArray(data?.history)) {
    items = data.history.slice();
  } else if (data && typeof data.content === "string" && data.content.trim()) {
    const rawImages = Array.isArray(data?.images)
      ? data.images
          .map((url) => String(url || "").trim())
          .filter((url) => /^https?:\/\//i.test(url) || url.startsWith("/uploads/"))
      : [];
    const legacyTimeSource = data?.date || data?.time || Date.now();
    const legacyTime = Number.isFinite(Number(legacyTimeSource))
      ? Number(legacyTimeSource)
      : new Date(String(legacyTimeSource)).getTime();
    items = [
      {
        id: data.id || `legacy_${Number(data.time) || Date.now()}`,
        title: data.title || "更新通知",
        content: data.content,
        time: Number.isFinite(legacyTime) && legacyTime > 0 ? legacyTime : Date.now(),
        images: rawImages,
      },
    ];
  }

  const normalized = items
    .map((item, idx) => {
      const content = String(item?.content || "").trim();
      if (!content) return null;
      const ts = Number(item?.time);
      const time = Number.isFinite(ts) && ts > 0 ? ts : Date.now() - idx;
      const idRaw = item?.id;
      const id = String(idRaw || `notice_${time}_${idx}`);
      const title = String(item?.title || "更新通知").trim() || "更新通知";
      const images = Array.isArray(item?.images)
        ? item.images
            .map((url) => String(url || "").trim())
            .filter((url) => /^https?:\/\//i.test(url) || url.startsWith("/uploads/"))
        : [];
      return { id, title, content, time, images };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time);

  const deduped = [];
  const seen = new Set();
  normalized.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    deduped.push(item);
  });
  return deduped;
}

function buildNoticeGalleryKey(rawId = "") {
  const cleaned = String(rawId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48);
  return cleaned || `notice_${Date.now()}`;
}

function renderNoticeImagesHtml(images = [], variant = "panel", noticeId = "") {
  const normalizedImages = Array.isArray(images)
    ? images.map((url) => String(url || "").trim()).filter(Boolean)
    : [];
  if (normalizedImages.length === 0) return "";

  const className =
    variant === "bar" ? "announcement-images announcement-images--bar" : "notice-item-images";
  const safeNoticeId = buildNoticeGalleryKey(noticeId);
  const galleryId = `noticeGallery_${variant}_${safeNoticeId}`;
  const primaryUrl = normalizedImages[0];
  const heroImageClass =
    variant === "bar"
      ? "announcement-image notice-gallery-hero"
      : "notice-item-image notice-gallery-hero";

  const thumbnailsHtml =
    normalizedImages.length > 1
      ? `
        <div class="notice-image-strip ${variant === "bar" ? "notice-image-strip--bar" : ""}" role="tablist" aria-label="公告图片缩略图">
          ${normalizedImages
            .map((url, index) => {
              const encodedUrl = encodeURIComponent(url);
              return `
                <button
                  type="button"
                  class="notice-image-thumb ${variant === "bar" ? "notice-image-thumb--bar" : ""} ${index === 0 ? "is-active" : ""}"
                  data-gallery-id="${galleryId}"
                  data-index="${index}"
                  aria-pressed="${index === 0 ? "true" : "false"}"
                  aria-label="查看第${index + 1}张公告图片"
                  onclick="swapNoticeGalleryImage(event, '${galleryId}', '${encodedUrl}', ${index})"
                >
                  <img src="${url}" alt="公告图片缩略图${index + 1}" class="notice-image-thumb-img" loading="lazy" />
                </button>
              `;
            })
            .join("")}
        </div>
      `
      : "";

  return `
    <div class="${className}" data-notice-gallery="${galleryId}">
      <button
        type="button"
        id="${galleryId}_main_btn"
        class="notice-image-button notice-image-main-button"
        data-current-url="${escapeHtml(primaryUrl)}"
        onclick="openNoticeGalleryImage(event, '${galleryId}')"
      >
        <img
          id="${galleryId}_main_img"
          src="${primaryUrl}"
          alt="公告图片"
          class="${heroImageClass}"
          loading="lazy"
        />
      </button>
      ${thumbnailsHtml}
    </div>
  `;
}

window.openNoticeImage = function (event, encodedUrl) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const url = decodeURIComponent(String(encodedUrl || ""));
  if (!url) return;
  if (typeof openLightbox === "function") {
    openLightbox(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

window.openNoticeGalleryImage = function (event, galleryId) {
  const mainButton = document.getElementById(`${galleryId}_main_btn`);
  const currentUrl = String(mainButton?.dataset?.currentUrl || "").trim();
  if (!currentUrl) return;
  window.openNoticeImage(event, encodeURIComponent(currentUrl));
};

window.swapNoticeGalleryImage = function (event, galleryId, encodedUrl, activeIndex) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const url = decodeURIComponent(String(encodedUrl || ""));
  if (!url) return;

  const mainButton = document.getElementById(`${galleryId}_main_btn`);
  const mainImage = document.getElementById(`${galleryId}_main_img`);
  const galleryRoot = document.querySelector(`[data-notice-gallery="${galleryId}"]`);
  if (!mainButton || !mainImage || !galleryRoot) return;

  mainButton.dataset.currentUrl = url;
  mainImage.src = url;
  mainImage.alt = `公告图片${Number(activeIndex) + 1}`;

  galleryRoot.querySelectorAll(".notice-image-thumb").forEach((thumb) => {
    const isActive = Number(thumb.dataset.index) === Number(activeIndex);
    thumb.classList.toggle("is-active", isActive);
    thumb.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (isActive) {
      thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
};

function getNoticeLastReadTs() {
  const val = Number(localStorage.getItem(NOTICE_READ_TS_KEY) || 0);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

function setNoticeLastReadTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return;
  localStorage.setItem(NOTICE_READ_TS_KEY, String(n));
}

function formatNoticeTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function refreshNoticeUnreadDot() {
  const dot = document.getElementById("noticeUnreadDot");
  if (!dot) return;
  const readTs = getNoticeLastReadTs();
  const hasUnread = noticeItems.some((item) => Number(item.time) > readTs);
  dot.style.display = hasUnread ? "block" : "none";
}

function renderAnnouncementBar() {
  const bar = document.getElementById("announcementBar");
  const text = document.getElementById("announcementText");
  if (!bar || !text) return;
  const noticeOverlay = document.getElementById("noticeOverlay");

  if (!noticeItems.length) {
    bar.style.display = "none";
    return;
  }

  const latest = noticeItems[0];
  const readTs = getNoticeLastReadTs();
  const dismissedId = sessionStorage.getItem(NOTICE_POPUP_DISMISSED_KEY) || "";
  const isUnread = Number(latest?.time) > readTs;
  if (
    !isUnread ||
    dismissedId === latest.id ||
    (noticeOverlay && noticeOverlay.style.display === "flex")
  ) {
    bar.style.display = "none";
    return;
  }

  const title = String(latest?.title || "更新通知").trim() || "更新通知";
  const content = String(latest?.content || "").trim();
  const paragraphs = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const imageHtml = renderNoticeImagesHtml(latest.images, "panel", latest.id);
  const timeText = formatNoticeTime(latest.time);

  text.dataset.noticeId = String(latest.id || "");
  text.innerHTML = `
    <div class="announcement-modal-head">
      <div class="announcement-modal-head-main">
        <div class="announcement-modal-icon">📢</div>
        <div class="announcement-modal-meta">
          <div class="announcement-modal-title">${escapeHtml(title)}</div>
          ${timeText ? `<div class="announcement-modal-time">${timeText}</div>` : ""}
        </div>
      </div>
      <button type="button" class="announcement-modal-close" aria-label="关闭公告弹窗" onclick="closeAnnouncement()">×</button>
    </div>
    <div class="announcement-modal-body">
      ${paragraphs || '<p class="announcement-modal-empty">暂无公告内容</p>'}
      ${imageHtml}
    </div>
  `;
  bar.style.display = "flex";
}

function renderNoticeList() {
  const listEl = document.getElementById("noticeList");
  const markBtn = document.getElementById("noticeMarkAllBtn");
  if (!listEl) return;

  const readTs = getNoticeLastReadTs();
  const hasUnread = noticeItems.some((item) => Number(item.time) > readTs);

  if (!noticeItems.length) {
    listEl.innerHTML = `<div class="notice-empty">暂无公告</div>`;
    if (markBtn) markBtn.disabled = true;
    refreshNoticeUnreadDot();
    renderAnnouncementBar();
    return;
  }

  listEl.innerHTML = noticeItems
    .map((item) => {
      const isUnread = Number(item.time) > readTs;
      const contentHtml = escapeHtml(item.content).replace(/\n/g, "<br>");
      const timeText = formatNoticeTime(item.time);
      const imageHtml = renderNoticeImagesHtml(item.images, "panel", item.id);
      return `
        <div class="notice-item ${isUnread ? "unread" : ""}">
          <div class="notice-item-head">
            <div class="notice-item-title">${escapeHtml(item.title)}</div>
            ${isUnread ? '<span class="notice-item-badge">未读</span>' : ""}
          </div>
          <div class="notice-item-content">${contentHtml}</div>
          ${imageHtml}
          ${timeText ? `<div class="notice-item-time">${timeText}</div>` : ""}
        </div>
      `;
    })
    .join("");

  if (markBtn) markBtn.disabled = !hasUnread;
  refreshNoticeUnreadDot();
  renderAnnouncementBar();
}

function openNoticeCenter() {
  const overlay = document.getElementById("noticeOverlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  renderNoticeList();
}

function closeNoticeCenter() {
  const overlay = document.getElementById("noticeOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
}

window.toggleNoticeCenter = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const overlay = document.getElementById("noticeOverlay");
  if (!overlay) return;
  if (overlay.style.display === "none" || !overlay.style.display) {
    openNoticeCenter();
  } else {
    closeNoticeCenter();
  }
};

window.handleNoticeOverlayClick = function (event) {
  if (!event) return;
  if (event.target?.id === "noticeOverlay") {
    closeNoticeCenter();
  }
};

window.markAllNoticesRead = function () {
  const latest = noticeItems[0]?.time || Date.now();
  setNoticeLastReadTs(latest);
  renderNoticeList();
  closeNoticeCenter();
  closeAnnouncement();
};

window.handleAnnouncementModalClick = function (event) {
  if (!event) return;
  if (event.target?.id === "announcementBar") {
    closeAnnouncement();
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeNoticeCenter();
    closeAnnouncement();
  }
});

async function loadAnnouncement() {
  try {
    const res = await fetch("/api/announcement");
    const data = await res.json();
    noticeItems = normalizeAnnouncementItems(data);
    renderNoticeList();
  } catch (e) {
    console.error("加载公告失败", e);
  }
}

function closeAnnouncement() {
  const bar = document.getElementById("announcementBar");
  const text = document.getElementById("announcementText");
  const latestId = String(text?.dataset?.noticeId || "");
  if (latestId) {
    sessionStorage.setItem(NOTICE_POPUP_DISMISSED_KEY, latestId);
  }
  if (bar) bar.style.display = "none";
}

async function publishAnnouncement() {
  const input = document.getElementById("announcementInput");
  const content = input?.value.trim() || "";
  const key = localStorage.getItem("nb_key");

  const confirmed = await confirmByModal({
    title: "发布公告？",
    desc: "确定要发布这条公告吗？所有用户都将看到。",
    primaryText: "确认发布",
    secondaryText: "取消",
  });
  if (!confirmed) return;

  try {
    const res = await fetch("/api/announcement", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ content }),
    });

    if (res.ok) {
      showApiGuideModal({
        title: "发布成功",
        desc: "公告已发布。",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
      if (input) input.value = "";
      loadAnnouncement(); // 立即刷新
    } else {
      const err = await res.json();
      showApiGuideModal({
        title: "发布失败",
        desc: err.error || "未知原因",
        primaryText: "我知道了",
        showSecondary: false,
        action: "close",
      });
    }
  } catch (e) {
    showApiGuideModal({
      title: "发布异常",
      desc: e.message || "请求异常",
      primaryText: "我知道了",
      showSecondary: false,
      action: "close",
    });
  }
}


