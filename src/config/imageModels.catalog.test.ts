import { afterEach, describe, expect, it, vi } from 'vitest';
import { getImageModelById, refreshImageModelCatalog } from './imageModels';

describe('image model catalog refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps an empty server catalog authoritative instead of restoring bundled defaults', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, defaultModelId: '', models: [] }),
    }));

    const catalog = await refreshImageModelCatalog();

    expect(catalog.models).toEqual([]);
    expect(getImageModelById().id).toBe('');
    expect(fetch).toHaveBeenCalledWith('/api/image-models/catalog', expect.objectContaining({ cache: 'no-store' }));
  });
});
