import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBase64FromUrl } from './imageUtils';

describe('getBase64FromUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches remote images through the same-origin proxy before converting to base64', async () => {
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: async () => blob,
    } as Response);

    const originalReader = globalThis.FileReader;
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onloadend: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL() {
        this.result = 'data:image/png;base64,aW1hZ2UtYnl0ZXM=';
        this.onloadend?.();
      }
    }
    vi.stubGlobal('FileReader', MockFileReader as any);

    const result = await getBase64FromUrl('https://visionary.beer/api/generations/id/image?token=abc');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/proxy/image?url=https%3A%2F%2Fvisionary.beer%2Fapi%2Fgenerations%2Fid%2Fimage%3Ftoken%3Dabc',
    );
    expect(result).toBe('data:image/png;base64,aW1hZ2UtYnl0ZXM=');

    vi.stubGlobal('FileReader', originalReader);
  });
});
