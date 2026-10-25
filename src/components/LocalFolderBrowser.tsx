import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { localFolderSave, type LocalFolderImage } from '../services/localFolderSave';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
export const DOWNLOADS_SHORTCUT = isMac ? '⌘ + Shift + J' : 'Ctrl + J';

const formatTime = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Shows the images already saved in the chosen folder. Webpages cannot open
// the folder itself, so this lists its files in the page instead.
export const LocalFolderBrowser = ({ folderName, onClose }: { folderName: string; onClose: () => void }) => {
  const [items, setItems] = useState<Array<LocalFolderImage & { url: string }> | null>(null);
  const [active, setActive] = useState<(LocalFolderImage & { url: string }) | null>(null);

  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    void localFolderSave.listImages(60).then(list => {
      if (cancelled) return;
      const withUrls = list.map(item => ({ ...item, url: URL.createObjectURL(item.file) }));
      urls = withUrls.map(item => item.url);
      setItems(withUrls);
    }).catch(() => !cancelled && setItems([]));
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') (active ? setActive(null) : onClose()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="已保存的图片" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-[#15171d] shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">已保存的图片</div>
            <div className="truncate text-xs text-gray-500">文件夹：{folderName} · 最近 60 张</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white" aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="min-h-[160px] overflow-y-auto p-4">
          {items === null && <div className="py-10 text-center text-xs text-gray-500">正在读取文件夹…</div>}
          {items?.length === 0 && <div className="py-10 text-center text-xs text-gray-500">这个文件夹里还没有图片。打开自动下载后生成的原图会保存到这里。</div>}
          {!!items?.length && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {items.map(item => (
                <button key={item.name} type="button" onClick={() => setActive(item)} className="group overflow-hidden rounded-lg border border-white/10 bg-black/30 text-left" title={item.name}>
                  <img src={item.url} alt={item.name} loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                  <div className="truncate px-1.5 py-1 text-[10px] text-gray-500">{formatTime(item.lastModified)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-white/10 px-4 py-2.5 text-[11px] text-gray-500">
          网页无法直接打开电脑上的文件夹。要在资源管理器里找到这些文件，请打开你选择的「{folderName}」文件夹。
        </div>
      </div>
      {active && (
        <div className="fixed inset-0 z-[210] flex flex-col items-center justify-center gap-3 bg-black/90 p-6" onClick={event => { event.stopPropagation(); setActive(null); }}>
          <img src={active.url} alt={active.name} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
          <div className="text-xs text-gray-400">{active.name}</div>
        </div>
      )}
    </div>
  );
};

// How to reach the browser's own downloads, which a page cannot open.
export const DownloadsHelp = ({ onClose }: { onClose: () => void }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="如何打开下载目录" onClick={onClose}>
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#15171d] p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
      <div className="text-sm font-medium text-white">如何打开下载目录</div>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-gray-300">
        <li>按 <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[11px] text-white">{DOWNLOADS_SHORTCUT}</kbd> 打开浏览器的下载列表。</li>
        <li>找到要的图片，点「在文件夹中显示」。</li>
      </ol>
      <div className="mt-3 text-[11px] leading-5 text-gray-500">网页无法替你打开电脑上的文件夹。使用 Chrome 或 Edge 电脑版时，可以在「本地存储」里选择一个保存文件夹，之后就能在网页里直接查看已保存的图片。</div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-gray-100 hover:bg-white/15">知道了</button>
      </div>
    </div>
  </div>
);
