const assert = require('assert');
const { isGptImageCompatibleModel } = require('./imageModelCompatibility.cjs');

describe('GPT-compatible image model detection', () => {
  it('recognizes base and GPT-Image-2.5 route names', () => {
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-2'), true);
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-2-all'), true);
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-2.5'), true);
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-2.5-flare'), true);
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-2.5-sunburst'), true);
  });

  it('preserves Seedream compatibility and rejects unrelated names', () => {
    assert.strictEqual(isGptImageCompatibleModel('seedream-5-pro'), true);
    assert.strictEqual(isGptImageCompatibleModel('gpt-image-20'), false);
    assert.strictEqual(isGptImageCompatibleModel('gemini-3.1-flash-image-preview'), false);
  });
});
