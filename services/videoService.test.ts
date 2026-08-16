import { describe, expect, it } from 'vitest';
import {
  buildInternalVideoRequest,
  VIDEO_POLL_DEADLINE_MS,
  VIDEO_POLL_INTERVAL_MS,
} from './videoService';

describe('videoService internal request contract', () => {
  it('polls PixelHub every 12 seconds for at most 30 minutes', () => {
    expect(VIDEO_POLL_INTERVAL_MS).toBe(12_000);
    expect(VIDEO_POLL_DEADLINE_MS).toBe(30 * 60 * 1000);
  });

  it('builds the sole internal API body with normalized duration and deduplicated references', () => {
    expect(
      buildInternalVideoRequest({
        modelId: 'gemini-omni-flash',
        routeId: 'gemini-omni-flash-line1',
        prompt: '  a cinematic river  ',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: '4',
        referenceImages: [
          ' data:image/jpeg;base64,one ',
          'https://example.com/ref.jpg',
          'data:image/jpeg;base64,one',
          '',
        ],
        referenceVideos: [
          ' https://example.com/reference.mp4 ',
          'https://example.com/reference.mp4',
          '',
        ],
      }),
    ).toEqual({
      modelId: 'gemini-omni-flash',
      routeId: 'gemini-omni-flash-line1',
      prompt: 'a cinematic river',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 4,
      referenceImages: [
        'data:image/jpeg;base64,one',
        'https://example.com/ref.jpg',
      ],
      referenceVideos: ['https://example.com/reference.mp4'],
    });
  });

  it('keeps an invalid numeric duration as NaN for server-side request validation', () => {
    const request = buildInternalVideoRequest({
      modelId: 'veo31-fast',
      routeId: 'veo31-fast-line1',
      prompt: 'test',
      aspectRatio: '9:16',
      resolution: '1080p',
      duration: 'not-a-number',
    });

    expect(Number.isNaN(request.duration)).toBe(true);
    expect(request.referenceImages).toEqual([]);
    expect(request.referenceVideos).toEqual([]);
  });
});
