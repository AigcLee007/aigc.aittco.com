import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const {
  isGeneratedAssetStorageEnabled,
  LOCAL_LINE4_ROUTE_ID,
  persistGeneratedImageResults,
} = require('./generatedAssetService.cjs');

describe('generated asset persistence routing', () => {
  it('stores JPEG base64 and rewrites the matching b64_json to its original URL', async () => {
    const buffer = await require('sharp')({ create: { width: 16, height: 9, channels: 3, background: '#334455' } }).jpeg().toBuffer();
    const base64 = buffer.toString('base64');
    const result = await persistGeneratedImageResults({
      payload: { data: [{ b64_json: base64 }] }, resultUrls: [`data:image/jpeg;base64,${base64}`],
      context: { routeId: LOCAL_LINE4_ROUTE_ID, userId: 'jpeg-test-user', taskId: 'jpeg-test-task' },
    });
    expect(result.resultUrls).toHaveLength(1);
    expect(result.payload.data[0].url).toBe(result.resultUrls[0]);
    expect(result.payload.data[0].b64_json).toBe(result.resultUrls[0]);
  });

  it('enables local storage for the configured line4 route', () => {
    expect(isGeneratedAssetStorageEnabled({ routeId: LOCAL_LINE4_ROUTE_ID })).toBe(true);
  });

  it('enables local storage for Visionary routes even when the admin route id is custom', () => {
    expect(
      isGeneratedAssetStorageEnabled({
        routeId: 'custom-vision-line',
        routeBaseUrl: 'https://visionary.beer',
        routeGeneratePath: '/openapi/v1/images/generations',
      }),
    ).toBe(true);
  });

  it('keeps local storage disabled for unrelated image routes', () => {
    expect(
      isGeneratedAssetStorageEnabled({
        routeId: 'unrelated-line',
        routeBaseUrl: 'https://api.example.com',
        routeGeneratePath: '/v1/images/generations',
      }),
    ).toBe(false);
  });

  it('rewrites common response URL fields to local generated asset URLs', async () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

    const result = await persistGeneratedImageResults({
      payload: {
        url: dataUrl,
        image_url: dataUrl,
        images: [dataUrl],
        results: [{ url: dataUrl, content: '' }],
      },
      resultUrls: [dataUrl],
      context: {
        routeId: LOCAL_LINE4_ROUTE_ID,
        userId: 'test-user',
        taskId: 'test-task',
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.assets).toHaveLength(1);
    expect(result.resultUrls[0]).toMatch(/^\/generated-assets\/line4\/original\//);
    expect(result.payload.url).toBe(result.resultUrls[0]);
    expect(result.payload.image_url).toBe(result.resultUrls[0]);
    expect(result.payload.images[0]).toBe(result.resultUrls[0]);
    expect(result.payload.results[0].url).toBe(result.resultUrls[0]);
    expect(result.previewUrl).toMatch(/^\/generated-assets\/line4\/thumb\//);
  });

  it('normalizes http URLs incorrectly wrapped as base64 data URLs before rewriting payloads', async () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';
    const originalDownloadTimeout = process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS;
    process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS = '1000';

    try {
      const result = await persistGeneratedImageResults({
        payload: {
          data: [{ b64_json: `data:image/png;base64,${url}` }],
        },
        resultUrls: [`data:image/png;base64,${url}`],
        context: {
          routeId: LOCAL_LINE4_ROUTE_ID,
          userId: 'test-user',
          taskId: 'test-task',
        },
      });

      expect(result.resultUrls).toEqual([url]);
      expect(result.payload.data[0].b64_json).toBe(url);
      expect(result.payload.url).toBe(url);
    } finally {
      if (originalDownloadTimeout === undefined) {
        delete process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS;
      } else {
        process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS = originalDownloadTimeout;
      }
    }
  });
});
