import React, { useMemo, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { X, Eraser, Trash2, Loader2, Sparkles, Move, Undo2, Brush, Banana } from 'lucide-react';
import { ToolMode } from '../types';
import { useSelectionStore } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import { renderMaskToDataURL } from '../src/utils/imageUtils';
import { editImageApi } from '../src/services/api';
import { useGenerationLogic } from '../src/hooks/useGenerationLogic';
import ModelSelector, { ModelOption } from './ModelSelector';

type MaskMode = 'transparent' | 'binary';
type InpaintModelValue = 'nano-banana-2-4k' | 'nano-banana-2-2k' | 'gemini-3.1-flash-image-preview-4k';

const INPAINT_MODELS: Array<{
  value: InpaintModelValue;
  label: string;
  imageSize: '2K' | '4K';
  cost: number;
  icon: React.ReactNode;
}> = [
  {
    value: 'nano-banana-2-4k',
    label: 'Nano Banana Pro (4K)',
    imageSize: '4K',
    cost: 5,
    icon: <Banana size={14} className="text-yellow-400" />,
  },
  {
    value: 'nano-banana-2-2k',
    label: 'Nano Banana Pro (2K)',
    imageSize: '2K',
    cost: 5,
    icon: <Banana size={14} className="text-yellow-400" />,
  },
  {
    value: 'gemini-3.1-flash-image-preview-4k',
    label: 'Nano Banana 2 (4K)',
    imageSize: '4K',
    cost: 2.5,
    icon: <Sparkles size={14} className="text-yellow-300" />,
  },
];

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取原图尺寸，请检查图片是否可访问'));
    img.src = src;
  });
};

