import { useEffect, useState } from 'react';

const GUIDE_SEEN_KEY = 'classic-mode-guide-seen-v1';

export const markClassicModeGuideSeen = () => {
  try { window.localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch { /* storage may be unavailable */ }
};

const hasSeenGuide = () => {
  try { return window.localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch { return true; }
};

// A one-time pointer to the classic layout for first-time canvas users.
// It closes for good after "知道了" or after switching once.
export const ClassicModeGuide = ({ onOpenClassicMode }: { onOpenClassicMode: () => void }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (hasSeenGuide()) return;
    // Let the canvas settle before pointing at the button.
    const timer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => { markClassicModeGuideSeen(); setVisible(false); };

  return (
    <div
      role="dialog"
      aria-label="经典版入口提示"
      className="absolute right-0 top-[calc(100%+10px)] z-[73] w-[248px] rounded-xl border border-yellow-400/30 bg-[#1b1d24] p-3 text-left shadow-[0_14px_40px_rgba(0,0,0,0.5)]"
    >
      <span aria-hidden="true" className="absolute -top-[6px] right-6 h-3 w-3 rotate-45 border-l border-t border-yellow-400/30 bg-[#1b1d24]" />
      <div className="text-[13px] font-semibold text-white">习惯列表式操作？</div>
      <div className="mt-1 text-[12px] leading-5 text-gray-400">可以切换到经典版，参数和结果都在一页，随时还能切回画布。</div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-2.5 py-1 text-[12px] text-gray-400 hover:bg-white/5 hover:text-gray-200"
        >
          知道了
        </button>
        <button
          type="button"
          onClick={() => { markClassicModeGuideSeen(); onOpenClassicMode(); }}
          className="rounded-lg bg-yellow-400 px-2.5 py-1 text-[12px] font-semibold text-black hover:bg-yellow-300"
        >
          去看看
        </button>
      </div>
    </div>
  );
};
