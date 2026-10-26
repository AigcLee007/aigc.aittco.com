import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Maximize2, X } from 'lucide-react';
import {
  fetchUpscaleOptions,
  fetchUpscaleQuote,
  type UpscaleEngine,
  type UpscaleQuote,
} from '../../src/services/upscaleApi';

interface UpscaleDialogProps {
  /** Pixel size of the image being upscaled, read from the real file. */
  width: number;
  height: number;
  onConfirm: (choice: { engine: string; factor: number; format: string | null; engineLabel: string }) => void;
  onCancel: () => void;
}

const FORMAT_LABELS: Record<string, string> = { png: 'PNG', jpg: 'JPG', webp: 'WebP' };
const formatPixels = (width: number, height: number) => `${width} × ${height}`;

const canTake = (item: UpscaleEngine) => (item.usableFactors ? item.usableFactors.length > 0 : true);
const factorsOf = (item: UpscaleEngine) => item.usableFactors ?? item.factors;
const formatsAt = (item: UpscaleEngine, factor: number): string[] =>
  item.formats ? (item.formatsByFactor ? item.formatsByFactor[String(factor)] ?? [] : item.formats) : [];

const chip = (selected: boolean) =>
  `rounded-full border px-3 py-1 text-xs ${selected ? 'border-white/60 bg-white/10 text-white' : 'border-white/10 text-gray-300 hover:bg-white/5'}`;

export const UpscaleDialog: React.FC<UpscaleDialogProps> = ({ width, height, onConfirm, onCancel }) => {
  const [engines, setEngines] = useState<UpscaleEngine[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [engineId, setEngineId] = useState('');
  const [factor, setFactor] = useState(2);
  const [format, setFormat] = useState<string | null>(null);
  const [quote, setQuote] = useState<UpscaleQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchUpscaleOptions({ width, height })
      .then((options) => {
        if (cancelled) return;
        setEnabled(options.enabled);
        setEngines(options.engines);
        // Open on the first engine that can take this image, at a factor that works.
        const first = options.engines.find(canTake) || options.engines[0];
        if (first) {
          const startFactor = first.defaultFactor || factorsOf(first)[factorsOf(first).length - 1];
          setEngineId(first.id);
          setFactor(startFactor);
          setFormat(formatsAt(first, startFactor)[0] ?? null);
        }
      })
      .catch(() => { if (!cancelled) setLoadError('暂时无法获取放大方式，请稍后再试'); });
    return () => { cancelled = true; };
  }, [width, height]);

  const engine = useMemo(() => engines?.find((item) => item.id === engineId) || null, [engines, engineId]);
  const availableFormats = engine ? formatsAt(engine, factor) : [];

  // Keep the format valid when the factor or engine changes (PNG drops out for large outputs).
  useEffect(() => {
    if (!engine?.formats) { setFormat(null); return; }
    if (!format || !availableFormats.includes(format)) setFormat(availableFormats[0] ?? null);
  }, [engine, factor, availableFormats.join(','), format]);

  // The price is asked from the server so the number shown is the number charged.
  useEffect(() => {
    if (!engine) return;
    if (engine.formats && !format) return;
    let cancelled = false;
    setQuote(null);
    setQuoteError('');
    fetchUpscaleQuote({ engine: engine.id, factor, format, width, height })
      .then((value) => { if (!cancelled) setQuote(value); })
      .catch((error: any) => { if (!cancelled) setQuoteError(error?.message || '无法计算价格'); });
    return () => { cancelled = true; };
  }, [engine, factor, format, width, height]);

  const pickEngine = (next: UpscaleEngine) => {
    if (!canTake(next)) return;
    setEngineId(next.id);
    const usable = factorsOf(next);
    if (!usable.includes(factor)) setFactor(next.defaultFactor || usable[usable.length - 1]);
  };

  const canConfirm = enabled && !!engine && !!quote && !quoteError;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="upscale-title" onClick={onCancel}>
      <div className="max-h-[92vh] w-[min(92vw,440px)] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-5 text-gray-200 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="upscale-title" className="flex items-center gap-2 text-base font-semibold text-white">
            <Maximize2 size={18} aria-hidden="true" /> 高清放大
          </h2>
          <button type="button" onClick={onCancel} aria-label="关闭" className="rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-xs text-gray-400">当前图片 {formatPixels(width, height)}</p>

        {loadError && <p role="alert" className="mb-3 text-sm text-red-400">{loadError}</p>}
        {!engines && !loadError && (
          <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> 正在读取…</p>
        )}
        {engines && !enabled && <p role="alert" className="mb-3 text-sm text-amber-400">高清放大暂未开通，请联系管理员。</p>}
        {engines && enabled && engines.length === 0 && <p role="alert" className="mb-3 text-sm text-amber-400">暂无可用的放大方式。</p>}

        {engines && enabled && engines.length > 0 && (
          <>
            <div role="radiogroup" aria-label="放大方式" className="space-y-2">
              {engines.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === engineId}
                  aria-disabled={!canTake(item)}
                  onClick={() => pickEngine(item)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${!canTake(item) ? 'cursor-not-allowed border-white/5 opacity-40' : item.id === engineId ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'}`}
                >
                  <div className="text-sm font-medium text-white">{item.label}</div>
                  <div className="mt-0.5 text-xs text-gray-400">{canTake(item) ? item.description : '这张图尺寸太大，此方式暂不支持'}</div>
                </button>
              ))}
            </div>

            {engine && factorsOf(engine).length > 1 && (
              <div className="mt-4" role="radiogroup" aria-label="放大倍数">
                <div className="mb-1.5 text-xs text-gray-400">放大倍数</div>
                <div className="flex flex-wrap gap-1.5">
                  {factorsOf(engine).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={value === factor} onClick={() => setFactor(value)} className={chip(value === factor)}>
                      {value === 1 ? '原尺寸增强' : `${value} 倍`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {engine?.formats && (
              <div className="mt-4" role="radiogroup" aria-label="输出格式">
                <div className="mb-1.5 text-xs text-gray-400">输出格式</div>
                <div className="flex flex-wrap gap-1.5">
                  {engine.formats.map((value) => {
                    const allowed = availableFormats.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={value === format}
                        aria-disabled={!allowed}
                        disabled={!allowed}
                        title={allowed ? undefined : '图片放大后较大，此格式文件会超过保存上限'}
                        onClick={() => setFormat(value)}
                        className={`${chip(value === format)} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {FORMAT_LABELS[value] || value.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                {availableFormats.length < engine.formats.length && (
                  <p className="mt-1.5 text-[11px] text-gray-500">输出较大时 PNG 不可选，可选 JPG 或 WebP。</p>
                )}
              </div>
            )}

            <div className="mt-4 min-h-[44px] rounded-xl bg-white/5 px-3 py-2 text-sm" aria-live="polite">
              {quoteError && <span className="text-red-400">{quoteError}</span>}
              {!quoteError && !quote && <span className="flex items-center gap-2 text-gray-400"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> 正在计算价格…</span>}
              {quote && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">输出 {formatPixels(quote.outputWidth, quote.outputHeight)}</span>
                  <span className="font-semibold text-white">{quote.points} 金币</span>
                </div>
              )}
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">图片将发送到云端处理，结果在服务器保留 5 小时，请及时下载。失败会自动退回金币。</p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-gray-300 hover:bg-white/10">取消</button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => engine && onConfirm({ engine: engine.id, factor, format, engineLabel: engine.label })}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quote ? `确认放大 · ${quote.points} 金币` : '确认放大'}
          </button>
        </div>
      </div>
    </div>
  );
};
