import { describe, expect, it } from 'vitest';
import { getImageModelById, getImageModelMaxReferenceImages, isMidjourneyImageModel } from './imageModels';
import { getImageRoutesByModelFamily, getImageRoutePointCost, getImageRouteSupportedQualities } from './imageRoutes';

describe('Midjourney catalog', () => {
  it('registers the discounted and stable routes under one model', () => {
    const model = getImageModelById('midjourney-v8.2-tehui');
    expect(model).toMatchObject({ id: 'midjourney-v8.2-tehui', label: 'Midjourney v8.2', requestModel: 'Midjourney v8.2-特惠', sizeOptions: ['1k', '2k'], supportsCustomRatio: false });
    const routes = getImageRoutesByModelFamily(model.routeFamily);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ baseUrl: 'https://api.osodm.com', generatePath: '/v1/images/midjourney/generations', taskPath: '/v1/images/midjourney/tasks/{taskId}', mode: 'async', apiKeyEnv: 'Midjourney-v8.2-osodm-tehui', pointCost: 8, resultKind: 'url' });
    expect(getImageRouteSupportedQualities(routes[0])).toEqual(['0.25', '0.5', '1', '2']);
    expect(getImageRoutePointCost(routes[0], '1k')).toBe(8);
    expect(getImageRoutePointCost(routes[0], '2k')).toBe(8);
    const stable = routes.find(route => route.line === '稳定线路');
    expect(stable).toMatchObject({ id: 'midjourney-v8.2-osodm-wending', baseUrl: 'https://api.osodm.com', generatePath: '/v1/images/midjourney/generations', taskPath: '/v1/images/midjourney/tasks/{taskId}', upstreamModel: 'mj-v8.2', mode: 'async', apiKeyEnv: 'Midjourney-v8.2-osodm-wending', isDefaultRoute: false });
    expect(getImageRoutePointCost(stable, '1k')).toBe(16);
    expect(getImageRoutePointCost(stable, '2k')).toBe(16);
    expect(getImageRouteSupportedQualities(stable)).toEqual(['0.25', '0.5', '1', '2']);
    expect(getImageModelMaxReferenceImages(model.id)).toBe(1);
    expect(isMidjourneyImageModel(model.requestModel)).toBe(true);
  });
});
