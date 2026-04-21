import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import CoinIcon from './CoinIcon';
import { formatPoint } from '../src/utils/pointFormat';

export interface ModelOption {
  value: string;
  label: string;
  cost?: number;
  icon?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

interface ModelSelectorProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  className?: string;
  dropUp?: boolean;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ value, options, onChange, className = "", dropUp = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2.5 sm:py-2 text-sm sm:text-xs text-white flex items-center justify-between hover:bg-gray-750 transition-colors touch-manipulation active:scale-[0.98] min-h-[42px] sm:min-h-0"
      >
        <div className="flex items-center gap-2 truncate flex-1">
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span>{selectedOption?.label}</span>
          {selectedOption?.disabled && <span className="text-[10px] text-red-400 opacity-80">(暂停使用)</span>}
        </div>
        <div className="flex items-center gap-2 ml-2">
          {!selectedOption?.disabled && selectedOption?.cost !== undefined && (
            <span className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-400/10 px-1.5 py-0.5 rounded">
              <CoinIcon size={10} />
              {formatPoint(selectedOption.cost)}
            </span>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 w-full bg-[#1A1A1A] border border-gray-700 rounded-lg shadow-xl overflow-hidden z-[120] max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 sm:py-2 text-sm sm:text-xs flex items-center justify-between transition-colors touch-manipulation ${
                option.disabled 
                  ? 'bg-gray-900/50 cursor-not-allowed text-gray-600' 
                  : value === option.value 
                    ? 'bg-purple-500/10 text-purple-200 hover:bg-purple-500/20' 
                    : 'text-gray-300 hover:bg-gray-700/50'
              }`}
            >
              <div className="truncate flex-1 text-left flex flex-col">
                <div className="flex items-center gap-2">
                  {option.icon && <span className={`shrink-0 ${option.disabled ? 'opacity-30' : ''}`}>{option.icon}</span>}
                  <span className={option.disabled ? 'line-through decoration-gray-700' : ''}>{option.label}</span>
                </div>
                {option.disabled && option.disabledReason && (
                  <span className="text-[9px] text-red-500/60 mt-0.5">{option.disabledReason}</span>
                )}
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                {!option.disabled && option.cost !== undefined && (
                  <span className="flex items-center gap-1 text-yellow-500/80 font-mono text-[10px] w-14 justify-start">
                    <CoinIcon size={10} className="shrink-0" />
                    {formatPoint(option.cost)}
                  </span>
                )}
                <div className="w-3 flex justify-center">
                  {value === option.value && <Check size={12} className="text-purple-400" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
