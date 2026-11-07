export function imageFileExtension(src: string, mime = ''): string {
  const mimeFormat = mime.toLowerCase().match(/^image\/(png|jpe?g|webp|gif|avif)(?:;|$)/)?.[1];
  const sourceFormat = src.toLowerCase().match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/)?.[1]
    || src.toLowerCase().match(/^data:image\/(png|jpe?g|webp|gif|avif)[;,]/)?.[1];
  const format = mimeFormat || sourceFormat || 'png';
  return format === 'jpeg' ? 'jpg' : format;
}
