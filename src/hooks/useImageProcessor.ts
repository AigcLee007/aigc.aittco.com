import { useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { assetStorage } from '../services/assetStorage';
import { cacheImageSource } from '../services/imageAssetCache';
import { NodeData, ToolMode, Point } from '../../types';
import { useToast } from '../context/ToastContext';

export const useImageProcessor = () => {
    const { addNode, generateId, canvasState } = useCanvasStore();
    const { selectAll, setToolMode } = useSelectionStore();
    const { error: toastError } = useToast();

    const processFiles = useCallback(async (items: (File | string)[], centerPoint?: Point) => {
        if (items.length === 0) return;
        const importedAt = new Date().toISOString();
    
        const createNodeFromBlob = async (blob: Blob, prompt: string): Promise<NodeData> => {
           const assetId = await assetStorage.storeBlob(blob);
           try { await assetStorage.ensurePreview(assetId); } catch { /* Retain original and allow a controlled display fallback. */ }
           const meta = await assetStorage.getMeta(assetId);
           const ratio = (meta?.height || 512) / (meta?.width || 512);
           const width = ratio > 1 ? 512 / ratio : 512;
           return {id:generateId(),type:'IMAGE',x:0,y:0,width,height:width*ratio,assetId,src:'',prompt,createdAt:importedAt,history:[{src:'',assetId,prompt}],historyIndex:0};
        };

        const createNodeFromSrc = async (src: string, prompt: string): Promise<NodeData> => {
          const cached = await cacheImageSource(src);
          if (!cached.assetId && /^(blob:|data:)/i.test(src)) return createNodeFromBlob(cached.blob,prompt);
          if(cached.assetId)try { await assetStorage.ensurePreview(cached.assetId); } catch { /* Original remains usable. */ }
          const meta = cached.assetId ? await assetStorage.getMeta(cached.assetId) : undefined;
          const ratio = (meta?.height || 512) / (meta?.width || 512);
          const width = ratio > 1 ? 512 / ratio : 512;
          const canonical = /^(blob:|data:)/i.test(src) ? '' : src;
          return {id:generateId(),type:'IMAGE',x:0,y:0,width,height:width*ratio,src:canonical,assetId:cached.assetId,prompt,createdAt:importedAt,history:[{src:canonical,assetId:cached.assetId,prompt}],historyIndex:0};
        };

        const results:Array<NodeData|null> = [];
        for (const item of items) {
          try {
            if (item instanceof File) {
                const isImage = item.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(item.name);
                if (!isImage) {
                    console.warn("Skipping non-image file:", item.name, item.type);
                    results.push(null);continue;
                }
                results.push(await createNodeFromBlob(item, ""));
            } else if (typeof item === 'string') {
                results.push(await createNodeFromSrc(item, "Web Image"));
            }
          }catch { results.push({error:true} as NodeData); }
        }
        const loadedNodes = results.filter((n): n is NodeData => n !== null && !n.error);
        
        if (loadedNodes.length === 0) {
            const hasErrors = results.some(n => n?.error);
            if (hasErrors) {
                toastError("Failed to load some images. Please check the files and try again.");
            } else if (items.length > 0) {
                console.warn("No valid images processed from input", items);
                toastError("No valid image files detected.");
            }
            return;
        }
    
        const count = loadedNodes.length; const cols = Math.ceil(Math.sqrt(count)); const gap = 40; const cellSize = 512;
        let cx, cy;
        if (centerPoint) { cx = (centerPoint.x - canvasState.offset.x) / canvasState.scale; cy = (centerPoint.y - canvasState.offset.y) / canvasState.scale; }
        else { cx = -canvasState.offset.x / canvasState.scale + (window.innerWidth / 2 / canvasState.scale); cy = -canvasState.offset.y / canvasState.scale + (window.innerHeight / 2 / canvasState.scale); }
        const totalGridW = cols * cellSize + (cols - 1) * gap; const rows = Math.ceil(count / cols); const totalGridH = rows * cellSize + (rows - 1) * gap;
        const startX = cx - totalGridW / 2; const startY = cy - totalGridH / 2;
        const positionedNodes = loadedNodes.map((node, idx) => {
          const col = idx % cols; const row = Math.floor(idx / cols);
          const cellCenterX = startX + col * (cellSize + gap) + cellSize / 2; const cellCenterY = startY + row * (cellSize + gap) + cellSize / 2;
          return { ...node, x: cellCenterX - node.width / 2, y: cellCenterY - node.height / 2 };
        });
        positionedNodes.forEach(n => addNode(n));
        setToolMode(ToolMode.SELECT);
        selectAll(positionedNodes.map(n => n.id));
      }, [canvasState, generateId, addNode, setToolMode, selectAll]);

      const handleUpload = useCallback((files: FileList) => {
        const fileArray: File[] = []; for (let i = 0; i < files.length; i++) fileArray.push(files[i]);
        processFiles(fileArray);
      }, [processFiles]);

      return { processFiles, handleUpload };
};
