import { afterEach, describe, expect, it, vi } from 'vitest';
import targetCatalog from '../../config/pixelhubVideoCatalog.json';
import modelCatalog from '../../config/videoModels.json';
import routeCatalog from '../../config/videoRoutes.json';
import {
  getVideoModelDisplayCost,
  getVideoModelMaxReferenceVideos,
  getVideoModelReferenceImageMode,
  getVideoModelResolutionOptions,
  refreshVideoModelCatalog,
} from './videoModels';

afterEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => modelCatalog,
  }));
  await refreshVideoModelCatalog();
  vi.unstubAllGlobals();
});

const targetModelIds = [
  'gemini-omni-flash',
  'sora-v3-pro',
  'veo31-fast',
];
const targetRouteIds = [
  'gemini-omni-flash-line1',
  'sora-v3-pro-line1',
  'veo31-fast-line1',
];
const legacyModelIds = [
  'veo3.1-fast',
  'grok-video-3',
  'kling-video-3.0',
  'kling-video-o3-omni',
  'sora2',
  'sora-v3-fast',
  'veo3.1-components',
  'veo3.1-pro',
  'veo3.1-fast-4K',
  'veo3.1-fast-components-4K',
  'veo3.1-pro-4k',
];
const legacyRouteIds = [
  'veo3.1-fast-line1',
  'grok-video-3-line1',
  'kling-video-3.0-line1',
  'kling-video-o3-omni-line1',
  'sora2-line1',
  'sora-v3-fast-line1',
  'veo3.1-components-line1',
  'veo3.1-pro-line1',
  'veo3.1-fast-4k-line1',
  'veo3.1-fast-components-4k-line1',
  'veo3.1-pro-4k-line1',
];

describe('PixelHub video catalog', () => {
  it('exposes only the three target models', () => {
    const activeIds = modelCatalog.models
      .filter((model) => model.isActive !== false)
      .map((model) => model.id);
    expect(activeIds).toEqual(targetModelIds);
    expect(modelCatalog.defaultModelId).toBe('gemini-omni-flash');

    expect(modelCatalog.models
      .filter((model) => !targetModelIds.includes(model.id))
      .map((model) => model.id))
      .toEqual(legacyModelIds);
    expect(modelCatalog.models
      .filter((model) => legacyModelIds.includes(model.id))
      .every((model) => model.isActive === false && model.isDefaultModel === false))
      .toBe(true);
  });

  it('keeps one independently keyed active route per target model', () => {
    const activeRoutes = routeCatalog.routes.filter(
      (route) => route.isActive !== false,
    );
    expect(activeRoutes.map((route) => route.apiKeyEnv)).toEqual([
      'PIXELHUB_GEMINI_OMNI_FLASH_KEY',
      'PIXELHUB_SORA_V3_PRO_KEY',
      'PIXELHUB_VEO31_FAST_KEY',
    ]);
    expect(activeRoutes.every((route) => route.baseUrl === 'https://api.pixellelabs.com')).toBe(true);
    expect(activeRoutes.every((route) => route.generatePath === '/v1/videos')).toBe(true);
    expect(activeRoutes.every((route) => route.taskPath === '/v1/videos/{taskId}')).toBe(true);

    expect(routeCatalog.routes
      .filter((route) => !targetRouteIds.includes(route.id))
      .map((route) => route.id))
      .toEqual(legacyRouteIds);
    expect(routeCatalog.routes
      .filter((route) => legacyRouteIds.includes(route.id))
      .every((route) => route.isActive === false && route.isDefaultRoute === false))
      .toBe(true);
  });

  it('matches the migration source of truth', () => {
    expect(targetCatalog.models.map((model) => model.id)).toEqual(targetModelIds);
    expect(targetCatalog.routes.map((route) => route.id)).toEqual(targetRouteIds);
    expect(targetCatalog.defaultModelId).toBe('gemini-omni-flash');
    expect(targetCatalog.defaultRouteId).toBe('gemini-omni-flash-line1');
    expect(modelCatalog.defaultModelId).toBe(targetCatalog.defaultModelId);
    expect(routeCatalog.defaultRouteId).toBe(targetCatalog.defaultRouteId);

    for (const targetModel of targetCatalog.models) {
      expect(modelCatalog.models.find((model) => model.id === targetModel.id))
        .toEqual(targetModel);
    }

    for (const targetRoute of targetCatalog.routes) {
      expect(routeCatalog.routes.find((route) => route.id === targetRoute.id))
        .toEqual(targetRoute);
    }
  });

  it('reads model controls and pricing from active capabilities', () => {
    expect(getVideoModelResolutionOptions('sora-v3-pro')).toEqual(['720p']);
    expect(getVideoModelResolutionOptions('veo31-fast')).toEqual(['720p', '1080p']);
    expect(getVideoModelMaxReferenceVideos('gemini-omni-flash')).toBe(1);
    expect(getVideoModelMaxReferenceVideos('sora-v3-pro')).toBe(3);
    expect(getVideoModelReferenceImageMode('veo31-fast')).toBe('frames');
    expect(getVideoModelDisplayCost('veo31-fast', '4')).toBe(2);
  });

  it('falls back to the default resolution when the server returns an empty option list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        defaultModelId: 'legacy-video-model',
        models: [{
          id: 'legacy-video-model',
          label: 'Legacy Video Model',
          modelFamily: 'legacy',
          routeFamily: 'legacy',
          defaultResolution: '720p',
          resolutionOptions: [],
          isActive: true,
        }],
      }),
    }));

    await refreshVideoModelCatalog();

    expect(getVideoModelResolutionOptions('legacy-video-model')).toEqual(['720p']);
  });
});
