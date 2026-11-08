import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Info, X } from 'lucide-react';
import type { NodeData } from '../types';
import { formatFullTime } from '../src/utils/timeFormat';

type ImageInfo = Pick<NodeData, 'generationInfo' | 'prompt' | 'createdAt'>;

export function imageSourceLabel(image: ImageInfo) {
  if (image.generationInfo?.source === 'uploaded') return '用户上传';
  if (image.generationInfo?.source === 'processed') return '图片处理结果';
  return image.generationInfo?.source === 'generated' ? 'AI 图片' : '图片';
}

export function ImageGenerationDetails({ image, compact = false }: { image: ImageInfo; compact?: boolean }) {
  const info = image.generationInfo;
  const [copyStatus, setCopyStatus] = useState('');
  const showGeneration = !info || info.source === 'generated';
  const copy = async (label: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopyStatus(`已复制${label}`); }
    catch { setCopyStatus('复制失败，请选中文字复制'); }
  };
  const rows = [
    ...(!compact ? [['来源', imageSourceLabel(image)]] : []),
    ...(showGeneration ? [['模型', info?.modelName || '未记录'], ['线路', info?.routeLabel || '未记录']] : []),
    ...(info?.outputSize ? [['输出尺寸', info.outputSize]] : []),
    ...(info?.aspectRatio ? [['画面比例', info.aspectRatio]] : []),
    [info?.source === 'uploaded' ? '导入时间' : info?.source === 'processed' ? '处理时间' : '生成时间', formatFullTime(image.createdAt) || '未记录'],
  ];
  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      <dl className={compact ? 'space-y-2' : 'space-y-4'}>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3">
            <dt className="shrink-0 text-gray-500" style={{ width: compact ? 52 : 64 }}>{label}</dt>
            <dd className="min-w-0 flex-1 m-0 flex items-start gap-2 text-gray-200">
              <span className={`min-w-0 flex-1 break-words select-text ${compact ? 'line-clamp-2' : 'whitespace-pre-wrap'}`} style={{ overflowWrap: 'anywhere' }}>{value}</span>
              {!compact && value !== '未记录' && (label === '模型' || label === '线路') && (
                <button type="button" aria-label={`复制${label}名称`} onClick={() => void copy(label, value)} className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-white">
                  {copyStatus === `已复制${label}` ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {(!compact || image.prompt) && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-1 text-gray-500">提示词</div>
          <p className={`m-0 text-gray-300 leading-relaxed break-words select-text ${compact ? 'line-clamp-4' : 'whitespace-pre-wrap'}`} style={{ overflowWrap: 'anywhere' }}>{image.prompt || '未记录'}</p>
        </div>
      )}
      {!compact && <div role="status" className="mt-3 text-xs text-gray-400">{copyStatus}</div>}
    </div>
  );
}

function ImageInfoDialog({ image, onClose }: { image: ImageInfo; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKey = (event: KeyboardEvent) => {
      // Keep browser text selection/copy, but do not let canvas shortcuts see
      // Delete, undo, copy, or tool keys while this modal is open.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab' && dialog) {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={event => event.stopPropagation()}
        className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-white/10 bg-[#18181b] text-white shadow-2xl outline-none">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#18181b] px-5 py-4">
          <h2 id={titleId} className="m-0 text-base font-medium">图片信息</h2>
          <button type="button" aria-label="关闭图片信息" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5"><ImageGenerationDetails image={image} /></div>
      </div>
    </div>, document.body,
  );
}

export function ImageInfoButton({ image, className, iconOnly = false }: { image: ImageInfo; className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="信息" title="图片信息" onClick={() => setOpen(true)}
      className={className || 'flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-200 hover:bg-white/10'}>
      <Info size={16} aria-hidden="true" />{!iconOnly && '信息'}
    </button>
    {open && <ImageInfoDialog image={image} onClose={() => setOpen(false)} />}
  </>;
}
