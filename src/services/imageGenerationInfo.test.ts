import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { sanitizePersistedNode } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import type { NodeData } from '../../types';
import type { GenerationRecord } from './generationRecordService';
import { canvasGenerationInfoUpdates, sanitizeGenerationInfo } from './imageGenerationInfo';

const generationInfo = { source: 'generated', modelId: 'model-old', modelName: '生成时的模型', routeId: 'route-old', routeLabel: '生成时的线路', recordId: 'record-1', outputSize: '1K', aspectRatio: '16:9' };

it('retains generation snapshots on the canvas and each image version after persistence', () => {
  const node = { id: 'n', type: 'IMAGE', x: 0, y: 0, width: 512, height: 288, src: '/result.png', generationInfo,
    history: [{ src: '/old.png', generationInfo: { ...generationInfo, modelName: '旧版本模型' } }] } as unknown as NodeData;
  const saved = sanitizePersistedNode(node) as any;
  expect(saved.generationInfo).toEqual(generationInfo);
  expect(saved.history[0].generationInfo.modelName).toBe('旧版本模型');
  expect((sanitizePersistedNode({ ...node, generationInfo: undefined } as any) as any).generationInfo).toBeUndefined();
});

it('retains snapshots through local history compaction and reload', async () => {
  await useHistoryStore.persist.rehydrate();
  const hook = renderHook(() => useHistoryStore());
  act(() => { useHistoryStore.setState({ logs: [{ id: 'info-history', time: '2026-11-09T08:12:00Z', prompt: 'dream', imageUrl: '/result.png', type: 'IMAGE', generationInfo } as any] }); });
  act(() => { useHistoryStore.getState().compactLogs(); });
  await act(async () => useHistoryStore.persist.rehydrate());
  expect((hook.result.current.logs.find(log => log.id === 'info-history') as any)?.generationInfo).toEqual(generationInfo);
});

it('backfills only matching originals owned by the current account and keeps edited versions separate', () => {
  const original: NodeData = { id: 'original', type: 'IMAGE', x: 0, y: 0, width: 512, height: 288, generationOwnerId: 'owner', taskId: 'job-old', assetId: 'result:v1:owner:job-old:0' };
  const record = { id: 'record-1', userId: 'owner', taskId: 'job-old', status: 'SUCCESS', modelName: '生成时的模型', routeLabel: '生成时的线路' } as GenerationRecord;
  expect(canvasGenerationInfoUpdates([original], [record], 'owner')[0].generationInfo).toMatchObject({ modelName: '生成时的模型', routeLabel: '生成时的线路' });
  expect(canvasGenerationInfoUpdates([original], [record], 'other')).toEqual([]);
  expect(canvasGenerationInfoUpdates([{ ...original, assetId: 'local-edit' }], [record], 'owner')).toEqual([]);
  expect(canvasGenerationInfoUpdates([{ ...original, generationInfo: { source: 'generated', recordId: 'new-edit-record', modelName: '编辑模型' } }], [record], 'owner')).toEqual([]);
});

it('stores only public snapshot fields and never attributes an upload to an old model', () => {
  expect(sanitizeGenerationInfo({ ...generationInfo, apiKey: 'secret', baseUrl: 'private' })).toEqual(generationInfo);
  expect(sanitizeGenerationInfo({ ...generationInfo, source: 'uploaded' })).toEqual({ source: 'uploaded' });
});
