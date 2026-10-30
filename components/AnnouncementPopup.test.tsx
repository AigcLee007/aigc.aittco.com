import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/services/accountService', () => ({ fetchBillingAccount: vi.fn().mockRejectedValue(new Error('no session')) }));
vi.mock('./PricingReferencePanel', () => ({ default: () => null }));
vi.mock('../src/components/ClassicModeGuide', () => ({
  ClassicModeGuide: () => null,
  markClassicModeGuideSeen: vi.fn(),
}));

import AnnouncementPopup from './AnnouncementPopup';

const item = (id: string, title: string, date: string) => ({ id, title, content: `${title}的正文`, active: true, date });
const ANNOUNCEMENTS = [
  item('old', '旧公告', '2026-10-01T00:00:00.000Z'),
  item('new', '最新公告', '2026-10-27T00:00:00.000Z'),
  item('mid', '中间公告', '2026-10-15T00:00:00.000Z'),
];

describe('announcement popup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: ANNOUNCEMENTS }) })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pops only the newest unread announcement for a new user, and does not chain to the next one', async () => {
    render(<AnnouncementPopup />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('最新公告的正文');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Give a (wrongly) re-triggered fetch time to open another dialog.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the older unread announcements as a red dot on the bell', async () => {
    render(<AnnouncementPopup />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const bell = screen.getByTitle('查看公告');
    expect(bell.querySelector('span.bg-red-500')).not.toBeNull();
  });

  it('does not pop again for a returning user who has read everything', async () => {
    localStorage.setItem('seen_announcement_ids', JSON.stringify(['old', 'new', 'mid']));
    render(<AnnouncementPopup />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the old-user rule: a returning user is only popped for what they have not read', async () => {
    localStorage.setItem('seen_announcement_ids', JSON.stringify(['old', 'new']));
    render(<AnnouncementPopup />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('中间公告的正文');
  });

  it('offers purchase and customer support from the home header', async () => {
    localStorage.setItem('seen_announcement_ids', JSON.stringify(['old', 'new', 'mid']));
    await act(async () => {
      render(<AnnouncementPopup />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const purchaseLink = screen.getByRole('link', { name: '购买额度' });
    expect(purchaseLink.getAttribute('href')).toBe('https://item.taobao.com/item.htm?id=1058856152173');
    expect(purchaseLink.getAttribute('target')).toBe('_blank');

    fireEvent.click(screen.getByRole('button', { name: '联系客服' }));
    const supportDialog = await screen.findByRole('dialog', { name: '联系客服' });
    expect(supportDialog.querySelector('img')?.getAttribute('alt')).toBe('微信客服二维码');
    fireEvent.click(screen.getByRole('button', { name: '关闭客服窗口' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '联系客服' })).toBeNull());
  });
});
