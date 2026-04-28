import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Brush,
  CheckCircle2,
  Eraser,
  Loader2,
  RefreshCcw,
  Route,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { AppStatus, NodeData } from '../types';
import { useCanvasStore } from '../src/store/canvasStore';
import { useSelectionStore } from '../src/store/selectionStore';
import { renderMaskToDataURL } from '../src/utils/imageUtils';
import { editImageApi } from '../services/api';
import ModelSelector, { type ModelOption } from './ModelSelector';
import DropUpSelect from './DropUpSelect';
import ImageModelIcon from './ImageModelIcon';
import CoinIcon from './CoinIcon';
import {
  getEditableImageModels,
  getEditableRoutesForModel,
  getImageEditModelGroup,
} from '../src/config/imageEditCapabilities';
import {
  buildImageEditPrompt,
  getDefaultEditPromptPlaceholder,
  IMAGE_EDIT_TYPE_OPTIONS,
  type ImageEditType,
} from '../src/utils/imageEditPrompt';
import {
  getImageModelById,
  getImageModelExtraAspectRatios,
  getImageModelRequestName,
} from '../src/config/imageModels';
import { formatPoint } from '../src/utils/pointFormat';

type MaskMode = 'transparent' | 'binary';

interface InitGenerationOptions {
  preserveToolMode?: boolean;
}

interface ImageEditPanelProps {
  selectedNode: NodeData | null;
  hasUnlockedGenerationAccess: boolean;
  isCheckingGenerationAccess: boolean;
  directKeyOnly: boolean;
  onInitGenerations: (
    count: number,
    prompt: string,
    aspectRatio?: string,
    baseNode?: NodeData,
    type?: 'IMAGE' | 'VIDEO',
    options?: InitGenerationOptions,
  ) => string[];
  onUpdateGeneration: (
    id: string,
    src: string | null,
    error?: string,
    taskId?: string,
  ) => void;
}

const COMMON_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

const gcd = (a: number, b: number): number => {
  let left = Math.abs(Math.round(a));
  let right = Math.abs(Math.round(b));
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
};

const getAspectRatioFromDimensions = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
};

const parseAspectRatioValue = (ratio: string) => {
  const [width, height] = String(ratio || '')
    .split(':')
    .map((value) => Number(value));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
};

const computeExpandedDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: string,
) => {
  const ratioValue = parseAspectRatioValue(targetRatio);
  if (!ratioValue) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - ratioValue) < 0.0001) {
    return { width: sourceWidth, height: sourceHeight };
  }

  if (ratioValue > sourceRatio) {
    return {
      width: Math.max(sourceWidth, Math.round(sourceHeight * ratioValue)),
      height: sourceHeight,
    };
  }

  return {
    width: sourceWidth,
    height: Math.max(sourceHeight, Math.round(sourceWidth / ratioValue)),
  };
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取原图，请检查图片链接是否可正常访问'));
    img.src = src;
  });

const buildOutpaintAssets = ({
  image,
  targetWidth,
  targetHeight,
  maskMode,
}: {
  image: HTMLImageElement;
  targetWidth: number;
  targetHeight: number;
  maskMode: MaskMode;
}) => {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const offsetX = Math.floor((targetWidth - sourceWidth) / 2);
  const offsetY = Math.floor((targetHeight - sourceHeight) / 2);

  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = targetWidth;
  imageCanvas.height = targetHeight;
  const imageCtx = imageCanvas.getContext('2d');
  if (!imageCtx) {
    throw new Error('无法创建扩图画布');
  }
  imageCtx.clearRect(0, 0, targetWidth, targetHeight);
  imageCtx.drawImage(image, offsetX, offsetY, sourceWidth, sourceHeight);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = targetWidth;
  maskCanvas.height = targetHeight;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) {
    throw new Error('无法创建扩图遮罩');
  }

  if (maskMode === 'binary') {
    maskCtx.fillStyle = '#ffffff';
    maskCtx.fillRect(0, 0, targetWidth, targetHeight);
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(offsetX, offsetY, sourceWidth, sourceHeight);
  } else {
    maskCtx.clearRect(0, 0, targetWidth, targetHeight);
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(offsetX, offsetY, sourceWidth, sourceHeight);
  }

  return {
    imageBase64: imageCanvas.toDataURL('image/png').split(',')[1],
    maskBase64: maskCanvas.toDataURL('image/png').split(',')[1],
  };
};

