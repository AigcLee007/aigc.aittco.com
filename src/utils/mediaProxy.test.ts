import { describe, expect, it } from 'vitest';
import { getProxiedImageUrl, isProxiedImageUrl } from './mediaProxy';

describe('media proxy helpers', () => {
  it('proxies remote image URLs for canvas-safe loading', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(getProxiedImageUrl(url)).toBe(`/api/proxy/image?url=${encodeURIComponent(url)}`);
  });

  it('does not double-proxy existing proxy URLs', () => {
    const url = '/api/proxy/image?url=https%3A%2F%2Fvisionary.beer%2Fimage';

    expect(getProxiedImageUrl(url)).toBe(url);
    expect(isProxiedImageUrl(url)).toBe(true);
  });

  it('leaves local and data URLs untouched', () => {
    expect(getProxiedImageUrl('/uploads/image.png')).toBe('/uploads/image.png');
    expect(getProxiedImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });
});
