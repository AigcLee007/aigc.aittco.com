import { describe, expect, it } from 'vitest';
import {
  fitImageInFrame,
  framePointToImagePoint,
  isPointInImageFrame,
} from './canvasImageFit';

describe('fitImageInFrame', () => {
  it('uses the whole frame when the image and frame have the same ratio', () => {
    expect(fitImageInFrame(1024, 1024, 512, 512)).toEqual({
      x: 0,
      y: 0,
      width: 512,
      height: 512,
    });
  });

  it('centers a landscape image without cropping it', () => {
    expect(fitImageInFrame(1920, 1080, 512, 512)).toEqual({
      x: 0,
      y: 112,
      width: 512,
      height: 288,
    });
  });

  it('centers a portrait image inside a landscape frame', () => {
    expect(fitImageInFrame(512, 1024, 512, 288)).toEqual({
      x: 184,
      y: 0,
      width: 144,
      height: 288,
    });
  });

  it('rejects invalid image or frame dimensions', () => {
    expect(() => fitImageInFrame(0, 1080, 512, 512)).toThrow(RangeError);
    expect(() => fitImageInFrame(1920, 1080, 512, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('ignores pointer positions in letterbox areas and maps visible points to image coordinates', () => {
    const fit = fitImageInFrame(1920, 1080, 512, 512);

    expect(isPointInImageFrame({ x: 100, y: 100 }, fit)).toBe(false);
    expect(isPointInImageFrame({ x: 100, y: 150 }, fit)).toBe(true);
    expect(framePointToImagePoint({ x: 100, y: 150 }, fit)).toEqual({ x: 100, y: 38 });
  });
});
