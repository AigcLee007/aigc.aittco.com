import { expect, it } from 'vitest';
import type { NodeData } from '../../types';
import type { GenerationRecord } from './generationRecordService';
import { canvasHistoryPreviewUpdates } from './canvasHistoryPreviews';

const original = { id: 'original', type: 'IMAGE', taskId: 'job-old', generationOwnerId: 'owner', generationResultIndex: 1,
  src: '/expired/original.png', assetId: 'result:v1:owner:job-old:1', width: 300, height: 200, x: 10, y: 20 } as NodeData;
const history = { id: 'old-record', userId: 'owner', status: 'SUCCESS', taskId: 'job-old',
  resultUrls: ['/expired/first.png', '/expired/original.png'], meta: { previewUrls: ['/first.preview.webp?token=preview.x', '/second.preview.webp?token=preview.y'] } } as unknown as GenerationRecord;

it('fills a retained canvas preview from durable history after ephemeral job metadata has expired', () => {
  expect(canvasHistoryPreviewUpdates([original], [history], 'owner')).toEqual([{ id: 'original', thumbnailSrc: '/second.preview.webp?token=preview.y' }]);
});
it('does not overwrite edited images or expose another account result', () => {
  expect(canvasHistoryPreviewUpdates([{ ...original, assetId: 'edited-local', src: 'asset:edited-local', generationResultSrc: original.src }], [history], 'owner')).toEqual([]);
  expect(canvasHistoryPreviewUpdates([original], [history], 'other')).toEqual([]);
});
it('does not repeatedly write an already retained preview', () => {
  expect(canvasHistoryPreviewUpdates([{ ...original, thumbnailSrc: '/second.preview.webp?token=preview.y' }], [history], 'owner')).toEqual([]);
});
