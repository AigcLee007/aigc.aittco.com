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
  getImageRouteEstimatedPointCost,
  getImageRoutePointCost,
  getImageRouteSupportedQualities,
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
    expect(sunburstRoutes).toHaveLength(5);
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
    expect(sunburstRoutes.map((route) => route.label)).toEqual(['稳定线路', '官key线路', '原生线路', '官渠高质', '备用线路']);
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
    const native = sunburstRoutes.find((route) => route.id === 'gpt-image-2.5-sunburst-native');
    const max = sunburstRoutes.find((route) => route.id === 'gpt-image-2.5-sunburst-max');
    const backup = sunburstRoutes.find((route) => route.id === 'gpt-image-2.5-sunburst-backup');
    expect(native).toMatchObject({ baseUrl: 'https://rolldek.com', apiKeyEnv: 'ROLL_IMAGE2.5_BIG_KEY' });
    expect(max).toMatchObject({ baseUrl: 'https://rolldek.com', apiKeyEnv: 'ROLL_IMAGE2.5_MAX_KEY' });
    expect(getImageRoutePointCost(native, '1k')).toBe(3.5);
    expect(getImageRoutePointCost(native, '2k')).toBe(4);
    expect(getImageRoutePointCost(native, '4k')).toBe(4.5);
    expect(getImageRoutePointCost(max, '1k')).toBe(5);
    expect(getImageRoutePointCost(max, '2k')).toBe(5.5);
    expect(getImageRoutePointCost(max, '4k')).toBe(6);
    expect(getImageModelNameForRoute({ imageModel: sunburst.id, imageLine: '原生线路', imageSize: '1k' })).toBe('gpt-image-2.5-sunburst');
    expect(getImageModelNameForRoute({ imageModel: sunburst.id, imageLine: '原生线路', imageSize: '2k' })).toBe('gpt-image-2.5-sunburst');
    expect(getImageModelNameForRoute({ imageModel: sunburst.id, imageLine: '原生线路', imageSize: '4k' })).toBe('gpt-image-2.5-sunburst');
    expect(getImageModelNameForRoute({ imageModel: sunburst.id, imageLine: '官渠高质', imageSize: '4k' })).toBe('gpt-image-2.5-sunburst');
    expect(getImageRouteSupportedQualities(native)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(getImageRouteSupportedQualities(max)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(getImageRouteSupportedQualities(backup)).toEqual(['auto', 'low', 'medium', 'high']);
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
    expect(isGptImageCompatibleModel('gpt-image-2.6-sunburst')).toBe(true);
    expect(isGptImageCompatibleModel('gpt-image-26')).toBe(false);
    expect(isGptImageCompatibleModel('seedream-5-pro')).toBe(true);
    expect(isGptImageCompatibleModel('seedream-5.5')).toBe(true);
    expect(isGptImageCompatibleModel('gemini-3.1-flash-image-preview')).toBe(false);
  });
});

describe('Seedream-5-pro catalog', () => {
  it('registers a PixelleLabs GPT-compatible model with only 1K and 2K sizes', () => {
    const model = getImageModelById('seedream-5-pro');
    const routes = getImageRoutesByModelFamily('seedream-5-pro');

    expect(model.label).toBe('Seedream-5-pro');
    expect(model.requestModel).toBe('seedream-5-pro');
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k', '2k']);
    expect(routes).toHaveLength(2);
    expect(routes.find((route) => route.id === 'seedream-5-pro-default')).toMatchObject({
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1/images/generations',
      editPath: '/v1/images/edits',
      upstreamModel: 'seedream-5-pro',
    });

    const visionary = routes.find((route) => route.id === 'seedream-5-pro-visionary-stable');
    expect(visionary).toMatchObject({
      label: '稳定线路',
      line: '稳定线路',
      baseUrl: 'https://api.visionary.beer',
      generatePath: '/v1/images/generations',
      taskPath: '/v1/tasks/{taskId}',
      upstreamModel: 'seedream-5.0-pro',
      apiKeyEnv: 'Nanobananapro_visionary',
      mode: 'async',
    });
    expect(visionary?.sizeOverrides).toEqual({
      '1k': { pointCost: 4 },
      '2k': { pointCost: 5 },
    });
    expect(getImageRoutePointCost(visionary, '1k')).toBe(4);
    expect(getImageRoutePointCost(visionary, '2k')).toBe(5);
  });
});

describe('Seedream-5.5 catalog', () => {
  it('registers the 5.5 model with the same runtime lines and pricing as Seedream-5-pro', () => {
    const model = getImageModelById('seedream-5.5');
    const routes = getImageRoutesByModelFamily('seedream-5.5');

    expect(model.label).toBe('Seedream-5.5');
    expect(model.requestModel).toBe('seedream-5.5');
    expect(model.selectorCost).toBe(3);
    expect(getImageModelSizeOptions(model.id)).toEqual(['1k', '2k']);
    expect(routes).toHaveLength(3);
    expect(routes.find((route) => route.id === 'seedream-5.5-default')).toMatchObject({
      baseUrl: 'https://api.pixellelabs.com',
      generatePath: '/v1/images/generations',
      editPath: '/v1/images/edits',
      upstreamModel: 'seedream-5.5',
      pointCost: 3,
    });

    const visionary = routes.find((route) => route.id === 'seedream-5.5-visionary-stable');
    expect(visionary).toMatchObject({
      label: '稳定线路',
      line: '稳定线路',
      baseUrl: 'https://api.visionary.beer',
      generatePath: '/v1/images/generations',
      taskPath: '/v1/tasks/{taskId}',
      upstreamModel: 'seedream-5.5',
      apiKeyEnv: 'Nanobananapro_visionary',
      mode: 'async',
    });
    expect(visionary?.sizeOverrides).toEqual({
      '1k': { pointCost: 4 },
      '2k': { pointCost: 5 },
    });
    expect(getImageRoutePointCost(visionary, '1k')).toBe(4);
    expect(getImageRoutePointCost(visionary, '2k')).toBe(5);
    const mouxihub = routes.find((route) => route.id === 'seedream-5.5-mouxihub');
    expect(mouxihub).toMatchObject({
      label: '官转线路',
      line: '官转线路',
      upstreamModel: 'seedream-v5.5',
    });
    expect(mouxihub?.sizeOverrides).toEqual({
      '1k': { pointCost: 4, inputImagePointCost: 1.25 },
      '2k': { pointCost: 4, inputImagePointCost: 1.25 },
    });
  });
});

describe('image route estimate with input image pricing', () => {
  it('includes references in each single-image request and rounds the aggregate once', () => {
    const route = {
      id: 'mouxihub', label: '眸析云', modelFamily: 'seedream-5.5', line: '眸析云',
      transport: 'openai-image' as const, mode: 'async' as const,
      baseUrl: 'https://api.mouxihub.com', generatePath: '/v1/images/generations?async=true',
      pointCost: 4,
      sizeOverrides: {
        '1k': { pointCost: 4, inputImagePointCost: 1.25 },
        '2k': { pointCost: 4, inputImagePointCost: 1.25 },
      },
    };

    expect(getImageRouteEstimatedPointCost(route, '1k', 2, 2)).toBe(13);
    expect(getImageRouteEstimatedPointCost(route, '2k', 1, 1)).toBe(5.3);
    expect(getImageRouteEstimatedPointCost({ ...route, sizeOverrides: { '1k': { pointCost: 4 } } }, '1k', 2, 2)).toBe(8);
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
