import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { NodeData } from '../types';
import { useGenerationProgress } from '../src/hooks/useGenerationProgress';
import { ImageGenerationDetails, imageSourceLabel } from './ImageGenerationDetails';

export default function ImageHoverTooltip({ node, x, y }: { node: NodeData; x: number; y: number }) {
  const feedback = useGenerationProgress(node);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x + 20, top: y + 20 });
  useEffect(() => {
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, [node.id]);
  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const left = x + width + 20 <= window.innerWidth - 12 ? x + 20 : x - width - 20;
    const top = y + height + 20 <= window.innerHeight - 12 ? y + 20 : y - height - 20;
    setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(top, window.innerHeight - height - 12)) });
  }, [visible, x, y, node.generationInfo, node.prompt, node.loading, node.error, feedback.statusText]);
  if (!visible) return null;
  return (
    <div ref={ref} role="tooltip" className="fixed pointer-events-none z-100 w-[300px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur-md" style={position}>
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2">
        {node.loading && !node.error ? <RefreshCw size={12} className="animate-spin text-blue-400" /> : <div className={`h-2 w-2 rounded-full ${node.error ? 'bg-red-500' : 'bg-green-500'}`} />}
        <span className="text-xs font-medium text-gray-200">{node.error ? '生成失败' : node.loading ? `生成中 ${feedback.percentLabel}` : node.type === 'VIDEO' ? 'AI VIDEO' : imageSourceLabel(node)}</span>
      </div>
      {node.loading && !node.error && <div className="mb-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-800"><div className="h-full bg-purple-500" style={{ width: `${feedback.percent}%` }} /></div>
        <div className="mt-1.5 text-xs text-blue-300">{feedback.statusText} · {feedback.elapsedLabel}</div>
      </div>}
      {node.type === 'IMAGE' ? <ImageGenerationDetails image={node} compact /> : <p className="text-xs text-gray-400 line-clamp-4">{node.prompt}</p>}
      {node.error && node.errorMessage && <div className="mt-2 text-xs text-red-300 line-clamp-3">{node.errorMessage}</div>}
    </div>
  );
}
