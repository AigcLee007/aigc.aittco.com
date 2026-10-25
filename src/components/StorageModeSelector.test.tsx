import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TransferModeToggle } from './StorageModeSelector';
import { imageResultStore } from '../services/imageResultStore';

describe('TransferModeToggle', () => {
  afterEach(() => { localStorage.clear(); });

  it('switches fast transfer on link lines and shares the preference', () => {
    render(<TransferModeToggle supported />);
    const toggle = screen.getByRole('switch', { name: '极速传输' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(imageResultStore.getStorageModePreference()).toBe('fast');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('is disabled and shown off on lines that return image data', () => {
    imageResultStore.setStorageModePreference('fast');
    render(<TransferModeToggle supported={false} />);
    const toggle = screen.getByRole('switch', { name: '极速传输' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toContain('此线路不支持');
  });

  it('reads values saved by earlier builds', () => {
    localStorage.setItem('image-storage-mode-v1', 'speed');
    expect(imageResultStore.getStorageModePreference()).toBe('fast');
    localStorage.setItem('image-storage-mode-v1', 'stable');
    expect(imageResultStore.getStorageModePreference()).toBe('standard');
  });
});
