import { useCallback, useEffect, useState } from 'react';
import { imageResultStore, type ImageStorageSummary } from '../services/imageResultStore';
import { localFolderSave, type LocalFolderState } from '../services/localFolderSave';

const formatBytes = (bytes: number | null | undefined) => {
  if (!Number.isFinite(Number(bytes))) return '—';
  const value = Number(bytes);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
};

// Where this browser keeps originals: its own cache (sized to the real quota,
// protected from eviction when the browser agrees) and, on Chrome / Edge
// desktop, a folder the user picks so originals land on their own disk.
export const LocalStoragePanel = () => {
  const [summary, setSummary] = useState<ImageStorageSummary | null>(null);
  const [folder, setFolder] = useState<{ state: LocalFolderState; name: string }>({ state: 'none', name: '' });
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const [next, status] = await Promise.all([
      imageResultStore.getStorageSummary().catch(() => null),
      localFolderSave.getStatus().catch(() => ({ state: 'none' as LocalFolderState, name: '' })),
    ]);
    setSummary(next);
    setFolder(status);
  }, []);

  useEffect(() => {
    void refresh();
    return localFolderSave.subscribe(() => void refresh());
  }, [refresh]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    try { await work(); setMessage(done); }
    catch (error: any) { if (error?.name !== 'AbortError') setMessage(error?.message || '操作失败，请重试'); }
    void refresh();
  };

  const usedPercent = summary?.budgetBytes ? Math.min(100, Math.round((summary.originalBytes / summary.budgetBytes) * 100)) : 0;

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-3" aria-label="本地存储">
      <div>
        <div className="text-sm text-gray-200 font-medium">本地存储</div>
        <div className="text-xs text-gray-500 mt-1">
          原图缓存 {formatBytes(summary?.originalBytes)} / {formatBytes(summary?.budgetBytes)}（{summary?.cachedOriginals ?? 0} 张）
          {summary?.persisted === true ? ' · 已受浏览器保护，不会被自动清理' : summary?.persisted === false ? ' · 浏览器空间紧张时可能被清理' : ''}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100} aria-label="原图缓存占用">
          <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${usedPercent}%` }} />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs text-gray-400">
          {folder.state === 'unsupported' && '保存到本地文件夹需要 Chrome 或 Edge 桌面版，当前使用浏览器默认下载。'}
          {folder.state === 'none' && '选择一个文件夹后，自动下载的原图会直接保存到这里。'}
          {folder.state === 'granted' && <>自动下载保存到：<span className="text-gray-200">{folder.name}</span></>}
          {(folder.state === 'prompt' || folder.state === 'denied') && <>文件夹「<span className="text-gray-200">{folder.name}</span>」需要重新授权，授权前使用浏览器默认下载。</>}
        </div>
        {folder.state !== 'unsupported' && (
          <div className="flex shrink-0 gap-2">
            {(folder.state === 'prompt' || folder.state === 'denied') && (
              <button type="button" onClick={() => run(() => localFolderSave.requestAccess(), '已重新授权')} className="rounded-lg bg-blue-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
                重新授权
              </button>
            )}
            <button type="button" onClick={() => run(() => localFolderSave.chooseFolder(), '已设置保存文件夹')} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10">
              {folder.state === 'none' ? '选择文件夹' : '更换'}
            </button>
            {folder.state !== 'none' && (
              <button type="button" onClick={() => run(() => localFolderSave.forgetFolder(), '已改回浏览器默认下载')} className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-white/5 hover:text-gray-200">
                停用
              </button>
            )}
          </div>
        )}
      </div>
      {message && <div className="text-xs text-emerald-300/80" role="status">{message}</div>}
    </div>
  );
};
