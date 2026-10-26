import React, { useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { UpscaleForm, type UpscaleChoice } from './UpscaleForm';

interface UpscaleDialogProps {
  /** Pixel size of the image being upscaled, read from the real file. */
  width: number;
  height: number;
  onConfirm: (choice: { engine: string; factor: number; format: string | null; engineLabel: string }) => void;
  onCancel: () => void;
}

export const UpscaleDialog: React.FC<UpscaleDialogProps> = ({ width, height, onConfirm, onCancel }) => {
  const [choice, setChoice] = useState<UpscaleChoice | null>(null);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="upscale-title" onClick={onCancel}>
      <div className="max-h-[92vh] w-[min(92vw,440px)] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-5 text-gray-200 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="upscale-title" className="flex items-center gap-2 text-base font-semibold text-white">
            <Maximize2 size={18} aria-hidden="true" /> 高清放大
          </h2>
          <button type="button" onClick={onCancel} aria-label="关闭" className="rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-xs text-gray-400">当前图片 {width} × {height}</p>

        <UpscaleForm width={width} height={height} onChange={setChoice} />

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-gray-300 hover:bg-white/10">取消</button>
          <button
            type="button"
            disabled={!choice}
            onClick={() => choice && onConfirm({ engine: choice.engine, factor: choice.factor, format: choice.format, engineLabel: choice.engineLabel })}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {choice ? `确认放大 · ${choice.quote.points} 金币` : '确认放大'}
          </button>
        </div>
      </div>
    </div>
  );
};
