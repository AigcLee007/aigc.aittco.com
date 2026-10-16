import type { NodeData } from '../../types';
import type { GenerationRecord } from './generationRecordService';
import { imageResultStore } from './imageResultStore';
import { getLocalLine4ThumbnailUrl } from '../utils/generatedImageStorage';

export const isRetainedPreview = (value?: string) => !!value && (/\.preview\.webp\?/.test(value) || value.includes('/generated-assets/line4/thumb/'));

// Update only existing original-result nodes. Account history never recreates
// the user's layout or replaces an edited/imported image with its old result.
export function canvasHistoryPreviewUpdates(nodes: NodeData[], records: GenerationRecord[], ownerId: string) {
  const byJob = new Map(records.filter(record => record.userId === ownerId && record.status === 'SUCCESS')
    .map(record => [String(record.meta?.imageJobId || record.taskId || ''), record]));
  return nodes.flatMap(node => {
    if (node.type !== 'IMAGE' || node.loading || node.error || node.generationOwnerId !== ownerId || !node.taskId) return [];
    const record = byJob.get(node.taskId);
    if (!record) return [];
    const slot = node.generationResultIndex || 0;
    const assetId = imageResultStore.resultId(ownerId, node.taskId, slot);
    const source = record.resultUrls?.[slot];
    const displaysOriginal = node.assetId === assetId || !!(node.generationResultSrc && node.src === node.generationResultSrc)
      || !!(source && source === node.src);
    if (!displaysOriginal) return [];
    const previews = Array.isArray(record.meta?.previewUrls) ? record.meta.previewUrls : [];
    const thumbnailSrc = String(previews[slot] || (slot === 0 ? record.previewUrl : '') || getLocalLine4ThumbnailUrl(source) || '');
    if (!isRetainedPreview(thumbnailSrc) || node.thumbnailSrc === thumbnailSrc) return [];
    return [{ id: node.id, thumbnailSrc }];
  });
}
