import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassicModeGuide } from './ClassicModeGuide';

describe('ClassicModeGuide', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('appears once for a first-time user and stays closed after 知道了', () => {
    const { unmount } = render(<ClassicModeGuide onOpenClassicMode={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(1300); });
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(<ClassicModeGuide onOpenClassicMode={() => {}} />);
    act(() => { vi.advanceTimersByTime(1300); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches to classic and is not shown again', () => {
    const open = vi.fn();
    render(<ClassicModeGuide onOpenClassicMode={open} />);
    act(() => { vi.advanceTimersByTime(1300); });
    fireEvent.click(screen.getByRole('button', { name: '去看看' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('classic-mode-guide-seen-v1')).toBe('1');
  });
});
