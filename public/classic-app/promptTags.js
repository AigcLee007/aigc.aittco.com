(function (global) {
  function toPositiveInt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    return i > 0 ? i : null;
  }

  function parsePromptReferenceTags(prompt, maxRefCount) {
    const text = String(prompt || "");
    const maxCount = toPositiveInt(maxRefCount) || 0;
    const tagRegex = /@(?:图)?\s*(\d+)/g;
    const rawTags = [];
    let m;

    while ((m = tagRegex.exec(text))) {
      rawTags.push({
        raw: m[0],
        index: toPositiveInt(m[1]),
        start: m.index,
        end: m.index + m[0].length,
      });
    }

    const referenceIndices = [];
    const seen = new Set();
    const duplicateIndices = [];
    const invalidIndices = [];

    rawTags.forEach((tag) => {
      const idx = tag.index;
      if (!idx) {
        invalidIndices.push({ index: tag.index, reason: "invalid" });
        return;
      }
      if (maxCount > 0 && idx > maxCount) {
        invalidIndices.push({ index: idx, reason: "out_of_range" });
        return;
      }
      if (seen.has(idx)) {
        duplicateIndices.push(idx);
        return;
      }
      seen.add(idx);
      referenceIndices.push(idx);
    });

    const promptWithoutTags = text
      .replace(tagRegex, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/^[ \t]+|[ \t]+$/g, "");

    return {
      hasAnyTag: rawTags.length > 0,
      rawTags,
      referenceIndices,
      duplicateIndices,
      invalidIndices,
      promptWithoutTags,
    };
  }

  function getMentionContext(text, caretPos) {
    const value = String(text || "");
    const caret = Math.max(0, Math.min(Number(caretPos) || 0, value.length));
    const before = value.slice(0, caret);
    const atPos = before.lastIndexOf("@");
    if (atPos < 0) return null;
    const fragment = before.slice(atPos);
    if (!/^@(?:图)?\s*\d*$/.test(fragment)) return null;
    const query = fragment.replace(/^@(?:图)?\s*/, "");
    return { start: atPos, end: caret, query };
  }

  function getMentionOptions(refCount, query) {
    const count = toPositiveInt(refCount) || 0;
    const q = String(query || "").trim();
    const options = [];
    for (let i = 1; i <= count; i++) {
      const s = String(i);
      if (!q || s.startsWith(q)) {
        options.push({
          index: i,
          label: `图${i}`,
          insertText: `@图${i}`,
        });
      }
    }
    return options;
  }

  function buildPromptWithInsertedTag(text, caretPos, refIndex) {
    const value = String(text || "");
    const caret = Math.max(0, Math.min(Number(caretPos) || 0, value.length));
    const context = getMentionContext(value, caret);
    const idx = toPositiveInt(refIndex);
    if (!idx) return { text: value, caret: caret };
    const token = `@图${idx}`;

    if (!context) {
      const insert =
        (caret > 0 && !/\s/.test(value[caret - 1]) ? " " : "") + token + " ";
      const next = value.slice(0, caret) + insert + value.slice(caret);
      return { text: next, caret: caret + insert.length };
    }

    const next =
      value.slice(0, context.start) + token + " " + value.slice(context.end);
    return { text: next, caret: context.start + token.length + 1 };
  }

  function remapPromptTagsAfterDelete(prompt, removedIndex) {
    const text = String(prompt || "");
    const removed = toPositiveInt(removedIndex);
    if (!removed) return text;
    return text.replace(/@(?:图)?\s*(\d+)/g, function (_, g1) {
      const idx = toPositiveInt(g1);
      if (!idx) return "";
      if (idx === removed) return "";
      if (idx > removed) return `@图${idx - 1}`;
      return `@图${idx}`;
    });
  }

  function resolveReferencesByIndices(refImages, referenceIndices) {
    const list = Array.isArray(refImages) ? refImages : [];
    const idxs = Array.isArray(referenceIndices) ? referenceIndices : [];
    if (idxs.length === 0) {
      return {
        selectedImages: list.slice(),
        validIndices: [],
        ignoredIndices: [],
      };
    }
    const selectedImages = [];
    const validIndices = [];
    const ignoredIndices = [];
    const seen = new Set();
    idxs.forEach((raw) => {
      const idx = toPositiveInt(raw);
      if (!idx || idx < 1 || idx > list.length) {
        ignoredIndices.push(raw);
        return;
      }
      if (seen.has(idx)) return;
      seen.add(idx);
      validIndices.push(idx);
      selectedImages.push(list[idx - 1]);
    });
    return { selectedImages, validIndices, ignoredIndices };
  }

  const api = {
    parsePromptReferenceTags,
    getMentionContext,
    getMentionOptions,
    buildPromptWithInsertedTag,
    remapPromptTagsAfterDelete,
    resolveReferencesByIndices,
  };

  global.PromptTagsUtil = api;
})(typeof window !== "undefined" ? window : globalThis);
