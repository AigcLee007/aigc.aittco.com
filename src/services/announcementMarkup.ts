// The same browser module is loaded by classic HTML and bundled into canvas.
import '../../public/shared/announcement-markup.js';

export interface AnnouncementMarkupApi {
  toHtml(source: string): string;
  toPlainText(source: string): string;
  FONT_STACKS: Record<string, string>;
  SIZE_MIN: number;
  SIZE_MAX: number;
}

const markup = (globalThis as unknown as { AnnouncementMarkup: AnnouncementMarkupApi }).AnnouncementMarkup;

export const announcementToHtml = (source: string) => markup.toHtml(source);
export const announcementToPlainText = (source: string) => markup.toPlainText(source);
export const ANNOUNCEMENT_SIZE_RANGE = { min: markup.SIZE_MIN, max: markup.SIZE_MAX };
