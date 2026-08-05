const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('video model capability schema', () => {
  const source = fs.readFileSync(path.join(__dirname, 'videoModelStore.cjs'), 'utf8');

  it('stores every capability required by the PixelHub models', () => {
    for (const column of [
      'resolution_options_json',
      'default_resolution',
      'max_reference_videos',
      'max_total_references',
      'reference_image_mode',
      'supports_video_reference',
      'prompt_max_length',
    ]) {
      assert.ok(source.includes(column), `missing ${column}`);
    }
  });

  it('maps capability columns to the public camel-case shape', () => {
    for (const property of [
      'resolutionOptions',
      'defaultResolution',
      'maxReferenceVideos',
      'maxTotalReferences',
      'referenceImageMode',
      'supportsVideoReference',
      'promptMaxLength',
    ]) {
      assert.ok(source.includes(property), `missing ${property}`);
    }
  });
});
