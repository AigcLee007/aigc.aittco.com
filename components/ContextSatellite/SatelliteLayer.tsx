import React, { useCallback } from 'react';
import { useCanvasStore } from '../../src/store/canvasStore';
import { useSelectionStore } from '../../src/store/selectionStore';
import { useCanvasOperations } from '../../src/hooks/useCanvasOperations';
import { generateImageApi } from '../../services/api';
import { generateVideo } from '../../services/videoService';
import { getImageModelNameForRoute, getSelectedImageRoute } from '../../src/config/imageRoutes';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getDefaultVideoAspectRatioForModel,
  getDefaultVideoDurationForModel,
  getDefaultVideoResolutionForModel,
  getVideoModelById,
} from '../../src/config/videoModels';
import { getSelectedVideoRoute } from '../../src/config/videoRoutes';
import { PrompterPill } from './PrompterPill';
import { SatelliteMenu } from './SatelliteMenu';
import { NodeData } from '../../types';
import { useImageRouteCatalog } from '../../src/hooks/useImageRouteCatalog';
import { useImageModelCatalog } from '../../src/hooks/useImageModelCatalog';
import { useVideoModelCatalog } from '../../src/hooks/useVideoModelCatalog';
import { useVideoRouteCatalog } from '../../src/hooks/useVideoRouteCatalog';

interface SatelliteLayerProps {
  onInitGenerations: (count: number, prompt: string, aspectRatio?: string, baseNode?: NodeData, type?: 'IMAGE' | 'VIDEO') => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string, taskId?: string) => void;
}

export const SatelliteLayer: React.FC<SatelliteLayerProps> = ({ onInitGenerations, onUpdateGeneration }) => {
  useImageRouteCatalog();
  useImageModelCatalog();
  useVideoModelCatalog();
  useVideoRouteCatalog();
  const { nodes, canvasState } = useCanvasStore();
  const { selectedIds, apiKey, imageModel, imageLine } = useSelectionStore();
  const selectedImageRoute = getSelectedImageRoute(imageModel, imageLine);
  const satelliteModel = getImageModelNameForRoute({
    imageModel,
    imageLine,
    imageSize: '1k',
  });
  const defaultVideoModel = getVideoModelById(DEFAULT_VIDEO_MODEL_ID());
  const defaultVideoRoute = getSelectedVideoRoute(defaultVideoModel.id);
  const defaultVideoAspectRatio = getDefaultVideoAspectRatioForModel(defaultVideoModel.id);
  const defaultVideoResolution = getDefaultVideoResolutionForModel(defaultVideoModel.id);
  const defaultVideoDuration = getDefaultVideoDurationForModel(defaultVideoModel.id);

  // Identify selection
  const selectedNodes = nodes.filter(n => selectedIds.includes(n.id));
  const primaryNode = selectedNodes.length === 1 ? selectedNodes[0] : null;

  // Render Logic
  const showPrompter = selectedIds.length === 0;
  const showSatellite = !!primaryNode && (primaryNode.type === 'IMAGE' || primaryNode.type === 'VIDEO') && primaryNode.src && !primaryNode.loading;

  // Position Calculation
  const getScreenCoords = (node: NodeData) => {
    // Canvas -> Screen
    // screenX = (nodeX + scaleX/2) * scale + offsetX
    // Wait, canvas transform logic is: pixelX = x * scale + offsetX
    // Node center top:
    const nodeCenterX = node.x + node.width / 2;
    const nodeTopY = node.y;
    
    const screenX = nodeCenterX * canvasState.scale + canvasState.offset.x;
    const screenY = nodeTopY * canvasState.scale + canvasState.offset.y;

    return { x: screenX, y: screenY };
  };

  // Handlers
  const handleGenerate = async (prompt: string, options: any) => {
    const { mode } = options;
    const generationAspectRatio = mode === 'VIDEO' ? defaultVideoAspectRatio : options.aspectRatio;
    
    // T2I / T2V
    const placeholderIds = onInitGenerations(1, prompt, generationAspectRatio, undefined, mode);
    
    placeholderIds.forEach(pid => {
       if (mode === 'IMAGE') {
           const payload = {
              model: satelliteModel,
              modelId: imageModel,
              prompt: prompt,
              size: '1k',
              aspect_ratio: generationAspectRatio,
              n: 1,
              routeId: selectedImageRoute.id,
           };
           generateImageApi(apiKey, payload)
             .then(res => onUpdateGeneration(pid, null, undefined, res.taskId))
             .catch(err => onUpdateGeneration(pid, null, err.message));
       } else {
           // T2V
           generateVideo(apiKey, {
              modelId: defaultVideoModel.id,
              routeId: defaultVideoRoute.id,
              prompt,
              aspectRatio: defaultVideoAspectRatio,
              resolution: defaultVideoResolution,
              duration: defaultVideoDuration,
              referenceImages: [],
              referenceVideos: [],
           })
           .then(url => onUpdateGeneration(pid, url))
           .catch(err => onUpdateGeneration(pid, null, err.message));
       }
    });

  };

  const handleSatelliteAction = (action: string) => {
    // Implement I2I, Animate, etc. actions here
    // For now, logging to console
    console.log("Satellite Action:", action, "on node", primaryNode?.id);
    
    if (action === 'animate' && primaryNode && primaryNode.type === 'IMAGE' && primaryNode.src) {
        // Quick Animate Logic
        const prompt = primaryNode.prompt || "Animate this image";
        const placeholderIds = onInitGenerations(1, prompt, defaultVideoAspectRatio, primaryNode, 'VIDEO');
        const pid = placeholderIds[0];
        
        generateVideo(apiKey, {
          modelId: defaultVideoModel.id,
          routeId: defaultVideoRoute.id,
          prompt,
          aspectRatio: defaultVideoAspectRatio,
          resolution: defaultVideoResolution,
          duration: defaultVideoDuration,
          referenceImages: [primaryNode.src],
          referenceVideos: [],
        })
            .then(url => onUpdateGeneration(pid, url))
            .catch(err => onUpdateGeneration(pid, null, err.message));
    }
  };

  return (
    <>
      {showPrompter && <PrompterPill onGenerate={handleGenerate} isGenerating={false} />}
      
      {showSatellite && primaryNode && (
        <SatelliteMenu 
          x={getScreenCoords(primaryNode).x} 
          y={getScreenCoords(primaryNode).y} 
          nodeType={primaryNode.type as 'IMAGE'|'VIDEO'}
          onAction={handleSatelliteAction} 
        />
      )}
    </>
  );
};
