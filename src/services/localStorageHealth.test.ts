import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageResultStore } from './imageResultStore';
import { localFolderSave } from './localFolderSave';

describe('browser storage preparation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks for persistence and sizes the original cache to 10% of the real quota', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { userAgent: 'desktop', storage: { persisted: async () => false, persist, estimate: async () => ({ quota: 20 * 1024 ** 3, usage: 0 }) } });
    const store = createImageResultStore();
    const result = await store.prepareStorage();
    expect(persist).toHaveBeenCalled();
    expect(result.persisted).toBe(true);
    expect(result.budgetBytes).toBe(2 * 1024 ** 3);
    store.close();
  });

  it('keeps the fixed default when the quota is small and caps large quotas', async () => {
    vi.stubGlobal('navigator', { userAgent: 'desktop', storage: { persisted: async () => true, estimate: async () => ({ quota: 1024 ** 3 }) } });
    const small = createImageResultStore();
    expect((await small.prepareStorage()).budgetBytes).toBe(384 * 1024 * 1024);
    small.close();
    vi.stubGlobal('navigator', { userAgent: 'desktop', storage: { persisted: async () => true, estimate: async () => ({ quota: 500 * 1024 ** 3 }) } });
    const large = createImageResultStore();
    expect((await large.prepareStorage()).budgetBytes).toBe(4096 * 1024 * 1024);
    large.close();
  });

  it('never adapts an explicit budget', async () => {
    vi.stubGlobal('navigator', { userAgent: 'desktop', storage: { persisted: async () => true, estimate: async () => ({ quota: 50 * 1024 ** 3 }) } });
    const store = createImageResultStore({ budgetBytes: 14 });
    expect((await store.prepareStorage()).budgetBytes).toBe(14);
    store.close();
  });
});

describe('local folder save', () => {
  it('falls back to a normal download when no folder is chosen', async () => {
    expect(await localFolderSave.saveBlob(new Blob(['x'], { type: 'image/png' }), 'a.png')).toBeNull();
    const status = await localFolderSave.getStatus();
    expect(['none', 'unsupported']).toContain(status.state);
  });

  it('lists nothing (and never prompts) when no folder is chosen', async () => {
    expect(await localFolderSave.listImages(10)).toEqual([]);
  });
});
