import type { NodeData } from '../../types';
import { imageResultStore, type ImageResultInput } from './imageResultStore';

// Node IDs are explicit associations for unmanaged results; prompts/URLs never
// establish ownership or link distinct jobs.
export function canvasResultIdentity(node: NodeData, source: string, serverCompletedAt?: string): ImageResultInput | undefined {
  if (!node.generationOwnerId) return undefined;
  const completedAt=serverCompletedAt ? Date.parse(serverCompletedAt) : NaN;
  let cloudBacked=false;
  try {
    const url=new URL(source,globalThis.location?.origin || 'http://localhost');
    cloudBacked=url.origin===(globalThis.location?.origin || 'http://localhost') && /^\/(api\/image-job-assets|generated-assets)\//.test(url.pathname) && Number.isFinite(completedAt);
  } catch { /* Provider URLs with unknown retention are never safe to evict. */ }
  return {
    ownerId: node.generationOwnerId,
    jobId: node.taskId?.startsWith('job-') ? node.taskId : node.clientRequestId ? `request-${node.clientRequestId}` : node.taskId || `node-${node.id}`,
    outputIndex: node.generationResultIndex || 0,
    originalUrl: source,
    previewUrl: node.thumbnailSrc,
    createdAt: node.generationStartedAt || (node.createdAt ? Date.parse(node.createdAt) : undefined),
    storageStatus: node.generationStorageStatus,
    // Only the immutable server completion establishes expiry. Browser delivery
    // can happen hours later and must never extend the cache eviction window.
    cloudBacked,
    cloudExpiresAt:cloudBacked ? completedAt+4*3600000 : undefined,
  };
}

export async function registerCanvasResult(node:NodeData,source:string,serverCompletedAt?:string){
  const identity=canvasResultIdentity(node,source,serverCompletedAt);
  if(!identity)return undefined;
  const info=await imageResultStore.register(identity);
  if(node.assetId && node.assetId!==info.id)await imageResultStore.adoptLegacy(info.id,node.assetId,identity.ownerId);
  return info;
}
