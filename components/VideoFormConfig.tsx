import React, { useEffect, useMemo } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { useSelectionStore } from '../src/store/selectionStore';
import ModelSelector from './ModelSelector';
import DropUpSelect from './DropUpSelect';
import { GoogleLogo } from './Logos';
import { uploadVideoReferenceFile } from '../src/services/videoReferenceUpload';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getDefaultVideoAspectRatioForModel,
  getDefaultVideoDurationForModel,
  getDefaultVideoResolutionForModel,
  getVideoModelAspectRatioOptions,
  getVideoModelById,
  getVideoModelDisplayCost,
  getVideoModelDurationOptions,
  getVideoModelMaxReferenceImages,
  getVideoModelMaxReferenceVideos,
  getVideoModelPointCostPerSecond,
  getVideoModelPricingMode,
  getVideoModelReferenceImageMode,
  getVideoModelSupportsVideoReference,
  getVideoModelResolutionOptions,
} from '../src/config/videoModels';
import { getVisibleVideoModels, getVideoRouteOptions, getVideoRoutesByRouteFamily } from '../src/config/videoRoutes';
import { useVideoModelCatalog } from '../src/hooks/useVideoModelCatalog';
import { useVideoRouteCatalog } from '../src/hooks/useVideoRouteCatalog';

interface VideoFormConfigProps { restrictToDirectKeyCompatible?: boolean; }

