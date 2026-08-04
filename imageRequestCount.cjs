const getEffectiveImageRequestCount = (requestBody = {}) => {
  const parsed = Number.parseInt(
    String(
      requestBody.n ||
        requestBody.candidateCount ||
        requestBody.generationConfig?.candidateCount ||
        requestBody.generationConfig?.candidate_count ||
        1,
    ),
    10,
  );

  return Math.max(1, Number.isFinite(parsed) ? parsed : 1);
};

const getGeminiSingleImageRequestError = (requestBody = {}) =>
  getEffectiveImageRequestCount(requestBody) > 1
    ? '当前 Gemini 原生线路暂仅支持 1 张图片，请先选择 1 张生成。'
    : null;

module.exports = {
  getEffectiveImageRequestCount,
  getGeminiSingleImageRequestError,
};
