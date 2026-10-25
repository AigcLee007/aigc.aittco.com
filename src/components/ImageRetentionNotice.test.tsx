import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageRetentionNotice } from './ImageRetentionNotice';
import { imageResultStore } from '../services/imageResultStore';
import * as routes from '../config/imageRoutes';

describe('ImageRetentionNotice', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('states the 4-hour cloud copy in standard mode', () => {
    render(<ImageRetentionNotice />);
    expect(screen.getByRole('note').textContent).toContain('原图云端仅保留 4 小时');
  });

  it('says originals are not kept when fast transfer applies to the line', () => {
    vi.spyOn(routes, 'getSelectedImageRoute').mockReturnValue({ resultKind: 'url' } as any);
    render(<ImageRetentionNotice />);
    act(() => imageResultStore.setStorageModePreference('fast'));
    expect(screen.getByRole('note').textContent).toContain('不在云端保存');
  });

  it('keeps the 4-hour notice on lines that return image data even when fast is on', () => {
    vi.spyOn(routes, 'getSelectedImageRoute').mockReturnValue({ resultKind: 'inline' } as any);
    imageResultStore.setStorageModePreference('fast');
    render(<ImageRetentionNotice />);
    expect(screen.getByRole('note').textContent).toContain('原图云端仅保留 4 小时');
  });
});
