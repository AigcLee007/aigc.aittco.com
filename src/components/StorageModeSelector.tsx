import { useEffect, useState } from 'react';
import { imageResultStore, type ImageStorageMode } from '../services/imageResultStore';

export const useStorageMode = (): [ImageStorageMode, (mode: ImageStorageMode) => void] => {
  const [mode, setMode] = useState<ImageStorageMode>(() => imageResultStore.getStorageModePreference());
  useEffect(() => {
    // Classic and canvas share one preference; keep this view in sync with either.
    const sync = () => setMode(imageResultStore.getStorageModePreference());
    window.addEventListener('image-storage-mode-change', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('image-storage-mode-change', sync); window.removeEventListener('storage', sync); };
  }, []);
  return [mode, next => imageResultStore.setStorageModePreference(next)];
};

const FAST_TITLE = '从上游直接下载原图，本站只保留预览；链接过期后只能用已下载的本地文件';
const UNSUPPORTED_TITLE = '此线路返回图片数据，固定经本站传输';

// Fast transfer only changes anything on lines that return upstream links,
// so it is shown next to the line and disabled where it would have no effect.
export const TransferModeToggle = ({ supported }: { supported: boolean }) => {
  const [mode, setMode] = useStorageMode();
  const active = supported && mode === 'fast';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label="极速传输"
      disabled={!supported}
      onClick={() => setMode(active ? 'standard' : 'fast')}
      title={supported ? FAST_TITLE : UNSUPPORTED_TITLE}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-yellow-400/60 bg-yellow-400/15 text-yellow-200' : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
      }`}
    >
      <span aria-hidden="true">⚡</span>
      极速{supported ? (active ? ' · 开' : ' · 关') : ' · 此线路不支持'}
    </button>
  );
};
