import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchGenerationRecord, BatchGenerationSettings } from '../src/services/batchGenerationTypes';
import { BatchWorkspace, type BatchWorkspaceController } from './BatchWorkspace';

const settings: BatchGenerationSettings = {
  modelId: 'nano-banana',
  routeId: 'route-a',
  aspectRatio: '1:1',
  imageSize: '1k',
  outputCount: 1,
  concurrency: 3,
  autoDownload: false,
};

const controllerFor = (batches: BatchGenerationRecord[] = []) => ({
  ownerId: 'owner-a',
  loading: false,
  batches,
  activeBatchId: null,
  createBatch: vi.fn(async () => 'new-batch'),
  replaceGroups: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => {}),
  getBatchRoutes: vi.fn(() => []),
  getBatchSizes: vi.fn(() => ['1k']),
  startBatch: vi.fn(async () => {}),
  pauseBatch: vi.fn(async () => {}),
  retryTasks: vi.fn(async () => {}),
  duplicateBatch: vi.fn(async () => 'copy-batch'),
  deleteBatch: vi.fn(async () => {}),
}) satisfies BatchWorkspaceController;

afterEach(() => vi.unstubAllGlobals());

describe('batch workbench', () => {
  it('opens from the full-screen batch workspace and creates the selected generation mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const controller = controllerFor();
    const onClose = vi.fn();
    render(<BatchWorkspace controller={controller} initialSettings={settings} onClose={onClose} onLocateNode={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '批量生图工作台' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '图生图批次' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(controller.createBatch).toHaveBeenCalledWith('i2i', settings);
  });
});
