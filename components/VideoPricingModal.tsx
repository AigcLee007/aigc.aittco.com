import React from 'react';
import { X } from 'lucide-react';
import { getVideoModelDisplayCost } from '../src/config/videoModels';
import { getVisibleVideoModels } from '../src/config/videoRoutes';

interface VideoPricingModalProps { isOpen: boolean; onClose: () => void; }

const VideoPricingModal: React.FC<VideoPricingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;
  const rows = getVisibleVideoModels().map((model) => ({
    id: model.id,
    label: model.label,
    unitCost: model.pointCostPerSecond || 0,
    minimumCost: getVideoModelDisplayCost(model.id, model.defaultDuration),
    duration: model.defaultDuration || '4',
  }));
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 p-4"><h3 className="text-lg font-bold text-white">视频模型计费</h3><button aria-label="关闭" onClick={onClose} className="p-1 text-gray-400 transition-colors hover:text-white"><X size={20} /></button></div>
      <div className="max-h-[80vh] space-y-3 overflow-y-auto p-6 text-sm text-gray-300">
        {rows.map((row) => <div key={row.id} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/50 p-3"><div><div className="font-bold text-white">{row.label}</div><div className="mt-1 text-xs text-gray-400">{row.unitCost} 金币/秒 · {row.duration}s 起</div></div><div className="whitespace-nowrap font-mono font-bold text-yellow-300">最低 {row.minimumCost} 金币</div></div>)}
      </div>
      <div className="border-t border-gray-800 bg-gray-900/80 p-4 text-center text-xs text-gray-500">点击遮罩层或右上角关闭</div>
    </div>
  </div>;
};

export default VideoPricingModal;
