import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import productionCatalog from '../../config/production-image-routes.json';
import staticCatalog from '../../config/imageRoutes.json';
import { getImageModelById, getImageModelSizeOptions } from './imageModels';
import { getImageRoutesByModelFamily, getImageModelNameForRoute, getImageRoutePointCost, getImageRouteSupportedQualities } from './imageRoutes';

const modelId = 'gpt-image-2.6-sunburst';

describe('GPT Image 2.6 Sunburst', () => {
  it('exposes the native and MochiAI routes under the same model', () => {
    expect(getImageModelById(modelId)).toMatchObject({ id: modelId, label: 'GPT-Image-2.6-Sunburst', requestModel: modelId, defaultSize: '2k', isActive: true });
    expect(getImageModelSizeOptions(modelId)).toEqual(['1k', '2k', '4k']);
    const routes = getImageRoutesByModelFamily(modelId);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ id: `${modelId}-native`, line: '原生线路', upstreamModel: modelId, transport: 'openai-image', mode: 'sync', baseUrl: 'https://rolldek.com', generatePath: '/v1/images/generations', editPath: '/v1/images/edits', apiKeyEnv: 'GPT-image-2.6-sunburst_rolldek_yuansheng', isDefaultRoute: true });
    expect(getImageRouteSupportedQualities(routes[0])).toEqual(['low', 'medium', 'high']);
    const mochiai = routes.find(route => route.id === `${modelId}-mochiai`);
    expect(mochiai).toMatchObject({ label: '特价4K', line: '特价4K', upstreamModel: modelId, transport: 'openai-image', mode: 'sync', baseUrl: 'https://mochiai.art', generatePath: '/v1/images/generations', editPath: '/v1/images/edits', apiKeyEnv: 'GPT-image-2.6-sunburst_mochiai', isDefaultRoute: false });
    expect(getImageRouteSupportedQualities(mochiai)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(productionCatalog.routes.filter(route => route.modelFamily === modelId)).toEqual(staticCatalog.routes.filter(route => route.modelFamily === modelId));
  });

  it.each([['1k', 2], ['2k', 2.5], ['4k', 3]] as const)('uses MochiAI for %s at %s points', (size, price) => {
    const route = getImageRoutesByModelFamily(modelId).find(route => route.line === '特价4K');
    expect(route).toBeDefined();
    expect(getImageRoutePointCost(route, size)).toBe(price);
    expect(getImageModelNameForRoute({ imageModel: modelId, imageLine: '特价4K', imageSize: size })).toBe(modelId);
  });

  it.each([['1k', 4], ['2k', 4.5], ['4k', 5]] as const)('uses the same upstream model and charges %s at %s points', (size, price) => {
    const route = getImageRoutesByModelFamily(modelId)[0];
    expect(route).toBeDefined();
    expect(getImageRoutePointCost(route, size)).toBe(price);
    expect(getImageModelNameForRoute({ imageModel: modelId, imageLine: '原生线路', imageSize: size })).toBe(modelId);
  });

  it('classic mode recognizes 2.6 and selects a supported quality from persisted settings', () => {
    const source = fs.readFileSync('public/classic-app/script.js', 'utf8');
    const start = source.indexOf('function isClassicGptImageModel(');
    const end = source.indexOf('function setClassicGptCompression(', start);
    let storedQuality: string | null = null;
    const context = vm.createContext({
      imageModel: modelId,
      getClassicSelectedModelId: () => modelId,
      getClassicSelectedRoute: () => ({ supportedQualities: ['low', 'medium', 'high'] }),
      GPT_IMAGE_QUALITY_KEY: 'quality',
      GPT_IMAGE_OUTPUT_COMPRESSION_KEY: 'compression',
      GPT_IMAGE_DEFAULTS: { quality: 'auto', outputFormat: 'png', moderation: 'auto' },
      GPT_IMAGE_QUALITY_VALUES: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      localStorage: { getItem: () => storedQuality },
    });
    vm.runInContext(source.slice(start, end), context);
    expect(vm.runInContext('isClassicGptImageModel()', context)).toBe(true);
    for (const value of [null, 'auto', 'xhigh', 'max', 'invalid']) {
      storedQuality = value;
      expect(vm.runInContext('getClassicGptSettings().quality', context)).toBe('medium');
    }
    for (const value of ['low', 'medium', 'high']) {
      storedQuality = value;
      expect(vm.runInContext('getClassicGptSettings().quality', context)).toBe(value);
    }
  });

  it('classic submission bridge routes 2.6 through the GPT payload builder', () => {
    const source = fs.readFileSync('public/classic-app/unified-bridge.js', 'utf8');
    const start = source.indexOf('const isGptImageCompatibleModel =');
    const end = source.indexOf('const isGptImage2Model =', start);
    expect(start).toBeGreaterThan(-1);
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end), context);
    expect(vm.runInContext(`isGptImageCompatibleModel({ id: '${modelId}' })`, context)).toBe(true);
    expect(vm.runInContext("isGptImageCompatibleModel({ id: 'gpt-image-26' })", context)).toBe(false);
  });
});
