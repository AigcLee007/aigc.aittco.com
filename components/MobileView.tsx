import React, { useMemo } from 'react';
import { useCanvasStore } from '../src/store/canvasStore';
import { useSelectionStore } from '../src/store/selectionStore';
import {
  Play,
  Image as ImageIcon,
  Plus,
  Settings,
  History,
  Map as MapIcon,
  Layers,
  ShoppingCart,
  Headset,
} from 'lucide-react';
import { ToolMode } from '../types';
import logo from '../src/assets/logo.svg';
import { getPreferredImageDisplayUrl } from '../src/utils/generatedImageStorage';
import { AssetImage } from '../src/components/AssetImage';
import { ImageRetentionNotice } from '../src/components/ImageRetentionNotice';

interface MobileViewProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenCanvas: () => void;
  onOpenClassicMode: () => void;
  onOpenSupport: () => void;
}

const MobileView: React.FC<MobileViewProps> = ({
  onOpenSettings,
  onOpenHistory,
  onOpenCanvas,
  onOpenClassicMode,
  onOpenSupport,
}) => {
  const storeNodes = useCanvasStore((state) => state.nodes);

  const nodes = useMemo(() => {
    return storeNodes ? [...storeNodes].reverse() : [];
  }, [storeNodes]);

  const { openLightbox, setControlPanelOpen, setToolMode } = useSelectionStore();

  const handleCreateClick = () => {
    setToolMode(ToolMode.GENERATE);
    setControlPanelOpen(true);
  };

  return (
    <div
      className="relative w-full h-full bg-neutral-900 overflow-y-auto pb-28 flex flex-col"
      style={{ minHeight: '100dvh' }}
    >
      <div className="shrink-0 sticky top-0 z-20 border-b border-white/10 bg-neutral-900/95 px-3 py-2.5 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <img src={logo} alt="Nano Banana Pro" className="h-5 w-5 shrink-0 opacity-90" />
            <h1 className="max-w-[112px] truncate text-base font-bold tracking-tight text-white min-[390px]:max-w-[150px]">
              <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
                Nano Banana Pro
              </span>
            </h1>
            <div className="hidden shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white min-[390px]:inline-flex">
              {nodes.length} 作品
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-4 gap-1">
            <button
              onClick={onOpenHistory}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-200 active:scale-95"
              title="历史记录"
            >
              <History size={15} />
            </button>
            <button
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-200 active:scale-95"
              title="设置"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={onOpenClassicMode}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-200 active:scale-95"
              title="VIP"
            >
              <Layers size={15} />
            </button>
            <button
              onClick={onOpenCanvas}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-200 active:scale-95"
              title="查看画布"
            >
              <MapIcon size={15} />
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <a
            href="https://item.taobao.com/item.htm?id=1058856152173"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="充值"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-orange-400/30 bg-orange-500/10 text-xs font-semibold text-orange-200"
          >
            <ShoppingCart size={15} aria-hidden="true" />
            充值
          </a>
          <button
            type="button"
            onClick={onOpenSupport}
            aria-label="客服"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 text-xs font-semibold text-emerald-200"
          >
            <Headset size={15} aria-hidden="true" />
            客服
          </button>
        </div>
      </div>

      <ImageRetentionNotice className="mx-3 mt-3 shrink-0" />

      {nodes.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 min-h-[50vh]">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6 shadow-inner">
            <ImageIcon size={32} className="opacity-50" />
          </div>
          <p className="text-lg font-medium text-white mb-2">暂无作品</p>
          <p className="text-sm opacity-60 text-center max-w-[220px]">
            点击右下角加号按钮，开始你的第一次创作
          </p>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="p-4 grid grid-cols-2 gap-3 pb-24">
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className="aspect-square relative rounded-xl overflow-hidden bg-white/5 border border-white/10 shadow-sm active:scale-95 transition-transform text-left"
              onClick={() => (node.src || node.assetId) && openLightbox(node.type === 'IMAGE' ? node : node.src!)}
            >
              {(node.src || node.assetId) && !node.loading && !node.error ? (
                <>
                  {node.type === 'VIDEO' ? (
                    <video
                      src={node.src}
                      className="w-full h-full object-cover"
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <AssetImage asset={node} alt={node.prompt || '作品'} className="w-full h-full" lazy />
                  )}

                  {node.type === 'VIDEO' && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-black/50 backdrop-blur rounded-full flex items-center justify-center">
                      <Play size={10} className="text-white fill-white" />
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  {node.loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <ImageIcon size={20} />
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleCreateClick}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-tr from-yellow-400 to-orange-500 rounded-full shadow-[0_4px_20px_rgba(234,179,8,0.4)] flex items-center justify-center text-black z-50 active:scale-90 transition-transform"
        title="开始创作"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  );
};

export default MobileView;
