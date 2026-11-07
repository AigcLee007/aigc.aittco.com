import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGifAnimation } from './useGifAnimation';
import { originalMemorySnapshot } from '../services/imageMemoryBudget';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const tiny = Buffer.from('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBFAABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7', 'base64');
// A valid wide 1K logical screen with 16 tiny frame patches. Reserving a
// full-resolution decoded buffer for every frame would exceed the 96MB budget.
const wide = Buffer.concat([
  Buffer.from('GIF89a'), Buffer.from([0, 6, 0, 4, 0x80, 0, 0, 255, 0, 0, 0, 255, 0]),
  ...Array.from({length: 16}, (_, index) => Buffer.from([
    0x21, 0xf9, 4, 0, 20, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
    2, 2, index % 2 ? 0x4c : 0x44, 1, 0,
  ])),
  Buffer.from([0x3b]),
]);

it.each([['two-frame GIF', tiny], ['16-frame wide 1K GIF', wide]])('plays %s and releases memory on unmount', async (_, data) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(data)));
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  const context = { clearRect: vi.fn(), putImageData: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any);
  const onFrame = vi.fn();
  const { result, unmount } = renderHook(() => useGifAnimation('blob:animated', true, onFrame));
  await waitFor(() => expect(result.current).toBeInstanceOf(HTMLCanvasElement));
  await waitFor(() => expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(originalMemorySnapshot().count).toBe(1);
  unmount();
  expect(originalMemorySnapshot().count).toBe(0);
  const frames = onFrame.mock.calls.length;
  await act(() => new Promise(resolve => setTimeout(resolve, 250)));
  expect(onFrame.mock.calls.length).toBe(frames);
});
