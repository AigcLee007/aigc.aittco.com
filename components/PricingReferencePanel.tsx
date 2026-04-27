import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ReceiptText, Tags, X } from 'lucide-react';
import { useSelectionStore } from '../src/store/selectionStore';
import {
  getDefaultImageSizeForModel,
  getImageModelOptions,
  getImageModelSizeOptions,
  getNormalizedImageSizeForModel,
  shouldShowImageSizeSelector,
} from '../src/config/imageModels';
import {
  getImageRoutePointCost,
  getImageRouteOptions,
  getImageRoutesByModelFamily,
  getSelectedImageRoute,
} from '../src/config/imageRoutes';
import { useImageModelCatalog } from '../src/hooks/useImageModelCatalog';
import { useImageRouteCatalog } from '../src/hooks/useImageRouteCatalog';
import { formatPoint } from '../src/utils/pointFormat';
import CoinIcon from './CoinIcon';
import ImageModelIcon from './ImageModelIcon';

interface PricingReferencePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL_LINES = '__all__';

const formatSizeLabel = (size: string) => {
  const normalized = String(size || '').trim().toLowerCase();
  return normalized === 'auto' ? '自动' : normalized.toUpperCase();
};

const getFriendlyLineLabel = (line: string, fallback?: string) => {
  const normalized = String(line || '').trim().toLowerCase();
  const match = normalized.match(/^line\s*([0-9]+)$/i);
  if (match?.[1]) return `线路 ${match[1]}`;
  if (normalized === 'default') return '默认线路';
  return String(fallback || line || '线路').trim();
};

