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

    const dialog = el("div", { class: "api-guide-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "upscaleTitle", style: "display:flex" });
    const card = el("div", { class: "api-guide-card", style: "max-width:420px;text-align:left" });
    const title = el("div", { class: "api-guide-title", id: "upscaleTitle", text: "高清放大" });
    const info = el("div", { class: "api-guide-desc", text: `当前图片 ${dims.width} × ${dims.height}` });
    const engineBox = el("div", { role: "radiogroup", "aria-label": "放大方式", style: "display:grid;gap:8px;margin:12px 0" });
    const factorBox = el("div", { role: "radiogroup", "aria-label": "放大倍数", style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0" });
    const formatBox = el("div", { role: "radiogroup", "aria-label": "输出格式", style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0" });
    const priceBox = el("div", { "aria-live": "polite", style: "min-height:40px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.06);margin:8px 0" });
    const note = el("div", { class: "api-guide-desc", style: "font-size:11px", text: "图片将发送到云端处理，结果在服务器保留 5 小时，请及时下载。失败会自动退回金币。" });
    const cancel = el("button", { class: "api-guide-btn ghost", type: "button", text: "取消", onclick: close });
    const confirm = el("button", { class: "api-guide-btn", type: "button", text: "确认放大", disabled: "" });
    const actions = el("div", { class: "api-guide-actions" }, [cancel, confirm]);
    card.append(title, info, engineBox, factorBox, formatBox, priceBox, note, actions);
    dialog.append(card);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    let quoteToken = 0;
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
          class: "api-guide-btn ghost", style: `text-align:left;display:block;${selected ? "outline:2px solid currentColor;" : ""}${canTake(engine) ? "" : "opacity:.4;cursor:not-allowed;"}`,
          onclick: () => {
            if (!canTake(engine)) return;
            state.engine = engine;
            const usable = factorsOf(engine);
            if (!usable.includes(state.factor)) state.factor = engine.defaultFactor || usable[usable.length - 1];
            void refreshQuote();
          },
        }, [el("strong", { text: engine.label }), el("div", { style: "font-size:11px;opacity:.7", text: canTake(engine) ? engine.description : "这张图尺寸太大，此方式暂不支持" })]);
      }));
      factorBox.hidden = factorsOf(state.engine).length < 2;
      factorBox.replaceChildren(el("span", { style: "font-size:12px;opacity:.7;margin-right:4px", text: "放大倍数" }), ...factorsOf(state.engine).map((value) => el("button", {
        type: "button", role: "radio", "aria-checked": String(value === state.factor), class: "api-guide-btn ghost",
        style: "padding:4px 10px;min-width:0;" + (value === state.factor ? "outline:2px solid currentColor" : ""),
        onclick: () => { state.factor = value; void refreshQuote(); },
        text: value === 1 ? "原尺寸增强" : `${value} 倍`,
      })));
      const allowed = formatsAt(state.engine, state.factor);
      formatBox.hidden = !state.engine.formats;
      formatBox.replaceChildren(el("span", { style: "font-size:12px;opacity:.7;margin-right:4px", text: "输出格式" }), ...(state.engine.formats || []).map((value) => {
        const ok = allowed.includes(value);
        return el("button", {
          type: "button", role: "radio", "aria-checked": String(value === state.format), "aria-disabled": String(!ok), class: "api-guide-btn ghost",
          title: ok ? "" : "图片放大后较大，此格式文件会超过保存上限",
          style: "padding:4px 10px;min-width:0;" + (value === state.format ? "outline:2px solid currentColor;" : "") + (ok ? "" : "opacity:.4;cursor:not-allowed;"),
          onclick: () => { if (!ok) return; state.format = value; void refreshQuote(); },
          text: LABELS[value] || value.toUpperCase(),
        });
      }));
      if (state.error) priceBox.textContent = state.error;
      else if (!state.quote) priceBox.textContent = "正在计算价格…";
      else priceBox.textContent = `输出 ${state.quote.outputWidth} × ${state.quote.outputHeight}　·　${state.quote.points} 金币`;
      confirm.disabled = !state.quote || Boolean(state.error);
      confirm.textContent = state.quote ? `确认放大 · ${state.quote.points} 金币` : "确认放大";
    };
    confirm.addEventListener("click", () => {
      if (!state.quote) return;
      const choice = { dataUrl, blob, engine: state.engine.id, factor: state.factor, format: state.format, prompt, size: `${state.quote.outputWidth}x${state.quote.outputHeight}`, label: state.engine.label };
      close();
      void submit(choice);
    });

    open = dialog;
    doc.body.append(dialog);
    confirm.focus();
    void refreshQuote();
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

  root.openClassicUpscale = openClassicUpscale;
  root.openClassicCompare = openClassicCompare;
})(typeof window === "undefined" ? globalThis : window);
