import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as jobs from './imageJobClient';
import 'fake-indexeddb/auto';
import { saveImageRequest, readImageRequest, listImageRequests } from './imageJobRequests';
import { persistImageJobCredentials } from '../store/canvasStore';
vi.mock('../store/canvasStore', () => ({ persistImageJobCredentials: vi.fn() }));

describe('recoverable image job submission', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());
  it('uses asynchronous admission and a request ID that remains the same during a lost acknowledgement', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-a' } }), { status: 200 }));
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'job-a', status: 'processing' }), { status: 200 }));
    const result = await jobs.submitImageJob('/api/generate', { prompt: 'test', clientRequestId: 'req-fixed' }, { 'X-Auth-Session': 'session-a' });
    expect(result.task_id).toBe('job-a');
    const sent = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(sent.asyncTask).toBe(true);
    expect(sent.clientRequestId).toBe('req-fixed');
    expect(String(fetcher.mock.calls[2][0])).toContain('/image-jobs/request/req-fixed');
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('keeps a recoverable request task when both submit and acknowledgement lookup disconnect', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-b' } }), { status: 200 }));
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await jobs.submitImageJob('/api/edit', { prompt: 'test', clientRequestId: 'req-lost' }, { 'X-Auth-Session': 'session-b' });
    expect(result.task_id).toBe('request-req-lost');
    expect(result.status).toBe('processing');
    expect(result.connection_status).toBe('recovering');
  });
  it('resends the exact same request only after lookup confirms it was not admitted', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-retry' } })));
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'job-retry' }), { status: 202 }));
    const result = await jobs.submitImageJob('/api/gemini/generate', { prompt: 'retry', clientRequestId: 'stable' }, { 'X-Auth-Session': 'session-retry' });
    expect(result.task_id).toBe('job-retry');
    const posts = fetcher.mock.calls.filter(call => call[1]?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
    expect(String(fetcher.mock.calls[2][0])).toBe('/api/image-jobs/request/stable');
  });
  it('a truncated successful acknowledgement is recovered by request lookup', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-truncated' } })));
    fetcher.mockResolvedValueOnce(new Response('{"task_id":', { status: 202 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'job-truncated', status: 'processing' })));
    expect((await jobs.submitImageJob('/api/generate', { clientRequestId: 'truncated' }, { 'X-Auth-Session': 'session-truncated' })).task_id).toBe('job-truncated');
  });
  it('does not turn confirmed validation errors into background tasks', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-c' } }), { status: 200 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad size' }), { status: 400 }));
    await expect(jobs.submitImageJob('/api/generate', { prompt: 'test' }, { 'X-Auth-Session': 'session-c' })).rejects.toThrow('bad size');
  });
  it('rejects a full personal queue without retrying or retaining a recovery request', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{"user":{"userId":"usr-full"}}'));
    fetcher.mockResolvedValueOnce(new Response('{"error":"请等待部分完成","code":"USER_QUEUE_FULL"}', { status: 429 }));
    await expect(jobs.submitImageJob('/api/generate', { clientRequestId: 'queue-full' }, { 'X-Auth-Session': 'session-full' }))
      .rejects.toMatchObject({ status: 429, code: 'USER_QUEUE_FULL' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readImageRequest('usr-full', 'queue-full')).toBeUndefined();
  });
  it('clears a lost submission when its confirmed-missing retry hits the personal queue limit', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{"user":{"userId":"usr-retry-full"}}'));
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetcher.mockResolvedValueOnce(new Response('{"error":"queue full","code":"USER_QUEUE_FULL"}', { status: 429 }));
    await expect(jobs.submitImageJob('/api/generate', { clientRequestId: 'retry-full' }, { 'X-Auth-Session': 'retry-full-session' }))
      .rejects.toMatchObject({ code: 'USER_QUEUE_FULL' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(await readImageRequest('usr-retry-full', 'retry-full')).toBeUndefined();
  });
  it('removes a restored upload after its admission is explicitly refused', async () => {
    localStorage.setItem('auth-session-v1', 'restore-full-session');
    await saveImageRequest({ owner: 'usr-restore-full', requestId: 'restore-full', endpoint: '/api/generate', payload: { prompt: 'full' }, createdAt: Date.now() });
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetcher.mockResolvedValueOnce(new Response('{"user":{"userId":"usr-restore-full"}}'));
    fetcher.mockResolvedValueOnce(new Response('{"error":"queue full","code":"USER_QUEUE_FULL"}', { status: 429 }));
    await expect(jobs.queryImageJob('request-restore-full', { 'X-Auth-Session': 'restore-full-session' }, '/api', 'usr-restore-full'))
      .rejects.toMatchObject({ code: 'USER_QUEUE_FULL' });
    expect(await readImageRequest('usr-restore-full', 'restore-full')).toBeUndefined();
  });
  it('request polling resolves lookup and then fetches its current job result', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'job-found', status: 'succeeded', data: [{ url: '/image.png' }] }), { status: 200 }));
    const result = await jobs.queryImageJob('request-req-lost', { 'X-Auth-Session': 'session-b' });
    expect(result.status).toBe('succeeded');
    expect(result.data[0].url).toBe('/image.png');
  });
  it('successful API errors are not hidden as network interruptions', () => {
    expect(jobs.isTransientJobError(new TypeError('Failed to fetch'))).toBe(true);
    expect(jobs.isTransientJobError({ status: 503 })).toBe(true);
    expect(jobs.isTransientJobError({ status: 401 })).toBe(false);
    expect(jobs.isTransientJobError({ status: 429 })).toBe(true);
    expect(jobs.isTransientJobError({ status: 429, code: 'USER_QUEUE_FULL' })).toBe(false);
    expect(jobs.isTransientJobError({ status: 400 })).toBe(false);
  });
  it('a reloaded page can recover an upload that never reached admission using the same request', async () => {
    localStorage.setItem('auth-session-v1', 'reload-session');
    const payload = { asyncTask: true, uiMode: 'canvas', clientRequestId: 'reload-req', prompt: 'reference', images: ['data:image/png;base64,AA=='], clientLiveTaskIds: ['reload-node'] };
    await saveImageRequest({ owner: 'usr-reload', requestId: 'reload-req', endpoint: '/api/edit', payload, createdAt: Date.now() });
    expect(await listImageRequests('usr-reload')).toEqual([{ requestId: 'reload-req', nodeIds: ['reload-node'], prompt: 'reference', createdAt: expect.any(Number) }]);
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-reload' } })));
    fetcher.mockResolvedValueOnce(new Response('{"task_id":"job-reload"}', { status: 202 }));
    const result = await jobs.queryImageJob('request-reload-req', { 'X-Auth-Session': 'reload-session' }, '/api', 'usr-reload');
    expect(result.task_id).toBe('job-reload');
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual(payload);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Content-Type')).toBe('application/json');
    expect(await readImageRequest('usr-reload', 'reload-req')).toBeUndefined();
  });
  it('does not resend from recovery while the original submission is preparing or awaiting admission', async () => {
    localStorage.setItem('auth-session-v1', 'inflight-session');
    const fetcher = vi.mocked(fetch);
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/auth/session')) return new Response('{"user":{"userId":"usr-inflight"}}');
      if (init?.method === 'POST') return new Response('{"task_id":"job-inflight"}', { status: 202 });
      return new Response('{}', { status: 404 });
    });
    let release!: () => void;
    vi.mocked(persistImageJobCredentials).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const work = jobs.submitImageJob('/api/generate', { prompt: 'seedream', routeId: 'seedream-5-pro-default', clientRequestId: 'inflight', clientLiveTaskIds: ['inflight-node'] }, { 'X-Auth-Session': 'inflight-session', 'Content-Type': 'application/json' });
    await vi.waitFor(() => expect(release).toBeDefined());
    try {
      const recovered = await jobs.queryImageJob('request-inflight', { 'X-Auth-Session': 'inflight-session' }, '/api', 'usr-inflight');
      expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
      expect(recovered.connection_status).toBe('unconfirmed');
    } finally { release(); await work; }
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('an old node cannot resend its stored upload under a different account', async () => {
    localStorage.setItem('auth-session-v1', 'new-owner-session');
    await saveImageRequest({ owner: 'usr-old', requestId: 'cross-owner', endpoint: '/api/generate', payload: { prompt: 'old account' }, createdAt: Date.now() });
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user: { userId: 'usr-new' } })));
    await expect(jobs.queryImageJob('request-cross-owner', { 'X-Auth-Session': 'new-owner-session' }, '/api', 'usr-old')).rejects.toMatchObject({ status: 401 });
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
  });
  it('canvas task credentials are durable before a paid POST is sent', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{"user":{"userId":"usr-durable"}}'));
    fetcher.mockResolvedValueOnce(new Response('{"task_id":"job-durable"}', { status: 202 }));
    let release!: () => void;
    vi.mocked(persistImageJobCredentials).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const work = jobs.submitImageJob('/api/generate', { prompt: 'safe', clientRequestId: 'durable', clientLiveTaskIds: ['durable-node'] }, { 'X-Auth-Session': 'durable-session' });
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    release();
    expect((await work).task_id).toBe('job-durable');
  });
  it('if canvas persistence fails, accepted tasks retain a small recovery receipt without reference bytes', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('{"user":{"userId":"usr-receipt"}}'));
    fetcher.mockResolvedValueOnce(new Response('{"task_id":"job-receipt"}', { status: 202 }));
    vi.mocked(persistImageJobCredentials).mockRejectedValueOnce(new Error('storage full'));
    await jobs.submitImageJob('/api/edit', { prompt: 'safe', images: ['data:image/png;base64,AA=='], clientRequestId: 'receipt', clientLiveTaskIds: ['receipt-node'] }, { 'X-Auth-Session': 'receipt-session' });
    const receipt = await readImageRequest('usr-receipt', 'receipt');
    expect(receipt?.admittedTaskId).toBe('job-receipt');
    expect(JSON.stringify(receipt)).not.toContain('base64');
    expect((await listImageRequests('usr-receipt'))[0].taskId).toBe('job-receipt');
  });
});