const PricingReferencePanel: React.FC<PricingReferencePanelProps> = ({
  isOpen,
  onClose,
}) => {
  const routeCatalog = useImageRouteCatalog();
  const modelCatalog = useImageModelCatalog();

  const {
    imageModel,
    imageLine,
    imageSize,
    quantity,
  } = useSelectionStore();

  const [lineFilter, setLineFilter] = useState(ALL_LINES);

  const models = useMemo(
    () => getImageModelOptions().filter((model) => model.isActive !== false),
    [modelCatalog.catalog],
  );

  const selectedRoute = getSelectedImageRoute(imageModel, imageLine);
  const selectedSize = getNormalizedImageSizeForModel(imageModel, imageSize);
  const selectedUnitCost = getImageRoutePointCost(selectedRoute, selectedSize);
  const selectedTotalCost = selectedUnitCost * Math.max(1, Number(quantity || 1));

  const lineOptions = useMemo(() => {
    const items = new Map<string, string>();
    models.forEach((model) => {
      getImageRoutesByModelFamily(model.routeFamily)
        .filter((route) => route.isActive !== false)
        .forEach((route) => {
          items.set(route.line, getFriendlyLineLabel(route.line, route.label));
        });
    });
    return Array.from(items.entries()).map(([value, label]) => ({ value, label }));
  }, [modelCatalog.catalog, models, routeCatalog.catalog]);

  const lowestPrices = useMemo(
    () =>
      models
        .map((model) => {
          const routes = getImageRoutesByModelFamily(model.routeFamily).filter(
            (route) => route.isActive !== false,
          );
          const sizeOptions = shouldShowImageSizeSelector(model.id)
            ? getImageModelSizeOptions(model.id)
            : [getDefaultImageSizeForModel(model.id)];
          const candidates = routes.flatMap((route) =>
            sizeOptions.map((size) => ({
              route,
              size,
              cost: getImageRoutePointCost(route, size),
            })),
          );
          const cheapest = candidates.sort((left, right) => left.cost - right.cost)[0];
          return cheapest ? { model, ...cheapest } : null;
        })
        .filter(Boolean),
    [modelCatalog.catalog, models, routeCatalog.catalog],
  );

  const rows = useMemo(
    () =>
      models.flatMap((model) => {
        const routes = getImageRoutesByModelFamily(model.routeFamily).filter((route) => {
          if (route.isActive === false) return false;
          return lineFilter === ALL_LINES ? true : route.line === lineFilter;
        });
        const sizeOptions = shouldShowImageSizeSelector(model.id)
          ? getImageModelSizeOptions(model.id)
          : [getDefaultImageSizeForModel(model.id)];

        return routes.map((route) => ({
          model,
          route,
          sizeOptions,
        }));
      }),
    [lineFilter, modelCatalog.catalog, models, routeCatalog.catalog],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 px-3 py-5 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-yellow-400/20 bg-[#10141d]/98 shadow-[0_30px_80px_rgba(0,0,0,0.62)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-linear-to-r from-yellow-400/[0.12] via-white/[0.03] to-transparent px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-yellow-400/25 bg-yellow-400/10 text-yellow-300">
                <ReceiptText size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-wide">价格表</h2>
                <p className="mt-0.5 text-xs text-gray-400">按模型、线路、画质尺寸查询单张消耗</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-white/10 bg-white/[0.025] p-4 sm:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/[0.08] p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white">
              <span className="text-gray-400">当前配置</span>
              <strong>{formatPoint(selectedTotalCost)}</strong>
              <CoinIcon size={16} />
              <span className="text-xs text-gray-400">
                {formatPoint(selectedUnitCost)} / 张 x {Math.max(1, Number(quantity || 1))} 张
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-400">
              {getFriendlyLineLabel(selectedRoute.line, selectedRoute.label)} / {formatSizeLabel(selectedSize)}
            </div>
          </div>

          <label className="relative flex min-w-[180px] items-center">
            <span className="sr-only">线路筛选</span>
            <select
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
              className="h-full w-full appearance-none rounded-xl border border-white/12 bg-[#171d29] px-3 py-2.5 pr-9 text-sm text-white outline-none transition-colors hover:border-white/25"
            >
              <option value={ALL_LINES}>全部线路</option>
              {lineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 text-gray-400" />
          </label>
        </div>

        {lowestPrices.length > 0 && (
          <div className="border-b border-white/10 bg-[#0d121b] px-4 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-yellow-200">最低价速览</div>
              <div className="text-[11px] text-gray-500">仅展示已启用模型和线路</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lowestPrices.map((item) => {
                if (!item) return null;
                return (
                  <div
                    key={item.model.id}
                    className="rounded-xl border border-yellow-400/25 bg-yellow-400/[0.08] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <ImageModelIcon iconKind={item.model.iconKind} variant="selector" />
                      <div className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                        {item.model.label}
                      </div>
                      <div className="flex items-center gap-1 rounded-lg bg-black/25 px-2 py-1 text-sm font-bold text-yellow-300">
                        <CoinIcon size={13} />
                        {formatPoint(item.cost)}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      {getFriendlyLineLabel(item.route.line, item.route.label)} / {formatSizeLabel(item.size)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="overflow-y-auto p-4">
          <div className="grid gap-3">
            {rows.map(({ model, route, sizeOptions }) => {
              const isCurrent =
                model.id === imageModel &&
                route.id === selectedRoute.id;
              const normalizedCurrentSize = getNormalizedImageSizeForModel(model.id, imageSize);
              return (
                <div
                  key={`${model.id}-${route.id}`}
                  className={`rounded-xl border p-3 transition-colors ${
                    isCurrent
                      ? 'border-yellow-400/40 bg-yellow-400/[0.08]'
                      : 'border-white/10 bg-white/[0.035]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ImageModelIcon iconKind={model.iconKind} variant="selector" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{model.label}</div>
                        <div className="text-[11px] text-gray-400">
                          {getFriendlyLineLabel(route.line, route.label)}
                        </div>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/25 bg-yellow-400/10 px-2 py-1 text-[11px] text-yellow-200">
                        <CheckCircle2 size={12} />
                        当前使用
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {sizeOptions.map((size) => {
                      const cost = getImageRoutePointCost(route, size);
                      const isSelectedSize = isCurrent && normalizedCurrentSize === size;
                      return (
                        <div
                          key={`${route.id}-${size}`}
                          className={`rounded-lg border px-3 py-2 ${
                            isSelectedSize
                              ? 'border-yellow-400/[0.45] bg-yellow-400/[0.12]'
                              : 'border-white/[0.08] bg-black/[0.18]'
                          }`}
                        >
                          <div className="text-[11px] text-gray-400">{formatSizeLabel(size)}</div>
                          <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-yellow-300">
                            <CoinIcon size={13} />
                            {formatPoint(cost)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs leading-5 text-gray-400">
            <Tags size={14} className="mt-0.5 shrink-0 text-yellow-300" />
            <span>最终消耗按模型、线路、画质尺寸和数量实时计算。比例、格式等未显示加价时表示当前不单独计费。</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PricingReferencePanel;
