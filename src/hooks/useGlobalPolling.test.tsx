import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalPolling } from './useGlobalPolling';

const state = vi.hoisted(() => ({ nodes: [] as any[], toast: vi.fn(), query: vi.fn(), updateNode: vi.fn() }));
vi.mock('../store/canvasStore', () => ({ useCanvasStore: (select: any) => select(state) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: state.toast }) }));
vi.mock('../services/api', () => ({
  checkTaskStatus: (...args: any[]) => state.query(...args),
  checkVideoTaskStatus: (...args: any[]) => state.query(...args),
  findAllUrlsInObject: (data: any, urls: string[]) => { if (data.url) urls.push(data.url); },
}));

afterEach(() => { vi.clearAllMocks(); });

function mount() {
  const update = vi.fn();
  const progress = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useGlobalPolling(undefined, update, progress), { wrapper });
  return { update, progress, client, close: () => { hook.unmount(); client.clear(); } };
}

describe('image task terminal states', () => {
  it('ends loading when success has no usable image instead of stopping silently', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'task', generationStartedAt: Date.now() }];
    state.query.mockResolvedValue({ status: 'succeeded' });
    const h = mount();
    try {
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('node', null, expect.stringContaining('图片')));
    } finally { h.close(); }
  });

  it('ends an image task that has exceeded its total waiting window', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'task', generationStartedAt: Date.now() - 31 * 60000 }];
    state.query.mockResolvedValue({ status: 'processing' });
    const h = mount();
    try {
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('node', null, expect.stringContaining('结果未确认')));
    } finally { h.close(); }
  });

  it('expires a restored submission even when no task ID was received', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, generationStartedAt: Date.now() - 31 * 60000 }];
    const h = mount();
    try {
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('node', null, expect.stringContaining('结果未确认')));
      expect(state.query).not.toHaveBeenCalled();
    } finally { h.close(); }
  });
});

describe('canvas task progress', () => {
  it('delivers intermediate progress even when the task status stays processing', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'task', generationStartedAt: Date.now() }];
    state.query.mockResolvedValue({ status: 'processing', data: { progress: '25%' } });
    const h = mount();
    try {
      await waitFor(() => expect(h.progress).toHaveBeenCalledWith('node', 25, 'reported'));
      state.query.mockResolvedValue({ status: 'processing', data: { progress: '65%' } });
      await h.client.refetchQueries({ queryKey: ['task', 'task'] });
      await waitFor(() => expect(h.progress).toHaveBeenCalledWith('node', 65, 'reported'));
      expect(h.update).not.toHaveBeenCalled();
    } finally { h.close(); }
  });

  it('shares task queries and updates each placeholder from one upstream response', async () => {
    state.nodes = ['one', 'two'].map(id => ({ id, type: 'IMAGE', loading: true, taskId: 'shared', generationStartedAt: Date.now() }));
    state.query.mockResolvedValue({ data: { status: 'queued', progress: 35 } });
    const h = mount();
    try {
      await waitFor(() => expect(h.progress).toHaveBeenCalledTimes(2));
      expect(state.query).toHaveBeenCalledTimes(1);
      expect(h.progress).toHaveBeenCalledWith('one', 35, 'reported');
      expect(h.progress).toHaveBeenCalledWith('two', 35, 'reported');
      expect(state.updateNode).toHaveBeenCalledWith('one', { generationStatus: 'QUEUED' }, true);
    } finally { h.close(); }
  });

  it('does not forward placeholder zero or failed 100 as generation progress', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'task', generationStartedAt: Date.now() }];
    state.query.mockResolvedValue({ status: 'processing', progress: 0 });
    const h = mount();
    try {
      await waitFor(() => expect(state.query).toHaveBeenCalled());
      state.query.mockResolvedValue({ status: 'failed', progress: 100, error: 'upstream failed' });
      await h.client.refetchQueries({ queryKey: ['task', 'task'] });
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('node', null, expect.any(String)));
      expect(h.progress).not.toHaveBeenCalled();
    } finally { h.close(); }
  });

  it('does not send duplicate or regressing upstream progress to storage', async () => {
    state.nodes = [{ id: 'node', type: 'IMAGE', loading: true, taskId: 'task', generationStartedAt: Date.now(), generationStatus: 'PROCESSING', progress: 65, progressSource: 'reported' }];
    state.query.mockResolvedValue({ status: 'processing', progress: 65 });
    const h = mount();
    try {
      await waitFor(() => expect(state.query).toHaveBeenCalled());
      state.query.mockResolvedValue({ status: 'processing', progress: 40 });
      await h.client.refetchQueries({ queryKey: ['task', 'task'] });
      expect(h.progress).not.toHaveBeenCalled();
      expect(state.updateNode).not.toHaveBeenCalled();
    } finally { h.close(); }
  });
});
