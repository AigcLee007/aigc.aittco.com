import React, { useEffect, useMemo } from 'react';
import { useSelectionStore } from '../src/store/selectionStore';
import DropUpSelect from './DropUpSelect';
import ModelSelector from './ModelSelector';
import ImageModelIcon from './ImageModelIcon';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getDefaultImageSizeForModel,
  getImageModelById,
  getImageModelExtraAspectRatios,
  getImageModelOptions,
  getImageModelSizeOptions,
  getNormalizedImageSizeForModel,
  shouldShowImageSizeSelector,
} from '../src/config/imageModels';
import {
  canUseDirectUserApiKeyForImageModel,
  getImageRoutePointCost,
  getImageRouteOptions,
  getImageRoutesByModelFamily,
} from '../src/config/imageRoutes';
import { useImageRouteCatalog } from '../src/hooks/useImageRouteCatalog';
import { useImageModelCatalog } from '../src/hooks/useImageModelCatalog';

const BASE_RATIO_OPTIONS = [
  { label: '智能', value: 'Smart' },
  { label: '自定义', value: 'Custom' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
  { label: '9:21', value: '9:21' },
  { label: '5:4', value: '5:4' },
];

interface ImageFormConfigProps {
  restrictToDirectKeyCompatible?: boolean;
}

export const ImageFormConfig: React.FC<ImageFormConfigProps> = ({
  restrictToDirectKeyCompatible = false,
}) => {
  useImageRouteCatalog();
  useImageModelCatalog();

  const {
    aspectRatio,
    setAspectRatio,
    customRatio,
    setCustomRatio,
    imageSize,
    setImageSize,
    quantity,
    setQuantity,
    imageModel,
    setImageModel,
    imageLine,
    setImageLine,
    gptImageQuality,
    setGptImageQuality,
    gptImageOutputFormat,
    setGptImageOutputFormat,
    gptImageOutputCompression,
    setGptImageOutputCompression,
    gptImageModeration,
    setGptImageModeration,
  } = useSelectionStore();

  const visibleImageModels = useMemo(
    () =>
      getImageModelOptions().filter((model) =>
        restrictToDirectKeyCompatible ? canUseDirectUserApiKeyForImageModel(model.id) : true,
      ),
    [restrictToDirectKeyCompatible],
  );

  const currentModel =
    visibleImageModels.find((model) => model.id === imageModel) ||
    visibleImageModels[0] ||
    getImageModelById(imageModel);

  const availableRoutes = useMemo(
    () =>
      getImageRoutesByModelFamily(currentModel.routeFamily).filter((route) =>
        restrictToDirectKeyCompatible ? route.allowUserApiKeyWithoutLogin === true : true,
      ),
    [currentModel.routeFamily, restrictToDirectKeyCompatible],
  );

  const imageRouteOptions = useMemo(
    () =>
      getImageRouteOptions(currentModel.id, {
        preferCompatibleFirst: restrictToDirectKeyCompatible,
        recommendCompatible: restrictToDirectKeyCompatible,
        directKeyOnly: restrictToDirectKeyCompatible,
      }),
    [currentModel.id, restrictToDirectKeyCompatible],
  );

  const rawSizeOptions = getImageModelSizeOptions(currentModel.id);
  const sizeOptions =
    currentModel.id === 'gpt-image-2' && !rawSizeOptions.includes('auto')
      ? ['auto', ...rawSizeOptions]
      : rawSizeOptions;
  const normalizedSize = getNormalizedImageSizeForModel(currentModel.id, imageSize);
  const showLineSelector = availableRoutes.length > 1;
  const showSizeSelector = shouldShowImageSizeSelector(currentModel.id);
  const isGptImage2 = currentModel.id === 'gpt-image-2';

  const commitGptCompression = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setGptImageOutputCompression(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    setGptImageOutputCompression(Math.max(0, Math.min(100, Math.round(parsed))));
  };

  useEffect(() => {
    if (visibleImageModels.length === 0) return;
    if (visibleImageModels.some((model) => model.id === imageModel)) return;
    setImageModel(visibleImageModels[0]?.id || DEFAULT_IMAGE_MODEL_ID());
  }, [imageModel, setImageModel, visibleImageModels]);

  useEffect(() => {
    if (normalizedSize === imageSize) return;
    setImageSize(normalizedSize || getDefaultImageSizeForModel(currentModel.id));
  }, [currentModel.id, imageSize, normalizedSize, setImageSize]);

  useEffect(() => {
    if (availableRoutes.length === 0) return;
    if (availableRoutes.some((route) => route.line === imageLine)) return;
    setImageLine(availableRoutes[0].line);
  }, [availableRoutes, imageLine, setImageLine]);

  const ratioOptions = useMemo(() => {
    const extraRatios = getImageModelExtraAspectRatios(currentModel.id).map((value) => ({
      label: value,
      value,
    }));
    const includeCustom = currentModel.supportsCustomRatio !== false;
    const merged = includeCustom
      ? [...BASE_RATIO_OPTIONS, ...extraRatios]
      : [
          ...BASE_RATIO_OPTIONS.filter((option) => option.value !== 'Custom'),
          ...extraRatios,
        ];

    return merged.filter(
      (option, index) =>
        merged.findIndex((item) => item.value === option.value) === index,
    );
  }, [currentModel.id, currentModel.supportsCustomRatio]);

  const gridClass =
    currentModel.panelLayout === 'nano-banana'
      ? 'grid-cols-[1.15fr_1fr_1.15fr_0.9fr] gap-1.5'
      : currentModel.panelLayout === 'compact'
        ? 'grid-cols-2 gap-2'
        : 'grid-cols-[1.15fr_1fr_1fr] gap-2';

  const modelOptions = useMemo(
    () =>
      visibleImageModels.map((model) => {
        const familyRoutes = getImageRoutesByModelFamily(model.routeFamily).filter((route) =>
          restrictToDirectKeyCompatible ? route.allowUserApiKeyWithoutLogin === true : true,
        );
        const displayRoute =
          familyRoutes.find((route) => route.line === imageLine) ||
          familyRoutes.find((route) => route.isDefaultRoute) ||
          familyRoutes.find((route) => route.isDefaultNanoBananaLine) ||
          familyRoutes[0];
        const modelSize = getNormalizedImageSizeForModel(model.id, imageSize);
        const displayCost = displayRoute
          ? getImageRoutePointCost(displayRoute, modelSize)
          : model.selectorCost;

        return {
          value: model.id,
          label: model.label,
          cost: displayCost,
          icon: <ImageModelIcon iconKind={model.iconKind} variant="selector" />,
        };
      }),
    [imageLine, imageSize, restrictToDirectKeyCompatible, visibleImageModels],
  );

  if (visibleImageModels.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-gray-400">
        当前没有可用于直连 API Key 的图像模型。
      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        <label className="mb-1 block text-[10px] text-gray-500">图像模型</label>
        <ModelSelector
          dropUp
          value={currentModel.id}
          onChange={(value) => setImageModel(value)}
          options={modelOptions}
        />
      </div>

      <div className={`grid ${gridClass}`}>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">画面比例</label>
          <DropUpSelect
            value={aspectRatio}
            onChange={(value) => setAspectRatio(value)}
            options={ratioOptions}
            showRectMarker
          />
          {aspectRatio === 'Custom' && currentModel.supportsCustomRatio !== false && (
            <div className="mt-1 flex items-center gap-1">
              <input
                type="text"
                value={customRatio}
                onChange={(event) => setCustomRatio(event.target.value)}
                placeholder="16:9"
                className="w-full rounded border border-gray-700 bg-gray-900 px-1 py-1 text-[10px] text-white"
              />
            </div>
          )}
        </div>

        {showSizeSelector && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">画质尺寸</label>
            <DropUpSelect
              value={normalizedSize}
              onChange={(value) => setImageSize(value)}
              options={sizeOptions.map((value) => ({
                value,
                label: value.toLowerCase() === 'auto' ? '自动' : value.toUpperCase(),
              }))}
            />
          </div>
        )}

        {showLineSelector && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">线路</label>
            <DropUpSelect
              value={imageLine}
              onChange={(value) => setImageLine(value)}
              options={imageRouteOptions}
            />
            {restrictToDirectKeyCompatible && (
              <div className="mt-1 text-[10px] leading-4 text-cyan-300">
                此处仅展示支持直连 API Key 的线路。
              </div>
            )}
          </div>
        )}

        {isGptImage2 && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">质量</label>
            <DropUpSelect
              value={gptImageQuality}
              onChange={(value) =>
                setGptImageQuality(value as 'auto' | 'low' | 'medium' | 'high')
              }
              options={[
                { value: 'auto', label: '自动' },
                { value: 'low', label: '低' },
                { value: 'medium', label: '中' },
                { value: 'high', label: '高' },
              ]}
            />
          </div>
        )}

        {isGptImage2 && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">格式</label>
            <DropUpSelect
              value={gptImageOutputFormat}
              onChange={(value) =>
                setGptImageOutputFormat(value as 'png' | 'jpeg' | 'webp')
              }
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </div>
        )}

        {isGptImage2 && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">压缩率</label>
            <input
              type="number"
              min={0}
              max={100}
              disabled={gptImageOutputFormat === 'png'}
              value={gptImageOutputCompression ?? ''}
              onChange={(event) => commitGptCompression(event.target.value)}
              placeholder="0-100"
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
            />
          </div>
        )}

        {isGptImage2 && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">审核强度</label>
            <DropUpSelect
              value={gptImageModeration}
              onChange={(value) => setGptImageModeration(value as 'auto' | 'low')}
              options={[
                { value: 'auto', label: '自动' },
                { value: 'low', label: '低' },
              ]}
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-[10px] text-gray-500">数量</label>
          <DropUpSelect
            value={String(quantity)}
            onChange={(value) => setQuantity(parseInt(value, 10))}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '4', label: '4' },
            ]}
          />
        </div>
      </div>
    </>
  );
};

export default ImageFormConfig;
