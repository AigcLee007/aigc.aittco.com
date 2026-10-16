import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGenerationRecords, clearGenerationRecords, type GenerationRecord } from '../services/generationRecordService';
import { useAccountGenerationHistory } from './useAccountGenerationHistory';

vi.mock('../services/generationRecordService', () => ({ fetchGenerationRecords: vi.fn(), clearGenerationRecords: vi.fn() }));
const record = (id: string, userId = 'owner'): GenerationRecord => ({
  id, userId, taskId: `job-${id}`, status: 'SUCCESS', mediaType: 'IMAGE', prompt: id,
  resultUrls: [`/expired/${id}.png`], previewUrl: `/permanent/${id}.webp`, createdAt: '2020-01-01T00:00:00Z',
} as GenerationRecord);
const page = (records: GenerationRecord[], number = 1, totalPages = 1) => ({ success: true, records, page: number, pageSize: 50, totalPages, total: records.length });

beforeEach(() => { vi.resetAllMocks(); localStorage.setItem('auth-session-v1', 'session-one'); });

describe('account history independent of browser image cache', () => {
  it('loads old account records with permanent previews when local history is empty, and pages older records', async () => {
    vi.mocked(fetchGenerationRecords).mockResolvedValueOnce(page([record('first')], 1, 2)).mockResolvedValueOnce(page([record('older')], 2, 2));
    const { result } = renderHook(() => useAccountGenerationHistory({ enabled: true, ownerId: 'owner', mediaType: 'image', localLogs: [] }));
    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(result.current.logs[0]).toMatchObject({ prompt: 'first', thumbnailUrl: '/permanent/first.webp' });
    expect(result.current.hasMore).toBe(true);
    await act(async () => result.current.loadMore());
    expect(result.current.logs).toHaveLength(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('retains visible records on a failed refresh and reports the failure', async () => {
    vi.mocked(fetchGenerationRecords).mockResolvedValueOnce(page([record('first')])).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAccountGenerationHistory({ enabled: true, ownerId: 'owner', mediaType: 'image', localLogs: [] }));
    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    await act(async () => result.current.refresh());
    expect(result.current.logs).toHaveLength(1);
    expect(result.current.error).toBeTruthy();
  });

  it('discards a late previous-session response after an account switch', async () => {
    let complete!: (value: ReturnType<typeof page>) => void;
    vi.mocked(fetchGenerationRecords).mockReturnValueOnce(new Promise(resolve => { complete = resolve; })).mockResolvedValue(page([record('new', 'other')]));
    const { result, rerender } = renderHook(({ ownerId }) => useAccountGenerationHistory({ enabled: true, ownerId, mediaType: 'image', localLogs: [] }), { initialProps: { ownerId: 'owner' } });
    localStorage.setItem('auth-session-v1', 'session-two');
    act(() => window.dispatchEvent(new Event('auth-session-change')));
    rerender({ ownerId: 'other' });
    await waitFor(() => expect(result.current.logs[0]?.prompt).toBe('new'));
    await act(async () => complete(page([record('old')])));
    expect(result.current.logs.map(log => log.prompt)).toEqual(['new']);
  });

  it('keeps every output preview and record even if original URLs are truncated or absent', async () => {
    const multiple = { ...record('multi'), resultUrls: ['/expired/one.png', 'data:image/png;base64,x[truncated]'], meta: { previewUrls: ['/permanent/one.webp', '/permanent/two.webp'] } };
    vi.mocked(fetchGenerationRecords).mockResolvedValue(page([multiple, { ...record('no-bytes'), resultUrls: [], previewUrl: null }]));
    const { result } = renderHook(() => useAccountGenerationHistory({ enabled: true, ownerId: 'owner', mediaType: 'image', localLogs: [] }));
    await waitFor(() => expect(result.current.logs).toHaveLength(3));
    expect(result.current.logs.find(log => log.thumbnailUrl === '/permanent/two.webp')?.imageUrl).toBe('');
    expect(result.current.logs.find(log => log.prompt === 'no-bytes')).toBeTruthy();
  });

  it('clears account history only on explicit invocation', async () => {
    vi.mocked(fetchGenerationRecords).mockResolvedValue(page([record('first')]));
    vi.mocked(clearGenerationRecords).mockResolvedValue({ success: true, removed: 1 });
    const { result } = renderHook(() => useAccountGenerationHistory({ enabled: true, ownerId: 'owner', mediaType: 'image', localLogs: [] }));
    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(clearGenerationRecords).not.toHaveBeenCalled();
    await act(async () => result.current.clearAccountHistory());
    expect(clearGenerationRecords).toHaveBeenCalledWith({ mediaType: 'all' });
    expect(result.current.logs).toEqual([]);
  });
});
