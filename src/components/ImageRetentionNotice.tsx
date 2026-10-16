import React from 'react';
import { CloudDownload } from 'lucide-react';

export function ImageRetentionNotice({ className = '' }: { className?: string }) {
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-[11px] leading-5 text-amber-200/90 ${className}`}>
      <CloudDownload size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>原图云端仅保留 <strong className="font-semibold">4 小时</strong>，请尽快下载到本地；预览和生成记录长期保留。</span>
    </div>
  );
}
