import React, { useCallback, useState } from 'react';
import { UpscaleDialog } from '../../components/ContextSatellite/UpscaleDialog';
import { readOriginalBlob } from '../services/imageAssetCache';
import { blobToDataUrl } from '../services/imageBlobUtils';
import { imageDimensions } from '../services/imageDimensions';
import { submitUpscale } from '../services/upscaleApi';
import { useCanvasStore } from '../store/canvasStore';
import type { NodeData } from '../../types';

export interface UpscaleFlowDeps {
  onInitGenerations: (count: number, prompt: string, aspectRatio?: string, baseNode?: NodeData, type?: 'IMAGE' | 'VIDEO') => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string, taskId?: string) => void;
}

interface Target { node: NodeData; dataUrl: string; width: number; height: number }

// Reads the real file first (so the price is based on true pixels), asks the user to
// confirm the quoted price, then submits a durable job and hands the task id to the canvas.
export const useUpscaleFlow = ({ onInitGenerations, onUpdateGeneration }: UpscaleFlowDeps) => {
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState('');

  const start = useCallback(async (node: NodeData) => {
    setNotice('');
    try {
      const blob = await readOriginalBlob(node);
      const size = await imageDimensions(blob);
      if (!size) throw new Error('无法识别图片尺寸');
      setTarget({ node, dataUrl: await blobToDataUrl(blob), width: size.width, height: size.height });
    } catch (error: any) {
      setNotice(error?.message || '读取原图失败，请稍后重试');
      window.setTimeout(() => setNotice(''), 4000);
    }
  }, []);

  const confirm = useCallback((choice: { engine: string; factor: number; format: string | null; engineLabel?: string }) => {
    if (!target) return;
    const { node, dataUrl } = target;
    setTarget(null);
    // The placeholder takes the source's shape, so the result lands at the right size.
    const [placeholderId] = onInitGenerations(1, node.prompt || '高清放大', 'Smart', node);
    // Remember what this result was made from, so the user can compare the two afterwards.
    useCanvasStore.getState().updateNode(placeholderId, {
      sourceNodeId: node.id,
      upscaleOf: { sourceNodeId: node.id, engineLabel: choice.engineLabel || '', factor: choice.factor },
    }, true);
    submitUpscale({ image: dataUrl, engine: choice.engine, factor: choice.factor, format: choice.format, clientLiveTaskIds: [placeholderId] })
      .then((result) => onUpdateGeneration(placeholderId, null, undefined, result.taskId))
      .catch((error) => onUpdateGeneration(placeholderId, null, error?.message || '高清放大失败'));
  }, [target, onInitGenerations, onUpdateGeneration]);

  const ui = (
    <>
      {notice && (
        <div role="alert" className="fixed bottom-6 canvas-center-x z-[70] -translate-x-1/2 rounded-full bg-neutral-900/90 px-4 py-2 text-sm text-red-300 shadow-xl">
          {notice}
        </div>
      )}
      {target && (
        <UpscaleDialog width={target.width} height={target.height} onConfirm={confirm} onCancel={() => setTarget(null)} />
      )}
    </>
  );

  return { start, ui };
};
