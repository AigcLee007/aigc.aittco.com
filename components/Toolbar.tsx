
import React, { useRef, useState } from 'react';
import { ToolMode } from '../types';
import { useSelectionStore } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import { Hand, MousePointer2, Sparkles, UploadCloud, Undo2, Redo2, Trash2, Settings, History, Grid, ScanSearch, DownloadCloud, Box, Loader2, HelpCircle, Clapperboard, ImagePlus, Eye, MessageSquare, Layers, ChevronDown, ChevronUp, Eraser } from 'lucide-react';

interface ToolbarProps {
  onUpload: (files: FileList) => void;
  onClearAll: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenInstructions: () => void;
  onArrange: () => void;
  onOpenReversePrompt?: () => void;
  onOpenBatchModal: () => void;
  onDownloadAllCanvas: () => void;
  isDownloadingCanvas?: boolean;
  onOpenClassicMode: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onUpload,
  onClearAll,
  onOpenSettings,
  onOpenHistory,
  onOpenInstructions,
  onArrange,
  onOpenReversePrompt,
  onOpenBatchModal,
  onDownloadAllCanvas,
  isDownloadingCanvas,
  onOpenClassicMode,
}) => {
  const { toolMode, setToolMode, apiKey, showLayers, toggleLayers, showTooltips, toggleTooltips } = useSelectionStore();
  const { undo, redo } = useCanvasStore();
  
  const hasKey = !!apiKey;
  
  // TODO: expose history state from store to enable/disable buttons properly
  const canUndo = true; // Temporary
  const canRedo = true; // Temporary

  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Toolbar compact mode: ~20% smaller
  const dockItemClass = "group relative flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-300 hover:scale-110 active:scale-95";
  const activeDockClass = "bg-white/20 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]"; 
  
  // --- Stack Component helper ---
  const DockStack = ({ icon, actions, title }: { icon: React.ReactNode, title?: string, actions: { icon: React.ReactNode, label: string, onClick: () => void, danger?: boolean }[] }) => (
    <div className="relative group/stack flex items-center justify-center">
      {/* Stack Content (Pop-up) */}
      <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 p-2 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl opacity-0 invisible translate-y-2 group-hover/stack:opacity-100 group-hover/stack:visible group-hover/stack:translate-y-0 transition-all duration-300 ease-out shadow-2xl z-50">
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={action.onClick}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 ${action.danger ? 'text-red-400 hover:bg-red-500/20' : 'text-gray-300 hover:bg-white/20 hover:text-white'}`}
            title={action.label}
          >
            {action.icon}
          </button>
        ))}
        {/* Arrow pointer */}
        <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-black/60 absolute -bottom-1.5 left-1/2 -translate-x-1/2" />
      </div>

      {/* Trigger Button inside Dock */}
      <button className={`${dockItemClass} hover:bg-white/5`} title={title}>
        {icon}
      </button>
    </div>
  );

  return (
    <>
      <div className={`fixed bottom-[15px] left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2 bg-[#121212]/90 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl z-50 transition-all duration-300 hover:bg-[#121212]/95 ${isCollapsed ? 'translate-y-[200%] opacity-0 pointer-events-none' : ''}`}>
        
        {/* 1. Undo/Redo Group */}
        <div className="flex items-center gap-1 border-r border-white/10 pr-2 mr-1">
            <button onClick={undo} disabled={!canUndo} className={`${dockItemClass} ${!canUndo ? 'opacity-30' : ''}`} title="撤销 (Ctrl+Z)">
              <Undo2 size={20} />
            </button>
            <button onClick={redo} disabled={!canRedo} className={`${dockItemClass} ${!canRedo ? 'opacity-30' : ''}`} title="重做 (Ctrl+Y)">
              <Redo2 size={20} />
            </button>
        </div>

        {/* 2. Basic Actions (Download, Upload, Arrange) */}
        <button onClick={onDownloadAllCanvas} className={dockItemClass} title="下载画布 (S)">
           <DownloadCloud size={20} />
        </button>
        <button onClick={handleUploadClick} className={dockItemClass} title="上传图片 (U)">
           <UploadCloud size={20} />
        </button>
        <button onClick={onArrange} className={dockItemClass} title="自动整理 (A)">
           <Grid size={20} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-2" />

        {/* 3. Tools (Select, Map) */}
        <button 
            onClick={() => setToolMode(ToolMode.SELECT)} 
            className={`${dockItemClass} ${toolMode === ToolMode.SELECT ? activeDockClass : ''}`}
            title="选择 (Esc)"
        >
            <MousePointer2 size={20} strokeWidth={1.5} />
        </button>
          
        <button 
            onClick={() => setToolMode(ToolMode.PAN)} 
            className={`${dockItemClass} ${toolMode === ToolMode.PAN ? activeDockClass : ''}`}
            title="移动 (Space)"
        >
            <Hand size={20} strokeWidth={1.5} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-2" />

        {/* 4. Generators */}
        <button 
            onClick={() => {
              setToolMode(ToolMode.GENERATE);
            }} 
            className={`${dockItemClass} ${toolMode === ToolMode.GENERATE ? 'bg-linear-to-tr from-purple-500 to-blue-500 text-white shadow-lg shadow-purple-500/30' : ''}`}
            title="生成图片 (P)"
        >
            <ImagePlus size={22} strokeWidth={1.5} />
        </button>

        <button 
            onClick={() => {
              setToolMode(ToolMode.VIDEO);
            }}
            className={`${dockItemClass} ${toolMode === ToolMode.VIDEO ? 'bg-linear-to-tr from-pink-500 to-orange-500 text-white shadow-lg shadow-pink-500/30' : ''}`}
            title="生成视频 (V)"
        >
            <Clapperboard size={22} strokeWidth={1.5} />
        </button>

        <button
            onClick={() => {
              setToolMode(ToolMode.INPAINT);
            }}
            className={`${dockItemClass} ${toolMode === ToolMode.INPAINT ? 'bg-linear-to-tr from-violet-500 to-indigo-500 text-white shadow-lg shadow-violet-500/30' : ''}`}
            title="局部重绘 (I)"
        >
            <Eraser size={21} strokeWidth={1.6} />
        </button>

        {/* 5. Collection Stack (Features) */}
        <DockStack 
          title="功能集合"
          icon={<Box size={20} strokeWidth={1.5} />} 
          actions={[
            { icon: <ScanSearch size={16} />, label: "图片反推 (Shift+R)", onClick: () => onOpenReversePrompt && onOpenReversePrompt() },
            { icon: <Box size={16} />, label: "批量生成", onClick: onOpenBatchModal },
            { icon: <MessageSquare size={16} />, label: showTooltips ? "隐藏提示" : "显示提示", onClick: toggleTooltips },
            { icon: <Trash2 size={16} />, label: "清空画布 (Ctrl+Shift+Del)", onClick: onClearAll, danger: true },
          ]} 
        />

        <div className="w-px h-6 bg-white/10 mx-2" />

        {/* 6. History & Settings */}
        <button onClick={onOpenHistory} className={dockItemClass} title="历史记录 (H)">
             <History size={20} strokeWidth={1.5} />
        </button>

        <button
            onClick={onOpenClassicMode}
            className={dockItemClass}
            title="切换到经典版"
        >
            <Layers size={20} strokeWidth={1.5} />
        </button>

        <div className="relative">
          <button 
              onClick={onOpenSettings} 
              className={dockItemClass}
              title={hasKey ? "设置" : "设置（API Key 可选）"}
          >
            <Settings size={20} strokeWidth={1.5} />
          </button>
        </div>

        {/* 7. Collapse */}
        <div className="ml-2 pl-2 border-l border-white/10">
                 <button 
                    onClick={() => setIsCollapsed(true)} 
                    className={`${dockItemClass}`} 
                    title="Collapse Toolbar"
                 >
                    <ChevronDown size={20} strokeWidth={1.5} />
                 </button>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/*"
          multiple
        />
      </div>

      {/* Expand Button - also restored */}
      <button 
        onClick={() => setIsCollapsed(false)}
        className={`fixed bottom-[15px] left-1/2 -translate-x-1/2 p-1.5 bg-[#121212]/90 backdrop-blur-xl border border-white/20 rounded-full shadow-xl z-50 text-gray-400 hover:text-white transition-all duration-300 ${isCollapsed ? 'translate-y-0 opacity-100' : 'translate-y-[200%] opacity-0 pointer-events-none'}`}
        title="Expand Toolbar"
      >
        <ChevronUp size={20} />
      </button>
    </>
  );
};

export default Toolbar;
