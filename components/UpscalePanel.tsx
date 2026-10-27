import React, { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, Maximize2, X } from 'lucide-react';
import { UpscaleForm, type UpscaleChoice } from './ContextSatellite/UpscaleForm';
import { submitUpscale } from '../src/services/upscaleApi';
import { blobToDataUrl } from '../src/services/imageBlobUtils';
import { imageDimensions } from '../src/services/imageDimensions';
import { useCanvasStore } from '../src/store/canvasStore';
import type { NodeData } from '../types';

// Matches what the server reads (30 MB). Larger files would be refused after a slow upload.
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

interface UpscalePanelProps {
  onInitGenerations: (count: number, prompt: string, aspectRatio?: string, baseNode?: NodeData, type?: 'IMAGE' | 'VIDEO') => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string, taskId?: string) => void;
  /** An image already chosen on the canvas, offered as the starting picture. */
  selectedNode?: NodeData | null;
  /** Reads the original of a canvas node (so a result is upscaled from its real file, not a preview). */
  readNode: (node: NodeData) => Promise<Blob>;
}

interface Picked { blob: Blob; dataUrl: string; width: number; height: number; name: string; fromNode: NodeData | null }

// The "高清放大" page of the control panel. It works on any picture: one already on the canvas, or one
// dropped / chosen from the computer. The result lands on the canvas as a new image next to it.
export const UpscalePanel: React.FC<UpscalePanelProps> = ({ onInitGenerations, onUpdateGeneration, selectedNode, readNode }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [choice, setChoice] = useState<UpscaleChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async (blob: Blob, name: string, fromNode: NodeData | null) => {
    setError('');
    if (blob.type && !ACCEPTED.includes(blob.type)) { setError('请使用 PNG、JPG 或 WebP 格式的图片'); return; }
    if (blob.size > MAX_FILE_BYTES) { setError('图片文件超过 30MB，请压缩后再试'); return; }
    setBusy(true);
    try {
      const size = await imageDimensions(blob);
      if (!size) throw new Error('无法识别这张图片，请换一张再试');
      setChoice(null);
      setPicked({ blob, dataUrl: await blobToDataUrl(blob), width: size.width, height: size.height, name, fromNode });
    } catch (err: any) {
      setError(err?.message || '图片读取失败，请重试');
    } finally { setBusy(false); }
  }, []);

  const useSelected = useCallback(async () => {
    if (!selectedNode) return;
    setBusy(true); setError('');
    try { await load(await readNode(selectedNode), selectedNode.name || '画布上的图片', selectedNode); }
    catch (err: any) { setError(err?.message || '读取原图失败，请稍后重试'); setBusy(false); }
  }, [selectedNode, readNode, load]);

  const onFiles = useCallback((files: FileList | File[] | null) => {
    const file = files && Array.from(files).find((item) => item.type.startsWith('image/'));
    if (!file) { setError('请选择一张图片'); return; }
    void load(file, file.name, null);
  }, [load]);

  const submit = () => {
    if (!picked || !choice) return;
    const { dataUrl, fromNode } = picked;
    // A picture from the canvas gets its result beside it; a local file starts a new image.
    const [placeholderId] = onInitGenerations(1, fromNode?.prompt || '高清放大', 'Smart', fromNode || undefined);
    if (fromNode) {
      useCanvasStore.getState().updateNode(placeholderId, {
        sourceNodeId: fromNode.id,
        upscaleOf: { sourceNodeId: fromNode.id, engineLabel: choice.engineLabel, factor: choice.factor },
      }, true);
    } else {
      useCanvasStore.getState().updateNode(placeholderId, { width: Math.min(512, picked.width), height: Math.round(Math.min(512, picked.width) * picked.height / picked.width) }, true);
    }
    submitUpscale({ image: dataUrl, engine: choice.engine, factor: choice.factor, format: choice.format, clientLiveTaskIds: [placeholderId] })
      .then((result) => onUpdateGeneration(placeholderId, null, undefined, result.taskId))
      .catch((err) => onUpdateGeneration(placeholderId, null, err?.message || '高清放大失败'));
    // Keep the picture so another engine or scale can be tried without choosing it again.
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-200">要放大的图片</span>
          {picked && (
            <button type="button" onClick={() => { setPicked(null); setChoice(null); setError(''); }} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white">
              <X size={12} aria-hidden="true" /> 更换
            </button>
          )}
        </div>

        {!picked ? (
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); onFiles(event.dataTransfer.files); }}
            className={`flex flex-col items-center gap-2.5 rounded-2xl border border-dashed px-4 py-7 text-center transition-colors ${dragging ? 'border-yellow-300 bg-yellow-300/15' : 'border-yellow-300/30 bg-linear-to-b from-yellow-300/[0.07] to-white/[0.02]'}`}
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-linear-to-br from-yellow-300/25 to-orange-400/5 text-yellow-300 shadow-[inset_0_0_0_1px_rgba(253,224,71,0.3),0_10px_26px_rgba(250,204,21,0.12)]">
              {busy ? <Loader2 size={24} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={26} aria-hidden="true" />}
            </span>
            <p className="text-sm font-bold text-white">把图片拖到这里，或</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="rounded-full bg-linear-to-r from-yellow-300 to-orange-400 px-4 py-1.5 text-xs font-bold text-black shadow-[0_6px_18px_rgba(250,204,21,0.25)] hover:brightness-110 disabled:opacity-50">从电脑选择</button>
              {selectedNode && selectedNode.type === 'IMAGE' && (selectedNode.src || selectedNode.assetId) && !selectedNode.loading && (
                <button type="button" disabled={busy} onClick={() => void useSelected()} className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50">用画布上选中的图</button>
              )}
            </div>
            <p className="text-[11px] text-gray-500">支持 PNG、JPG、WebP，单张不超过 30MB</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
            <img src={picked.dataUrl} alt="待放大的图片预览" className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover shadow-lg" />
            <div className="min-w-0 text-xs">
              <div className="truncate text-gray-200">{picked.name}</div>
              <div className="mt-0.5 text-gray-400">{picked.width} × {picked.height}</div>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { onFiles(event.target.files); event.target.value = ''; }} />
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {picked && <UpscaleForm width={picked.width} height={picked.height} onChange={setChoice} />}

      <button
        type="button"
        disabled={!picked || !choice}
        onClick={submit}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-yellow-300 to-orange-400 py-3.5 text-sm font-black text-black shadow-[0_10px_30px_rgba(250,204,21,0.3)] transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        <Maximize2 size={16} aria-hidden="true" />
        {choice ? `开始放大 · ${choice.quote.points} 金币` : '开始放大'}
      </button>
    </div>
  );
};
