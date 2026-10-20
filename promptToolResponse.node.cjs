const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGeminiPromptOptions } = require("./promptToolResponse.cjs");

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
