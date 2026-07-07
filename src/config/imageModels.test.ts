import { describe, expect, it } from 'vitest';
import {
  getDefaultImageSizeForModel,
  getImageModelById,
  getImageModelOptions,
  getImageModelSizeOptions,
} from './imageModels';
import { getImageRouteOptions, getImageRoutesByModelFamily } from './imageRoutes';

describe('Nano Banana 2-Lite catalog', () => {
  it('registers Nano Banana 2-Lite as a 1K-only Nano Banana 2-compatible model', () => {
    const model = getImageModelById('nano-banana-2-lite');

    expect(model.label).toBe('Nano Banana 2-Lite');
    expect(model.panelLayout).toBe('nano-banana');
    expect(model.sizeBehavior).toBe('passthrough');
    expect(model.defaultSize).toBe('1k');
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k']);
    expect(getDefaultImageSizeForModel(model.id)).toBe('1k');
    expect(getImageModelOptions().map((option) => option.id)).toContain('nano-banana-2-lite');
  });

  it('gives Nano Banana 2-Lite its own routes copied from Nano Banana 2', () => {
    const originalRoutes = getImageRoutesByModelFamily('nano-banana-2');
    const liteRoutes = getImageRoutesByModelFamily('nano-banana-2-lite');

    expect(liteRoutes).toHaveLength(originalRoutes.length);
    expect(liteRoutes.map((route) => route.line)).toEqual(originalRoutes.map((route) => route.line));
    expect(liteRoutes.map((route) => route.transport)).toEqual(
      originalRoutes.map((route) => route.transport),
    );
    expect(liteRoutes.every((route) => route.modelFamily === 'nano-banana-2-lite')).toBe(true);
    expect(getImageRouteOptions('nano-banana-2-lite').map((option) => option.value)).toEqual(
      getImageRouteOptions('nano-banana-2').map((option) => option.value),
    );
  });
});
