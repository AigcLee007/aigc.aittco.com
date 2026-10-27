// Classic layout: "高清放大" for a finished image. Kept in its own file; script.js and
// unified-bridge.js only call window.openClassicUpscale(url, prompt).
(function (root) {
  const doc = root.document;
  const SESSION_KEY = "auth-session-v1";
  const MAX_DIALOG_WAIT_MS = 15000;
  let open = null;

  const sessionHeaders = () => {
    const token = root.localStorage?.getItem(SESSION_KEY) || "";
    return token ? { "X-Auth-Session": token } : {};
  };
  const toast = (message) => (typeof root.showSoftToast === "function" ? root.showSoftToast(message, 3200) : root.alert(message));
  const ask = async (url, options) => {
    const response = await root.fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { status: response.status, code: data.code });
    return data;
  };
  const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new root.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
  const measure = (blob) => new Promise((resolve, reject) => {
    const url = root.URL.createObjectURL(blob);
    const image = new root.Image();
    image.onload = () => { root.URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { root.URL.revokeObjectURL(url); reject(new Error("无法识别这张图片")); };
    image.src = url;
  });
  const el = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    children.forEach((child) => node.append(child));
    return node;
  };

  function close() {
    if (open) { open.remove(); open = null; }
  }

  // The "before" picture is kept as a downscaled copy in this browser, under its own id, so the
  // comparison still works after a reload and costs a few hundred KB instead of a full original.
  const COMPARE_EDGE = 2048;
  const COMPARE_PREFIX = "compare:";
  async function keepBeforeCopy(blob, liveId) {
    const id = COMPARE_PREFIX + liveId;
    try {
      const small = await root.ClassicImageRuntime.makeBrowserPreview(blob, { maxEdge: COMPARE_EDGE, mimeType: "image/jpeg" });
      await root.writeClassicImageCache("previews", id, { blob: small.blob, width: small.width, height: small.height, version: 1 });
      return id;
    } catch (_) { return ""; }
  }

  async function readOriginal(url) {
    const asset = await root.getClassicOriginalAsset(url, true);
    if (asset.status !== "ready") throw new Error("原图读取失败，请稍后重试");
    try { return asset.blob; } finally { asset.release(); }
  }

  async function submit({ dataUrl, blob, engine, factor, format, prompt, size, label }) {
    const headers = { "Content-Type": "application/json", ...sessionHeaders() };
    const owner = String(root.classicImageJobOwner || "");
    const requestId = root.ClassicImageJobs.newId();
    const liveId = root.createClassicLiveTask({ prompt: prompt || "高清放大", modelLabel: label, routeLabel: "高清放大", size, status: "submitting" });
    const compareId = await keepBeforeCopy(blob, liveId);
    if (compareId) root.updateClassicLiveTask?.(liveId, { compareUrl: compareId, compareLabel: label });
    root.promoteClassicLiveTask?.(liveId, `request-${requestId}`, { clientRequestId: requestId, ownerId: owner, status: "submitting" });
    try {
      const ack = await root.ClassicImageJobs.submit("/api/upscale", { image: dataUrl, engine, factor, format, uiMode: "classic", clientLiveTaskIds: [liveId] }, headers, requestId, owner);
      const taskId = ack.task_id || ack.id;
      if (!taskId) throw new Error("未获取到任务编号");
      root.promoteClassicLiveTask?.(liveId, taskId, { prompt: prompt || "高清放大", size, modelLabel: label, routeLabel: "高清放大", status: "running" });
      root.pollSingleTask?.(taskId, "", size, 1, { trackUi: false, liveTaskId: liveId, promptSnapshot: prompt || "高清放大", modelLabel: label, routeLabel: "高清放大" });
    } catch (error) {
      root.failClassicLiveTask?.(liveId, error.message || "高清放大失败", { prompt: prompt || "高清放大", size, modelLabel: label, routeLabel: "高清放大" });
      toast(error.message || "高清放大失败");
    }
  }

  // The engine / scale / format picker with its live price, shared by the dialog and the page.
  // `options` comes from /api/upscale/options?width&height. It calls onChange(choice|null) whenever
  // the selection or its price changes, and has no buttons of its own.
  function buildForm(dims, options, onChange) {
    const LABELS = { png: "PNG", jpg: "JPG", webp: "WebP" };
    const canTake = (engine) => (engine.usableFactors ? engine.usableFactors.length > 0 : true);
    const factorsOf = (engine) => engine.usableFactors || engine.factors;
    const formatsAt = (engine, factor) => (engine.formats ? (engine.formatsByFactor ? engine.formatsByFactor[String(factor)] || [] : engine.formats) : []);
    const first = options.engines.find(canTake) || options.engines[0];
    const startFactor = first.defaultFactor || factorsOf(first).slice(-1)[0];
    const state = { engine: first, factor: startFactor, format: formatsAt(first, startFactor)[0] || null, quote: null, error: "" };
    // PNG drops out for very large outputs, so the chosen format is re-checked whenever the factor changes.
    const syncFormat = () => {
      if (!state.engine.formats) { state.format = null; return; }
      const allowed = formatsAt(state.engine, state.factor);
      if (!allowed.includes(state.format)) state.format = allowed[0] || null;
    };

    const engineBox = el("div", { role: "radiogroup", "aria-label": "放大方式", class: "up-engines" });
    const factorBox = el("div", { role: "radiogroup", "aria-label": "放大倍数", class: "up-row" });
    const formatBox = el("div", { role: "radiogroup", "aria-label": "输出格式", class: "up-row" });
    const priceBox = el("div", { "aria-live": "polite", class: "up-price" });
    const note = el("div", { class: "up-note", text: "图片将发送到云端处理，结果在服务器保留 5 小时，请及时下载。失败会自动退回金币。" });
    const container = el("div", { class: "up-form" }, [engineBox, factorBox, formatBox, priceBox, note]);

    let quoteToken = 0;
    const emit = () => onChange(state.quote && !state.error
      ? { engine: state.engine.id, factor: state.factor, format: state.format, label: state.engine.label, quote: state.quote, size: `${state.quote.outputWidth}x${state.quote.outputHeight}` }
      : null);
    const refreshQuote = async () => {
      const token = ++quoteToken;
      syncFormat();
      state.quote = null; state.error = "";
      render();
      if (state.engine.formats && !state.format) return;
      try {
        const quote = await ask("/api/upscale/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: state.engine.id, factor: state.factor, format: state.format, width: dims.width, height: dims.height }) });
        if (token === quoteToken) { state.quote = quote; render(); }
      } catch (error) { if (token === quoteToken) { state.error = error.message; render(); } }
    };
    const render = () => {
      engineBox.replaceChildren(...options.engines.map((engine) => {
        const selected = engine.id === state.engine.id;
        return el("button", {
          type: "button", role: "radio", "aria-checked": String(selected), "aria-disabled": String(!canTake(engine)),
          class: "up-engine",
          onclick: () => {
            if (!canTake(engine)) return;
            state.engine = engine;
            const usable = factorsOf(engine);
            if (!usable.includes(state.factor)) state.factor = engine.defaultFactor || usable[usable.length - 1];
            void refreshQuote();
          },
        }, [el("span", { class: "up-radio", "aria-hidden": "true" }), el("span", { class: "up-engine-text" }, [el("span", { class: "up-engine-name", text: engine.label }), el("span", { class: "up-engine-desc", text: canTake(engine) ? engine.description : "这张图尺寸太大，此方式暂不支持" })])]);
      }));
      factorBox.hidden = factorsOf(state.engine).length < 2;
      factorBox.replaceChildren(el("span", { class: "up-row-label", text: "放大倍数" }), ...factorsOf(state.engine).map((value) => el("button", {
        type: "button", role: "radio", "aria-checked": String(value === state.factor), class: "up-chip",
        onclick: () => { state.factor = value; void refreshQuote(); },
        text: value === 1 ? "原尺寸增强" : `${value} 倍`,
      })));
      const allowed = formatsAt(state.engine, state.factor);
      formatBox.hidden = !state.engine.formats;
      formatBox.replaceChildren(el("span", { class: "up-row-label", text: "输出格式" }), ...(state.engine.formats || []).map((value) => {
        const ok = allowed.includes(value);
        return el("button", {
          type: "button", role: "radio", "aria-checked": String(value === state.format), "aria-disabled": String(!ok), class: "up-chip",
          title: ok ? "" : "图片放大后较大，此格式文件会超过保存上限",
          onclick: () => { if (!ok) return; state.format = value; void refreshQuote(); },
          text: LABELS[value] || value.toUpperCase(),
        });
      }));
      if (state.error) priceBox.replaceChildren(el("span", { class: "up-price-error", text: state.error }));
      else if (!state.quote) priceBox.replaceChildren(el("span", { class: "up-price-wait", text: "正在计算价格…" }));
      else priceBox.replaceChildren(
        el("span", { class: "up-price-size" }, [el("small", { text: "输出尺寸" }), el("span", { text: `${state.quote.outputWidth} × ${state.quote.outputHeight}` })]),
        el("span", { class: "up-price-cost" }, [el("b", { text: String(state.quote.points) }), el("small", { text: " 金币" })]),
      );
      emit();
    };
    void refreshQuote();
    return container;
  }

  async function openClassicUpscale(url, prompt = "") {
    if (!root.localStorage?.getItem(SESSION_KEY)) { toast("请先登录后再使用高清放大"); return; }
    if (open) return;
    toast("正在读取原图…");
    let blob, dims, dataUrl, options;
    try {
      blob = await Promise.race([
        readOriginal(url),
        new Promise((_, reject) => root.setTimeout(() => reject(new Error("读取原图超时，请稍后重试")), MAX_DIALOG_WAIT_MS)),
      ]);
      dims = await measure(blob);
      [dataUrl, options] = await Promise.all([toDataUrl(blob), ask(`/api/upscale/options?width=${dims.width}&height=${dims.height}`)]);
    } catch (error) { toast(error.message || "读取原图失败"); return; }
    if (!options.enabled || !options.engines.length) { toast("高清放大暂未开通，请联系管理员"); return; }

    let choice = null;
    const dialog = el("div", { class: "api-guide-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "upscaleTitle", style: "display:flex" });
    const card = el("div", { class: "api-guide-card", style: "max-width:420px;text-align:left" });
    const title = el("div", { class: "api-guide-title", id: "upscaleTitle", text: "高清放大" });
    const info = el("div", { class: "api-guide-desc", text: `当前图片 ${dims.width} × ${dims.height}` });
    const cancel = el("button", { class: "api-guide-btn ghost", type: "button", text: "取消", onclick: close });
    const confirm = el("button", { class: "api-guide-btn", type: "button", text: "确认放大", disabled: "" });
    const form = buildForm(dims, options, (next) => {
      choice = next;
      confirm.disabled = !next;
      confirm.textContent = next ? `确认放大 · ${next.quote.points} 金币` : "确认放大";
    });
    card.append(title, info, form, el("div", { class: "api-guide-actions" }, [cancel, confirm]));
    dialog.append(card);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    confirm.addEventListener("click", () => {
      if (!choice) return;
      const chosen = { dataUrl, blob, ...choice, prompt };
      close();
      void submit(chosen);
    });

    open = dialog;
    doc.body.append(dialog);
    confirm.focus();
  }

  // Opens the before / after slider. `beforeId` is the cache id written by keepBeforeCopy.
  async function openClassicCompare(beforeId, afterUrl, label = "") {
    if (!beforeId || !afterUrl) { toast("没有可对比的放大前图片"); return; }
    if (typeof root.CompareSlider?.open !== "function") { toast("对比组件加载失败，请刷新页面"); return; }
    const urls = [];
    try {
      const cached = await root.readClassicImageCache("previews", beforeId);
      if (!cached?.blob) { toast("放大前的图片已不在本机缓存中，无法对比"); return; }
      const after = await root.getClassicOriginalAsset(afterUrl, true);
      if (after.status !== "ready") { toast("放大后的图片读取失败，请稍后重试"); return; }
      urls.push(root.URL.createObjectURL(cached.blob));
      const view = root.CompareSlider.open({
        before: urls[0], after: after.url, beforeLabel: "放大前", afterLabel: label ? `放大后 · ${label}` : "放大后",
        title: "放大前后对比", beforeSize: cached.width ? `${cached.width} × ${cached.height}（预览）` : null,
        afterSize: after.image?.naturalWidth ? `${after.image.naturalWidth} × ${after.image.naturalHeight}` : null,
        onClose: () => { urls.forEach((url) => root.URL.revokeObjectURL(url)); after.release(); },
      });
      if (!view) { urls.forEach((url) => root.URL.revokeObjectURL(url)); after.release(); }
    } catch (error) {
      urls.forEach((url) => root.URL.revokeObjectURL(url));
      toast(error.message || "对比打开失败");
    }
  }

  // ===== 高清放大 page (the second mode of the create tab) =====
  // Works on any picture: dropped, chosen from the computer, pasted, or sent here from a result card.
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const page = { picked: null, choice: null, busy: false, token: 0, ready: false };
  const $ = (id) => doc.getElementById(id);

  function showPageError(message) {
    const box = $("classicUpscaleError");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  function refreshGo() {
    const go = $("classicUpscaleGo");
    if (!go) return;
    go.disabled = !(page.picked && page.choice) || page.busy;
    go.textContent = page.choice ? `开始放大 · ${page.choice.quote.points} 金币` : "开始放大";
  }

  function resetPage() {
    page.token++;
    page.picked = null;
    page.choice = null;
    $("classicUpscaleForm")?.replaceChildren();
    $("classicUpscaleFormModule").hidden = true;
    $("classicUpscalePreview").hidden = true;
    $("classicUpscalePreview").replaceChildren();
    $("classicUpscalePlaceholder").hidden = false;
    $("classicUpscaleChange").hidden = true;
    showPageError("");
    refreshGo();
  }

  async function loadIntoPage(blob, name) {
    showPageError("");
    if (!root.localStorage?.getItem(SESSION_KEY)) { showPageError("请先登录后再使用高清放大"); return; }
    if (blob.type && !ACCEPTED_TYPES.includes(blob.type)) { showPageError("请使用 PNG、JPG 或 WebP 格式的图片"); return; }
    if (blob.size > MAX_FILE_BYTES) { showPageError("图片文件超过 30MB，请压缩后再试"); return; }
    const token = ++page.token;
    page.busy = true;
    refreshGo();
    try {
      const dims = await measure(blob);
      const [dataUrl, options] = await Promise.all([toDataUrl(blob), ask(`/api/upscale/options?width=${dims.width}&height=${dims.height}`)]);
      if (token !== page.token) return;
      if (!options.enabled || !options.engines.length) { showPageError("高清放大暂未开通，请联系管理员"); return; }
      page.picked = { blob, dataUrl, dims, name };
      page.choice = null;
      const preview = $("classicUpscalePreview");
      const thumb = el("img", { alt: "待放大的图片预览", src: dataUrl });
      preview.replaceChildren(thumb, el("div", { class: "meta" }, [el("b", { text: name || "图片" }), el("span", { text: `${dims.width} × ${dims.height}` })]));
      preview.hidden = false;
      $("classicUpscalePlaceholder").hidden = true;
      $("classicUpscaleChange").hidden = false;
      $("classicUpscaleFormModule").hidden = false;
      $("classicUpscaleForm").replaceChildren(buildForm(dims, options, (next) => { if (token === page.token) { page.choice = next; refreshGo(); } }));
    } catch (error) {
      if (token === page.token) showPageError(error.message || "图片读取失败，请重试");
    } finally {
      if (token === page.token) { page.busy = false; refreshGo(); }
    }
  }

  function pickFromFiles(files) {
    const file = Array.from(files || []).find((item) => item.type && item.type.startsWith("image/"));
    if (!file) { showPageError("请选择一张图片"); return; }
    void loadIntoPage(file, file.name);
  }

  function setClassicMode(mode) {
    const upscale = mode === "upscale";
    $("classicGenerateArea").hidden = upscale;
    $("classicUpscaleArea").hidden = !upscale;
    for (const [id, active] of [["classicModeGenerate", !upscale], ["classicModeUpscale", upscale]]) {
      const tab = $(id);
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    // The settings column on the right belongs to generation only.
    const right = doc.querySelector(".classic-create-layout > .right-column, .classic-create-layout .right-column");
    if (right) right.hidden = upscale;
    try { root.localStorage?.setItem("classic-create-mode", mode); } catch (_) { /* private mode */ }
  }

  // A result card can hand its picture to the page instead of the quick dialog.
  async function sendToUpscalePage(url, name = "") {
    setClassicMode("upscale");
    try { await loadIntoPage(await readOriginal(url), name || "生成结果"); }
    catch (error) { showPageError(error.message || "原图读取失败，请稍后重试"); }
  }

  function initPage() {
    if (page.ready || !$("classicUpscaleArea")) return;
    page.ready = true;
    const drop = $("classicUpscaleDrop"), file = $("classicUpscaleFile");
    drop.addEventListener("click", () => { if (!page.picked) file.click(); });
    drop.addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && !page.picked) { event.preventDefault(); file.click(); } });
    file.addEventListener("change", () => { pickFromFiles(file.files); file.value = ""; });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); event.stopPropagation(); drop.classList.remove("is-dragging"); pickFromFiles(event.dataTransfer?.files); });
    doc.addEventListener("paste", (event) => {
      if ($("classicUpscaleArea").hidden) return;
      const active = doc.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type && entry.type.startsWith("image/"));
      const pasted = item?.getAsFile();
      if (!pasted) return;
      event.preventDefault();
      void loadIntoPage(pasted, "粘贴的图片");
    });
    $("classicUpscaleGo").addEventListener("click", async () => {
      const { picked, choice } = page;
      if (!picked || !choice || page.busy) return;
      page.busy = true;
      refreshGo();
      try {
        await submit({ dataUrl: picked.dataUrl, blob: picked.blob, ...choice, prompt: picked.name });
      } finally {
        page.busy = false;
        refreshGo();
      }
      // The picture stays, so another engine or scale can be tried without choosing it again.
    });
    let remembered = "";
    try { remembered = root.localStorage?.getItem("classic-create-mode") || ""; } catch (_) { /* ignore */ }
    setClassicMode(remembered === "upscale" ? "upscale" : "generate");
  }

  root.setClassicMode = setClassicMode;
  root.classicUpscalePage = { reset: resetPage, load: loadIntoPage, sendHere: sendToUpscalePage };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initPage);
  else initPage();

  root.openClassicUpscale = openClassicUpscale;
  root.ClassicUpscaleInternals = { buildForm, submit, ask, measure, toDataUrl, toast, sessionHeaders, el };
  root.openClassicCompare = openClassicCompare;
})(typeof window === "undefined" ? globalThis : window);
