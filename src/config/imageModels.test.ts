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
  it('registers Flare and Sunburst as independent models with separate route families', () => {
    const flare = getImageModelById('gpt-image-2.5-flare');
    const sunburst = getImageModelById('gpt-image-2.5-sunburst');
    const flareRoutes = getImageRoutesByModelFamily('gpt-image-2.5-flare');
    const sunburstRoutes = getImageRoutesByModelFamily('gpt-image-2.5-sunburst');

    expect(flare.label).toBe('GPT-Image-2.5-Flare');
    expect(flare.requestModel).toBe('gpt-image-2.5-flare');
    expect(sunburst.label).toBe('GPT-Image-2.5-Sunburst');
    expect(sunburst.requestModel).toBe('gpt-image-2.5-sunburst');
    expect(getImageModelSizeOptions(flare.id)).toEqual(['1k', '2k', '4k']);
    expect(flareRoutes).toHaveLength(3);
    expect(sunburstRoutes).toHaveLength(3);
    expect(flareRoutes[0]).toEqual(expect.objectContaining({
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1/images/generations',
      editPath: '/v1/images/edits',
      apiKeyEnv: 'IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY',
      transport: 'openai-image',
      mode: 'sync',
      pointCost: 3,
      upstreamModel: 'gpt-image-2.5-flare',
      modelFamily: 'gpt-image-2.5-flare',
    }));
    expect(sunburstRoutes[0]).toEqual(expect.objectContaining({ upstreamModel: 'gpt-image-2.5-sunburst', modelFamily: 'gpt-image-2.5-sunburst' }));
    expect(flareRoutes.map((route) => route.label)).toEqual(['稳定线路', '官key线路', '备用线路']);
    expect(sunburstRoutes.map((route) => route.label)).toEqual(['稳定线路', '官key线路', '备用线路']);
    expect(flareRoutes[1].sizeOverrides).toEqual({
      '1k': { upstreamModel: 'gpt-image-2.5-flare' },
      '2k': { upstreamModel: 'gpt-image-2.5-flare-2k' },
      '4k': { upstreamModel: 'gpt-image-2.5-flare-4k' },
    });
    expect(sunburstRoutes[1].sizeOverrides).toEqual({
      '1k': { upstreamModel: 'gpt-image-2.5-sunburst' },
      '2k': { upstreamModel: 'gpt-image-2.5-sunburst-2k' },
      '4k': { upstreamModel: 'gpt-image-2.5-sunburst-4k' },
    });
    expect(
      getImageModelNameForRoute({ imageModel: flare.id, imageLine: '稳定线路', imageSize: '2k' }),
    ).toBe('gpt-image-2.5-flare');
    expect(
      getImageModelNameForRoute({ imageModel: sunburst.id, imageLine: '稳定线路', imageSize: '2k' }),
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