export const VideoFormConfig: React.FC<VideoFormConfigProps> = ({ restrictToDirectKeyCompatible = false }) => {
  useVideoModelCatalog();
  useVideoRouteCatalog();
  const videoReferenceInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploadingReferenceVideo, setIsUploadingReferenceVideo] = React.useState(false);
  const {
    videoModel, setVideoModel, videoLine, setVideoLine, videoAspectRatio, setVideoAspectRatio,
    videoDuration, setVideoDuration, videoResolution, setVideoResolution, videoReferenceVideos,
    addVideoReferenceVideo, removeVideoReferenceVideo,
  } = useSelectionStore();

  const visibleVideoModels = useMemo(
    () => getVisibleVideoModels({ directKeyOnly: restrictToDirectKeyCompatible }),
    [restrictToDirectKeyCompatible],
  );
  const currentModel = visibleVideoModels.find((model) => model.id === videoModel) || visibleVideoModels[0] || getVideoModelById(videoModel);
  const availableRoutes = useMemo(
    () => getVideoRoutesByRouteFamily(currentModel.routeFamily).filter((route) => route.isActive !== false && (!restrictToDirectKeyCompatible || route.allowUserApiKeyWithoutLogin === true)),
    [currentModel.routeFamily, restrictToDirectKeyCompatible],
  );
  const routeOptions = useMemo(() => getVideoRouteOptions(currentModel.id, { directKeyOnly: restrictToDirectKeyCompatible }), [currentModel.id, restrictToDirectKeyCompatible]);
  const ratioOptions = getVideoModelAspectRatioOptions(currentModel.id);
  const durationOptions = getVideoModelDurationOptions(currentModel.id);
  const resolutionOptions = getVideoModelResolutionOptions(currentModel.id);
  const supportsVideoReference = getVideoModelSupportsVideoReference(currentModel.id);
  const referenceImageMode = getVideoModelReferenceImageMode(currentModel.id);
  const maxReferenceImages = getVideoModelMaxReferenceImages(currentModel.id);
  const maxReferenceVideos = getVideoModelMaxReferenceVideos(currentModel.id);
  const maxTotalReferences = getVideoModelById(currentModel.id).maxTotalReferences ?? maxReferenceImages + maxReferenceVideos;
  const showLineSelector = availableRoutes.length > 1;

  useEffect(() => {
    if (visibleVideoModels.length && !visibleVideoModels.some((model) => model.id === videoModel)) setVideoModel(visibleVideoModels[0].id);
  }, [setVideoModel, videoModel, visibleVideoModels]);
  useEffect(() => {
    if (availableRoutes.length && !availableRoutes.some((route) => route.line === videoLine)) setVideoLine(availableRoutes[0].line);
  }, [availableRoutes, setVideoLine, videoLine]);
  useEffect(() => {
    if (!ratioOptions.includes(videoAspectRatio)) setVideoAspectRatio(getDefaultVideoAspectRatioForModel(currentModel.id));
  }, [currentModel.id, ratioOptions, setVideoAspectRatio, videoAspectRatio]);
  useEffect(() => {
    if (!durationOptions.includes(videoDuration)) setVideoDuration(getDefaultVideoDurationForModel(currentModel.id));
  }, [currentModel.id, durationOptions, setVideoDuration, videoDuration]);
  useEffect(() => {
    if (!resolutionOptions.includes(videoResolution)) setVideoResolution(getDefaultVideoResolutionForModel(currentModel.id));
  }, [currentModel.id, resolutionOptions, setVideoResolution, videoResolution]);
  useEffect(() => {
    if (videoReferenceVideos.length > maxReferenceVideos) videoReferenceVideos.slice(maxReferenceVideos).forEach((_, index) => removeVideoReferenceVideo(maxReferenceVideos + index));
  }, [maxReferenceVideos, removeVideoReferenceVideo, videoReferenceVideos]);

  const modelOptions = visibleVideoModels.map((model) => ({
    value: model.id, label: model.label,
    cost: getVideoModelDisplayCost(model.id, model.id === currentModel.id ? videoDuration : model.defaultDuration),
    icon: <GoogleLogo />,
  }));
  const isPerSecondPricing = getVideoModelPricingMode(currentModel.id) === 'per_second';
  const pointCostPerSecond = getVideoModelPointCostPerSecond(currentModel.id);
  const estimatedCost = getVideoModelDisplayCost(currentModel.id, videoDuration);

  const handleSelectReferenceVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (videoReferenceVideos.length + files.length > maxReferenceVideos) {
      window.alert(`当前模型最多支持 ${maxReferenceVideos} 个参考视频`);
      return;
    }
    try {
      setIsUploadingReferenceVideo(true);
      for (const file of files) {
        const url = await uploadVideoReferenceFile(file);
        addVideoReferenceVideo({ id: `${Date.now()}-${file.name}`, url, name: file.name });
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '参考视频上传失败');
    } finally { setIsUploadingReferenceVideo(false); }
  };

  if (!visibleVideoModels.length) return <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-gray-400">当前没有可用的视频模型。</div>;

  return <div className="flex flex-col gap-3">
    <div className={`grid ${showLineSelector ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
      <div><label className="mb-1 block text-[10px] text-gray-500">画面比例</label><DropUpSelect value={videoAspectRatio} onChange={setVideoAspectRatio} options={ratioOptions.map((value) => ({ value, label: value }))} showRectMarker /></div>
      <div><label className="mb-1 block text-[10px] text-gray-500">分辨率</label>{resolutionOptions.length > 1 ? <DropUpSelect value={videoResolution} onChange={setVideoResolution} options={resolutionOptions.map((value) => ({ value, label: value.toUpperCase() }))} /> : <div className="flex h-9 items-center rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-gray-300">{resolutionOptions[0].toUpperCase()}</div>}</div>
      <div><label className="mb-1 block text-[10px] text-gray-500">时长</label><DropUpSelect value={videoDuration} onChange={setVideoDuration} options={durationOptions.map((value) => ({ value, label: `${value}s` }))} /></div>
      {showLineSelector && <div><label className="mb-1 block text-[10px] text-gray-500">线路</label><DropUpSelect value={videoLine} onChange={setVideoLine} options={routeOptions} /></div>}
    </div>
    {supportsVideoReference && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="flex items-center justify-between"><label className="text-[10px] text-gray-500">参考视频（最多 {maxReferenceVideos} 个）</label><button type="button" onClick={() => videoReferenceInputRef.current?.click()} disabled={isUploadingReferenceVideo} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-blue-300 disabled:opacity-60"><Upload size={11} />{isUploadingReferenceVideo ? '上传中' : '上传视频'}</button></div>
      <input ref={videoReferenceInputRef} type="file" multiple accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" onChange={handleSelectReferenceVideo} />
      {videoReferenceVideos.map((item, index) => <div key={item.id || item.url} className="flex h-8 items-center justify-between gap-2 rounded-md bg-black/20 px-2 text-xs text-gray-300"><span className="truncate">{item.name || item.url}</span><button type="button" aria-label={`移除参考视频 ${index + 1}`} onClick={() => removeVideoReferenceVideo(index)} className="text-gray-400 hover:text-white"><X size={14} /></button></div>)}
      <div className="text-[10px] text-gray-400">参考图片最多 {maxReferenceImages} 张，参考视频最多 {maxReferenceVideos} 个，合计最多 {maxTotalReferences} 个</div>
    </div>}
    <div><div className="mb-1 flex items-center justify-between gap-2"><label className="block text-[10px] text-gray-500">视频模型</label><span className="text-[10px] font-medium text-yellow-300">{isPerSecondPricing ? `${pointCostPerSecond} 金币/s · 预计 ${estimatedCost} 金币` : `预计 ${estimatedCost} 金币`}</span></div><ModelSelector dropUp value={currentModel.id} onChange={(value) => { setVideoModel(value); setVideoAspectRatio(getDefaultVideoAspectRatioForModel(value)); setVideoDuration(getDefaultVideoDurationForModel(value)); setVideoResolution(getDefaultVideoResolutionForModel(value)); }} options={modelOptions} /></div>
    {referenceImageMode === 'frames' && <div className="text-[10px] text-cyan-300">参考图片将按首帧、尾帧顺序发送。</div>}
  </div>;
};

export default VideoFormConfig;
