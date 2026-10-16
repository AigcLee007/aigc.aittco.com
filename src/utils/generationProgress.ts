import type { NodeData } from '../../types';

// Shared migration origin for old nodes, including persistence and tooltip views.
// The bounded cache contains timestamps only, never image data or node objects.
const legacyStarts = new Map<string, number>();
export function resolveGenerationStartedAt(node: NodeData, now = Date.now()): number {
  if (Number.isFinite(node.generationStartedAt) && node.generationStartedAt! > 0) {
    legacyStarts.delete(node.id);
    return node.generationStartedAt!;
  }
  if (!node.loading) {
    legacyStarts.delete(node.id);
    return now;
  }
  if (!legacyStarts.has(node.id)) {
    legacyStarts.set(node.id, now);
    if (legacyStarts.size > 256) legacyStarts.delete(legacyStarts.keys().next().value!);
  }
  return legacyStarts.get(node.id)!;
}

// Several routes use 0 while waiting and 100 for either terminal outcome.
// Only intermediate values establish that a response carries useful progress.
export function readTaskProgress(payload: unknown, depth = 0): number | undefined {
  if (!payload || typeof payload !== 'object' || depth > 4) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['progress', 'percentage', 'percent']) {
    const raw = record[key];
    const value = typeof raw === 'number' ? raw
      : typeof raw === 'string' && /^\d+(?:\.\d+)?\s*%?$/.test(raw.trim())
        ? Number(raw.trim().replace(/\s*%$/, '')) : NaN;
    if (Number.isFinite(value) && value > 0 && value < 100) return value;
  }
  for (const key of ['data', 'task', 'result']) {
    const value = readTaskProgress(record[key], depth + 1);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function getGenerationProgress(node: NodeData, now: number, fallbackStartedAt = now) {
  const startedAt = Number.isFinite(node.generationStartedAt) && node.generationStartedAt! > 0
    ? node.generationStartedAt! : fallbackStartedAt;
  const elapsedMs = Math.max(0, now - startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  const elapsedLabel = `已等待 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  if (node.error) return { percent: 0, percentLabel: '', statusText: '生成失败', elapsedLabel };
  if (!node.loading) {
    const complete = !!(node.src || node.assetId);
    return { percent: complete ? 100 : 0, percentLabel: complete ? '100%' : '', statusText: complete ? '生成完成' : '等待生成', elapsedLabel };
  }

  const reported = node.progressSource === 'reported' ? readTaskProgress({ progress: node.progress }) : undefined;
  const percent = reported !== undefined ? Math.floor(reported)
    : Math.min(95, Math.floor(1 + 95 * (1 - Math.exp(-elapsedMs / 90_000))));
  const percentLabel = `${reported === undefined ? '预计 ' : ''}${percent}%`;
  const longWait = elapsedMs >= 180_000;
  const queued = ['QUEUED', 'IN_QUEUE'].includes(String(node.generationStatus || '').trim().toUpperCase());
  const statusText = node.generationConnectionStatus === 'recovering' ? '连接中断，正在恢复任务'
    : node.generationConnectionStatus === 'unconfirmed' ? '尚未确认受理，请核对历史记录'
    : queued
    ? longWait ? '排队时间较长，仍在等待' : '正在排队，等待开始生成'
    : !node.taskId && !node.generationStatus
      ? longWait ? '提交耗时较长，等待服务器确认' : '正在提交，等待服务器确认'
      : longWait ? '生成耗时较长，仍在等待结果' : node.type === 'VIDEO' ? '正在生成视频' : '正在生成图片';

  return { percent, percentLabel, statusText, elapsedLabel };
}
