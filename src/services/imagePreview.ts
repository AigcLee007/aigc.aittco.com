import { bounded, ImageAssetError } from './imageAssetTypes';
import { imageDimensions } from './imageDimensions';
export const PREVIEW_EDGE = 720;
export const PREVIEW_VERSION = 1;
let decodeTail: Promise<unknown> = Promise.resolve();

export async function decodeImage(url: string, timeoutMs = 15000): Promise<HTMLImageElement> {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => img.naturalWidth ? resolve(img) : reject(new ImageAssetError('DECODE', '图片无法解码'));
    img.onerror = () => reject(new ImageAssetError('DECODE', '图片无法解码'));
    img.src = url;
  });
  try { return await bounded(loading, timeoutMs); }
  catch (error) { img.src = ''; throw error; }
  finally { img.onload = img.onerror = null; }
}

export function createPreview(blob: Blob, validateOnly = false): Promise<{blob: Blob; width: number; height: number}> {
  const deadline = Date.now() + 45000;
  const job = decodeTail.catch(() => {}).then(async () => {
    if (Date.now() > deadline) throw new ImageAssetError('TIMEOUT','预览图读取超时，请重试');
    let bitmap: ImageBitmap | undefined; let img: HTMLImageElement | undefined; let url: string | undefined;
    const canvas = document.createElement('canvas');
    try {
      const dimensions=await imageDimensions(blob);
      if (typeof createImageBitmap === 'function') {
        const ratio=dimensions ? Math.min(1,PREVIEW_EDGE/Math.max(dimensions.width,dimensions.height)) : 1;
        const pending = dimensions ? createImageBitmap(blob,{resizeWidth:Math.max(1,Math.round(dimensions.width*ratio)),resizeHeight:Math.max(1,Math.round(dimensions.height*ratio)),resizeQuality:'high'}) : createImageBitmap(blob);
        try { bitmap = await bounded(pending); }
        catch (error) { void pending.then(late => late.close(), () => {}); throw error; }
      } else { url = URL.createObjectURL(blob); img = await decodeImage(url); }
      const width = dimensions?.width || bitmap?.width || img!.naturalWidth, height = dimensions?.height || bitmap?.height || img!.naturalHeight;
      if (!width || !height) throw new ImageAssetError('DECODE', '图片无法解码');
      if(validateOnly)return {blob,width,height};
      const ratio = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new ImageAssetError('DECODE', '预览图创建失败');
      context.drawImage(bitmap || img!, 0, 0, canvas.width, canvas.height);
      const preview = await bounded(new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new ImageAssetError('DECODE', '预览图创建失败')), 'image/webp', 0.85)));
      return {blob:preview,width,height};
    } finally {
      bitmap?.close(); if (img) img.src = ''; if (url) URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    }
  });
  decodeTail = job; return job;
}
