// Announcement rich-text markup, shared by the classic layout, the canvas layout and the admin preview.
//
//   AnnouncementMarkup.toHtml("[b]重点[/b] [color=#ff6b6b]红色[/color] 😀")  -> safe HTML string
//   AnnouncementMarkup.toPlainText(text)                                      -> text without tags
//
// Tags: [b] [i] [u] [h] [center] [size=14..40] [color=#rgb|#rrggbb] [font=sans|hei|song|kai|mono]
//       [img]/uploads/x.png[/img]  (only /uploads/ paths and http(s) URLs)
// Every piece of text is escaped first and only whitelisted tags with validated values are emitted,
// so the output is safe to assign to innerHTML. Old plain-text announcements render unchanged.
(function (root) {
  const FONT_STACKS = {
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    hei: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    song: '"SimSun", "Songti SC", "Noto Serif SC", serif',
    kai: '"KaiTi", "Kaiti SC", "STKaiti", serif',
    mono: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
  };
  const SIZE_MIN = 12;
  const SIZE_MAX = 40;
  const TAG_PATTERN = /\[img\]([^\[\]\s]+)\[\/img\]|\[(\/?)(b|i|u|h|center|size|color|font)(?:=([^\[\]]*))?\]/gi;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const isSafeImageUrl = (url) => /^https?:\/\/[^\s"'<>]+$/i.test(url) || /^\/uploads\/[A-Za-z0-9._\-\/]+$/.test(url);

  const openTag = (name, arg) => {
    const value = String(arg || "").trim();
    switch (name) {
      case "b": return { open: "<strong>", close: "</strong>" };
      case "i": return { open: "<em>", close: "</em>" };
      case "u": return { open: "<u>", close: "</u>" };
      case "h": return { open: '<span class="ann-h">', close: "</span>" };
      case "center": return { open: '<span class="ann-center">', close: "</span>" };
      case "size": {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n)) return null;
        const px = Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
        return { open: `<span style="font-size:${px}px">`, close: "</span>" };
      }
      case "color":
        if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
        return { open: `<span style="color:${value}">`, close: "</span>" };
      case "font": {
        const stack = FONT_STACKS[value.toLowerCase()];
        if (!stack) return null;
        return { open: `<span style="font-family:${escapeHtml(stack)}">`, close: "</span>" };
      }
      default: return null;
    }
  };

  const textToHtml = (text) => escapeHtml(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");

  function toHtml(source) {
    const input = String(source == null ? "" : source);
    const stack = [];
    let html = "";
    let cursor = 0;
    TAG_PATTERN.lastIndex = 0;
    let match;
    while ((match = TAG_PATTERN.exec(input))) {
      html += textToHtml(input.slice(cursor, match.index));
      cursor = match.index + match[0].length;

      if (match[1] !== undefined) {
        const url = match[1];
        html += isSafeImageUrl(url)
          ? `<img class="ann-img" src="${escapeHtml(url)}" alt="公告图片" loading="lazy" data-ann-img="1">`
          : textToHtml(match[0]);
        continue;
      }

      const closing = match[2] === "/";
      const name = match[3].toLowerCase();
      if (closing) {
        // Close back to the matching opener; a stray closing tag is dropped.
        const at = stack.map((entry) => entry.name).lastIndexOf(name);
        if (at < 0) continue;
        while (stack.length > at) html += stack.pop().close;
        continue;
      }
      const tag = openTag(name, match[4]);
      if (!tag) {
        html += textToHtml(match[0]);
        continue;
      }
      html += tag.open;
      stack.push({ name, close: tag.close });
    }
    html += textToHtml(input.slice(cursor));
    while (stack.length) html += stack.pop().close;
    return html;
  }

  function toPlainText(source) {
    return String(source == null ? "" : source)
      .replace(/\[img\][^\[\]\s]*\[\/img\]/gi, "[图片]")
      .replace(/\[\/?(?:b|i|u|h|center|size|color|font)(?:=[^\[\]]*)?\]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const api = { toHtml, toPlainText, FONT_STACKS, SIZE_MIN, SIZE_MAX };
  root.AnnouncementMarkup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
