const assert = require('assert');
const { getSeedreamSizeError } = require('./seedreamImagePolicy.cjs');

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
