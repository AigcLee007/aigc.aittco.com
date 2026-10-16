import { get, keys, setMany, update, createStore, promisifyRequest } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import { createPreview, PREVIEW_VERSION } from './imagePreview';
import { bounded, ImageAssetError } from './imageAssetTypes';
import { takePreviewPreparationSlot } from './imagePreparationQueue';
import { imageResultStore } from './imageResultStore';

export interface AssetMeta { createdAt: number; width?: number; height?: number; bytes: number; mime: string; previewVersion?: number; previewBytes?: number; sharedResult?: boolean }
const previews = new Map<string, Promise<Blob>>();
const withAssetStore = createStore('keyval-store', 'keyval');
const pins = new Map<string, number>();
export const pinAsset = (id: string): (() => void) => {
  const releaseShared = id.startsWith('result:v1:') ? imageResultStore.pin(id) : () => {};
  pins.set(id, (pins.get(id) || 0) + 1);
  let released=false;
  return () => { if(released)return;released=true;releaseShared();const count = (pins.get(id) || 1) - 1; if (count) pins.set(id,count); else pins.delete(id); };
};
export const pinnedAssetIds = () => Array.from(pins.keys());
export const isValidAssetBlob = (value: unknown): value is Blob => value instanceof Blob && value.size > 0 && (!value.type || value.type.startsWith('image/'));

export const assetStorage = {
  async storeBlob(blob: Blob): Promise<string> {
    if (!isValidAssetBlob(blob)) throw new ImageAssetError('DECODE', '不是有效图片');
    const id=uuidv4();
    // Original commits first; failed preview creation never loses original bytes.
    await bounded(setMany([[`asset-${id}`,blob],[`asset-meta-${id}`,{createdAt:Date.now(),bytes:blob.size,mime:blob.type} satisfies AssetMeta]]));
    return id;
  },
  async getBlob(id: string): Promise<Blob | undefined> { return bounded(get(`asset-${id}`)); },
  async getMeta(id: string): Promise<AssetMeta | undefined> { return bounded(get(`asset-meta-${id}`)); },
  async ensurePreview(id: string, force = false): Promise<Blob> {
    const existing=previews.get(id); if (existing) return existing;
    const unpin=pinAsset(id);
    const work=(async () => {
      const releasePreparation=await takePreviewPreparationSlot();
      try {
      const [cached,meta]=await Promise.all([bounded(get<Blob>(`asset-preview-${id}`)),this.getMeta(id)]);
      if (!force && isValidAssetBlob(cached) && meta?.previewVersion === PREVIEW_VERSION) return cached;
      const original=await this.getBlob(id);
      if (!isValidAssetBlob(original)) throw new ImageAssetError('NOT_FOUND', '本地图片不存在');
      const preview=await createPreview(original);
      try {
        if (id.startsWith('result:v1:')) await imageResultStore.putPreview(id,preview.blob,{width:preview.width,height:preview.height,previewVersion:PREVIEW_VERSION});
        else {
          await bounded(setMany([[`asset-preview-${id}`,preview.blob]]));
          // Merge at commit: another tab may link this legacy source while its
          // preview is decoding. A stale metadata snapshot could drop protection.
          await bounded(update<AssetMeta>(`asset-meta-${id}`, current => ({
            ...current,createdAt:current?.createdAt || meta?.createdAt || Date.now(),bytes:original.size,mime:original.type,width:preview.width,height:preview.height,previewVersion:PREVIEW_VERSION,previewBytes:preview.blob.size
          })));
        }
      } catch { /* A full local cache must not discard a usable small preview. */ }
      return preview.blob;
      }finally{releasePreparation();}
    })();
    previews.set(id,work);
    try { return await work; } finally { previews.delete(id); unpin(); }
  },
  async deleteBlob(id: string): Promise<boolean> {
    // Shared results may still be used by classic or another canvas. Their byte
    // budget owns eviction, independently of this canvas's node references.
    if (pins.has(id) || id.startsWith('result:v1:')) return false;
    let deleted = false;
    await bounded(withAssetStore('readwrite', store => {
      const committed = promisifyRequest(store.transaction);
      const request = store.get(`asset-meta-${id}`);
      request.onsuccess = () => {
        if (pins.has(id) || request.result?.sharedResult) return;
        [`asset-${id}`,`asset-preview-${id}`,`asset-meta-${id}`].forEach(key => store.delete(key));
        deleted = true;
      };
      return committed;
    }));
    return deleted;
  },
  async cleanupUnusedAssets(activeIds: Iterable<string>, currentReferences?: () => Iterable<string>): Promise<{removed:number;kept:number}> {
    const active=new Set([...activeIds,...pins.keys()]); let removed=0,kept=0;
    for (const key of await keys()) {
      if (typeof key!=='string' || !key.startsWith('asset-') || key.startsWith('asset-meta-') || key.startsWith('asset-preview-') || key.startsWith('asset-source-')) continue;
      const id=key.slice(6), meta=await this.getMeta(id);
      // Unknown legacy assets remain recoverable; do not guess their ownership.
      if (id.startsWith('result:v1:') || meta?.sharedResult || active.has(id) || pins.has(id) || !meta || Date.now()-meta.createdAt < 7*86400000 || (currentReferences && new Set(currentReferences()).has(id))) { kept++; continue; }
      if (await this.deleteBlob(id)) removed++; else kept++;
    }
    return {removed,kept};
  },
  // Compatibility: this short-lived URL is owned and revoked by its caller.
  async getAssetUrl(id: string): Promise<string | null> { const blob=await this.getBlob(id); return isValidAssetBlob(blob) ? URL.createObjectURL(blob) : null; },
};
