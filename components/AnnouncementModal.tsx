import React, { useEffect } from 'react';
import { Megaphone, X } from 'lucide-react';
import AnnouncementRichText from './AnnouncementRichText';

interface AnnouncementModalProps {
  title: string;
  dateText?: string;
  content: string;
  images?: string[];
  /** Small line above the title, used by the admin preview. */
  banner?: string;
  /** Replaces the default "我知道了" button. */
  footer?: React.ReactNode;
  /** Opens pictures in a new tab; the admin preview turns this off because its pictures are local. */
  interactiveImages?: boolean;
  onClose: () => void;
}

// The one announcement dialog. The live popup and the admin preview both render this, so what an
// admin previews is exactly what users get. Header and footer stay put; only the body scrolls.
const AnnouncementModal: React.FC<AnnouncementModalProps> = ({
  title,
  dateText,
  content,
  images,
  banner,
  footer,
  interactiveImages = true,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openImage = (src: string) => {
    if (interactiveImages) window.open(src, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 px-3 backdrop-blur-sm animate-in fade-in duration-200 sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-label={title || '系统公告'}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-[min(780px,100%)] flex-col overflow-hidden rounded-2xl border border-yellow-500/25 bg-[#18181b] shadow-[0_30px_80px_rgba(0,0,0,0.6)] animate-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-gradient-to-r from-yellow-500/12 to-transparent px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="shrink-0 rounded-xl bg-yellow-500/12 p-2.5 text-yellow-400">
              <Megaphone size={22} />
            </div>
            <div className="min-w-0">
              {banner && <div className="mb-0.5 text-xs text-yellow-300">{banner}</div>}
              <h3 className="truncate text-lg font-semibold tracking-wide text-white sm:text-xl">{title || '系统公告'}</h3>
              {dateText && <span className="mt-0.5 block text-xs text-gray-500">{dateText}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭公告"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={22} />
          </button>
        </div>

        <div className="sleek-scroll-y min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <AnnouncementRichText
            content={content}
            className="text-gray-200"
            onImageClick={interactiveImages ? openImage : undefined}
          />
          {!!images?.length && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, idx) => (
                <button
                  key={`${img}-${idx}`}
                  type="button"
                  onClick={() => openImage(img)}
                  className={`overflow-hidden rounded-xl border border-white/10 bg-black/20 ${interactiveImages ? 'cursor-zoom-in' : 'cursor-default'}`}
                >
                  <img src={img} alt={`公告图片${idx + 1}`} className="h-32 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-white/5 bg-white/[0.02] px-5 py-3.5 sm:px-8">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-yellow-400 px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-yellow-300"
            >
              我知道了
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnouncementModal;
