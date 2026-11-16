const assert = require('assert');
const { getSeedreamSizeError, getGptImageQualityFields } = require('./seedreamImagePolicy.cjs');

describe('Seedream-5-pro size policy', () => {
  it('accepts 1K and 2K tiers and rejects 4K', () => {
    assert.strictEqual(getSeedreamSizeError({ size: '1k' }), null);
    assert.strictEqual(getSeedreamSizeError({ image_size: '2K' }), null);
    assert.match(getSeedreamSizeError({ size: '4k' }), /1K.*2K/);
  });

  it('rejects explicit dimensions outside the 2K envelope', () => {
    assert.match(getSeedreamSizeError({ size: '3840x2160' }), /1K.*2K/);
    assert.strictEqual(getSeedreamSizeError({ size: '2048x2048' }), null);
  });
});

describe('Seedream quality request policy', () => {
  it('omits quality for every Seedream route, even when the UI retained a custom value', () => {
    assert.deepEqual(getGptImageQualityFields('seedream-5-pro', 'medium'), {});
    assert.deepEqual(getGptImageQualityFields('seedream-5-pro', 'auto'), {});
    assert.deepEqual(getGptImageQualityFields('seedream-5.5', 'high'), {});
  });

  it('keeps GPT Image quality selection and its default for other models', () => {
    assert.deepEqual(getGptImageQualityFields('gpt-image-2', 'high'), { quality: 'high' });
    assert.deepEqual(getGptImageQualityFields('gpt-image-2', ''), { quality: 'auto' });
  });
});
