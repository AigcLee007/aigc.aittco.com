import { describe, expect, it } from 'vitest';
import {
  buildVideoReferencePayload,
  getVideoReferenceLimit,
  normalizeVideoReferences,
} from './videoService';

describe('videoService reference payloads', () => {
  it('keeps only supported video reference formats and deduplicates them', () => {
    expect(
      normalizeVideoReferences([
        '  https://example.com/a.jpg  ',
        'data:image/png;base64,abc',
        'abc',
        'https://example.com/a.jpg',
      ]),
    ).toEqual([
      'https://example.com/a.jpg',
      'data:image/png;base64,abc',
      'data:image/jpeg;base64,abc',
    ]);
  });

  it('maps kling and sora style models to image_urls', () => {
    expect(buildVideoReferencePayload('sora2', ['https://example.com/ref.jpg'])).toEqual({
      image_urls: ['https://example.com/ref.jpg'],
    });
    expect(buildVideoReferencePayload('kling-video-o3-omni', ['a', 'b', 'c'])).toEqual({
      image_urls: ['data:image/jpeg;base64,a', 'data:image/jpeg;base64,b', 'data:image/jpeg;base64,c'],
    });
  });

  it('maps veo first-last models to start_frame and end_frame', () => {
    expect(
      buildVideoReferencePayload('veo3.1-fast', ['https://example.com/start.jpg', 'https://example.com/end.jpg']),
    ).toEqual({
      start_frame: 'https://example.com/start.jpg',
      end_frame: 'https://example.com/end.jpg',
    });
  });

  it('uses the documented reference limits for each model', () => {
    expect(getVideoReferenceLimit('kling-video-3.0')).toBe(1);
    expect(getVideoReferenceLimit('kling-video-o3-omni')).toBe(7);
    expect(getVideoReferenceLimit('sora2')).toBe(1);
    expect(getVideoReferenceLimit('sora-v3-pro')).toBe(4);
    expect(getVideoReferenceLimit('veo31-fast')).toBe(1);
    expect(getVideoReferenceLimit('veo3.1-fast')).toBe(2);
  });
});
