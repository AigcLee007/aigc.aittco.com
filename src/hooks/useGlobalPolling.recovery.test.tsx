import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ nodes: [] as any[], update: vi.fn(), recover: vi.fn(), history: vi.fn() }));
vi.mock('../store/canvasStore', () => ({
  persistImageJobCredentials: vi.fn().mockResolvedValue(undefined),
  useCanvasStore: Object.assign((select: any) => select({ nodes: mocks.nodes }), {
    getState: () => ({ nodes: mocks.nodes, updateNode: mocks.update, addNode: vi.fn() }),
  }),
}));
vi.mock('../services/api', () => ({ checkTaskStatus: vi.fn(), checkVideoTaskStatus: vi.fn(), findAllUrlsInObject: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('../services/accountIdentity', () => ({ getStoredAuthSessionToken: () => 'session', buildBillingIdentityHeaders: () => ({ 'X-Auth-Session': 'session' }) }));
vi.mock('../services/imageJobClient', () => ({ getImageJobOwner: vi.fn().mockResolvedValue('owner'), isTransientJobError: vi.fn(), queryImageJob: vi.fn() }));
vi.mock('../services/imageJobRequests', () => ({ listImageRequests: vi.fn().mockResolvedValue([]), removeImageRequest: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/canvasResultIdentity', () => ({ recoverCanvasResult: mocks.recover }));
vi.mock('../services/generationRecordService', () => ({ fetchGenerationRecords: mocks.history }));
vi.mock('../services/imageResultStore', () => ({ imageResultStore: {
  resultId: (owner: string, job: string, slot: number) => `result:v1:${owner}:${job}:${slot}`,
  getState: vi.fn().mockResolvedValue({ originalCached: false }),
} }));
import { useGlobalPolling } from './useGlobalPolling';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  mocks.nodes = [{ id: 'node', type: 'IMAGE', loading: false, error: false, generationOwnerId: 'owner',
    taskId: 'job-old', generationResultIndex: 0, assetId: 'result:v1:owner:job-old:0' }];
  mocks.update.mockReset();
  mocks.update.mockImplementation((id, patch) => Object.assign(mocks.nodes.find(node => node.id === id), patch));
  mocks.recover.mockReset().mockResolvedValue({ id: 'result:v1:owner:job-old:0' });
  mocks.history.mockReset().mockResolvedValue({ records: [] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [{
    task_id: 'job-old', status: 'succeeded', results: ['/api/image-job-assets/recovered.jpg'],
    preview_url: '/api/image-job-assets/preview.webp', storage_status: 'saved', completed_at: '2026-10-15T01:00:00.000Z',
  }] }) }));
});
function Probe() { useGlobalPolling(undefined, vi.fn(), vi.fn()); return null; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
}
it('restores a saved original URL when persistence removed a malformed oversized source', async () => {
  mount();
  await waitFor(() => expect(mocks.nodes[0].src).toBe('/api/image-job-assets/recovered.jpg'));
  expect(mocks.nodes[0].assetId).toBe('result:v1:owner:job-old:0');
  expect(mocks.nodes[0].thumbnailSrc).toBe('/api/image-job-assets/preview.webp');
  expect(mocks.recover).toHaveBeenCalledWith(expect.objectContaining({ id: 'node' }), expect.objectContaining({ source: '/api/image-job-assets/recovered.jpg' }));
});
it('keeps a locally edited image when its original generation is still in the recovery list', async () => {
  mocks.nodes[0].assetId = 'local-background-removed';
  mocks.nodes[0].src = '';
  mocks.nodes[0].generationResultSrc = '/old-original';
  mount();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(mocks.nodes[0].src).toBe('');
  expect(mocks.nodes[0].assetId).toBe('local-background-removed');
  expect(mocks.recover).not.toHaveBeenCalled();
});

it('backfills retained previews beyond the account API task batch limit', async () => {
  mocks.nodes = Array.from({ length: 105 }, (_, index) => ({ id: `node-${index}`, type: 'IMAGE', loading: false,
    generationOwnerId: 'owner', taskId: `job-${index}`, assetId: `result:v1:owner:job-${index}:0` }));
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) } as Response);
  mocks.history.mockImplementation(async ({ taskIds }: { taskIds: string[] }) => ({ records: taskIds.slice(0, 100).map(taskId => ({
    userId: 'owner', status: 'SUCCESS', taskId, resultUrls: [], meta: { previewUrls: [`/api/image-job-assets/${taskId}.preview.webp?token=preview.fixture`] },
  })) }));
  mount();
  await waitFor(() => expect(mocks.nodes[104].thumbnailSrc).toBe('/api/image-job-assets/job-104.preview.webp?token=preview.fixture'));
  expect(mocks.history).toHaveBeenCalledTimes(2);
  expect(mocks.history.mock.calls.map(([options]) => options.taskIds.length)).toEqual([100, 5]);
});

it('releases the recovery lock after a stalled JSON body so focus can recover again', async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) } as Response);
  try {
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.nodes[0].src).toBe('/api/image-job-assets/recovered.jpg');
  } finally { vi.useRealTimers(); }
});
