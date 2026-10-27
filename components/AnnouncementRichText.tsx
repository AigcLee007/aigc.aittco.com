import React, { useMemo } from 'react';
import { announcementToHtml } from '../src/services/announcementMarkup';

interface AnnouncementRichTextProps {
  content: string;
  className?: string;
  onImageClick?: (src: string) => void;
}

// The renderer escapes all text and only emits whitelisted tags, so the HTML is safe to inject.
const AnnouncementRichText: React.FC<AnnouncementRichTextProps> = ({ content, className = '', onImageClick }) => {
  const html = useMemo(() => announcementToHtml(content), [content]);
  return (
    <div
      className={`announcement-rich ${className}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (onImageClick && target instanceof HTMLImageElement && target.dataset.annImg) {
          onImageClick(target.src);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default AnnouncementRichText;
