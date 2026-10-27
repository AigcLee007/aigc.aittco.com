import React from 'react';
import { GitCompare, Maximize2 } from 'lucide-react';
import { useSelectionStore } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import { ToolMode, type NodeData } from '../types';

interface SingleImageToolbarProps {
  onUpscale: (node: NodeData) => void;
  onCompare: (result: NodeData, source: NodeData) => void;
}

// Shown at the bottom of the screen when exactly one finished image is selected, in the same
// place and style as the multi-select bar. It puts the two upscale actions one click away.
const SingleImageToolbar: React.FC<SingleImageToolbarProps> = ({ onUpscale, onCompare }) => {
  const { selectedIds, toolMode } = useSelectionStore();
  const { nodes } = useCanvasStore();

  if (selectedIds.length !== 1) return null;
  // While drawing a mask or generating, the user is busy with something else.
  if (toolMode === ToolMode.INPAINT || toolMode === ToolMode.GENERATE || toolMode === ToolMode.VIDEO || toolMode === ToolMode.UPSCALE) return null;

  const node = nodes.find((item) => item.id === selectedIds[0]);
  if (!node || node.type !== 'IMAGE' || node.loading || node.error || !(node.src || node.assetId)) return null;

  // A comparison needs both pictures, so it only appears while the source is still on the canvas.
  const source = node.upscaleOf ? nodes.find((item) => item.id === node.upscaleOf!.sourceNodeId) : undefined;
  const canCompare = !!source && source.type === 'IMAGE' && !!(source.src || source.assetId);

  return (
    <div
      role="toolbar"
      aria-label="图片快捷操作"
      className="fixed bottom-8 canvas-center-x z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-[#1e1e1e]/90 p-2 shadow-[0_20px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={() => onUpscale(node)}
        className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-200"
      >
        <Maximize2 size={16} aria-hidden="true" />
        高清放大
      </button>
      {canCompare && (
        <button
          type="button"
          onClick={() => onCompare(node, source!)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10"
        >
          <GitCompare size={16} aria-hidden="true" />
          对比放大前后
        </button>
      )}
    </div>
  );
};

export default SingleImageToolbar;
