import { describe, expect, it } from 'vitest';
import {
  buildVideoReferencePayload,
  getVideoReferenceLimit,
  getPublicVideoResolution,
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

  it('maps sora v3 hd toggle to 480p and 720p', () => {
    expect(getPublicVideoResolution('sora-v3-pro', false)).toBe('480p');
    expect(getPublicVideoResolution('sora-v3-pro', true)).toBe('720p');
    expect(getPublicVideoResolution('sora-v3-fast', false)).toBe('480p');
    expect(getPublicVideoResolution('sora-v3-fast', true)).toBe('720p');
  });

  it('maps sora v3 reference mode to image_urls and keeps video_reference separate', () => {
    expect(
      buildVideoReferencePayload('sora-v3-pro', ['https://example.com/ref1.jpg', 'https://example.com/ref2.jpg'], {
        videoReference: 'https://example.com/reference.mp4',
        referenceMode: 'images',
      }),
    ).toEqual({
      video_reference: 'https://example.com/reference.mp4',
      image_urls: ['https://example.com/ref1.jpg', 'https://example.com/ref2.jpg'],
    });
  });

  it('maps sora v3 frame mode to start_frame and end_frame', () => {
    expect(
      buildVideoReferencePayload('sora-v3-fast', ['https://example.com/start.jpg', 'https://example.com/end.jpg'], {
        videoReference: 'https://example.com/reference.mp4',
        referenceMode: 'frames',
      }),
    ).toEqual({
      video_reference: 'https://example.com/reference.mp4',
      start_frame: 'https://example.com/start.jpg',
      end_frame: 'https://example.com/end.jpg',
    });
  });

  it('keeps other models on image_urls without video_reference', () => {
    expect(buildVideoReferencePayload('veo31-fast', ['a', 'b'])).toEqual({
      image_urls: ['data:image/jpeg;base64,a'],
    });
  });
});
