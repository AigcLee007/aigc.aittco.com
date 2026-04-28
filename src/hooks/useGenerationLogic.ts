import { useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { useHistoryStore } from '../store/historyStore';
import { assetStorage } from '../services/assetStorage';
import { arrangeNodes } from '../utils/layout';
import { NodeData, ToolMode } from '../../types';

type AutoDownloadItem = {
    src: string;
    prompt?: string;
    id?: string;
};

let autoDownloadQueue: AutoDownloadItem[] = [];
let autoDownloadTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_DOWNLOAD_BATCH_MS = 1200;

const sanitizeFilename = (raw: string) =>
    raw
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
        .replace(/^_+|_+$/g, '');

const inferExt = (src: string, mime?: string) => {
    const lower = src.toLowerCase();
    if (mime?.includes('webp') || lower.includes('.webp')) return 'webp';
    if (mime?.includes('jpeg') || mime?.includes('jpg') || lower.includes('.jpg') || lower.includes('.jpeg')) return 'jpg';
    return 'png';
};

const resolveFetchUrl = (src: string) => {
    if (src.startsWith('http')) return `/api/proxy/image?url=${encodeURIComponent(src)}`;
    return src;
};

const triggerDownload = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const fetchBlobForDownload = async (src: string): Promise<Blob | null> => {
    try {
        if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/') || src.startsWith('http')) {
            const res = await fetch(resolveFetchUrl(src));
            if (res.ok) return await res.blob();
        }
    } catch (err) {
        console.warn('Auto download fetch failed:', err);
    }
    return null;
};

const flushAutoDownloadQueue = async () => {
    const items = autoDownloadQueue.splice(0, autoDownloadQueue.length);
    autoDownloadTimer = null;
    if (items.length === 0) return;

    // Download each image one-by-one (no zip).
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const filenameBase = sanitizeFilename(item.prompt || 'image') || 'image';
        const seq = String(i + 1).padStart(2, '0');
        const blob = await fetchBlobForDownload(item.src);
        if (blob) {
            const ext = inferExt(item.src, blob.type);
            const href = URL.createObjectURL(blob);
            triggerDownload(href, `${seq}_${filenameBase}_${item.id || Date.now()}.${ext}`);
            setTimeout(() => URL.revokeObjectURL(href), 1000);
        } else {
            triggerDownload(item.src, `${seq}_${filenameBase}_${item.id || Date.now()}.png`);
        }
        if (i < items.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 220));
        }
    }
};

const enqueueAutoDownload = (item: AutoDownloadItem) => {
    autoDownloadQueue.push(item);
    if (autoDownloadTimer) clearTimeout(autoDownloadTimer);
    autoDownloadTimer = setTimeout(() => {
        void flushAutoDownloadQueue();
    }, AUTO_DOWNLOAD_BATCH_MS);
};

