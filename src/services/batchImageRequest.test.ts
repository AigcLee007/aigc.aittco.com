import { describe, expect, it, vi } from 'vitest';
import type { ImageRouteConfig } from '../config/imageRoutes';
import { generateGeminiImage, generateImageApi, editImageApi } from '../../services/api';
import { buildBatchImageRequest, normalizeBatchImageResponse, submitBatchImageRequest } from './batchImageRequest';

vi.mock('../../services/api', () => ({
  generateGeminiImage: vi.fn(),
  generateImageApi: vi.fn(),
  editImageApi: vi.fn(),
}));

const route = (transport: ImageRouteConfig['transport'], id = 'route-a'): ImageRouteConfig => ({
  id,
  label: 'Route A',
  modelFamily: 'image-family',
  line: 'line-a',
  transport,
  mode: 'async',
  baseUrl: 'https://images.example.test',
  generatePath: '/images/generations',
  editPath: '/images/edits',
}) as ImageRouteConfig;

const input = (overrides: Record<string, unknown> = {}) => ({
  mode: 't2i' as const,
  modelId: 'nano-banana-pro',
  modelName: 'nano-banana-pro-upstream',
  route: route('openai-image'),
  prompt: 'A small glass greenhouse',
  aspectRatio: '16:9',
  imageSize: '2k',
  references: [] as string[],
  ...overrides,
});

describe('batch image request construction', () => {
  it('sends the original single Soul 2.0 reference to the backend edit route', () => {
    const reference = 'data:image/png;base64,AA==';
    const request = buildBatchImageRequest(input({
      mode: 'i2i', modelId: 'higgsfield-soul-2', modelName: 'higgsfield-ai/soul/v2/standard',
      route: route('higgsfield-image', 'higgsfield-soul-2'), imageSize: '1080p',
      references: [reference],
    }));
    expect(request.endpoint).toBe('edit');
    expect(request.payload).toMatchObject({ images: [reference], image_size: '1080p', n: 1 });
  });
  it('builds native Gemini content with every selected reference image', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      route: route('gemini-native', 'gemini-native-route'),
      references: ['data:image/png;base64,AA==', 'data:image/jpeg;base64,BB=='],
    }));

    expect(request.endpoint).toBe('gemini');
    expect(request.payload.contents[0].parts).toEqual([
      { text: 'A small glass greenhouse' },
      { inlineData: { mimeType: 'image/png', data: 'AA==' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'BB==' } },
    ]);
    expect(request.payload.generationConfig).toMatchObject({
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
      candidateCount: 1,
    });
  });

  it('uses the GPT edit payload with all joint references', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      modelId: 'gpt-image-2',
      modelName: 'gpt-image-2',
      route: route('openai-image', 'gpt-route'),
      references: ['data:image/png;base64,AA==', 'data:image/png;base64,BB=='],
    }));

    expect(request.endpoint).toBe('edit');
    expect(request.payload).toMatchObject({
      modelId: 'gpt-image-2',
      routeId: 'gpt-route',
      image_size: '2k',
      images: ['data:image/png;base64,AA==', 'data:image/png;base64,BB=='],
      n: 1,
    });
  });

  it('uses one raw image for an independent generic edit request', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      references: ['data:image/png;base64,AA=='],
    }));

    expect(request.endpoint).toBe('generate');
    expect(request.payload).toMatchObject({ image: 'AA==', n: 1, routeId: 'route-a' });
    expect(request.payload.images).toBeUndefined();
  });

  it('uses the multi-reference array shape for Doubao editing models', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      modelName: 'doubao-image-v5',
      references: ['data:image/png;base64,AA==', 'data:image/png;base64,BB=='],
    }));

    expect(request.endpoint).toBe('generate');
    expect(request.payload.image).toEqual(['AA==', 'BB==']);
  });

  it('preserves all Grok reference fields used by the canvas editor', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      modelName: 'grok-imagine-image',
      references: ['data:image/png;base64,AA==', 'data:image/jpeg;base64,BB=='],
    }));

    expect(request.endpoint).toBe('generate');
    expect(request.payload).toMatchObject({
      image: 'AA==',
      images: ['AA==', 'BB=='],
      reference_image: 'AA==',
      reference_images: ['AA==', 'BB=='],
      reference_mode: 'stable_fusion',
    });
  });

  it('marks legacy multi-reference requests for collage composition', () => {
    const request = buildBatchImageRequest(input({
      mode: 'i2i',
      modelId: 'legacy-image',
      modelName: 'legacy-image',
      references: ['data:image/png;base64,AA==', 'data:image/png;base64,BB=='],
    }));

    expect(request.payload.referenceMode).toBe('legacy-collage');
  });

  it('normalizes managed tasks and immediate image response shapes', () => {
    expect(normalizeBatchImageResponse({ taskId: 'job-123' })).toEqual({ taskId: 'job-123', images: [] });
    expect(normalizeBatchImageResponse({ url: '/generated/one.png' })).toEqual({
      images: ['/generated/one.png'],
    });
    expect(normalizeBatchImageResponse({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }],
    })).toEqual({ images: ['data:image/png;base64,AA=='] });
  });

  it('submits one output with its route, client request ID, and live canvas node mapping', async () => {
    vi.mocked(generateImageApi).mockResolvedValue({ url: '/generated/one.png' } as never);
    const request = input({
      route: route('openai-image', 'selected-route'),
      modelId: 'nano-banana-pro',
    });

    const response = await submitBatchImageRequest(undefined, request, 'canvas-node-7', 'request-7');

    expect(response.images).toEqual(['/generated/one.png']);
    expect(generateImageApi).toHaveBeenCalledWith(undefined, expect.objectContaining({
      modelId: 'nano-banana-pro',
      routeId: 'selected-route',
      n: 1,
      clientRequestId: 'request-7',
      clientLiveTaskIds: ['canvas-node-7'],
    }));
    expect(editImageApi).not.toHaveBeenCalled();
    expect(generateGeminiImage).not.toHaveBeenCalled();
  });

  it('rejects image-to-image requests without reference images', () => {
    expect(() => buildBatchImageRequest(input({ mode: 'i2i' }))).toThrow('至少需要一张参考图');
  });
});
