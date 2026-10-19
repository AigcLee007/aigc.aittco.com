import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { parseWindow, diagnoseWindow } = require('./diagnose-image-window.cjs');

describe('read-only image incident diagnosis', () => {
  it('requires explicit timezones and converts the screenshot window to UTC', () => {
    expect(parseWindow(['2026-10-19T01:15:00+08:00', '2026-10-19T01:25:00+08:00', 'acct-test'])).toEqual({
      since: '2026-10-18 17:15:00.000', until: '2026-10-18 17:25:00.000', accountId: 'acct-test',
    });
    expect(() => parseWindow(['2026-10-19T01:15:00', '2026-10-19T01:25:00'])).toThrow();
    expect(() => parseWindow(['2026-10-20T00:00:00Z', '2026-10-19T00:00:00Z'])).toThrow();
  });
  it('reconciles gross reservations and refunds without equating charges with successes', async () => {
    const ledger = [3, 4.5, 3, 3.4, 12, 12, 12].map((points, i) => ({ id: `c${i}`, accountId: 'a', type: 'charge', points }));
    ledger.push(...[12, 12, 12].map((points, i) => ({ id: `r${i}`, accountId: 'a', type: 'refund', points })));
    const execute = vi.fn().mockResolvedValueOnce([ledger]).mockResolvedValueOnce([[
      { status: 'SUCCESS', accountId: 'a' }, { status: 'FAILED', accountId: 'a', emptyPrompt: 1 },
    ]]).mockResolvedValueOnce([[]]);
    const report = await diagnoseWindow({ execute }, { since: '2026-10-18 17:15:00.000', until: '2026-10-18 17:25:00.000', accountId: 'a' });
    expect(report.accounts).toEqual([{ accountId: 'a', charges: 7, refunds: 3, reservedPoints: 49.9, refundedPoints: 36, netSpentPoints: 13.9 }]);
    expect(report.recordSummary).toEqual({ success: 1, failed: 1, pending: 0, emptyPrompt: 1 });
    for (const [sql, params] of execute.mock.calls) {
      expect(sql.trim()).toMatch(/^SELECT /);
      expect(sql).not.toContain('SELECT *');
      expect(params).toContain('a');
    }
  });
});
