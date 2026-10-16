import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { generateVideo, pollVideoTask, VIDEO_POLL_INTERVAL_MS } from './videoService';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../src/services/accountIdentity', () => ({ getAuthorizedBillingHeaders: vi.fn(async () => ({})) }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('video generation feedback', () => {
  it('reports acceptance before polling and forwards actual progress and queue status', async () => {
    vi.useFakeTimers();
    vi.mocked(axios.post).mockResolvedValue({ data: { id: 'video-task' } });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { status: 'queued', data: { progress: '65%' } } })
      .mockResolvedValueOnce({ data: { status: 'succeeded', video_url: '/video/result.mp4' } });
    const progress = vi.fn();
    const result = generateVideo(undefined, { modelId: 'video', routeId: 'route', prompt: 'test', aspectRatio: '16:9', resolution: '720p', duration: 5 }, progress);
    await vi.advanceTimersByTimeAsync(0);
    expect(progress).toHaveBeenCalledWith(0, 'estimated', 'PENDING');
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS);
    expect(progress).toHaveBeenCalledWith(65, 'reported', 'QUEUED');
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS);
    await expect(result).resolves.toBe('/video/result.mp4');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a status-only update when progress is unavailable and never forwards failed 100', async () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { status: 'processing', progress: 0 } })
      .mockResolvedValueOnce({ data: { status: 'failed', progress: 100, error: 'failed' } });
    const progress = vi.fn();
    const result = pollVideoTask(undefined, 'video-task', progress);
    const failure = expect(result).rejects.toThrow('failed');
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS);
    expect(progress).toHaveBeenCalledWith(0, 'estimated', 'PROCESSING');
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS);
    await failure;
    expect(progress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
