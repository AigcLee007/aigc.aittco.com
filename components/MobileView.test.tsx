import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../src/store/canvasStore', () => ({
  useCanvasStore: (selector: (state: { nodes: never[] }) => unknown) => selector({ nodes: [] }),
}));
vi.mock('../src/store/selectionStore', () => ({
  useSelectionStore: () => ({ openLightbox: vi.fn(), setControlPanelOpen: vi.fn(), setToolMode: vi.fn() }),
}));
vi.mock('../src/components/ImageRetentionNotice', () => ({ ImageRetentionNotice: () => null }));

import MobileView from './MobileView';

describe('canvas mobile home actions', () => {
  afterEach(cleanup);

  it('shows purchase and support actions in the mobile header', () => {
    const onOpenSupport = vi.fn();
    render(
      <MobileView
        onOpenSettings={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenCanvas={vi.fn()}
        onOpenClassicMode={vi.fn()}
        onOpenSupport={onOpenSupport}
      />,
    );

    expect(screen.getByRole('link', { name: '购买额度' }).getAttribute('href')).toBe(
      'https://item.taobao.com/item.htm?id=1058856152173',
    );
    fireEvent.click(screen.getByRole('button', { name: '联系客服' }));
    expect(onOpenSupport).toHaveBeenCalledTimes(1);
  });
});