export const useGenerationLogic = () => {
    const { nodes, setNodes, updateNode, generateId, setCanvasTransform, canvasState } = useCanvasStore();
    const { setToolMode, addLog } = useSelectionStore.getState() as any; // Cast to access non-state actions if any or mixed

    const autoDownloadGeneratedImage = useCallback((src: string, prompt?: string, id?: string) => {
        enqueueAutoDownload({ src, prompt, id });
    }, []);

    // Init generations (placeholder nodes)
    const handleInitGenerations = useCallback((
        count: number,
        prompt: string,
        aspectRatio: string = '1:1',
        baseNode?: NodeData,
        type: 'IMAGE' | 'VIDEO' = 'IMAGE',
        options: { preserveToolMode?: boolean } = {},
    ) => {
        let width = 512;
        let height = 512;

        // Parse aspect ratio
        if (aspectRatio !== 'Smart' && aspectRatio) {
        const parts = aspectRatio.split(':').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const ratio = parts[0] / parts[1];
            if (ratio > 1) {
            // Landscape: Width 512, Height scaled
            width = 512;
            height = Math.round(512 / ratio);
            } else {
            // Portrait or Square: Height 512, Width scaled
            height = 512;
            width = Math.round(512 * ratio);
            }
        }
        } else if (baseNode) {
        // Smart mode with base node: inherit ratio
        const ratio = baseNode.width / baseNode.height;
        if (ratio > 1) {
            width = 512;
            height = Math.round(512 / ratio);
        } else {
            height = 512;
            width = Math.round(512 * ratio);
        }
        }

        const newNodes: NodeData[] = [];

        // Create new nodes
        for (let i = 0; i < count; i++) {
        newNodes.push({
            id: generateId(),
            type: type,
            x: 0,
            y: 0,
            width: width,
            height: height,
            opacity: 1,
            locked: false,
            loading: true,
            src: '',
            prompt: prompt,
            history: [],
            historyIndex: 0
        });
        }

        const currentNodes = useCanvasStore.getState().nodes;
        const allNodes = [...currentNodes, ...newNodes];

        // Arrange nodes (allNodes will use stable sort now, creating new columns)
        const finalNodes = arrangeNodes(allNodes, {
            startX: 360,
            startY: 100,
            gap: 20,
            maxRows: 3,
            nodeWidth: width,
            nodeHeight: height
        });

        setNodes(finalNodes);
        if (!options.preserveToolMode) {
            // Switch to SELECT mode so user can see what's happening
            setToolMode(ToolMode.SELECT);
        }

        // Auto-pan to new nodes
        const newIds = new Set(newNodes.map(n => n.id));
        const arrangedNewNodes = finalNodes.filter(n => newIds.has(n.id));

        if (arrangedNewNodes.length > 0) {
            // Calculate bounding box of new nodes
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            arrangedNewNodes.forEach(n => {
                minX = Math.min(minX, n.x);
                maxX = Math.max(maxX, n.x + n.width);
                minY = Math.min(minY, n.y);
                maxY = Math.max(maxY, n.y + n.height);
            });

            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            const screenCenterX = window.innerWidth / 2;
            const screenCenterY = window.innerHeight / 2;

            // Offset = ScreenCenter - CanvasCenter * Scale
            const newOffsetX = screenCenterX - centerX * canvasState.scale;
            const newOffsetY = screenCenterY - centerY * canvasState.scale;

            setCanvasTransform({ x: newOffsetX, y: newOffsetY }, canvasState.scale);
        }

        return newNodes.map(n => n.id);
    }, [generateId, setNodes, setToolMode, canvasState, setCanvasTransform]);

    // Update progress
    const handleUpdateProgress = useCallback((id: string, progress: number) => {
        updateNode(id, { progress }, true); 
    }, [updateNode]);

    // Update generation
    const handleUpdateGeneration = useCallback(async (id: string, src: string | null, error?: string, taskId?: string) => {
        if (taskId) {
            updateNode(id, { taskId, loading: true, error: false }, true);
            return;
        }

        if (error || !src || typeof src !== 'string') {
        updateNode(id, { loading: false, error: true, errorMessage: error || 'Invalid image source' });
        return;
        }

        const { addLog, updateLogAsset } = useHistoryStore.getState();

        // Detect video EARLY from original src (before proxy changes URL to blob:)
        const currentNodes0 = useCanvasStore.getState().nodes;
        const currentNode0 = currentNodes0.find(n => n.id === id);
        const rawSrc = src;
        const isVideo = rawSrc.toLowerCase().endsWith('.mp4') 
            || rawSrc.toLowerCase().includes('format=mp4')
            || rawSrc.toLowerCase().includes('/video/')
            || currentNode0?.type === 'VIDEO';

        const currentNodes = useCanvasStore.getState().nodes;
        const currentNode = currentNodes.find(n => n.id === id);
        if (!currentNode) return;

        // 1) Show result immediately with original URL first.
        // Avoid blocking first paint on local proxy latency.
        const displaySrc = rawSrc;

        updateNode(id, {
            src: displaySrc,
            loading: false,
            error: false,
            opacity: 1
        }, true);

        const logId = addLog(
          currentNode.prompt || (isVideo ? "Generated Video" : "Generated Image"),
          displaySrc,
          undefined,
          isVideo ? 'VIDEO' : (currentNode.type as 'IMAGE' | 'VIDEO')
        );

        if (!isVideo && useSelectionStore.getState().autoDownloadOnSuccess) {
            void autoDownloadGeneratedImage(displaySrc, currentNode.prompt, id);
        }

        // 2) Update image dimensions asynchronously (do not block UI).
        if (!isVideo) {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = () => {
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              const latestNode = useCanvasStore.getState().nodes.find(n => n.id === id);
              if (!latestNode) return;
              const aspectRatio = img.naturalHeight / img.naturalWidth;
              updateNode(id, { height: latestNode.width * aspectRatio }, true);
            }
          };
          img.src = displaySrc;
        }

        // 3) Persist asset in background (best effort), then backfill node/history.
        const shouldCache = !isVideo && (
          rawSrc.startsWith('data:image') ||
          rawSrc.startsWith('http') ||
          displaySrc.startsWith('/api/proxy/image?url=')
        );
        if (shouldCache) {
          void (async () => {
            try {
              const fetchUrl = rawSrc.startsWith('http')
                ? `/api/proxy/image?url=${encodeURIComponent(rawSrc)}`
                : rawSrc;
              const res = await fetch(fetchUrl);
              if (!res.ok) return;
              const blob = await res.blob();
              const assetId = await assetStorage.storeBlob(blob);
              const cachedUrl = await assetStorage.getAssetUrl(assetId);

              if (cachedUrl) {
                // Some browsers/proxies can block blob: URL rendering in strict contexts.
                // Keep the display URL as the original remote/proxy URL and only persist assetId.
                if (cachedUrl.startsWith('blob:')) {
                  updateNode(id, { assetId }, true);
                  updateLogAsset(logId, assetId);
                } else {
                  updateNode(id, { src: cachedUrl, assetId }, true);
                  updateLogAsset(logId, assetId, cachedUrl);
                }
              } else {
                updateNode(id, { assetId }, true);
                updateLogAsset(logId, assetId);
              }
            } catch (e) {
              console.warn("Background asset cache failed", e);
            }
          })();
        }
    }, [autoDownloadGeneratedImage, updateNode]);

    return { handleInitGenerations, handleUpdateGeneration, handleUpdateProgress };
};
