import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../src/store/canvasStore', () => ({
  useCanvasStore: (selector: (state: { nodes: unknown[] }) => unknown) => selector({ nodes: [{id:'image-info',type:'IMAGE',src:'/fixture.png',prompt:'测试图片',generationInfo:{source:'generated',modelName:'历史模型',routeLabel:'历史线路'}}] }),
}));
vi.mock('../src/store/selectionStore', () => ({
  useSelectionStore: () => ({ openLightbox: vi.fn(), setControlPanelOpen: vi.fn(), setToolMode: vi.fn() }),
}));
vi.mock('../src/components/ImageRetentionNotice', () => ({ ImageRetentionNotice: () => null }));
vi.mock('../src/components/AssetImage', () => ({ AssetImage: () => <div>图片预览</div> }));

import MobileView from './MobileView';

describe('canvas mobile home actions', () => {
  afterEach(cleanup);

  it('opens generation details directly from the mobile image card', () => {
    render(<MobileView onOpenSettings={vi.fn()} onOpenHistory={vi.fn()} onOpenCanvas={vi.fn()} onOpenClassicMode={vi.fn()} onOpenSupport={vi.fn()} />);
    const info = screen.getByRole('button', { name: '信息' });
    expect(info.parentElement?.closest('button')).toBeNull();
    fireEvent.click(info);
    expect(screen.getByRole('dialog', { name: '图片信息' }).textContent).toContain('历史模型');
    expect(screen.getByRole('dialog', { name: '图片信息' }).textContent).toContain('历史线路');
  });

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

    expect(screen.getByRole('link', { name: '充值' }).getAttribute('href')).toBe(
      'https://item.taobao.com/item.htm?id=1058856152173',
    );
    fireEvent.click(screen.getByRole('button', { name: '客服' }));
    expect(onOpenSupport).toHaveBeenCalledTimes(1);
  });
});
