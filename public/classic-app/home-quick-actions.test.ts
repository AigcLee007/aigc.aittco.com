import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const document = new DOMParser().parseFromString(
  readFileSync(resolve(process.cwd(), 'public/classic-app/index.html'), 'utf8'),
  'text/html',
);

describe('classic home quick actions', () => {
  it('shows purchase and support actions in the home toolbar', () => {
    const toolbar = document.querySelector('.classic-toolbar-tool-row');
    const purchaseLink = toolbar?.querySelector('a[href="https://item.taobao.com/item.htm?id=1058856152173"]');
    const supportButton = toolbar?.querySelector('button[onclick="openSupportModal()"]');

    expect(purchaseLink).not.toBeNull();
    expect(purchaseLink?.textContent).toContain('充值');
    expect(purchaseLink?.getAttribute('target')).toBe('_blank');
    expect(supportButton).not.toBeNull();
    expect(supportButton?.textContent).toContain('客服');
  });

  it('labels the upscale mode as 8K超清 and shows the shared badge', () => {
    const upscaleTab = document.querySelector('#classicModeUpscale');

    expect(upscaleTab?.textContent).toContain('8K超清');
    expect(upscaleTab?.querySelector('img')?.getAttribute('src')).toBe('/8k-ultra-hd.svg');
  });
});
