import { describe, expect, it } from 'vitest';
import {
  getDefaultImageSizeForModel,
  getImageModelById,
  getImageModelOptions,
  getImageModelSizeOptions,
  isGptImageCompatibleModel,
} from './imageModels';
import {
  getImageModelNameForRoute,
  getImageRouteOptions,
  getImageRoutesByModelFamily,
} from './imageRoutes';

describe('GPT-Image-2.5 catalog', () => {
  it('registers one model with Flare and Sunburst routes', () => {
    const model = getImageModelById('gpt-image-2.5');
    const routes = getImageRoutesByModelFamily('gpt-image-2.5');

    expect(model.label).toBe('GPT-Image-2.5');
    expect(model.requestModel).toBe('gpt-image-2.5');
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k', '2k', '4k']);
    expect(routes.map((route) => route.id)).toEqual([
      'gpt-image-2.5-flare',
      'gpt-image-2.5-sunburst',
    ]);
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseUrl: 'https://api.pixellelabs.com',
          generatePath: '/v1/images/generations',
          editPath: '/v1/images/edits',
          apiKeyEnv: 'IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY',
          transport: 'openai-image',
          mode: 'sync',
          pointCost: 3,
          upstreamModel: 'gpt-image-2.5-flare',
        }),
        expect.objectContaining({ upstreamModel: 'gpt-image-2.5-sunburst' }),
      ]),
    );
    expect(
      getImageModelNameForRoute({ imageModel: model.id, imageLine: 'flare', imageSize: '2k' }),
    ).toBe('gpt-image-2.5-flare');
    expect(
      getImageModelNameForRoute({ imageModel: model.id, imageLine: 'sunburst', imageSize: '2k' }),
    ).toBe('gpt-image-2.5-sunburst');
  });
});

describe('GPT-compatible image model detection', () => {
  it('marks GPT-Image-2.5 route names and Seedream as GPT-compatible', () => {
    expect(isGptImageCompatibleModel('gpt-image-2.5')).toBe(true);
    expect(isGptImageCompatibleModel('gpt-image-2.5-flare')).toBe(true);
    expect(isGptImageCompatibleModel('gpt-image-2.5-sunburst')).toBe(true);
    expect(isGptImageCompatibleModel('seedream-5-pro')).toBe(true);
    expect(isGptImageCompatibleModel('gemini-3.1-flash-image-preview')).toBe(false);
  });
});

describe('Seedream-5-pro catalog', () => {
  it('registers a PixelleLabs GPT-compatible model with only 1K and 2K sizes', () => {
    const model = getImageModelById('seedream-5-pro');

    expect(model.label).toBe('Seedream-5-pro');
    expect(model.requestModel).toBe('seedream-5-pro');
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k', '2k']);
    expect(getImageRoutesByModelFamily('seedream-5-pro')).toHaveLength(1);
    expect(getImageRoutesByModelFamily('seedream-5-pro')[0]).toMatchObject({
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1/images/generations',
      editPath: '/v1/images/edits',
      upstreamModel: 'seedream-5-pro',
    });
  });
});

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
