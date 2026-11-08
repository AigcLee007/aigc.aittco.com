import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImageHoverTooltip from './ImageHoverTooltip';
import type { NodeData } from '../types';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('waits 300ms before showing the stored model and keeps its card inside the viewport', () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 240 } as DOMRect);
  const node: NodeData = { id: 'hover', type: 'IMAGE', x: 0, y: 0, width: 512, height: 288, generationInfo: { source: 'generated', modelName: '历史模型', routeLabel: '历史线路' } };
  const view = render(<ImageHoverTooltip node={node} x={window.innerWidth - 4} y={window.innerHeight - 4} />);
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => { vi.advanceTimersByTime(299); });
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  const tooltip = screen.getByRole('tooltip');
  expect(screen.getByText('历史模型')).toBeTruthy();
  expect(parseFloat(tooltip.style.left) + 300).toBeLessThanOrEqual(window.innerWidth - 12);
  expect(parseFloat(tooltip.style.top) + 240).toBeLessThanOrEqual(window.innerHeight - 12);
  view.unmount();
  expect(screen.queryByRole('tooltip')).toBeNull();
});
