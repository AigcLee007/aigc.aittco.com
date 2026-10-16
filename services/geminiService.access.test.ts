import { afterEach, expect, it, vi } from 'vitest';
import { checkBalance } from './geminiService';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('ends API-key verification when response headers or body stall', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })));
  const pending = expect(checkBalance('fixture-test-key')).rejects.toThrow('API Key 验证超时，请重试');
  await vi.advanceTimersByTimeAsync(12001);
  await pending;
}, 1000);
