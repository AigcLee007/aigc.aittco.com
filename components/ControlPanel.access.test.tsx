import 'fake-indexeddb/auto';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ session: vi.fn(), balance: vi.fn() }));
vi.mock('../services/geminiService', () => ({ checkBalance: mocks.balance }));
vi.mock('../src/services/accountIdentity', async original => ({
  ...await original<typeof import('../src/services/accountIdentity')>(),
  fetchCurrentAuthSession: mocks.session,
}));
vi.mock('../src/hooks/useImageRouteCatalog', () => ({ useImageRouteCatalog: () => ({}) }));
vi.mock('../src/hooks/useImageModelCatalog', () => ({ useImageModelCatalog: () => ({}) }));
vi.mock('../src/hooks/useVideoRouteCatalog', () => ({ useVideoRouteCatalog: () => ({}) }));
vi.mock('../src/hooks/useVideoModelCatalog', () => ({ useVideoModelCatalog: () => ({}) }));
vi.mock('react-draggable', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./ImageFormConfig', () => ({ default: () => <div>已验证的图片配置</div> }));
vi.mock('./VideoFormConfig', () => ({ default: () => <div>已验证的视频配置</div> }));
vi.mock('../services/promptService', () => ({ fetchPromptToolConfig: async () => ({}), optimizePrompt: vi.fn() }));

import ControlPanel from './ControlPanel';
import { useSelectionStore } from '../src/store/selectionStore';
import { setStoredAuthSessionToken } from '../src/services/accountIdentity';

describe('canvas permission verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setStoredAuthSessionToken('session-a');
    useSelectionStore.setState({ apiKey: '', panelMode: 'IMAGE', prompt: 'a flower', selectedIds: [], referenceImages: [] });
  });

  it('keeps generation locked on a verification outage, then allows an explicit successful retry', async () => {
    mocks.session.mockRejectedValueOnce(new Error('登录状态验证超时，请重试'))
      .mockResolvedValueOnce({ authenticated: true, user: { userId: 'admin-a' } });
    const { container } = render(<ControlPanel onInitGenerations={vi.fn()} onUpdateGeneration={vi.fn()} onOpenBatchModal={vi.fn()} />);
    await screen.findByText('登录状态验证超时，请重试');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await screen.findByText('已验证的图片配置');
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false));
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('preserves session recovery with a saved key (valid=%s)', async keyValid => {
    mocks.session.mockRejectedValueOnce(new Error('登录状态验证超时，请重试'))
      .mockResolvedValueOnce({ authenticated: true, user: { userId: 'admin-a' } });
    mocks.balance.mockResolvedValue({ success: keyValid });
    useSelectionStore.setState({ apiKey: 'saved-api-key-12345' });
    const { container } = render(<ControlPanel onInitGenerations={vi.fn()} onUpdateGeneration={vi.fn()} onOpenBatchModal={vi.fn()} />);
    await waitFor(() => expect(mocks.balance).toHaveBeenCalledTimes(1));
    await screen.findByText('登录状态验证超时，请重试');
    if (keyValid) {
      expect(screen.getByText('已验证的图片配置')).toBeTruthy();
      expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    }
    act(() => useSelectionStore.setState({ panelMode: 'VIDEO' }));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(screen.queryByText('请先登录后使用视频生成')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await screen.findByText('已验证的视频配置');
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false));
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });

  it('labels the upscale mode as 8K超清 and shows the shared badge', async () => {
    mocks.session.mockResolvedValue({ authenticated: true, user: { userId: 'admin-a' } });
    await act(async () => {
      render(<ControlPanel onInitGenerations={vi.fn()} onUpdateGeneration={vi.fn()} onOpenBatchModal={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const upscaleTab = screen.getByRole('tab', { name: '8K超清' });
    expect(upscaleTab.querySelector('img')?.getAttribute('src')).toBe('/8k-ultra-hd.svg');
  });
});
