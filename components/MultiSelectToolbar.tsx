import React from 'react';
import { useSelectionStore } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import { useCanvasOperations } from '../src/hooks/useCanvasOperations';
import { 
  Group, 
  Ungroup, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  ArrowUpToLine, 
  AlignVerticalSpaceAround, 
  ArrowDownToLine,
  GripHorizontal,
  GripVertical,
  Trash2,
  X
} from 'lucide-react';

const MultiSelectToolbar: React.FC = () => {
  const { selectedIds, clearSelection } = useSelectionStore();
  const { nodes } = useCanvasStore();
  const { handleGroup, handleUngroup, handleAlign, handleDeleteSelected } = useCanvasOperations();

  if (selectedIds.length < 2) return null;

  const selectedNodes = nodes.filter(n => selectedIds.includes(n.id));
  if (selectedNodes.length < 2) return null;

  // Determine if all selected are in the same group
  const groupIds = new Set(selectedNodes.map(n => n.groupId).filter(Boolean));
  const isAllSameGroup = groupIds.size === 1 && selectedNodes.every(n => n.groupId === Array.from(groupIds)[0]);
  const hasGroups = groupIds.size > 0;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-[#1e1e1e]/90 backdrop-blur-xl border border-white/10 p-2 rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.4)] flex items-center gap-2 select-none">
      
      <div className="flex items-center gap-1">
         <span className="text-xs font-semibold text-gray-400 px-3">{selectedNodes.length} 项</span>
      </div>
      
      <div className="h-6 w-px bg-white/10 mx-1"></div>

      <div className="flex items-center gap-1">
        {isAllSameGroup ? (
           <button onClick={handleUngroup} title="取消编组" className="p-2.5 text-blue-400 hover:bg-white/10 hover:text-blue-300 rounded-xl transition-all">
             <Ungroup size={18} />
           </button>
        ) : (
           <button onClick={handleGroup} title="编组" className="p-2.5 text-gray-300 hover:bg-white/10 hover:text-white rounded-xl transition-all">
             <Group size={18} />
           </button>
        )}
      </div>

      <div className="h-6 w-px bg-white/10 mx-1"></div>

      <div className="flex items-center gap-1">
        <button onClick={() => handleAlign('left')} title="左对齐" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <AlignLeft size={16} />
        </button>
        <button onClick={() => handleAlign('center')} title="水平居中" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <AlignCenter size={16} />
        </button>
        <button onClick={() => handleAlign('right')} title="右对齐" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <AlignRight size={16} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1"></div>
        <button onClick={() => handleAlign('horizontal-distribute')} title="水平等距分布" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <GripHorizontal size={16} />
        </button>
      </div>

      <div className="h-6 w-px bg-white/10 mx-1"></div>

      <div className="flex items-center gap-1">
        <button onClick={() => handleAlign('top')} title="顶对齐" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <ArrowUpToLine size={16} />
        </button>
        <button onClick={() => handleAlign('middle')} title="垂直居中" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <AlignVerticalSpaceAround size={16} />
        </button>
        <button onClick={() => handleAlign('bottom')} title="底对齐" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <ArrowDownToLine size={16} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1"></div>
        <button onClick={() => handleAlign('vertical-distribute')} title="垂直等距分布" className="p-2 text-gray-400 hover:bg-white/10 hover:text-white rounded-lg transition-all">
          <GripVertical size={16} />
        </button>
      </div>

      <div className="h-6 w-px bg-white/10 mx-1"></div>

      <div className="flex items-center gap-1">
         <button onClick={handleDeleteSelected} title="删除选定" className="p-2.5 text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded-xl transition-all">
           <Trash2 size={18} />
         </button>
      </div>
      
      <div className="flex items-center gap-1">
         <button onClick={clearSelection} title="取消选择" className="p-1.5 text-gray-500 hover:bg-white/10 hover:text-gray-300 rounded-full transition-all ml-1 border border-white/5">
           <X size={14} />
         </button>
      </div>
    </div>
  );
};

export default MultiSelectToolbar;
