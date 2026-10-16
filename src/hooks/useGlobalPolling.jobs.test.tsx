import React from 'react';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ nodes: [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'job-a', error: false }], query: vi.fn(), update: vi.fn() }));
vi.mock('../store/canvasStore', () => ({ useCanvasStore: Object.assign((select: any) => select({ nodes: mocks.nodes }), { getState: () => ({ nodes: mocks.nodes, updateNode: mocks.update, addNode: mocks.update, generateId: () => 'new' }) }) }));
vi.mock('../services/api', () => ({ checkTaskStatus: mocks.query, checkVideoTaskStatus: mocks.query, findAllUrlsInObject: (data: any, urls: string[]) => { for (const item of data.data || []) if (item.url) urls.push(item.url); } }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('../services/accountIdentity', () => ({ getStoredAuthSessionToken: () => null, buildBillingIdentityHeaders: () => ({}) }));
import { useGlobalPolling } from './useGlobalPolling';
afterEach(cleanup);
beforeEach(() => { mocks.query.mockReset(); mocks.update.mockReset(); mocks.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'job-a', error: false }]; });
function Probe({ updated }: { updated: (id: string, src: string | null, error?: string) => void }) { useGlobalPolling(undefined, updated, vi.fn()); return null; }
it('temporary browser disconnection keeps a task recoverable instead of failing its node', async () => {
  Object.assign(mocks.nodes[0], { generationStartedAt: Date.now() - 31 * 60_000 });
  mocks.query.mockRejectedValue(new TypeError('Failed to fetch'));
  const updated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(mocks.query).toHaveBeenCalled());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  expect(updated).not.toHaveBeenCalled();
});
it('confirmed upstream failure still marks the node failed', async () => {
  mocks.query.mockResolvedValue({ status: 'failed', error: 'upstream504' });
  const updated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(updated).toHaveBeenCalledWith('node', null, 'upstream504'));
});
it('a refused recovered admission stops the placeholder and shows the user queue message', async () => {
  mocks.nodes[0].taskId = 'request-full';
  mocks.query.mockRejectedValue(Object.assign(new Error('请等待部分完成'), { status: 429, code: 'USER_QUEUE_FULL' }));
  const updated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(updated).toHaveBeenCalledWith('node', null, '请等待部分完成'));
});
it('a completed generation with failed image storage is not turned into a generation failure', async () => {
  mocks.query.mockResolvedValue({ status: 'succeeded', images: [], storage_status: 'failed' });
  const updated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('node', expect.objectContaining({ error: false, loading: false, generationConnectionStatus: 'result-unavailable' }), true));
  expect(updated).not.toHaveBeenCalled();
});
it('a completed request lookup promotes its real job ID before finishing the node', async () => {
  mocks.nodes[0].taskId = 'request-req-a';
  mocks.query.mockResolvedValue({ task_id: 'job-real-a', request_id: 'req-a', status: 'succeeded', images: ['/original.png'] });
  mocks.update.mockImplementation((_id, patch) => Object.assign(mocks.nodes[0], patch));
  const updated = vi.fn(() => {
    expect(mocks.nodes[0].taskId).toBe('job-real-a');
    mocks.nodes[0].loading = false;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(updated).toHaveBeenCalledWith('node', '/original.png'));
  expect(mocks.nodes[0].taskId).toBe('job-real-a');
});
it('real job polling does not complete a request alias again while its completion callback is pending', async () => {
  mocks.nodes[0].taskId = 'request-req-a';
  mocks.query.mockResolvedValue({ task_id: 'job-real-a', status: 'succeeded', images: ['/remote.png'] });
  mocks.update.mockImplementation((_id, patch) => Object.assign(mocks.nodes[0], patch));
  const updated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
  mocks.query.mockResolvedValue({ task_id: 'job-real-a', status: 'succeeded', images: ['/saved.png'] });
  view.rerender(<QueryClientProvider client={client}><Probe updated={updated} /></QueryClientProvider>);
  await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(updated).toHaveBeenCalledTimes(1);
});
