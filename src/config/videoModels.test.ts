import { describe, expect, it } from 'vitest';
import { getVideoReferenceThumbnailLabel } from './videoModels';

describe('videoModels reference thumbnail labels', () => {
  it('uses start and end frame labels for sora v3 frame mode', () => {
    expect(getVideoReferenceThumbnailLabel('sora-v3-pro', 'frames', 0)).toBe('首帧');
    expect(getVideoReferenceThumbnailLabel('sora-v3-fast', 'frames', 1)).toBe('尾帧');
    expect(getVideoReferenceThumbnailLabel('sora-v3-fast', 'frames', 2)).toBe('图3');
  });

  it('keeps configured labels for non-frame video references', () => {
    expect(getVideoReferenceThumbnailLabel('sora-v3-pro', 'images', 0)).toBe('图1');
    expect(getVideoReferenceThumbnailLabel('veo3.1-fast', 'images', 0)).toBe('首帧');
  });
});
