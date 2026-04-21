import React, { useEffect, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useSelectionStore } from '../src/store/selectionStore';
import ModelSelector from './ModelSelector';
import DropUpSelect from './DropUpSelect';
import { GoogleLogo } from './Logos';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getDefaultVideoAspectRatioForModel,
  getDefaultVideoDurationForModel,
  getVideoModelAspectRatioOptions,
  getVideoModelById,
  getVideoModelDisplayCost,
  getVideoModelDurationOptions,
  getVideoModelOptions,
  getVideoModelSupportsHd,
} from '../src/config/videoModels';
import {
  canUseDirectUserApiKeyForVideoModel,
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
  } = useSelectionStore();

  const visibleVideoModels = useMemo(
    () =>
      getVideoModelOptions().filter((model) =>
        restrictToDirectKeyCompatible ? canUseDirectUserApiKeyForVideoModel(model.id) : true,
      ),
    [restrictToDirectKeyCompatible],
  );

  const currentModel =
    visibleVideoModels.find((model) => model.id === videoModel) ||
    visibleVideoModels[0] ||
    getVideoModelById(videoModel);

  const availableRoutes = useMemo(
    () =>
      getVideoRoutesByRouteFamily(currentModel.routeFamily).filter((route) =>
        restrictToDirectKeyCompatible ? route.allowUserApiKeyWithoutLogin === true : true,
      ),
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

  const modelOptions = visibleVideoModels.map((model) => ({
    value: model.id,
    label: model.label,
    cost: getVideoModelDisplayCost(model.id),
    icon: model.id.startsWith('grok') ? <Sparkles size={14} /> : <GoogleLogo />,
  }));

  if (visibleVideoModels.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-gray-400">
        No video models are currently available for direct API Key use.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid ${showLineSelector ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">Aspect ratio</label>
          <DropUpSelect
            value={videoAspectRatio}
            onChange={(value) => setVideoAspectRatio(value)}
            options={ratioOptions.map((value) => ({
              value,
              label:
                value === '16:9'
                  ? '16:9 (Landscape)'
                  : value === '9:16'
                    ? '9:16 (Portrait)'
                    : value,
            }))}
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] text-gray-500">Duration</label>
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
            <label className="mb-1 block text-[10px] text-gray-500">Route</label>
            <DropUpSelect
              value={videoLine}
              onChange={(value) => setVideoLine(value)}
              options={routeOptions}
            />
            {restrictToDirectKeyCompatible && (
              <div className="mt-1 text-[10px] leading-4 text-cyan-300">
                Only routes that support direct API Key use are shown here.
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-[10px] text-gray-500">Video model</label>
          {supportsHd && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={videoHd}
                onChange={(event) => setVideoHd(event.target.checked)}
                className="h-3 w-3 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-[10px] font-medium text-purple-300">
                {isGrokModel ? '1080P HD' : 'HD mode'}
              </span>
            </label>
          )}
        </div>

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
