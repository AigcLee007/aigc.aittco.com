import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTaskStatus, editImageApi, findAllUrlsInObject, generateImageApi, normalizeImageResultValue } from './api';

describe('image result URL parsing', () => {
  it('does not wrap http image URLs as base64 data URLs', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(normalizeImageResultValue(url)).toBe(url);
  });

  it('unwraps http URLs that were incorrectly stored as base64 data URLs', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(normalizeImageResultValue(`data:image/png;base64,${url}`)).toBe(url);
  });

  it('extracts Visionary results URLs without corrupting them', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';
    const results: string[] = [];

    findAllUrlsInObject(
      {
        id: 'id',
        status: 'succeeded',
        results: [{ url, content: '' }],
      },
      results,
    );

    expect(results).toEqual([url]);
  });

  it('extracts b64_json URL values without corrupting them', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';
    const results: string[] = [];

    findAllUrlsInObject(
      {
        id: 'id',
        status: 'succeeded',
        data: [{ b64_json: `data:image/png;base64,${url}` }],
      },
      results,
    );

    expect(results).toEqual([url]);
  });
});

describe('image request deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('auth-session-v1', 'sess_diagnostic');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([generateImageApi, editImageApi])('ends an unacknowledged submission without submitting it again', async (submit) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = submit(undefined, { routeId: 'gpt-image-2-line2', model: 'gpt-image-2' }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(120_001);
    const error = await Promise.race([outcome, Promise.resolve(null)]);
    expect(error?.message).toContain('结果未确认');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds reading a stalled JSON body as well as fetching response headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })));
    const outcome = checkTaskStatus(undefined, 'diagnostic-task').catch((error) => error);
    await vi.advanceTimersByTimeAsync(20_001);
    const error = await Promise.race([outcome, Promise.resolve(null)]);
    expect(error?.message).toContain('查询超时');
  });

  it('preserves a successful task acknowledgement and clears the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ task_id: 'acknowledged' }) })));
    expect((await generateImageApi(undefined, { routeId: 'gpt-image-2-line2' })).taskId).toBe('acknowledged');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
