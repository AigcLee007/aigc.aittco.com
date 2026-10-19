import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { useCanvasStore } from '../store/canvasStore';
import { historyManager } from './HistoryManager';

const node = (id: string) => ({ id, type: 'IMAGE' as const, x: 0, y: 0, width: 100, height: 100 });
const store = () => useCanvasStore.getState();

beforeEach(async () => {
  await useCanvasStore.persist.rehydrate();
  store().setNodes([], true);
  historyManager.clear();
});

it('undoes arrangement without losing results completed after the command', () => {
  store().setNodes([{ ...node('a'), loading: true, src: '' }], true);
  store().setNodes(store().nodes.map(n => ({ ...n, x: 200 })));
  store().updateNode('a', { loading: false, src: '/completed.png', assetId: 'result' }, true);
  store().undo();
  expect(store().nodes[0]).toMatchObject({ x: 0, loading: false, src: '/completed.png', assetId: 'result' });
  store().redo();
  expect(store().nodes[0]).toMatchObject({ x: 200, loading: false, src: '/completed.png', assetId: 'result' });
});

it('preserves background-restored nodes when undoing and redoing an earlier layout', () => {
  store().setNodes([node('old')], true);
  store().setNodes([{ ...node('old'), x: 200 }]);
  const generated = Array.from({ length: 4 }, (_, i) => ({ ...node(`result-${i}`), src: `/result-${i}.png` }));
  generated.forEach(n => store().addNode(n, true));
  store().undo();
  expect(store().nodes).toHaveLength(5);
  store().redo();
  expect(store().nodes.slice(1)).toEqual(generated);
});

it('restores completed results when redoing their placeholder insertion', () => {
  store().setNodes([node('old')], true);
  store().setNodes([node('old'), { ...node('new'), loading: true, src: '' }]);
  store().updateNode('new', { loading: false, src: '/completed.png' }, true);
  store().undo();
  expect(store().nodes.map(n => n.id)).toEqual(['old']);
  store().redo();
  expect(store().nodes[1]).toMatchObject({ loading: false, src: '/completed.png' });
});

it('keeps clear and undo explicit without deleting later background additions', () => {
  store().setNodes([node('old')], true);
  store().setNodes([]);
  store().addNode(node('later'), true);
  store().undo();
  expect(store().nodes.map(n => n.id)).toEqual(['old', 'later']);
  store().redo();
  expect(store().nodes.map(n => n.id)).toEqual(['later']);
});
