import { readOriginalBlob } from './imageAssetCache';
import type { NodeData } from '../../types';

interface CompareSliderApi {
  open: (options: {
    before: string; after: string; beforeLabel?: string; afterLabel?: string; title?: string;
    beforeSize?: string | null; afterSize?: string | null; onClose?: () => void;
  }) => { close: () => void } | null;
}
declare global { interface Window { CompareSlider?: CompareSliderApi } }

let loading: Promise<CompareSliderApi> | null = null;
const loadSlider = (): Promise<CompareSliderApi> => {
  if (window.CompareSlider) return Promise.resolve(window.CompareSlider);
  loading ||= new Promise<CompareSliderApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/shared/compare-slider.js?v=compare_v1';
    script.onload = () => (window.CompareSlider ? resolve(window.CompareSlider) : reject(new Error('对比组件加载失败')));
    script.onerror = () => { loading = null; reject(new Error('对比组件加载失败')); };
    document.head.append(script);
  });
  return loading;
};

const sizeOf = (blob: Blob) => new Promise<string | null>((resolve) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(`${image.naturalWidth} × ${image.naturalHeight}`); };
  image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  image.src = url;
});

// Opens the before / after slider for two canvas nodes. Both pictures are read through the same
// cache the canvas uses, so a local copy is preferred and nothing is downloaded twice.
export async function openNodeComparison(result: NodeData, source: NodeData): Promise<void> {
  const [slider, beforeBlob, afterBlob] = await Promise.all([loadSlider(), readOriginalBlob(source), readOriginalBlob(result)]);
  const urls = [URL.createObjectURL(beforeBlob), URL.createObjectURL(afterBlob)];
  const [beforeSize, afterSize] = await Promise.all([sizeOf(beforeBlob), sizeOf(afterBlob)]);
  const view = slider.open({
    before: urls[0], after: urls[1],
    beforeLabel: '放大前', afterLabel: result.upscaleOf?.engineLabel ? `放大后 · ${result.upscaleOf.engineLabel}` : '放大后',
    title: '放大前后对比', beforeSize, afterSize,
    // The object URLs live exactly as long as the overlay does.
    onClose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  });
  if (!view) urls.forEach((url) => URL.revokeObjectURL(url));
}
