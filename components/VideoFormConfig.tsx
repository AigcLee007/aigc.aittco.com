import React, { useEffect, useMemo } from 'react';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { useSelectionStore } from '../src/store/selectionStore';
import ModelSelector from './ModelSelector';
import DropUpSelect from './DropUpSelect';
import { GoogleLogo } from './Logos';
import { uploadVideoReferenceFile } from '../src/services/videoReferenceUpload';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getDefaultVideoAspectRatioForModel,
  getDefaultVideoDurationForModel,
  getVideoModelAspectRatioOptions,
  getVideoModelById,
  getVideoModelDisplayCost,
  getVideoModelDurationOptions,
  getVideoModelMaxReferenceImages,
  getVideoModelPointCostPerSecond,
  getVideoModelPricingMode,
  getVideoModelSupportsHd,
} from '../src/config/videoModels';
import {
  getVisibleVideoModels,
  getVideoRouteOptions,
  getVideoRoutesByRouteFamily,
} from '../src/config/videoRoutes';
import { useVideoModelCatalog } from '../src/hooks/useVideoModelCatalog';
import { useVideoRouteCatalog } from '../src/hooks/useVideoRouteCatalog';

interface VideoFormConfigProps {
  restrictToDirectKeyCompatible?: boolean;
}

export const VideoFormConfig: React.FC<VideoFormConfigProps> = ({
  restrictToDirectKeyCompatible = false,
}) => {
  useVideoModelCatalog();
  useVideoRouteCatalog();
  const videoReferenceInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploadingReferenceVideo, setIsUploadingReferenceVideo] = React.useState(false);

  const {
    videoModel,
    setVideoModel,
    videoLine,
    setVideoLine,
    videoAspectRatio,
    setVideoAspectRatio,
    videoDuration,
    setVideoDuration,
    videoHd,
    setVideoHd,
    videoReferenceMode,
    setVideoReferenceMode,
    videoReferenceUrl,
    setVideoReferenceUrl,
  } = useSelectionStore();

  const visibleVideoModels = useMemo(() => {
    if (restrictToDirectKeyCompatible) {
      return getVisibleVideoModels({ directKeyOnly: true });
    }
    return getVisibleVideoModels();
  }, [restrictToDirectKeyCompatible]);

  const currentModel =
    visibleVideoModels.find((model) => model.id === videoModel) ||
    visibleVideoModels[0] ||
    getVideoModelById(videoModel);

  const availableRoutes = useMemo(
    () =>
      getVideoRoutesByRouteFamily(currentModel.routeFamily).filter((route) => {
        if (route.isActive === false) return false;
        return restrictToDirectKeyCompatible ? route.allowUserApiKeyWithoutLogin === true : true;
      }),
    [currentModel.routeFamily, restrictToDirectKeyCompatible],
  );

  const routeOptions = useMemo(
    () =>
      getVideoRouteOptions(currentModel.id, {
        directKeyOnly: restrictToDirectKeyCompatible,
      }),
    [currentModel.id, restrictToDirectKeyCompatible],
  );

  const ratioOptions = getVideoModelAspectRatioOptions(currentModel.id);
  const durationOptions = getVideoModelDurationOptions(currentModel.id);
  const supportsHd = getVideoModelSupportsHd(currentModel.id);
  const supportsVideoReference = currentModel.id === 'sora-v3-pro' || currentModel.id === 'sora-v3-fast';
  const maxReferenceImages = getVideoModelMaxReferenceImages(
    currentModel.id,
    supportsVideoReference && videoReferenceMode === 'frames' ? 'frames' : 'images',
  );
  const showLineSelector = availableRoutes.length > 1;
  const isGrokModel = currentModel.id.startsWith('grok');

  useEffect(() => {
    if (visibleVideoModels.length === 0) return;
    if (visibleVideoModels.some((model) => model.id === videoModel)) return;
    setVideoModel(visibleVideoModels[0]?.id || DEFAULT_VIDEO_MODEL_ID());
  }, [setVideoModel, videoModel, visibleVideoModels]);

  useEffect(() => {
    if (availableRoutes.length === 0) return;
    if (availableRoutes.some((route) => route.line === videoLine)) return;
    setVideoLine(availableRoutes[0].line);
  }, [availableRoutes, setVideoLine, videoLine]);

  useEffect(() => {
    if (ratioOptions.includes(videoAspectRatio)) return;
    setVideoAspectRatio(getDefaultVideoAspectRatioForModel(currentModel.id));
  }, [currentModel.id, ratioOptions, setVideoAspectRatio, videoAspectRatio]);

  useEffect(() => {
    if (durationOptions.includes(videoDuration)) return;
    setVideoDuration(getDefaultVideoDurationForModel(currentModel.id));
  }, [currentModel.id, durationOptions, setVideoDuration, videoDuration]);

  useEffect(() => {
    if (supportsHd || !videoHd) return;
    setVideoHd(false);
  }, [setVideoHd, supportsHd, videoHd]);

  useEffect(() => {
    if (!supportsVideoReference) {
      if (videoReferenceMode !== 'images') setVideoReferenceMode('images');
      if (videoReferenceUrl) setVideoReferenceUrl('');
    }
  }, [supportsVideoReference, videoReferenceMode, videoReferenceUrl, setVideoReferenceMode, setVideoReferenceUrl]);

  const modelOptions = visibleVideoModels.map((model) => ({
    value: model.id,
    label: model.label,
    cost: getVideoModelDisplayCost(
      model.id,
      model.id === currentModel.id ? videoDuration : model.defaultDuration,
    ),
    icon: model.id.startsWith('grok') ? <Sparkles size={14} /> : <GoogleLogo />,
  }));
  const isPerSecondPricing = getVideoModelPricingMode(currentModel.id) === 'per_second';
  const pointCostPerSecond = getVideoModelPointCostPerSecond(currentModel.id);
  const estimatedCost = getVideoModelDisplayCost(currentModel.id, videoDuration);

  const handleSelectReferenceVideo = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setIsUploadingReferenceVideo(true);
      const uploadedUrl = await uploadVideoReferenceFile(file);
      setVideoReferenceUrl(uploadedUrl);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '参考视频上传失败');
    } finally {
      setIsUploadingReferenceVideo(false);
    }
  };

  if (visibleVideoModels.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-gray-400">
        当前没有可用于直连 API Key 的视频模型。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid ${showLineSelector ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">画面比例</label>
          <DropUpSelect
            value={videoAspectRatio}
            onChange={(value) => setVideoAspectRatio(value)}
            options={ratioOptions.map((value) => ({
              value,
              label:
                value === '16:9'
                  ? '16:9（横屏）'
                  : value === '9:16'
                    ? '9:16（竖屏）'
                    : value,
            }))}
            showRectMarker
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] text-gray-500">时长</label>
          <DropUpSelect
            value={videoDuration}
            onChange={(value) => setVideoDuration(value)}
            options={durationOptions.map((value) => ({
              value,
              label: `${value}s`,
            }))}
          />
        </div>

        {showLineSelector && (
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">线路</label>
            <DropUpSelect
              value={videoLine}
              onChange={(value) => setVideoLine(value)}
              options={routeOptions}
            />
            {restrictToDirectKeyCompatible && (
              <div className="mt-1 text-[10px] leading-4 text-cyan-300">
                这里只显示支持直连 API Key 的线路。
              </div>
            )}
          </div>
        )}
      </div>

      {supportsVideoReference && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-[10px] text-gray-500">
                {videoReferenceMode === 'frames' ? '参考视频 URL' : '参考视频 URL（可选）'}
              </label>
              <button
                type="button"
                onClick={() => videoReferenceInputRef.current?.click()}
                disabled={isUploadingReferenceVideo}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-blue-300 transition-colors hover:border-white/20 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingReferenceVideo ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Upload size={11} />
                )}
                {isUploadingReferenceVideo ? '上传中' : '上传视频'}
              </button>
            </div>
            <input
              value={videoReferenceUrl}
              onChange={(e) => setVideoReferenceUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
            />
            <input
              ref={videoReferenceInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              className="hidden"
              onChange={handleSelectReferenceVideo}
            />
          </div>
          <div className="text-[10px] text-gray-400">
            {videoReferenceMode === 'frames'
              ? `首尾帧模式下最多支持 ${maxReferenceImages} 张图片`
              : `参考图模式下最多支持 ${maxReferenceImages} 张图片`}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="block text-[10px] text-gray-500">视频模型</label>
          <span className="text-[10px] font-medium text-yellow-300">
            {isPerSecondPricing
              ? `${pointCostPerSecond} 金币/s · 预计 ${estimatedCost} 金币`
              : `预计 ${estimatedCost} 金币`}
          </span>
        </div>
        {supportsHd && (
          <label className="mb-2 flex cursor-pointer items-center justify-end gap-1.5">
            <input
              type="checkbox"
              checked={videoHd}
              onChange={(event) => setVideoHd(event.target.checked)}
              className="h-3 w-3 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-[10px] font-medium text-purple-300">
              {isGrokModel ? '1080P 高清' : '高清模式'}
            </span>
          </label>
        )}

        <ModelSelector
          dropUp
          value={currentModel.id}
          onChange={(value) => {
            setVideoModel(value);
            setVideoAspectRatio(getDefaultVideoAspectRatioForModel(value));
            setVideoDuration(getDefaultVideoDurationForModel(value));
            setVideoHd(false);
          }}
          options={modelOptions}
        />
      </div>
    </div>
  );
};

export default VideoFormConfig;
