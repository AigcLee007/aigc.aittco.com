import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage, editImage } from './geminiService';

vi.mock('../src/services/accountIdentity', () => ({ getAuthorizedBillingHeaders: vi.fn(async () => ({})) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('batch image generation feedback', () => {
  it.each(['generate', 'edit'])('forwards acceptance and reported progress for %s without simulated ticks', async mode => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'queued', progress: '65%' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'succeeded', url: 'https://example.com/image.png' }))));
    const progress = vi.fn();
    const result = mode === 'generate'
      ? generateImage(undefined, 'test', '1:1', '1k', 1, progress)
      : editImage(undefined, 'base64', 'test', '1:1', '1k', 1, progress);
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).toHaveBeenCalledWith(0, 'estimated', 'PENDING');
    await vi.advanceTimersByTimeAsync(2000);
    expect(progress).toHaveBeenCalledWith(65, 'reported', 'QUEUED');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual(['https://example.com/image.png']);
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
