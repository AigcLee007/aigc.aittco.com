import type { ImageGenerationInfo, NodeData } from '../../types';
import type { GenerationRecord } from './generationRecordService';

// Keep historical names, not a lookup into today's editable model/route catalog.
export function sanitizeGenerationInfo(value: unknown): ImageGenerationInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (!['generated', 'uploaded', 'processed'].includes(String(input.source))) return undefined;
  const result: ImageGenerationInfo = { source: input.source as ImageGenerationInfo['source'] };
  if (result.source !== 'generated') return result;
  for (const key of ['modelId', 'modelName', 'routeId', 'routeLabel', 'recordId', 'outputSize', 'aspectRatio'] as const) {
    const text = typeof input[key] === 'string' ? input[key].trim().slice(0, 256) : '';
    if (text) result[key] = text;
  }
  return result;
}

export function generationInfoFromRecord(record: GenerationRecord): ImageGenerationInfo {
  return sanitizeGenerationInfo({ source: 'generated', modelId: record.modelId, modelName: record.modelName,
    routeId: record.routeId, routeLabel: record.routeLabel, recordId: record.id,
    outputSize: record.outputSize, aspectRatio: record.aspectRatio })!;
}

export function canvasGenerationInfoUpdates(nodes: NodeData[], records: GenerationRecord[], ownerId: string) {
  const byTask = new Map(records.filter(record => record.userId === ownerId && record.status === 'SUCCESS')
    .map(record => [String(record.meta?.imageJobId || record.taskId || ''), record]));
  return nodes.flatMap(node => {
    if (node.type !== 'IMAGE' || node.loading || node.error || node.generationOwnerId !== ownerId || !node.taskId
      || (node.generationInfo && node.generationInfo.source !== 'generated')) return [];
    const record = byTask.get(node.taskId);
    if (!record || (node.generationInfo?.recordId && node.generationInfo.recordId !== record.id)) return [];
    const slot = node.generationResultIndex || 0;
    const assetId = `result:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(node.taskId)}:${slot}`;
    const original = node.assetId === assetId || !!(node.generationResultSrc && node.src === node.generationResultSrc)
      || !!(node.src && record.resultUrls?.[slot] === node.src);
    if (!original) return [];
    const generationInfo = generationInfoFromRecord(record);
    if (JSON.stringify(node.generationInfo) === JSON.stringify(generationInfo)) return [];
    return [{ id: node.id, generationInfo }];
  });
}
