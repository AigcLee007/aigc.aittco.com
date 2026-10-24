import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppVersionBadge } from './AppVersionBadge';

describe('AppVersionBadge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the built commit and exposes the build time for operators', () => {
    vi.stubGlobal('__APP_COMMIT__', 'abc1234');
    vi.stubGlobal('__APP_BUILT_AT__', '2026-10-25T08:30:00.000Z');
    render(<AppVersionBadge />);
    const badge = screen.getByTestId('app-version-badge');
    expect(badge.textContent).toBe('abc1234');
    expect(badge.getAttribute('title')).toMatch(/^版本 abc1234 · 构建于 2026-10-25 \d{2}:30$/);
  });

  it('falls back to unknown when no build metadata was injected', () => {
    vi.stubGlobal('__APP_COMMIT__', undefined);
    vi.stubGlobal('__APP_BUILT_AT__', undefined);
    render(<AppVersionBadge />);
    expect(screen.getByTestId('app-version-badge').textContent).toBe('unknown');
  });
});