const resolveImmediateEditUrl = (result: {
  taskId?: string;
  url?: string;
  images?: string[];
  data?: Array<{ url?: string; b64_json?: string }>;
}) => {
  if (result.url) return result.url;
  if (Array.isArray(result.images) && result.images.length > 0) {
    return result.images[0] || null;
  }
  if (Array.isArray(result.data) && result.data.length > 0) {
    const first = result.data[0];
    if (first?.url) return first.url;
    if (typeof first?.b64_json === 'string') {
      return `data:image/png;base64,${first.b64_json}`;
    }
  }
  return null;
};

const getRecommendedGroupForEditType = (type: ImageEditType) => {
  switch (type) {
    case 'erase':
      return 'gpt-image-2';
    case 'background':
    case 'restyle':
      return 'nano-banana-2';
    case 'outpaint':
    case 'retouch':
      return 'nano-banana-pro';
    case 'replace':
    default:
      return 'nano-banana-2';
  }
};

const getEditTypeLabel = (type: ImageEditType) =>
  IMAGE_EDIT_TYPE_OPTIONS.find((item) => item.value === type)?.label || '图片编辑';

const ImageEditPanel: React.FC<ImageEditPanelProps> = ({
  selectedNode,
  hasUnlockedGenerationAccess,
  isCheckingGenerationAccess,
  directKeyOnly,
  onInitGenerations,
  onUpdateGeneration,
}) => {
  const { updateNode } = useCanvasStore();
  const { apiKey, brushColor, brushSize, setBrushColor, setBrushSize, setStatus } =
    useSelectionStore();

  const [editType, setEditType] = useState<ImageEditType>('replace');
  const [editPrompt, setEditPrompt] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedSize, setSelectedSize] = useState('2k');
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('1:1');
  const [maskMode, setMaskMode] = useState<MaskMode>('transparent');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editableModels = useMemo(
    () => getEditableImageModels({ directKeyOnly }),
    [directKeyOnly],
  );

  const currentModel =
    editableModels.find((item) => item.id === selectedModelId) || editableModels[0] || null;

  const routeCapabilities = useMemo(
    () => (currentModel ? getEditableRoutesForModel(currentModel.id, { directKeyOnly }) : []),
    [currentModel, directKeyOnly],
  );

  const currentCapability =
    routeCapabilities.find((item) => item.routeId === selectedRouteId) ||
    routeCapabilities[0] ||
    null;

  const hasMask =
    selectedNode?.type === 'IMAGE' &&
    !selectedNode.loading &&
    Array.isArray(selectedNode.maskStrokes) &&
    selectedNode.maskStrokes.length > 0;
  const requiresManualMask = editType !== 'outpaint';
  const hasEditableRegion = requiresManualMask ? hasMask : true;

  const sourceRatio = useMemo(() => {
    if (!selectedNode?.width || !selectedNode?.height) return '1:1';
    return getAspectRatioFromDimensions(selectedNode.width, selectedNode.height);
  }, [selectedNode?.width, selectedNode?.height]);

  const ratioOptions = useMemo(() => {
    const extraRatios = currentModel ? getImageModelExtraAspectRatios(currentModel.id) : [];
    const merged = [
      { value: sourceRatio, label: sourceRatio, badge: '原图' },
      ...COMMON_RATIO_OPTIONS.map((value) => ({ value, label: value })),
      ...extraRatios.map((value) => ({ value, label: value })),
    ];

    return merged.filter(
      (item, index) =>
        merged.findIndex((candidate) => candidate.value === item.value) === index,
    );
  }, [currentModel, sourceRatio]);

  useEffect(() => {
    if (!selectedNode?.id) return;
    setSelectedAspectRatio(sourceRatio);
    setError(null);
  }, [selectedNode?.id, sourceRatio]);

  useEffect(() => {
    if (editableModels.length === 0) return;
    if (selectedModelId && editableModels.some((item) => item.id === selectedModelId)) {
      return;
    }

    const recommendedGroup = getRecommendedGroupForEditType(editType);
    const nextModel =
      editableModels.find((item) => getImageEditModelGroup(item) === recommendedGroup) ||
      editableModels[0];

    if (nextModel) {
      setSelectedModelId(nextModel.id);
    }
  }, [editType, editableModels, selectedModelId]);

  useEffect(() => {
    if (!currentModel) return;
    if (selectedRouteId && routeCapabilities.some((item) => item.routeId === selectedRouteId)) {
      return;
    }
    if (routeCapabilities[0]) {
      setSelectedRouteId(routeCapabilities[0].routeId);
    }
  }, [currentModel, routeCapabilities, selectedRouteId]);

  useEffect(() => {
    if (!currentCapability) return;
    if (currentCapability.sizeOptions.includes(selectedSize)) return;
    setSelectedSize(currentCapability.defaultSize);
  }, [currentCapability, selectedSize]);

  useEffect(() => {
    if (editType !== 'outpaint') return;
    if (selectedAspectRatio !== sourceRatio) return;

    const sourceRatioValue = parseAspectRatioValue(sourceRatio);
    const nextRatio = ratioOptions.find((item) => {
      if (item.value === sourceRatio) return false;
      const optionRatioValue = parseAspectRatioValue(item.value);
      if (!sourceRatioValue || !optionRatioValue) return true;
      if (sourceRatioValue > 1) return optionRatioValue >= 1;
      if (sourceRatioValue < 1) return optionRatioValue <= 1;
      return true;
    });

    if (nextRatio) {
      setSelectedAspectRatio(nextRatio.value);
    }
  }, [editType, ratioOptions, selectedAspectRatio, sourceRatio]);

  const modelOptions = useMemo<ModelOption[]>(
    () =>
      editableModels.map((model) => {
        const firstCapability = getEditableRoutesForModel(model.id, { directKeyOnly })[0];
        return {
          value: model.id,
          label: model.label,
          cost: firstCapability?.pointCost ?? model.selectorCost,
          icon: <ImageModelIcon iconKind={model.iconKind} variant="selector" />,
        };
      }),
    [directKeyOnly, editableModels],
  );

  const routeOptions = useMemo(
    () =>
      routeCapabilities.map((item) => ({
        value: item.routeId,
        label: item.routeLabel,
        badge: item.routeMode === 'sync' ? '同步' : '异步',
        description: item.routeDescription,
      })),
    [routeCapabilities],
  );

  const displayPromptLabel = useMemo(() => {
    const promptText = String(editPrompt || '').trim();
    return promptText ? `${getEditTypeLabel(editType)}：${promptText}` : getEditTypeLabel(editType);
  }, [editPrompt, editType]);

  const pointCost = currentCapability
    ? currentCapability.pointCost *
      Math.max(1, Number.isFinite(selectedQuantity) ? selectedQuantity : 1)
    : 0;
  const hasEditableModelOptions = editableModels.length > 0;
  const hasEditableRouteOptions = routeCapabilities.length > 0;

  const handleUndoLastStroke = () => {
    if (!selectedNode?.maskStrokes?.length) return;
    updateNode(selectedNode.id, {
      maskStrokes: selectedNode.maskStrokes.slice(0, -1),
    });
  };

  const handleClearMask = () => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, { maskStrokes: [] });
  };

  const positionPlaceholders = (
    ids: string[],
    baseNode: NodeData,
    promptText: string,
    sizeOverride?: { width: number; height: number },
  ) => {
    const gap = 28;
    const nodeWidth = sizeOverride?.width ?? baseNode.width;
    const nodeHeight = sizeOverride?.height ?? baseNode.height;

    ids.forEach((id, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      updateNode(
        id,
        {
          x: baseNode.x + baseNode.width + gap + column * (nodeWidth + gap),
          y: baseNode.y + row * (nodeHeight + gap),
          width: nodeWidth,
          height: nodeHeight,
          prompt: promptText,
          sourceNodeId: baseNode.id,
        },
        true,
      );
    });
  };

  const handleSubmit = async () => {
    const normalizedPrompt = String(editPrompt || '').trim();
    if (!hasUnlockedGenerationAccess) {
      setError(
        isCheckingGenerationAccess
          ? '正在验证访问权限，请稍后再试'
          : '请先登录，或验证可用的 API Key',
      );
      return;
    }
    if (!selectedNode || selectedNode.type !== 'IMAGE' || !selectedNode.src) {
      setError('请先在画布上选中一张图片');
      return;
    }
    if (requiresManualMask && !hasMask) {
      setError('请先在图片上涂抹需要编辑的区域');
      return;
    }
    if (editType !== 'erase' && editType !== 'outpaint' && !normalizedPrompt) {
      setError('请先输入编辑提示词');
      return;
    }
    if (!currentModel || !currentCapability) {
      setError('当前没有可用的编辑模型或线路');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setStatus(AppStatus.LOADING);

    try {
      const safeSource = selectedNode.src.startsWith('http')
        ? `/api/proxy/image?url=${encodeURIComponent(selectedNode.src)}`
        : selectedNode.src;
      const image = await loadImage(safeSource);
      const intrinsicWidth = image.naturalWidth;
      const intrinsicHeight = image.naturalHeight;
      const effectiveRatio =
        selectedAspectRatio || getAspectRatioFromDimensions(intrinsicWidth, intrinsicHeight);
      const promptText = buildImageEditPrompt(editType, normalizedPrompt);

      let maskBase64 = '';
      let punchedBase64 = '';
      let resultDisplaySize: { width: number; height: number } | undefined;

      if (editType === 'outpaint') {
        const expanded = computeExpandedDimensions(intrinsicWidth, intrinsicHeight, effectiveRatio);
        if (expanded.width === intrinsicWidth && expanded.height === intrinsicHeight) {
          throw new Error('扩图/改比例需要选择与原图不同的输出比例');
        }

        const outpaintAssets = buildOutpaintAssets({
          image,
          targetWidth: expanded.width,
          targetHeight: expanded.height,
          maskMode,
        });

        maskBase64 = outpaintAssets.maskBase64;
        punchedBase64 = outpaintAssets.imageBase64;
        resultDisplaySize = computeExpandedDimensions(
          selectedNode.width,
          selectedNode.height,
          effectiveRatio,
        );
      } else {
        const strokeSnapshot = [...(selectedNode.maskStrokes || [])];
        const maskDataUrl = renderMaskToDataURL(
          null,
          intrinsicWidth,
          intrinsicHeight,
          selectedNode.width,
          selectedNode.height,
          strokeSnapshot,
          maskMode === 'binary',
        );
        const punchedImageDataUrl = renderMaskToDataURL(
          image,
          intrinsicWidth,
          intrinsicHeight,
          selectedNode.width,
          selectedNode.height,
          strokeSnapshot,
          false,
        );
        maskBase64 = maskDataUrl.split(',')[1];
        punchedBase64 = punchedImageDataUrl.split(',')[1];
      }

      if (!maskBase64 || !punchedBase64) {
        throw new Error('编辑区域生成失败，请调整后再试');
      }

      const placeholderIds = onInitGenerations(
        selectedQuantity,
        displayPromptLabel,
        effectiveRatio,
        selectedNode,
        'IMAGE',
        { preserveToolMode: true },
      );
      positionPlaceholders(placeholderIds, selectedNode, displayPromptLabel, resultDisplaySize);

      const payload = {
        modelId: currentModel.id,
        routeId: currentCapability.routeId,
        model: getImageModelRequestName(currentModel.id),
        prompt: promptText,
        image: punchedBase64,
        mask: maskBase64,
        size: selectedSize,
        image_size: selectedSize,
        aspect_ratio: effectiveRatio,
        mask_mode: maskMode,
      };

      const settled = await Promise.allSettled(
        placeholderIds.map(async (placeholderId) => {
          const result = await editImageApi(apiKey, {
            ...payload,
            n: 1,
          });
          if (result.taskId) {
            onUpdateGeneration(placeholderId, null, undefined, result.taskId);
            return;
          }

          const immediateUrl = resolveImmediateEditUrl(result);
          if (!immediateUrl) {
            throw new Error('当前线路没有返回可显示的编辑结果');
          }
          onUpdateGeneration(placeholderId, immediateUrl);
        }),
      );

      const failed = settled.filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected',
      );
      if (failed.length > 0) {
        const firstMessage =
          failed[0]?.reason?.message || '部分编辑任务提交失败，请检查线路后稍后重试';
        setError(firstMessage);
      }
    } catch (submitError: any) {
      setError(submitError?.message || '编辑任务提交失败');
    } finally {
      setIsSubmitting(false);
      setStatus(AppStatus.IDLE);
    }
  };

  const selectedModelConfig = currentModel ? getImageModelById(currentModel.id) : null;
  const recommendedGroup = getRecommendedGroupForEditType(editType);
  const currentGroup = currentModel ? getImageEditModelGroup(currentModel) : null;
  const recommendationMatched = currentGroup === recommendedGroup;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Eraser size={16} className="text-orange-300" />
              画布图片编辑
            </div>
            <div className="mt-1 text-xs leading-5 text-gray-400">
              {requiresManualMask
                ? '先选中一张图片，再在画布上涂抹需要修改的区域。'
                : '扩图模式会自动把新增画布区域当作待生成区域，不需要手动画遮罩。'}
            </div>
          </div>
          {selectedNode?.type === 'IMAGE' ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-right">
              <div className="text-[11px] font-medium text-emerald-200">
                {Math.round(selectedNode.width)} x {Math.round(selectedNode.height)}
              </div>
              <div className="mt-0.5 text-[10px] text-emerald-100/80">原图比例 {sourceRatio}</div>
            </div>
          ) : null}
        </div>
      </div>

      {!selectedNode || selectedNode.type !== 'IMAGE' ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-gray-400">
          请先在画布中选中一张图片，再进入编辑模式。
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[1.1fr_0.9fr] gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">编辑类型</label>
              <DropUpSelect
                value={editType}
                onChange={(value) => setEditType(value as ImageEditType)}
                options={IMAGE_EDIT_TYPE_OPTIONS}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">遮罩模式</label>
              <DropUpSelect
                value={maskMode}
                onChange={(value) => setMaskMode(value as MaskMode)}
                options={[
                  {
                    value: 'transparent',
                    label: '透明挖空',
                    description: '默认推荐，适合大多数线路。',
                  },
                  {
                    value: 'binary',
                    label: '黑白遮罩',
                    description: '当透明遮罩不稳定时再切换。',
                  },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] text-gray-500">
              {editType === 'outpaint' ? '扩图提示词' : '编辑提示词'}
            </label>
            <textarea
              value={editPrompt}
              onChange={(event) => setEditPrompt(event.target.value)}
              placeholder={getDefaultEditPromptPlaceholder(editType)}
              className="h-28 min-h-28 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-gray-100 outline-none transition-all placeholder:text-gray-500 focus:border-orange-400/40 focus:bg-white/10"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">编辑模型</label>
              <ModelSelector
                value={currentModel?.id || ''}
                onChange={(value) => setSelectedModelId(value)}
                options={modelOptions}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">编辑线路</label>
              <DropUpSelect
                value={currentCapability?.routeId || ''}
                onChange={(value) => setSelectedRouteId(value)}
                options={routeOptions}
              />
            </div>
          </div>

          {!hasEditableModelOptions || !hasEditableRouteOptions ? (
            <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              当前没有可用的编辑模型或线路。请先检查线路是否启用，或刷新后重试。
            </div>
          ) : null}

          {currentCapability ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Route size={14} className="text-sky-300" />
                    {currentCapability.modelLabel} / {currentCapability.routeLabel}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-gray-400">
                    {currentCapability.routeDescription}
                  </div>
                </div>
                <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/10 px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1 text-sm font-semibold text-yellow-200">
                    <CoinIcon size={12} />
                    {formatPoint(pointCost)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-yellow-100/80">预计 {selectedQuantity} 张</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span
                  className={`rounded-full border px-2 py-1 ${
                    recommendationMatched
                      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  {recommendationMatched ? '当前模型适合当前编辑类型' : '当前类型有更推荐的模型'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                  {currentCapability.routeMode === 'sync' ? '同步返图' : '异步任务'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                  默认 {currentCapability.pointCostText} 点 / 张
                </span>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_1fr_0.95fr] gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">
                {editType === 'outpaint' ? '目标比例' : '输出比例'}
              </label>
              <DropUpSelect
                value={selectedAspectRatio}
                onChange={(value) => setSelectedAspectRatio(value)}
                options={ratioOptions}
                showRectMarker
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">输出尺寸</label>
              <DropUpSelect
                value={selectedSize}
                onChange={(value) => setSelectedSize(value)}
                options={(currentCapability?.sizeOptions || ['1k']).map((value) => ({
                  value,
                  label: value.toUpperCase(),
                }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-gray-500">生成张数</label>
              <DropUpSelect
                value={String(selectedQuantity)}
                onChange={(value) => setSelectedQuantity(Number(value))}
                options={['1', '2', '4'].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </div>
          </div>

          {requiresManualMask ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <label className="mb-2 block text-[10px] text-gray-500">笔触颜色</label>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2 py-1.5">
                    <input
                      type="color"
                      value={brushColor}
                      onChange={(event) => setBrushColor(event.target.value)}
                      className="h-8 w-8 cursor-pointer rounded bg-transparent p-0"
                    />
                    <span className="text-xs font-mono text-gray-300">{brushColor.toUpperCase()}</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <label className="mb-2 block text-[10px] text-gray-500">笔触粗细</label>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-2 py-2">
                    <Brush size={12} className="text-gray-400" />
                    <input
                      type="range"
                      min={8}
                      max={120}
                      step={1}
                      value={brushSize}
                      onChange={(event) => setBrushSize(parseInt(event.target.value, 10))}
                      className="w-full accent-orange-400"
                    />
                    <span className="w-8 text-right text-xs text-gray-300">{brushSize}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUndoLastStroke}
                  disabled={!hasMask}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Undo2 size={12} />
                  撤销一笔
                </button>
                <button
                  type="button"
                  onClick={handleClearMask}
                  disabled={!hasMask}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={12} />
                  清空遮罩
                </button>
                <div
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    hasMask
                      ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-400/25 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  {hasMask ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  {hasMask ? '已检测到遮罩区域' : '还没有涂抹遮罩'}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-xs leading-5 text-sky-100">
              当前是扩图模式。系统会自动把新比例下新增的边缘区域作为待生成区域，不需要手动画遮罩。
            </div>
          )}

          {selectedModelConfig ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-gray-400">
              <div className="flex items-center gap-2 font-medium text-gray-200">
                <Sparkles size={14} className="text-orange-300" />
                当前推荐
              </div>
              <div className="mt-2">
                {selectedModelConfig.label} 更适合{' '}
                {(currentCapability?.recommendedFor || [])
                  .map((item) => getEditTypeLabel(item))
                  .join('、')}
                ，当前编辑类型是 {getEditTypeLabel(editType)}。
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              isCheckingGenerationAccess ||
              !hasUnlockedGenerationAccess ||
              !selectedNode ||
              !hasEditableRegion
            }
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all ${
              isSubmitting ||
              isCheckingGenerationAccess ||
              !hasUnlockedGenerationAccess ||
              !selectedNode ||
              !hasEditableRegion
                ? 'cursor-not-allowed border border-white/10 bg-gray-700 text-gray-400'
                : 'border border-orange-300/25 bg-linear-to-r from-orange-500 to-amber-500 text-white shadow-lg hover:from-orange-400 hover:to-amber-400'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                正在提交编辑任务...
              </>
            ) : (
              <>
                <RefreshCcw size={16} />
                {editType === 'outpaint' ? '开始扩图' : '生成编辑版本'}
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
};

export default ImageEditPanel;
