const assert = require('node:assert/strict');
const { getGptImageAnimationFields, normalizeAnimationSize } = require('./gptImageAnimationPolicy.cjs');
const route = { id: 'gpt-image-2.6-sunburst-osodm-1k' };

describe('GPT 2.6 animation route policy', () => {
  it('uses reference-project GIF defaults and keeps static PNG available', () => {
    assert.deepEqual(getGptImageAnimationFields(route, { output_format: 'gif', size: '1k' }),
      { output_format: 'gif', frame_count: 9, frame_duration_ms: 200 });
    assert.deepEqual(getGptImageAnimationFields(route, { output_format: 'png', complexity: 'high' }),
      { output_format: 'png', complexity: 'high' });
  });
  it('preserves explicit frame controls and rejects invalid values before billing', () => {
    assert.deepEqual(getGptImageAnimationFields(route, { output_format: 'gif', frame_count: 16, frame_duration_ms: 20 }),
      { output_format: 'gif', frame_count: 16, frame_duration_ms: 20 });
    for (const patch of [{ size: '2k' }, { image_size: '4k' }, { quality: 'max' }, { frame_count: 17 }, { frame_duration_ms: 19 }, { frame_count: 2.5 }, { complexity: 'max' }, { output_format: 'svg' }]) {
      assert.throws(() => getGptImageAnimationFields(route, { output_format: 'gif', ...patch }), error => error.status === 400);
    }
  });
  it('never enables GIF on other routes', () => {
    assert.deepEqual(getGptImageAnimationFields({ id: 'gpt-image-2.6-sunburst-native' }, { output_format: 'png' }), {});
    assert.throws(() => getGptImageAnimationFields({ id: 'gpt-image-2.6-sunburst-mochiai' }, { output_format: 'gif' }), error => error.status === 400);
  });
  it('caps wide 1K dimensions to the reference-project pixel budget', () => {
    const [width, height] = normalizeAnimationSize('1824x1024').split('x').map(Number);
    assert.ok(width * height <= 1572864);
    assert.equal(width % 16, 0);
    assert.equal(height % 16, 0);
    assert.equal(normalizeAnimationSize('1024x1024'), '1024x1024');
  });
  it('classic settings retain animation controls only on the new route', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const source = fs.readFileSync('public/classic-app/script.js', 'utf8');
    const settings = new Map([
      ['classic_animation_format', 'gif'], ['classic_animation_complexity', 'high'],
      ['classic_animation_frames', '12'], ['classic_animation_duration', '300'],
    ]);
    let selectedRoute = route;
    const context = vm.createContext({
      localStorage: { getItem: key => settings.get(key) || null },
      getClassicSelectedRoute: () => selectedRoute,
      getClassicSupportedGptQualities: () => ['low', 'medium', 'high'],
      GPT_IMAGE_QUALITY_KEY: 'quality',
      GPT_IMAGE_DEFAULTS: {quality:'medium',outputFormat:'png',moderation:'auto'},
    });
    vm.runInContext(source.slice(source.indexOf('function getClassicGptSettings()'), source.indexOf('function setClassicAnimationSetting(')), context);
    const animated = vm.runInContext('getClassicGptSettings()', context);
    assert.equal(animated.outputFormat, 'gif');
    assert.equal(animated.frameCount, 12);
    assert.equal(animated.frameDurationMs, 300);
    selectedRoute = { id: 'gpt-image-2.6-sunburst-native' };
    const original = vm.runInContext('getClassicGptSettings()', context);
    assert.equal(original.outputFormat, 'png');
    assert.equal(original.frameCount, undefined);
  });
});
