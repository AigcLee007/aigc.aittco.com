import { useEffect, useState } from 'react';
import { imageResultStore, type ImageStorageMode } from '../services/imageResultStore';

export const STORAGE_MODE_OPTIONS: Array<{ value: ImageStorageMode; label: string; description: string }> = [
  { value: 'auto', label: '自动', description: '服务器暂存原图 5 小时，作为稳定兜底' },
  { value: 'stable', label: '稳定优先', description: '全部经本站服务器中转，适合上游链接打不开时' },
  { value: 'speed', label: '速度优先', description: '优先从上游直接下载，服务器只保留预览；链接过期后只能用已下载的本地文件' },
];

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

export const StorageModeSelector = () => {
  const [mode, setMode] = useStorageMode();
  const current = STORAGE_MODE_OPTIONS.find(option => option.value === mode) || STORAGE_MODE_OPTIONS[0];
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
      <div className="text-sm text-gray-200 font-medium" id="storage-mode-label">图片传输方式</div>
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="storage-mode-label">
        {STORAGE_MODE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${mode === option.value ? 'bg-blue-500/80 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-gray-500 mt-2">{current.description}。仅对之后生成的图片生效，部分线路只返回图片数据，会照常经本站传输。</div>
    </div>
  );
};
