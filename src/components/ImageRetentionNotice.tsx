import React from 'react';
import { CloudDownload, Zap } from 'lucide-react';
import { useStorageMode } from './StorageModeSelector';
import { useSelectionStore } from '../store/selectionStore';
import { getSelectedImageRoute } from '../config/imageRoutes';

// The cloud copy depends on the transfer mode: standard keeps the original for
// 4 hours; fast keeps none, but only on lines that return upstream links.
export function ImageRetentionNotice({ className = '' }: { className?: string }) {
  const [mode] = useStorageMode();
  const { imageModel, imageLine } = useSelectionStore();
  const fast = mode === 'fast' && getSelectedImageRoute(imageModel, imageLine)?.resultKind === 'url';
  const Icon = fast ? Zap : CloudDownload;
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-[11px] leading-5 text-amber-200/90 ${className}`}>
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {fast ? (
        <span>已开启极速：原图<strong className="font-semibold">不在云端保存</strong>，从上游直接下载，请及时保存到本地；预览保留 30 天，生成记录长期保留。</span>
      ) : (
        <span>原图云端仅保留 <strong className="font-semibold">4 小时</strong>，请尽快下载到本地；预览保留 30 天，生成记录长期保留。</span>
      )}
    </div>
  );
}
