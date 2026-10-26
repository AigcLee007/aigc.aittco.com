// Before / after comparison slider, shared by the classic layout and the canvas layout.
//
//   const view = CompareSlider.open({ before, after, beforeLabel, afterLabel, title });
//   view.close();
//
// `before` and `after` are image sources (blob: or http(s):). The overlay is a native dialog-like
// layer with a draggable divider that also works from the keyboard, so it needs no framework.
(function (root) {
  const doc = root.document;
  let openView = null;

  const el = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    children.forEach((child) => node.append(child));
    return node;
  };
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const loadSize = (src) => new Promise((resolve) => {
    const image = new root.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = src;
  });

  // Position is the share of the frame, 0..1, shown to the left of the divider.
  function open({ before, after, beforeLabel = "原图", afterLabel = "放大后", title = "放大对比", beforeSize = null, afterSize = null, onClose = null } = {}) {
    if (!before || !after) return null;
    if (openView) openView.close();

    const previouslyFocused = doc.activeElement;
    let position = 0.5;
    let closed = false;

    const beforeImg = el("img", { alt: beforeLabel, draggable: "false", style: "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none" });
    const afterImg = el("img", { alt: afterLabel, draggable: "false", style: "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none" });
    // The "after" image sits on top and is cut off at the divider, so its left part shows the result.
    const afterLayer = el("div", { style: "position:absolute;inset:0;overflow:hidden" }, [afterImg]);
    const line = el("div", { style: "position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);pointer-events:none" });
    const knob = el("div", {
      role: "slider", tabindex: "0", "aria-label": "拖动对比放大前后", "aria-orientation": "horizontal",
      "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "50", "aria-valuetext": "各显示一半",
      style: "position:absolute;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid #fff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:ew-resize;touch-action:none;outline-offset:3px",
      text: "◀ ▶",
    });
    const badge = (text, side) => el("span", { style: `position:absolute;top:10px;${side}:10px;padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;pointer-events:none`, text });
    const frame = el("div", { style: "position:relative;flex:1;min-height:0;background:#111;border-radius:12px;overflow:hidden;touch-action:none;cursor:ew-resize" },
      [beforeImg, afterLayer, line, knob, badge(`${beforeLabel}${beforeSize ? ` · ${beforeSize}` : ""}`, "right"), badge(`${afterLabel}${afterSize ? ` · ${afterSize}` : ""}`, "left")]);
    const status = el("div", { "aria-live": "polite", style: "color:#bbb;font-size:12px;text-align:center;min-height:16px", text: "正在加载图片…" });
    const closeButton = el("button", { type: "button", "aria-label": "关闭对比", style: "position:absolute;top:10px;right:12px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer", text: "×", onclick: () => view.close() });
    const heading = el("div", { id: "compareSliderTitle", style: "color:#fff;font-size:15px;font-weight:600;text-align:center", text: title });
    const panel = el("div", { style: "position:relative;display:flex;flex-direction:column;gap:10px;width:min(96vw,1200px);height:min(92vh,860px);padding:14px" }, [heading, frame, status]);
    const overlay = el("div", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": "compareSliderTitle",
      style: "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center",
    }, [panel, closeButton]);

    const apply = () => {
      const percent = Math.round(position * 100);
      afterLayer.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
      line.style.left = `${percent}%`;
      knob.style.left = `${percent}%`;
      knob.setAttribute("aria-valuenow", String(percent));
      knob.setAttribute("aria-valuetext", percent <= 2 ? `只显示${beforeLabel}` : percent >= 98 ? `只显示${afterLabel}` : `${afterLabel} ${percent}%，${beforeLabel} ${100 - percent}%`);
    };
    // The divider follows the visible image, not the empty bars around it, because the frame
    // may be wider than the picture. Positions are therefore measured against the frame.
    const moveTo = (clientX) => {
      const box = frame.getBoundingClientRect();
      if (!box.width) return;
      position = clamp((clientX - box.left) / box.width, 0, 1);
      apply();
    };

    let dragging = false;
    frame.addEventListener("pointerdown", (event) => {
      dragging = true;
      try { frame.setPointerCapture(event.pointerId); } catch (_) { /* older engines */ }
      moveTo(event.clientX);
      knob.focus({ preventScroll: true });
      event.preventDefault();
    });
    frame.addEventListener("pointermove", (event) => { if (dragging) moveTo(event.clientX); });
    const stop = (event) => { dragging = false; try { frame.releasePointerCapture(event.pointerId); } catch (_) { /* not captured */ } };
    frame.addEventListener("pointerup", stop);
    frame.addEventListener("pointercancel", stop);
    knob.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const keys = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -0.1, PageUp: 0.1 };
      if (event.key === "Home") position = 0;
      else if (event.key === "End") position = 1;
      else if (event.key in keys) position = clamp(position + keys[event.key], 0, 1);
      else return;
      apply();
      event.preventDefault();
    });

    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); view.close(); return; }
      // Keep focus inside the layer: the only focusable controls are the slider and the close button.
      if (event.key === "Tab") {
        event.preventDefault();
        (doc.activeElement === knob ? closeButton : knob).focus();
      }
    };
    overlay.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) view.close(); });

    const view = {
      element: overlay,
      get position() { return position; },
      setPosition(value) { position = clamp(Number(value), 0, 1); apply(); },
      close() {
        if (closed) return;
        closed = true;
        overlay.remove();
        if (openView === view) openView = null;
        try { onClose?.(); } catch (_) { /* a failing callback must not keep the layer open */ }
        try { previouslyFocused?.focus?.({ preventScroll: true }); } catch (_) { /* element is gone */ }
      },
    };

    doc.body.append(overlay);
    apply();
    knob.focus({ preventScroll: true });
    openView = view;

    let remaining = 2;
    let failed = false;
    const settle = () => {
      if (closed || --remaining > 0) return;
      status.textContent = failed ? "有图片没能加载，请关闭后重试" : "拖动中间的滑块，对比放大前后的细节";
    };
    beforeImg.addEventListener("load", settle);
    afterImg.addEventListener("load", settle);
    beforeImg.addEventListener("error", () => { failed = true; settle(); });
    afterImg.addEventListener("error", () => { failed = true; settle(); });
    beforeImg.src = before;
    afterImg.src = after;
    return view;
  }

  root.CompareSlider = { open, measure: loadSize };
})(typeof window === "undefined" ? globalThis : window);
