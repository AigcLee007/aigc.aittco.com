import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, set } from 'idb-keyval';
import { historyManager } from '../commands/HistoryManager';
import { useCanvasStore } from '../store/canvasStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { assetStorage } from './assetStorage';
import { runLocalCacheMaintenance } from './localCacheMaintenance';

const sourceNode = (src: string) => ({
  id: 'source-node', type: 'IMAGE' as const, src, x: 0, y: 0, width: 300, height: 200,
});

async function seedMappedOriginal(src: string, id: string) {
  const blob = new Blob(['offline original'], { type: 'image/png' });
  await set(`asset-${id}`, blob);
  await set(`asset-meta-${id}`, { createdAt: Date.now() - 8 * 86400000, bytes: blob.size, mime: blob.type });
  await set(`asset-source-${src}`, id);
}

beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  await Promise.all([useCanvasStore.persist.rehydrate(), useHistoryStore.persist.rehydrate(), useSelectionStore.persist.rehydrate()]);
  await clear();
  historyManager.clear();
  useCanvasStore.getState().setNodes([], true);
  useHistoryStore.setState({ logs: [] });
  useSelectionStore.setState({ referenceImages: [] });
});

afterEach(() => {
  historyManager.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('source-only image ownership during cache maintenance', () => {
  it('keeps an expired URL\'s cached original while a deleted node remains undoable', async () => {
    const src = 'https://expired.example/undo.png';
    await seedMappedOriginal(src, 'undo-original');
    useCanvasStore.getState().setNodes([sourceNode(src)], true);
    useCanvasStore.getState().deleteNode('source-node');

    expect((await runLocalCacheMaintenance({ force: true })).removed).toBe(0);
    expect(await assetStorage.getBlob('undo-original')).toBeTruthy();
    historyManager.undo();
    expect(useCanvasStore.getState().nodes[0].src).toBe(src);
  });

  it('keeps the source-only original in a redo snapshot', async () => {
    const src = 'https://expired.example/redo.png';
    await seedMappedOriginal(src, 'redo-original');
    useCanvasStore.getState().addNode(sourceNode(src));
    historyManager.undo();

    expect((await runLocalCacheMaintenance({ force: true })).removed).toBe(0);
    historyManager.redo();
    expect(await assetStorage.getBlob('redo-original')).toBeTruthy();
  });

  it('keeps a replaced source held by an update command', async () => {
    const src = 'https://expired.example/replaced.png';
    await seedMappedOriginal(src, 'replaced-original');
    useCanvasStore.getState().setNodes([sourceNode(src)], true);
    useCanvasStore.getState().updateNode('source-node', { src: '/replacement.png' });

    expect((await runLocalCacheMaintenance({ force: true })).removed).toBe(0);
    historyManager.undo();
    expect(useCanvasStore.getState().nodes[0].src).toBe(src);
    expect(await assetStorage.getBlob('replaced-original')).toBeTruthy();
  });

  it('keeps sources from a canvas replacement and its node history', async () => {
    const src = 'https://expired.example/replaced-canvas.png';
    const oldSrc = 'https://expired.example/node-history.png';
    await seedMappedOriginal(src, 'canvas-original');
    await seedMappedOriginal(oldSrc, 'history-original');
    useCanvasStore.getState().setNodes([{ ...sourceNode(src), history: [{ src: oldSrc }] }], true);
    useCanvasStore.getState().setNodes([]);

    expect((await runLocalCacheMaintenance({ force: true })).removed).toBe(0);
    expect(await assetStorage.getBlob('canvas-original')).toBeTruthy();
    expect(await assetStorage.getBlob('history-original')).toBeTruthy();
  });

  it('protects a mapped original when its source becomes referenced during cleanup', async () => {
    const src = 'https://expired.example/late-reference.png';
    await seedMappedOriginal(src, 'late-original');
    const getMeta = assetStorage.getMeta.bind(assetStorage);
    vi.spyOn(assetStorage, 'getMeta').mockImplementation(async id => {
      const meta = await getMeta(id);
      if (id === 'late-original') useCanvasStore.getState().addNode(sourceNode(src));
      return meta;
    });

    expect((await runLocalCacheMaintenance({ force: true })).removed).toBe(0);
    expect(await assetStorage.getBlob('late-original')).toBeTruthy();
  });

  it('releases source ownership after command history is cleared', async () => {
    const src = 'https://expired.example/unreferenced.png';
    await seedMappedOriginal(src, 'unused-original');
    useCanvasStore.getState().addNode(sourceNode(src));
    historyManager.undo();
    historyManager.clear();

    expect(useCanvasStore.getState().nodes).toEqual([]);
    const result = await runLocalCacheMaintenance({ force: true });
    expect(result.skipped).toBe(false);
    expect(result.removed).toBe(1);
    expect(await assetStorage.getBlob('unused-original')).toBeUndefined();
  });
});
