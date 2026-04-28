import { useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { assetStorage } from '../services/assetStorage';
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
           const src = await assetStorage.getAssetUrl(assetId);
           
           return new Promise((resolve) => {
              const img = new Image(); 
              img.crossOrigin = "Anonymous";
              img.onload = () => {
                 let width = img.width; 
                 let height = img.height; 
                 const maxSize = 512;
                 if (width > maxSize || height > maxSize) {
                   const ratio = width / height;
                   if (width > height) { width = maxSize; height = maxSize / ratio; }
                   else { height = maxSize; width = maxSize * ratio; }
                 }
                 resolve({ 
                     id: generateId(), 
                     type: 'IMAGE', 
                     x: 0, 
                     y: 0, 
                     width, 
                     height, 
                     opacity: 1, 
                     locked: false, 
                      src: src!, // managed by assetStorage
                      assetId: assetId,
                      prompt: prompt, 
                      createdAt: importedAt,
                      history: [], 
                      historyIndex: 0 
                 });
              };
              img.onerror = () => { 
                 resolve({ 
                     id: generateId(), 
                     type: 'IMAGE', 
                     x: 0, 
                     y: 0, 
                     width: 100, 
                     height: 100, 
                     src: '', 
                     error: true, 
                     errorMessage: "Failed to load image" 
                 } as any); 
              };
              img.src = src!;
           });
        };
    
        const createNodeFromSrc = (src: string, prompt: string): Promise<NodeData> => {
          // For web images/strings, we still use the old way unless we want to fetch and store them?
          // For now, keep as is for strings, but if it is long base64, maybe convert to blob?
          // Let's keep simple: strings (URLs) stay as src without assetId.
          return new Promise((resolve) => {
            const img = new Image(); img.crossOrigin = "Anonymous";
            img.onload = () => {
              let width = img.width; let height = img.height; const maxSize = 512;
              if (width > maxSize || height > maxSize) {
                const ratio = width / height;
                if (width > height) { width = maxSize; height = maxSize / ratio; }
                else { height = maxSize; width = maxSize * ratio; }
              }
              // If we want to store web images locally to avoid CORS/broken links:
              // handle separately. For now, just pass src.
              resolve({ id: generateId(), type: 'IMAGE', x: 0, y: 0, width, height, opacity: 1, locked: false, src: src, prompt: prompt, createdAt: importedAt, history: [{ src: src, prompt: prompt }], historyIndex: 0 });
            };
            img.onerror = () => { resolve({ id: generateId(), type: 'IMAGE', x: 0, y: 0, width: 100, height: 100, src: '', error: true, errorMessage: "Failed to load image" } as any); };
            img.src = src;
          });
        };
    
        const loadPromises = items.map(async (item) => {
            if (item instanceof File) {
                const isImage = item.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(item.name);
                if (!isImage) {
                    console.warn("Skipping non-image file:", item.name, item.type);
                    return null;
                }
                return createNodeFromBlob(item, "");
            } else if (typeof item === 'string') {
                return createNodeFromSrc(item, "Web Image");
            }
            return null;
        });
    
        const results = await Promise.all(loadPromises);
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
