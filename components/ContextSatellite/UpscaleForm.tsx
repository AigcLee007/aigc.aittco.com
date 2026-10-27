import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchUpscaleOptions,
  fetchUpscaleQuote,
  type UpscaleEngine,
  type UpscaleQuote,
} from '../../src/services/upscaleApi';

export interface UpscaleChoice {
  engine: string;
  factor: number;
  format: string | null;
  engineLabel: string;
  quote: UpscaleQuote;
}

interface UpscaleFormProps {
  /** Pixel size of the image being upscaled, read from the real file. */
  width: number;
  height: number;
  /** Called every time the choice is valid (and with null while it is not), so the host can enable its button. */
  onChange: (choice: UpscaleChoice | null) => void;
}

const FORMAT_LABELS: Record<string, string> = { png: 'PNG', jpg: 'JPG', webp: 'WebP' };
const formatPixels = (width: number, height: number) => `${width} × ${height}`;

const canTake = (item: UpscaleEngine) => (item.usableFactors ? item.usableFactors.length > 0 : true);
const factorsOf = (item: UpscaleEngine) => item.usableFactors ?? item.factors;
const formatsAt = (item: UpscaleEngine, factor: number): string[] =>
  item.formats ? (item.formatsByFactor ? item.formatsByFactor[String(factor)] ?? [] : item.formats) : [];

const chip = (selected: boolean) =>
  `min-w-[52px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${selected ? 'border-transparent bg-linear-to-r from-yellow-300 to-orange-400 font-bold text-black shadow-[0_6px_18px_rgba(250,204,21,0.25)]' : 'border-white/15 bg-white/[0.04] text-gray-200 hover:border-yellow-300/50'}`;

// The engine / scale / format picker with its live price. It owns no buttons: the dialog and the
// canvas panel each put their own "confirm" around it, so both always show the same price.
export const UpscaleForm: React.FC<UpscaleFormProps> = ({ width, height, onChange }) => {
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
    setEngines(null);
    setLoadError('');
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

  useEffect(() => {
    onChange(enabled && engine && quote && !quoteError
      ? { engine: engine.id, factor, format, engineLabel: engine.label, quote }
      : null);
  }, [enabled, engine, quote, quoteError, factor, format]);

  const pickEngine = (next: UpscaleEngine) => {
    if (!canTake(next)) return;
    setEngineId(next.id);
    const usable = factorsOf(next);
    if (!usable.includes(factor)) setFactor(next.defaultFactor || usable[usable.length - 1]);
  };

  return (
    <div>
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
                className={`flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all ${!canTake(item) ? 'cursor-not-allowed border-white/5 opacity-40' : item.id === engineId ? 'border-yellow-300 bg-linear-to-br from-yellow-300/15 to-orange-400/5 shadow-[0_0_0_1px_rgba(253,224,71,0.3),0_10px_26px_rgba(250,204,21,0.08)]' : 'border-white/10 bg-white/[0.03] hover:border-yellow-300/45'}`}
              >
                <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${item.id === engineId ? 'border-yellow-300' : 'border-white/30'}`} aria-hidden="true">
                  {item.id === engineId && <span className="h-2 w-2 rounded-full bg-yellow-300" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-white">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-400">{canTake(item) ? item.description : '这张图尺寸太大，此方式暂不支持'}</span>
                </span>
              </button>
            ))}
          </div>

          {engine && factorsOf(engine).length > 1 && (
            <div className="mt-4" role="radiogroup" aria-label="放大倍数">
              <div className="mb-2 text-xs font-semibold text-gray-400">放大倍数</div>
              <div className="flex flex-wrap gap-2">
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
              <div className="mb-2 text-xs font-semibold text-gray-400">输出格式</div>
              <div className="flex flex-wrap gap-2">
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

          <div className="mt-4 min-h-[58px] rounded-2xl border border-yellow-300/20 bg-linear-to-br from-yellow-300/10 to-white/[0.03] px-4 py-3 text-sm" aria-live="polite">
            {quoteError && <span className="text-red-400">{quoteError}</span>}
            {!quoteError && !quote && <span className="flex items-center gap-2 text-gray-400"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> 正在计算价格…</span>}
            {quote && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold text-gray-400">输出尺寸</span>
                  <span className="text-[15px] font-bold text-white">{formatPixels(quote.outputWidth, quote.outputHeight)}</span>
                </span>
                <span className="flex items-baseline gap-1 text-yellow-300">
                  <span className="text-2xl font-black leading-none">{quote.points}</span>
                  <span className="text-xs font-bold">金币</span>
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">图片将发送到云端处理，结果在服务器保留 5 小时，请及时下载。失败会自动退回金币。</p>
    </div>
  );
};
