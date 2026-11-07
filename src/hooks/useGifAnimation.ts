import { useEffect, useId, useRef, useState } from 'react';
import { acquireOriginalImageLease } from '../services/imageMemoryBudget';

// Konva draws an HTMLImageElement's first frame. Composite GIF patches into a
// canvas so each timed frame also participates in normal canvas interaction.
export function useGifAnimation(url: string | undefined, enabled: boolean, onFrame: () => void) {
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const playerId = useId();
  const draw = useRef(onFrame);
  draw.current = onFrame;
  useEffect(() => {
    setImage(null);
    if (!enabled || !url) return;
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseMemory: (() => void) | null = null;
    const canvas = document.createElement('canvas');
    void (async () => {
      const [{ parseGIF, decompressFrame }, response] = await Promise.all([
        import('gifuct-js'), fetch(url, { signal: controller.signal }),
      ]);
      const bytes = await response.arrayBuffer();
      if (stopped) return;
      const gif = parseGIF(bytes);
      const width = gif.lsd.width, height = gif.lsd.height;
      if (!width || !height || width * height > 1572864 || gif.frames.length > 100) return;
      // Keep compressed frames and decode only the current patch. Reserve the
      // compositing canvases, disposal snapshot and current decoded frame.
      releaseMemory = acquireOriginalImageLease(`gif:${playerId}:${url}`, width, height * 5);
      if (!releaseMemory) return;
      const frames = gif.frames.filter(frame => 'image' in frame);
      if (stopped || !frames.length) {
        releaseMemory();
        releaseMemory = null;
        return;
      }
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const patch = document.createElement('canvas');
      const patchContext = patch.getContext('2d');
      if (!context || !patchContext) {
        releaseMemory();
        releaseMemory = null;
        return;
      }
      let index = 0;
      let previous: { dims: { left: number; top: number; width: number; height: number }; disposalType: number } | undefined;
      let restored: ImageData | undefined;
      const tick = () => {
        if (stopped) return;
        if (index === 0) context.clearRect(0, 0, width, height);
        else if (previous?.disposalType === 2) {
          const { left, top, width, height } = previous.dims;
          context.clearRect(left, top, width, height);
        } else if (previous?.disposalType === 3 && restored) {
          context.putImageData(restored, 0, 0);
        }
        const frame = decompressFrame(frames[index], gif.gct, true);
        restored = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : undefined;
        patch.width = frame.dims.width;
        patch.height = frame.dims.height;
        patchContext.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), patch.width, patch.height), 0, 0);
        context.drawImage(patch, frame.dims.left, frame.dims.top);
        draw.current();
        previous = { dims: frame.dims, disposalType: frame.disposalType };
        index = (index + 1) % frames.length;
        timer = setTimeout(tick, Math.max(20, frame.delay || 200));
      };
      tick();
      setImage(canvas);
    })().catch(error => {
      releaseMemory?.();
      releaseMemory = null;
      if (!stopped) console.warn('GIF playback could not start', error);
    });
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      releaseMemory?.();
      canvas.width = canvas.height = 0;
    };
  }, [url, enabled, playerId]);
  return image;
}
