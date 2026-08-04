import { describe, expect, it } from 'vitest';
import targetCatalog from '../../config/pixelhubVideoCatalog.json';
import modelCatalog from '../../config/videoModels.json';
import routeCatalog from '../../config/videoRoutes.json';

describe('PixelHub video catalog', () => {
  it('exposes only the three target models', () => {
    const activeIds = modelCatalog.models
      .filter((model) => model.isActive !== false)
      .map((model) => model.id);
    expect(activeIds).toEqual([
      'gemini-omni-flash',
      'sora-v3-pro',
      'veo31-fast',
    ]);
    expect(modelCatalog.defaultModelId).toBe('gemini-omni-flash');
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
  });

  it('matches the migration source of truth', () => {
    expect(targetCatalog.models.map((model) => model.id)).toEqual([
      'gemini-omni-flash',
      'sora-v3-pro',
      'veo31-fast',
    ]);
    expect(targetCatalog.routes.map((route) => route.id)).toEqual([
      'gemini-omni-flash-line1',
      'sora-v3-pro-line1',
      'veo31-fast-line1',
    ]);

    for (const targetModel of targetCatalog.models) {
      expect(modelCatalog.models.find((model) => model.id === targetModel.id))
        .toEqual(targetModel);
    }

    for (const targetRoute of targetCatalog.routes) {
      expect(routeCatalog.routes.find((route) => route.id === targetRoute.id))
        .toEqual(targetRoute);
    }
  });
});
