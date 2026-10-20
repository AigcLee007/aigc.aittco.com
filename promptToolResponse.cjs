function extractGeminiFinalText(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .filter((part) => part?.thought !== true && typeof part?.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();

    if (text) return text;
  }

  throw new Error("优化失败：模型未返回最终答案");
}

function parseGeminiPromptOptions(response) {
  const rawText = extractGeminiFinalText(response);
  let cleaned = rawText;

  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);

  let options;
  try {
    options = JSON.parse(cleaned.trim());
  } catch (_) {
    throw new Error("优化失败：模型未返回有效提示词方案");
  }

  if (
    !Array.isArray(options) ||
    options.length === 0 ||
    options.some((option) => !option || typeof option !== "object" || Array.isArray(option) || typeof option.prompt !== "string" || !option.prompt.trim())
  ) {
    throw new Error("优化失败：模型未返回有效提示词方案");
  }

  return options.map((option, index) => ({
    style: typeof option.style === "string" && option.style.trim() ? option.style.trim() : `优化方案 ${index + 1}`,
    prompt: option.prompt.trim(),
  }));
}

module.exports = { parseGeminiPromptOptions };
