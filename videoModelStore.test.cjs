const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeManagedVideoModelInput } = require('./videoModelStore.cjs');

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

  it('rejects capability defaults and combined limits that conflict', () => {
    assert.throws(
      () => normalizeManagedVideoModelInput({
        id: 'bad',
        label: 'Bad',
        modelFamily: 'bad',
        routeFamily: 'bad',
        aspectRatioOptions: ['16:9'],
        defaultAspectRatio: '16:9',
        resolutionOptions: ['720p'],
        defaultResolution: '1080p',
        durationOptions: ['4'],
        defaultDuration: '4',
        maxReferenceImages: 2,
        maxReferenceVideos: 1,
        maxTotalReferences: 1,
      }),
      /default resolution|max total references/i,
    );
  });
});
