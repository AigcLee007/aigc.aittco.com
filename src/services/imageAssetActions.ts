import { useCanvasStore } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import type { ImageAssetRef } from './imageAssetTypes';
import { readOriginalBlob } from './imageAssetCache';

export const assetActionSource = (ref: ImageAssetRef): string => ref.src || (ref.assetId ? `asset:${ref.assetId}` : '');
export function assetRefFromSource(src: string): ImageAssetRef {
  if (src.startsWith('asset:')) return {assetId:src.slice(6)};
  const node=useCanvasStore.getState().nodes.find(n=>n.type==='IMAGE' && n.src===src);
  if(node)return node;
  const log=useHistoryStore.getState().logs.find(l=>l.type==='IMAGE' && l.imageUrl===src);
  return log ? {assetId:log.assetId,src:log.imageUrl,thumbnailSrc:log.thumbnailUrl} : {src};
}
export const originalBlobFromSource = (src: string,options:{validate?:boolean}={}) => readOriginalBlob(assetRefFromSource(src),15000,options);
