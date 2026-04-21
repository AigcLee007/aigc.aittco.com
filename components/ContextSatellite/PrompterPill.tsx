import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Image as ImageIcon, Video, Settings2, ChevronUp, ChevronDown, Wand2 } from 'lucide-react';

interface PrompterPillProps {
  onGenerate: (prompt: string, options: any) => void;
  isGenerating: boolean;
}

export const PrompterPill: React.FC<PrompterPillProps> = ({ onGenerate, isGenerating }) => {
  const [prompt, setPrompt] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  
  // Options state
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [model, setModel] = useState('snoopy-v1'); // Default model placeholder

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    onGenerate(prompt, {
      mode,
      aspectRatio,
      model
    });
    // Optional: Collapse after submit?
    // setExpanded(false);
  };

  return (
    <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-full max-w-2xl px-4 pointer-events-none">
      
      {/* Expanded Settings Panel (pops up above the pill) */}
      {expanded && (
        <div className="w-full bg-neutral-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 mb-2 pointer-events-auto animate-in slide-in-from-bottom-4 fade-in duration-200">
           <div className="flex items-center gap-6 text-sm text-gray-300">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500 font-medium uppercase tracking-wider">Mode</label>
                <div className="flex bg-white/5 rounded-lg p-1">
                   <button 
                     onClick={() => setMode('IMAGE')}
                     className={`flex-1 px-3 py-1.5 rounded-md flex items-center gap-2 transition-all ${mode === 'IMAGE' ? 'bg-white/10 text-white shadow-sm' : 'hover:text-white text-gray-400'}`}
                   >
                     <ImageIcon size={14} /> Image
                   </button>
                   <button 
                     onClick={() => setMode('VIDEO')}
                     className={`flex-1 px-3 py-1.5 rounded-md flex items-center gap-2 transition-all ${mode === 'VIDEO' ? 'bg-white/10 text-white shadow-sm' : 'hover:text-white text-gray-400'}`}
                   >
                     <Video size={14} /> Video
                   </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[120px]">
                <label className="text-xs text-gray-500 font-medium uppercase tracking-wider">Aspect Ratio</label>
                <select 
                  value={aspectRatio} 
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500/50"
                >
                  <option value="1:1">1:1 Square</option>
                  <option value="16:9">16:9 Landscape</option>
                  <option value="9:16">9:16 Portrait</option>
                  <option value="4:3">4:3 Standard</option>
                  <option value="3:4">3:4 Portrait</option>
                </select>
              </div>

               <div className="flex flex-col gap-1.5 min-w-[120px]">
                <label className="text-xs text-gray-500 font-medium uppercase tracking-wider">Model</label>
                <select 
                  value={model} 
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500/50"
                >
                   {/* We might need to fetch these or hardcode for now */}
                   {mode === 'IMAGE' ? (
                     <>
                        <option value="flux-schnell">Flux Schnell</option>
                        <option value="flux-dev">Flux Dev</option>
                        <option value="sdxl">SDXL</option>
                     </>
                   ) : (
                     <>
                        <option value="veo3.1-fast">Veo 3.1 Fast</option>
                     </>
                   )}
                </select>
              </div>
           </div>
        </div>
      )}

      {/* Main Bar */}
      <div className="w-full bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl p-1.5 flex items-center gap-2 pointer-events-auto transition-all hover:bg-neutral-900/70 hover:border-white/20">
        
        {/* Toggle Settings */}
        <button 
          onClick={() => setExpanded(!expanded)}
          className={`p-3 rounded-full transition-colors ${expanded ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
        >
          <Settings2 size={18} />
        </button>

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
            <input 
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === 'IMAGE' ? "Imagine something..." : "Describe a video..."}
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-500 text-sm px-2 font-medium"
            />
            
            {/* Action Button */}
            <button 
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className={`
                px-4 py-2 rounded-full font-medium text-sm flex items-center gap-2 transition-all
                ${!prompt.trim() || isGenerating 
                  ? 'bg-white/5 text-gray-500 cursor-not-allowed' 
                  : 'bg-white text-black hover:bg-gray-200 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                }
              `}
            >
               {isGenerating ? (
                 <span className="flex items-center gap-2">Generating...</span>
               ) : (
                 <>
                   <Sparkles size={16} fill="black" />
                   Generate
                 </>
               )}
            </button>
        </form>

      </div>
      
      {/* Hint */}
      {!expanded && !prompt && (
        <div className="text-[10px] text-gray-500 font-medium tracking-wide uppercase opacity-50 animate-pulse">
          Press 'Space' or Start Typing
        </div>
      )}

    </div>
  );
};
