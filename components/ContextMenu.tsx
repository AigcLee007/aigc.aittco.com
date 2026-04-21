import React from 'react';
import { useSelectionStore } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import {
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
  Wand2,
  Download,
  Eye,
  ImagePlus,
  Link,
  Eraser,
} from 'lucide-react';
import { ToolMode } from '../types';

interface ContextMenuProps {
  onDuplicate: () => void;
  onRemoveBackground: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  onDuplicate,
  onRemoveBackground,
  onDownload,
  onCopyLink,
}) => {
  const {
    contextMenu,
    closeContextMenu,
    openLightbox,
    addReferenceImage,
    clearSelection,
    setToolMode,
    setInpaintWindowOpen,
    setPrompt,
    setPendingPrompt,
    setPanelMode,
    setControlPanelOpen,
  } = useSelectionStore();

  const { nodes, deleteNode, reorderNode, addToHistory } = useCanvasStore();

  const nodeId = contextMenu?.nodeId;
  const x = contextMenu?.x || 0;
  const y = contextMenu?.y || 0;

  if (!contextMenu) return null;

  const node = nodes.find((n) => n.id === nodeId);
  const isImageNode = node?.type === 'IMAGE';

  const style = {
    top: Math.min(y, window.innerHeight - 420),
    left: Math.min(x, window.innerWidth - 220),
  };

  const handleView = () => {
    if (node?.src) openLightbox(node.src);
    closeContextMenu();
  };

  const handleSetReference = () => {
    closeContextMenu();
    if (node?.src && node.type === 'IMAGE' && nodeId) {
      const src = node.src;
      setTimeout(() => {
        addReferenceImage(src);
        clearSelection();
        setToolMode(ToolMode.GENERATE);
      }, 10);
    }
  };

  const handleInpaint = () => {
    closeContextMenu();
    setToolMode(ToolMode.INPAINT);
    setInpaintWindowOpen(true);
  };

  const handleRegenerate = () => {
    if (!node || node.type !== 'IMAGE') return;

    const promptText = (node.prompt || '').trim();
    if (!promptText) {
      alert('\u8BE5\u56FE\u7247\u6682\u65E0\u53EF\u7528\u63D0\u793A\u8BCD');
      closeContextMenu();
      return;
    }

    setPrompt(promptText);
    setPendingPrompt(promptText);
    setPanelMode('IMAGE');
    setToolMode(ToolMode.GENERATE);
    setControlPanelOpen(true);
    clearSelection();
    closeContextMenu();
  };

  const handleReorder = (direction: 'up' | 'down' | 'top' | 'bottom') => {
    if (!nodeId) return;
    addToHistory();
    reorderNode(nodeId, direction);
    closeContextMenu();
  };

  const handleDelete = () => {
    if (!nodeId) return;
    addToHistory();
    deleteNode(nodeId);
    closeContextMenu();
  };

  return (
    <div
      className="fixed z-50 w-52 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden text-sm"
      style={style}
      onMouseLeave={closeContextMenu}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col py-1">
        {isImageNode && (
          <button onClick={handleView} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
            <Eye size={14} className="text-green-400" />
            <span>{'\u653E\u5927\u9884\u89C8 (Lightbox)'}</span>
          </button>
        )}

        {isImageNode && (
          <button onClick={handleSetReference} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
            <ImagePlus size={14} className="text-orange-400" />
            <span>{'\u8BBE\u4E3A\u53C2\u8003\u56FE (Img2Img)'}</span>
          </button>
        )}

        {isImageNode && (
          <button onClick={handleInpaint} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
            <Eraser size={14} className="text-purple-400" />
            <span>{'\u5C40\u90E8\u91CD\u7ED8 (Inpaint)'}</span>
          </button>
        )}

        {isImageNode && (
          <button onClick={handleRegenerate} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
            <Wand2 size={14} className="text-emerald-400" />
            <span>{'\u91CD\u65B0\u751F\u6210'}</span>
          </button>
        )}

        {isImageNode ? (
          <button onClick={onDownload} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
            <Download size={14} className="text-blue-400" />
            <span>{'\u4FDD\u5B58\u56FE\u7247 (\u539F\u56FE)'}</span>
          </button>
        ) : (
          <>
            <button onClick={onDownload} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
              <Download size={14} className="text-blue-400" />
              <span>{'\u4E0B\u8F7D\u89C6\u9891'}</span>
            </button>
            <button onClick={onCopyLink} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
              <Link size={14} className="text-blue-400" />
              <span>{'\u590D\u5236\u89C6\u9891\u94FE\u63A5'}</span>
            </button>
          </>
        )}

        <div className="h-px bg-gray-800 my-1" />

        <button onClick={onDuplicate} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
          <Copy size={14} />
          <span>{'\u590D\u5236\u56FE\u5C42'}</span>
        </button>

        <div className="h-px bg-gray-800 my-1" />

        <button onClick={() => handleReorder('top')} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
          <ArrowUpToLine size={14} />
          <span>{'\u7F6E\u4E8E\u9876\u5C42'}</span>
        </button>
        <button onClick={() => handleReorder('up')} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
          <ArrowUp size={14} />
          <span>{'\u4E0A\u79FB\u4E00\u5C42'}</span>
        </button>
        <button onClick={() => handleReorder('down')} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
          <ArrowDown size={14} />
          <span>{'\u4E0B\u79FB\u4E00\u5C42'}</span>
        </button>
        <button onClick={() => handleReorder('bottom')} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-left text-gray-200">
          <ArrowDownToLine size={14} />
          <span>{'\u7F6E\u4E8E\u5E95\u5C42'}</span>
        </button>

        <div className="h-px bg-gray-800 my-1" />

        <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 hover:bg-red-900/30 text-left text-red-300">
          <Trash2 size={14} />
          <span>{'\u5220\u9664\u56FE\u5C42'}</span>
        </button>
      </div>
    </div>
  );
};

export default ContextMenu;
