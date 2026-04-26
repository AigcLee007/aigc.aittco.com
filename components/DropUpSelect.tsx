import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropUpOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
}

interface DropUpSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: DropUpOption[];
  className?: string;
  showRectMarker?: boolean;
}

const DropUpSelect: React.FC<DropUpSelectProps> = ({
  value,
  onChange,
  options,
  className = "",
  showRectMarker = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  const parseRatio = (raw?: string): { w: number; h: number } | null => {
    const text = String(raw || "").trim();
    const match = text.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  };

  const getMarkerStyle = (option: DropUpOption): React.CSSProperties => {
    const parsed = parseRatio(option.value) || parseRatio(option.label) || { w: 1, h: 1 };
    const maxEdge = 18;
    const minEdge = 6;
    if (parsed.w >= parsed.h) {
      return {
        width: maxEdge,
        height: Math.max(minEdge, Math.round((maxEdge * parsed.h) / parsed.w)),
      };
    }
    return {
      width: Math.max(minEdge, Math.round((maxEdge * parsed.w) / parsed.h)),
      height: maxEdge,
    };
  };

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
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-2.5 sm:py-2 text-sm sm:text-xs text-white flex items-center justify-between hover:bg-gray-750 transition-colors touch-manipulation active:scale-[0.98] min-h-[42px] sm:min-h-0"
      >
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            {showRectMarker ? (
              <span
                className="inline-block shrink-0 rounded-[4px] border border-yellow-400/85 bg-yellow-400/8"
                style={getMarkerStyle(selectedOption)}
              />
            ) : null}
            <span className={showRectMarker ? "whitespace-nowrap" : "truncate whitespace-nowrap"}>
              {selectedOption?.label}
            </span>
            {selectedOption?.badge ? (
              <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-100">
                {selectedOption.badge}
              </span>
            ) : null}
          </div>
        </div>
        <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 ml-1 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute bottom-full mb-1 left-0 bg-[#1A1A1A] border border-gray-700 rounded-lg shadow-xl overflow-hidden z-[130] max-h-56 overflow-y-auto sleek-scroll-y ${
            showRectMarker
              ? 'w-max min-w-[170px] max-w-[260px]'
              : 'w-full min-w-[88px]'
          }`}
        >
          {options.map((option) => {
            const isActive = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs transition-colors touch-manipulation ${
                  isActive
                    ? 'bg-purple-500/10 text-purple-200'
                    : 'text-gray-300 hover:bg-gray-700/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {showRectMarker ? (
                      <span
                        className={`inline-block shrink-0 rounded-[4px] border ${
                          isActive
                            ? 'border-yellow-400/85 bg-yellow-400/10'
                            : 'border-gray-500/70 bg-transparent'
                        }`}
                        style={getMarkerStyle(option)}
                      />
                    ) : null}
                    <span className={showRectMarker ? "whitespace-nowrap" : "truncate whitespace-nowrap"}>
                      {option.label}
                    </span>
                    {option.badge ? (
                      <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-100">
                        {option.badge}
                      </span>
                    ) : null}
                  </div>
                  {option.description ? (
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {option.description}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DropUpSelect;
