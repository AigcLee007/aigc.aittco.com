import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  className?: string;
  contentClassName?: string;
}

const GlassModal: React.FC<GlassModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  width = "max-w-xl",
  className = "",
  contentClassName = "overflow-y-auto overflow-x-hidden custom-scrollbar"
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
    } else {
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!visible && !isOpen) return null;

  return (
    <div className={`fixed inset-0 z-60 flex items-center justify-center p-4 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* Overlay */}
      <div 
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ease-out ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
        onClick={onClose}
      />

      {/* Card */}
      <div 
        onClick={e => e.stopPropagation()}
        className={`relative w-full ${width} bg-[#121212]/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-[32px] overflow-hidden flex flex-col max-h-[85vh] transform transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1) ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'} ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-white/5 shrink-0">
          <h2 className="text-lg font-medium text-white/90 tracking-wide">{title}</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className={`flex-1 ${contentClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default GlassModal;
