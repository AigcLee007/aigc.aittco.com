import React from 'react';
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SingleImageToolbar from './SingleImageToolbar';
import { useCanvasStore } from '../src/store/canvasStore';
import { useSelectionStore } from '../src/store/selectionStore';
import { ToolMode } from '../types';
import { useGlobalShortcuts } from '../src/hooks/useGlobalShortcuts';

beforeEach(() => {
  useCanvasStore.setState({ nodes: [{ id: 'image', type: 'IMAGE', x: 0, y: 0, width: 512, height: 288, src: '/result.png', prompt: '梦境', createdAt: '2026-11-09T08:12:00Z' }] });
  useSelectionStore.setState({ selectedIds: ['image'], toolMode: ToolMode.SELECT });
});

it('opens image information for a selected old image without guessing its model or route', () => {
  render(<SingleImageToolbar onUpscale={vi.fn()} onCompare={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '信息' }));
  const dialog = screen.getByRole('dialog', { name: '图片信息' });
  expect(within(dialog).getAllByText('未记录').length).toBeGreaterThanOrEqual(2);
  expect(within(dialog).getByText('梦境')).toBeTruthy();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows full original generation names and distinguishes uploaded images', () => {
  const generationInfo = { source: 'generated', modelName: 'GPT-Image-2.6-Sunburst', routeLabel: '特价4K', outputSize: '1K', aspectRatio: '16:9' };
  act(() => { useCanvasStore.setState({ nodes: [{ ...useCanvasStore.getState().nodes[0], generationInfo } as any] }); });
  render(<SingleImageToolbar onUpscale={vi.fn()} onCompare={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '信息' }));
  expect(screen.getByText('GPT-Image-2.6-Sunburst')).toBeTruthy();
  expect(screen.getByText('特价4K')).toBeTruthy();
  expect(screen.getByRole('button', { name: '复制模型名称' })).toBeTruthy();
  act(() => { useCanvasStore.setState({ nodes: [{ ...useCanvasStore.getState().nodes[0], generationInfo: { source: 'uploaded' } } as any] }); });
  expect(screen.getByText('用户上传')).toBeTruthy();
  expect(screen.queryByText('GPT-Image-2.6-Sunburst')).toBeNull();
});

it('keeps canvas shortcuts out of the dialog while preserving native text copy', () => {
  const remove = vi.fn();
  function Shortcuts() { useGlobalShortcuts(useCanvasStore.getState().nodes, remove, vi.fn()); return null; }
  render(<><Shortcuts /><SingleImageToolbar onUpscale={vi.fn()} onCompare={vi.fn()} /></>);
  fireEvent.click(screen.getByRole('button', { name: '信息' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Delete' });
  expect(remove).not.toHaveBeenCalled();
  const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
  fireEvent(dialog, copy);
  expect(copy.defaultPrevented).toBe(false);
});
