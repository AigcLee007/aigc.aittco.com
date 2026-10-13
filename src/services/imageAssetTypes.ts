export interface ImageAssetRef { assetId?: string; src?: string; thumbnailSrc?: string }
export type AssetVariant = 'preview' | 'original';
export type ImageAssetStatus = 'reading' | 'ready' | 'missing' | 'failed' | 'deferred';
export class ImageAssetError extends Error {
  constructor(public code: 'EMPTY' | 'NOT_FOUND' | 'TIMEOUT' | 'DECODE' | 'NETWORK' | 'BUDGET', message: string) { super(message); }
}
// Settle IDB and network operations even when their underlying API cannot abort.
export function bounded<T>(operation: Promise<T>, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImageAssetError('TIMEOUT', '图片读取超时')), timeoutMs);
    operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
