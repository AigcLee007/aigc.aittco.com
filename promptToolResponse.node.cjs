const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGeminiPromptOptions, parseGeminiReversePrompt } = require("./promptToolResponse.cjs");

test("uses final text parts and ignores Gemini thought parts", () => {
  const response = {
    candidates: [{
      content: {
        parts: [
          { text: "I should analyze the request first.", thought: true },
          { text: "[{\"style\":\"写实\",\"prompt\":\"一只小猫\"}]" },
        ],
      },
    }],
  };

  assert.deepEqual(parseGeminiPromptOptions(response), [
    { style: "写实", prompt: "一只小猫" },
  ]);
});

test("joins final text parts when the JSON is split across parts", () => {
  const response = {
    candidates: [{
      content: {
        parts: [
          { text: "[{\"style\":\"写实\"," },
          { text: "\"prompt\":\"一只小猫\"}]" },
        ],
      },
    }],
  };

  assert.deepEqual(parseGeminiPromptOptions(response), [
    { style: "写实", prompt: "一只小猫" },
  ]);
});

test("rejects thought-only responses instead of treating reasoning as a prompt", () => {
  const response = {
    candidates: [{
      content: { parts: [{ text: "I should analyze the request first.", thought: true }] },
    }],
  };

  assert.throws(() => parseGeminiPromptOptions(response), /最终答案/);
});

test("rejects malformed or incomplete prompt options", () => {
  assert.throws(() => parseGeminiPromptOptions({ candidates: [{ content: { parts: [{ text: "thinking" }] } }] }), /有效提示词方案/);
  assert.throws(() => parseGeminiPromptOptions({ candidates: [{ content: { parts: [{ text: "[{\"style\":\"写实\"}]" }] } }] }), /有效提示词方案/);
});

test("reverse prompt uses structured final JSON after thought parts", () => {
  const response = {
    candidates: [{
      content: {
        parts: [
          { text: "I should analyze every visual detail first.", thought: true },
          { text: "{\"plainPrompt\":\"一只橘猫坐在窗台上，柔和自然光，写实摄影\",\"jsonPrompt\":{\"subject\":\"橘猫\"}}" },
        ],
      },
    }],
  };

  assert.deepEqual(parseGeminiReversePrompt(response), {
    plainPrompt: "一只橘猫坐在窗台上，柔和自然光，写实摄影",
    jsonPrompt: { subject: "橘猫" },
  });
});

test("reverse prompt rejects reasoning text instead of returning it as a successful prompt", () => {
  const thoughtOnly = {
    candidates: [{
      content: { parts: [{ text: "I should analyze every visual detail first.", thought: true }] },
    }],
  };
  const unstructuredText = {
    candidates: [{ content: { parts: [{ text: "First, the analysis is crucial. I should inspect the image." }] } }],
  };

  assert.throws(() => parseGeminiReversePrompt(thoughtOnly), /图片逆推.*最终答案/);
  assert.throws(() => parseGeminiReversePrompt(unstructuredText), /图片逆推.*有效提示词结果/);
});
