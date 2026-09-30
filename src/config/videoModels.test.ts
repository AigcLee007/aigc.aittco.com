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
  'gemini-omni-1.1-flash',
  'grok-imagine-video-1.5',
  'omni_flash-10s',
];
const targetRouteIds = [
  'gemini-omni-1.1-flash-line1',
  'grok-imagine-video-1.5-mouxihub',
  'omni_flash-10s-mouxihub',
];
const legacyModelIds = [
  'gemini-omni-flash',
  'sora-v3-pro',
  'veo31-fast',
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
  'gemini-omni-flash-line1',
  'sora-v3-pro-line1',
  'veo31-fast-line1',
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
  it('keeps existing active models and exposes Omni Flash 10s', () => {
    const activeIds = modelCatalog.models
      .filter((model) => model.isActive !== false)
      .map((model) => model.id);
    expect(activeIds).toEqual(targetModelIds);
    expect(modelCatalog.defaultModelId).toBe('gemini-omni-1.1-flash');

    expect(modelCatalog.models
      .filter((model) => !targetModelIds.includes(model.id))
      .map((model) => model.id)
      .sort())
      .toEqual([...legacyModelIds].sort());
    expect(modelCatalog.models
      .filter((model) => legacyModelIds.includes(model.id))
      .every((model) => model.isActive === false && model.isDefaultModel === false))
      .toBe(true);
  });

  it('keeps one independently keyed active route per target model', () => {
    const activeRoutes = routeCatalog.routes.filter(
      (route) => route.isActive !== false,
    );
    expect(activeRoutes.map((route) => route.apiKeyEnv).sort()).toEqual(['MOUXIHUB_GROK_VIDEO_API_KEY', 'MOUXIHUB_OMNI_FLASH_API_KEY', 'ROLL_VEDIO_OMNI_KEY'].sort());
    const rollDek = activeRoutes.find((route) => route.id === 'gemini-omni-1.1-flash-line1')!;
    expect(rollDek.baseUrl).toBe('https://rolldek.com');
    expect(rollDek.generatePath).toBe('/v1/videos');
    expect(rollDek.taskPath).toBe('/v1/videos/{taskId}');
    expect(rollDek.contentPath).toBe('/v1/videos/{taskId}/content');
    const mouxihub = activeRoutes.find((route) => route.id === 'grok-imagine-video-1.5-mouxihub')!;
    expect(mouxihub.baseUrl).toBe('https://api.mouxihub.com');
    expect(mouxihub.generatePath).toBe('/v1/video/generations');
    expect(mouxihub.taskPath).toBe('/v1/videos/{taskId}');
    const omni = activeRoutes.find((route) => route.id === 'omni_flash-10s-mouxihub')!;
    expect(omni.baseUrl).toBe('https://api.mouxihub.com');
    expect(omni.generatePath).toBe('/v1/videos');
    expect(omni.taskPath).toBe('/v1/videos/{taskId}');
    expect(omni.transport).toBe('openai-video');
    expect(omni.apiKeyEnv).toBe('MOUXIHUB_OMNI_FLASH_API_KEY');
    expect(omni.contentPath).toBeUndefined();
    expect(omni.isDefaultRoute).toBe(false);

    expect(routeCatalog.routes
      .filter((route) => !targetRouteIds.includes(route.id))
      .map((route) => route.id)
      .sort())
      .toEqual([...legacyRouteIds].sort());
    expect(routeCatalog.routes
      .filter((route) => legacyRouteIds.includes(route.id))
      .every((route) => route.isActive === false && route.isDefaultRoute === false))
      .toBe(true);
  });

  it('matches the migration source of truth without changing defaults', () => {
    expect(targetCatalog.models.map((model) => model.id)).toEqual(['gemini-omni-1.1-flash', 'grok-imagine-video-1.5', 'omni_flash-10s']);
    expect(targetCatalog.routes.map((route) => route.id)).toEqual(['gemini-omni-1.1-flash-line1', 'grok-imagine-video-1.5-mouxihub', 'omni_flash-10s-mouxihub']);
    expect(targetCatalog.defaultModelId).toBe('gemini-omni-1.1-flash');
    expect(targetCatalog.defaultRouteId).toBe('gemini-omni-1.1-flash-line1');
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
    expect(getVideoModelResolutionOptions('gemini-omni-1.1-flash')).toEqual(['720p']);
    expect(getVideoModelMaxReferenceVideos('gemini-omni-1.1-flash')).toBe(1);
    expect(getVideoModelReferenceImageMode('gemini-omni-1.1-flash')).toBe('frames');
    expect(getVideoModelDisplayCost('gemini-omni-1.1-flash', '5')).toBe(20);
    const omni = modelCatalog.models.find((model) => model.id === 'omni_flash-10s')!;
    expect(omni.isActive).toBe(true);
    expect(omni.isDefaultModel).toBe(false);
    expect(omni.routeFamily).toBe('omni_flash-10s');
    expect(omni.aspectRatioOptions).toEqual(['16:9', '9:16']);
    expect(omni.resolutionOptions).toEqual(['720p']);
    expect(omni.durationOptions).toEqual(['10']);
    expect(omni.maxReferenceImages).toBe(7);
    expect(omni.maxReferenceVideos).toBe(1);
    expect(getVideoModelDisplayCost('omni_flash-10s', '10')).toBe(20);
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
