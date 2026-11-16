const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const sandbox = {};
vm.runInNewContext(
  fs.readFileSync(require.resolve('./image-quality-policy.js'), 'utf8'),
  { globalThis: sandbox },
);
const policy = sandbox.ClassicImageQualityPolicy;

describe('classic image quality policy', () => {
  it('hides quality selection and omits the quality field for Seedream models', () => {
    assert.equal(policy.shouldShowQualitySelector('seedream-5-pro'), false);
    assert.equal(JSON.stringify(policy.getQualityPayloadFields('seedream-5-pro', 'medium')), '{}');
  });

  it('preserves quality selection for non-Seedream models', () => {
    assert.equal(policy.shouldShowQualitySelector('gpt-image-2'), true);
    assert.equal(JSON.stringify(policy.getQualityPayloadFields('gpt-image-2', 'high')), '{"quality":"high"}');
    assert.equal(JSON.stringify(policy.getQualityPayloadFields('gpt-image-2', '')), '{"quality":"auto"}');
  });
});
