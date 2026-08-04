const assert = require('assert');
const {
  getEffectiveImageRequestCount,
  getGeminiSingleImageRequestError,
} = require('./imageRequestCount.cjs');

describe('getEffectiveImageRequestCount', () => {
  it('reads all supported image-count fields', () => {
    assert.strictEqual(getEffectiveImageRequestCount({ n: 3 }), 3);
    assert.strictEqual(getEffectiveImageRequestCount({ candidateCount: 4 }), 4);
    assert.strictEqual(
      getEffectiveImageRequestCount({ generationConfig: { candidateCount: 2 } }),
      2,
    );
    assert.strictEqual(
      getEffectiveImageRequestCount({ generationConfig: { candidate_count: 5 } }),
      5,
    );
  });

  it('returns one for missing or invalid counts', () => {
    assert.strictEqual(getEffectiveImageRequestCount({}), 1);
    assert.strictEqual(getEffectiveImageRequestCount({ n: 'invalid' }), 1);
  });

  it('rejects Gemini-native requests with more than one image', () => {
    assert.strictEqual(
      getGeminiSingleImageRequestError({ candidateCount: 2 }),
      '当前 Gemini 原生线路暂仅支持 1 张图片，请先选择 1 张生成。',
    );
    assert.strictEqual(getGeminiSingleImageRequestError({ n: 1 }), null);
  });
});