export const InpaintWindow: React.FC = () => {
  const {
    isInpaintWindowOpen,
    setInpaintWindowOpen,
    toolMode,
    setToolMode,
    selectedIds,
    apiKey,
    prompt,
    setPrompt,
    quantity,
    setQuantity,
    brushSize,
    setBrushSize,
    brushColor,
    setBrushColor,
  } = useSelectionStore();

  const { nodes, updateNode } = useCanvasStore();
  const { handleInitGenerations: onInitGenerations, handleUpdateGeneration: onUpdateGeneration } = useGenerationLogic();

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskMode>('transparent');
  const [inpaintModel, setInpaintModel] = useState<InpaintModelValue>('nano-banana-2-4k');

  const panelRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 20, y: 20 });

  const selectedNode = useMemo(
    () => (selectedIds.length === 1 ? nodes.find((n) => n.id === selectedIds[0]) : null),
    [selectedIds, nodes],
  );
  const isImageSelected = selectedNode?.type === 'IMAGE' && !selectedNode.loading;
  const hasStrokes = !!(selectedNode?.maskStrokes && selectedNode.maskStrokes.length > 0);

  const modelOptions: ModelOption[] = useMemo(
    () =>
      INPAINT_MODELS.map((m) => ({
        value: m.value,
        label: m.label,
        cost: m.cost,
        icon: m.icon,
      })),
    [],
  );

  if (!isInpaintWindowOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return setError('请输入重绘提示词');
    if (!apiKey.trim()) return setError('请先在设置中输入 API Key');
    if (!selectedNode || !selectedNode.src || !hasStrokes) {
      return setError('请先在画布图片上涂抹遮罩区域后再提交');
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const selectedModelConfig = INPAINT_MODELS.find((m) => m.value === inpaintModel) || INPAINT_MODELS[0];
      const reqModelName = selectedModelConfig.value;
      const reqImageSize = selectedModelConfig.imageSize;
      const effectiveRatio = '1:1';
      const strokeSnapshot = [...(selectedNode.maskStrokes || [])];

      const safeSource = selectedNode.src.startsWith('http')
        ? `/api/proxy/image?url=${encodeURIComponent(selectedNode.src)}`
        : selectedNode.src;
      const img = await loadImage(safeSource);
      const intrinsicWidth = img.naturalWidth;
      const intrinsicHeight = img.naturalHeight;

      const useBinaryMask = maskMode === 'binary';
      const maskDataUrl = renderMaskToDataURL(
        null,
        intrinsicWidth,
        intrinsicHeight,
        selectedNode.width,
        selectedNode.height,
        strokeSnapshot,
        useBinaryMask,
      );
      const punchedImageDataUrl = renderMaskToDataURL(
        img,
        intrinsicWidth,
        intrinsicHeight,
        selectedNode.width,
        selectedNode.height,
        strokeSnapshot,
        false,
      );

      const maskBase64 = maskDataUrl.split(',')[1];
      const punchedBase64 = punchedImageDataUrl.split(',')[1];
      if (!maskBase64 || !punchedBase64) throw new Error('遮罩生成失败，请重试');

      const placeholderIds = onInitGenerations(quantity, prompt, effectiveRatio, selectedNode);
      const settled = await Promise.allSettled(
        placeholderIds.map(async (pid) => {
          const payload: any = {
            model: reqModelName,
            prompt,
            n: 1,
            image: punchedBase64,
            mask: maskBase64,
            image_size: reqImageSize,
            size: reqImageSize,
            aspect_ratio: effectiveRatio,
            mask_mode: maskMode,
          };
          const res = await editImageApi(apiKey, payload);
          onUpdateGeneration(pid, null, undefined, res.taskId);
          return res.taskId;
        }),
      );

      const successCount = settled.filter((r) => r.status === 'fulfilled').length;
      const failed = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      if (successCount > 0) {
        updateNode(selectedNode.id, { maskStrokes: [] });
      }

      if (failed.length > 0) {
        const firstError = failed[0]?.reason?.message || '部分任务提交失败';
        setError(successCount > 0 ? `已提交 ${successCount} 个任务，另有失败：${firstError}` : firstError);
        if (successCount === 0) {
          placeholderIds.forEach((pid) => onUpdateGeneration(pid, null, firstError));
        }
      }
    } catch (err: any) {
      setError(err?.message || '重绘请求失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUndoLastStroke = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedNode?.maskStrokes?.length) return;
    updateNode(selectedNode.id, { maskStrokes: selectedNode.maskStrokes.slice(0, -1) });
  };

  const handleClearStrokes = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedNode) updateNode(selectedNode.id, { maskStrokes: [] });
  };

  const handleClose = () => {
    setInpaintWindowOpen(false);
    if (toolMode === ToolMode.INPAINT) setToolMode(ToolMode.SELECT);
  };

  return (
    <Draggable
      nodeRef={panelRef}
      handle=".drag-handle"
      defaultPosition={posRef.current}
      onStop={(_, data) => {
        posRef.current = { x: data.x, y: data.y };
      }}
      bounds="parent"
    >
      <div
        ref={panelRef}
        className="fixed z-50 w-84 bg-gray-900/90 backdrop-blur-3xl border border-gray-700/50 shadow-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: 'calc(100vh - 40px)', userSelect: 'none' }}
      >
        <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-gray-800 cursor-move bg-gray-900/50 hover:bg-gray-800/50 transition-colors">
          <div className="flex items-center gap-2">
            <Eraser size={16} className="text-purple-400" />
            <span className="font-bold text-sm bg-linear-to-r from-purple-400 to-indigo-400 text-transparent bg-clip-text">
              局部重绘 (Inpaint)
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
            title="关闭窗口"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 styled-scrollbar">
          <div className="flex items-center gap-2 p-3 bg-purple-900/20 border border-purple-500/30 rounded-xl mb-4">
            <Sparkles size={14} className="text-purple-400 shrink-0" />
            <div className="text-xs text-purple-200 leading-relaxed text-left">
              <span className="font-semibold block mb-1">
                当前模型：{INPAINT_MODELS.find((m) => m.value === inpaintModel)?.label}
              </span>
              支持 2K / 4K 局部重绘。
            </div>
          </div>

          {!isImageSelected ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-3 border border-dashed border-gray-700 rounded-xl">
              <Move size={24} className="opacity-50" />
              <span className="text-xs text-center px-4">请先在画布上选中一张图片</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <span className={'text-xs font-medium ' + (hasStrokes ? 'text-green-400' : 'text-gray-400')}>
                  {hasStrokes ? '已检测到遮罩笔触' : '请在图片上涂抹遮罩区域'}
                </span>
                <div className="flex items-center gap-1">
                  {hasStrokes && (
                    <button
                      type="button"
                      onClick={handleUndoLastStroke}
                      className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded text-[10px] transition-colors"
                    >
                      <Undo2 size={10} />
                      撤销一笔
                    </button>
                  )}
                  {hasStrokes && (
                    <button
                      type="button"
                      onClick={handleClearStrokes}
                      className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-[10px] transition-colors"
                    >
                      <Trash2 size={10} />
                      清空
                    </button>
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 font-medium">重绘提示词</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="描述需要在遮罩区域生成的内容"
                    className="w-full h-24 bg-black/40 border border-gray-800 rounded-xl p-3 text-sm focus:outline-hidden focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none transition-all placeholder:text-gray-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 font-medium">局部重绘模型</label>
                  <ModelSelector
                    value={inpaintModel}
                    options={modelOptions}
                    onChange={(value) => setInpaintModel(value as InpaintModelValue)}
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">生成张数</label>
                    <select
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
                      className="w-full bg-black/40 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white outline-hidden cursor-pointer hover:border-gray-700 focus:border-purple-500"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={4}>4</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">遮罩模式</label>
                    <select
                      value={maskMode}
                      onChange={(e) => setMaskMode(e.target.value as MaskMode)}
                      className="w-full bg-black/40 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white outline-hidden cursor-pointer hover:border-gray-700 focus:border-purple-500"
                    >
                      <option value="transparent">透明洞模式</option>
                      <option value="binary">黑白遮罩模式</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">笔触颜色</label>
                    <div className="flex items-center gap-2 bg-black/30 border border-gray-800 rounded-lg px-2 py-1.5">
                      <input
                        type="color"
                        value={brushColor}
                        onChange={(e) => setBrushColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                      <span className="text-xs text-gray-300 font-mono">{brushColor.toUpperCase()}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">笔触粗细</label>
                    <div className="bg-black/30 border border-gray-800 rounded-lg px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Brush size={12} className="text-gray-400" />
                        <input
                          type="range"
                          min={8}
                          max={120}
                          step={1}
                          value={brushSize}
                          onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                          className="w-full accent-purple-500"
                        />
                        <span className="text-xs text-gray-300 w-8 text-right">{brushSize}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs text-left">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!hasStrokes || isSubmitting}
                  className={`w-full py-3.5 rounded-xl font-bold text-sm text-white shadow-xl transition-all duration-300 ${
                    !hasStrokes || isSubmitting
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700/50'
                      : 'bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 border border-purple-500/50 hover:shadow-purple-500/25 active:scale-[0.98]'
                  }`}
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      <span>提交中...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <Sparkles size={16} className={hasStrokes ? 'animate-pulse' : ''} />
                      <span>开始重绘</span>
                    </div>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </Draggable>
  );
};

export default InpaintWindow;
