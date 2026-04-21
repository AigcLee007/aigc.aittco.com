import React, { useState } from 'react';
import { Play, Image as ImageIcon, Copy, Trash2, Maximize2, Wand2, MoreHorizontal, Layers, X, Edit } from 'lucide-react';

interface SatelliteMenuProps {
  x: number;
  y: number;
  nodeType: 'IMAGE' | 'VIDEO';
  onAction: (action: string) => void;
}

export const SatelliteMenu: React.FC<SatelliteMenuProps> = ({ x, y, nodeType, onAction }) => {
  // Prevent menu from going off-screen (simple boundary check logic can be added here)
  
  return (
    <div 
      className="fixed z-50 flex items-center gap-1 p-1.5 bg-neutral-900/80 backdrop-blur-md border border-white/10 rounded-full shadow-xl animate-in fade-in zoom-in-95 duration-200"
      style={{ left: x, top: y, transform: 'translate(-50%, -120%)' }} // Position above the node
    >
      
      {nodeType === 'IMAGE' && (
        <>
          <SatelliteButton icon={<Wand2 size={16} />} label="Variant" onClick={() => onAction('variant')} />
          <div className="w-px h-4 bg-white/10 mx-1" />
          <SatelliteButton icon={<Play size={16} />} label="Animate" onClick={() => onAction('animate')} highlight />
          <div className="w-px h-4 bg-white/10 mx-1" />
          <SatelliteButton icon={<Maximize2 size={16} />} label="Upscale" onClick={() => onAction('upscale')} />
          {/* <SatelliteButton icon={<Edit size={16} />} label="Inpaint" onClick={() => onAction('inpaint')} /> */}
        </>
      )}

      {nodeType === 'VIDEO' && (
        <>
          <SatelliteButton icon={<Play size={16} />} label="Extend" onClick={() => onAction('extend')} highlight />
          <div className="w-px h-4 bg-white/10 mx-1" />
           <SatelliteButton icon={<Maximize2 size={16} />} label="HD" onClick={() => onAction('hd')} />
        </>
      )}
      
      <div className="w-px h-4 bg-white/10 mx-1" />
      
      <SatelliteButton icon={<MoreHorizontal size={16} />} onClick={() => onAction('more')} />

    </div>
  );
};

const SatelliteButton: React.FC<{ icon: React.ReactNode; label?: string; onClick: () => void; highlight?: boolean }> = ({ 
  icon, label, onClick, highlight 
}) => {
  return (
    <button 
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`
        flex items-center gap-1.5 px-3 py-2 rounded-full transition-all group
        ${highlight 
          ? 'bg-white text-black hover:bg-gray-200 shadow-[0_0_15px_rgba(255,255,255,0.3)]' 
          : 'text-gray-300 hover:text-white hover:bg-white/10'
        }
      `}
      title={label}
    >
      {icon}
      {label && <span className="text-xs font-medium">{label}</span>}
    </button>
  );
}
