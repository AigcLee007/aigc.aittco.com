import { describe, expect, it } from 'vitest';
import { buildGptImagePayload } from './gptImagePayload';

describe('GPT-compatible image payload', () => {
  it('includes the selected ratio for Seedream 2K requests', () => {
    const payload = buildGptImagePayload({
      model: 'seedream-5.0-pro',
      modelId: 'seedream-5-pro',
      prompt: 'cinematic dreamscape',
      imageSize: '2k',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 1,
      routeId: 'seedream-5-pro-visionary-stable',
    });

    expect(payload).toMatchObject({
      size: '2048x1152',
      image_size: '2k',
      aspect_ratio: '16:9',
      routeId: 'seedream-5-pro-visionary-stable',
    });
    expect(payload).not.toHaveProperty('quality');
  });

  it('does not add the Seedream-specific ratio field to GPT Image requests', () => {
    const payload = buildGptImagePayload({
      model: 'gpt-image-2',
      modelId: 'gpt-image-2',
      prompt: 'a flower',
      imageSize: '2k',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 1,
      routeId: 'gpt-image-2-default',
    });

    expect(payload).not.toHaveProperty('aspect_ratio');
    expect(payload.quality).toBe('medium');
  });

  it('does not add the Visionary ratio field to the default Seedream route', () => {
    const payload = buildGptImagePayload({
      model: 'seedream-5-pro',
      modelId: 'seedream-5-pro',
      prompt: 'a flower',
      imageSize: '2k',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 1,
      routeId: 'seedream-5-pro-default',
    });

    expect(payload).not.toHaveProperty('aspect_ratio');
    expect(payload).not.toHaveProperty('quality');
  });
});
