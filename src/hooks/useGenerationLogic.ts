import { useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { useHistoryStore } from '../store/historyStore';
import { assetStorage } from '../services/assetStorage';
import { cacheImageSource } from '../services/imageAssetCache';
import { arrangeNodes } from '../utils/layout';
import { getLocalLine4ThumbnailUrl } from '../utils/generatedImageStorage';
import { getProxiedImageUrl, unwrapMiswrappedImageUrl } from '../utils/mediaProxy';
import { revokeDownloadObjectUrlLater } from '../utils/downloadObjectUrl';
import { NodeData, ToolMode } from '../../types';
import { getImageJobOwner } from '../services/imageJobClient';
import { getStoredAuthSessionToken, buildBillingIdentityHeaders } from '../services/accountIdentity';
import { imageResultStore, type ImageResultInput } from '../services/imageResultStore';
import { canvasResultIdentity, registerCanvasResult } from '../services/canvasResultIdentity';

type AutoDownloadItem = {
    src: string;
    prompt?: string;
    id?: string;
    identity?: ImageResultInput;
    session?: string | null;
};

let autoDownloadQueue: AutoDownloadItem[] = [];
let autoDownloadTimer: ReturnType<typeof setTimeout> | null = null;
let autoDownloadRunning = false;
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

const resolveFetchUrl = (src: string) => getProxiedImageUrl(src);

const triggerDownload = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const fetchBlobForDownload = async (src: string, identity?: ImageResultInput): Promise<Blob | null> => {
    try {
        if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/') || src.startsWith('http')) {
            return (await cacheImageSource(src,15000,false,identity)).blob;
        }
    } catch (err) {
        console.warn('Auto download fetch failed:', err);
    }
    return null;
};

const flushAutoDownloadQueue = async () => {
    autoDownloadTimer = null;
    if (autoDownloadRunning) return;
    autoDownloadRunning = true;
    let sequence=0;
    try {

    // Download each image one-by-one (no zip).
    while(autoDownloadQueue.length) {
        const item = autoDownloadQueue.shift()!;
        try {
        if(item.session !== getStoredAuthSessionToken() || !imageResultStore.getAutoDownloadPreference(true))continue;
        const filenameBase = sanitizeFilename(item.prompt || 'image') || 'image';
        const seq = String(++sequence).padStart(2, '0');
        const blob = await fetchBlobForDownload(item.src,item.identity);
        if(item.session !== getStoredAuthSessionToken() || !blob)continue;
        const resultId=item.identity ? imageResultStore.resultId(item.identity.ownerId,item.identity.jobId,item.identity.outputIndex) : undefined;
        // Claim only once bytes are ready; a crash after intent remains ambiguous
        // and must never automatically trigger a second download on restoration.
        const token=resultId ? await imageResultStore.claimDownload(resultId).catch(()=>null) : undefined;
        if(resultId && !token)continue;
        if(item.session !== getStoredAuthSessionToken() || !imageResultStore.getAutoDownloadPreference(true))continue;
        if (blob) {
            const ext = inferExt(item.src, blob.type);
            const href = URL.createObjectURL(blob);
            try {
              triggerDownload(href, `${seq}_${filenameBase}_${item.id || Date.now()}.${ext}`);
              if(resultId && token)await imageResultStore.markDownloadStarted(resultId,token).catch(()=>false);
            } finally { revokeDownloadObjectUrlLater(href); }
        }
        if (autoDownloadQueue.length) {
            await new Promise((resolve) => setTimeout(resolve, 220));
        }
        } catch(error) { console.warn('Automatic download was not confirmed; use manual download',error); }
    }
    } finally { autoDownloadRunning=false; }
};

const enqueueAutoDownload = (item: AutoDownloadItem) => {
    autoDownloadQueue.push(item);
    if (autoDownloadTimer || autoDownloadRunning) return;
    autoDownloadTimer = setTimeout(() => {
        void flushAutoDownloadQueue();
    }, AUTO_DOWNLOAD_BATCH_MS);
};

export const useGenerationLogic = () => {
    const { nodes, setNodes, updateNode, generateId, setCanvasTransform, canvasState } = useCanvasStore();
    const { setToolMode, addLog } = useSelectionStore.getState() as any; // Cast to access non-state actions if any or mixed

    const autoDownloadGeneratedImage = useCallback((src: string, prompt?: string, id?: string,identity?:ImageResultInput) => {
        enqueueAutoDownload({ src, prompt, id, identity, session:getStoredAuthSessionToken() });
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
            generationStartedAt: Date.now(),
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
        const ownerNode = useCanvasStore.getState().nodes.find(n => n.id === id);
        if (ownerNode?.generationOwnerId) {
            const session = getStoredAuthSessionToken();
            if (!session) return;
            const owner = await getImageJobOwner(buildBillingIdentityHeaders(session)).catch(() => '');
            if (session !== getStoredAuthSessionToken() || owner !== ownerNode.generationOwnerId) return;
        }
        if (taskId) {
            const current = useCanvasStore.getState().nodes.find(n => n.id === id);
            if (current?.taskId === taskId && !current.loading && (current.src || current.error || current.generationConnectionStatus === 'result-unavailable')) return;
            updateNode(id, { taskId, loading: true, error: false, errorMessage: undefined }, true);
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
        const rawSrc = unwrapMiswrappedImageUrl(src);
        const isVideo = rawSrc.toLowerCase().endsWith('.mp4') 
            || rawSrc.toLowerCase().includes('format=mp4')
            || rawSrc.toLowerCase().includes('/video/')
            || currentNode0?.type === 'VIDEO';

        const currentNodes = useCanvasStore.getState().nodes;
        const currentNode = currentNodes.find(n => n.id === id);
        if (!currentNode) return;
        if (!currentNode.loading && !currentNode.error && currentNode.src === rawSrc) return;
        const generatedAt = new Date().toISOString();
        const generationSession=getStoredAuthSessionToken();
        const resultIdentity=isVideo ? undefined : canvasResultIdentity({...currentNode,createdAt:generatedAt},rawSrc);
        const resultAssetId=resultIdentity ? imageResultStore.resultId(resultIdentity.ownerId,resultIdentity.jobId,resultIdentity.outputIndex) : undefined;

        // 1) Show result immediately with original URL first.
        // Avoid blocking first paint on local proxy latency.
        const displaySrc = rawSrc;
        const canvasSafeSrc = getProxiedImageUrl(rawSrc);
        const thumbnailSrc = isVideo ? undefined : currentNode.thumbnailSrc || getLocalLine4ThumbnailUrl(displaySrc) || undefined;

        updateNode(id, {
            src: displaySrc,
            generationResultSrc: displaySrc,
            assetId: resultAssetId,
            thumbnailSrc,
            loading: false,
            error: false,
            generationConnectionStatus: undefined,
            opacity: 1,
            createdAt: generatedAt,
        }, true);

        const logId = addLog(
          currentNode.prompt || (isVideo ? "Generated Video" : "Generated Image"),
          displaySrc,
          resultAssetId,
          isVideo ? 'VIDEO' : (currentNode.type as 'IMAGE' | 'VIDEO'),
          thumbnailSrc,
        );

        if (!isVideo && imageResultStore.getAutoDownloadPreference(useSelectionStore.getState().autoDownloadOnSuccess)) {
            void autoDownloadGeneratedImage(displaySrc, currentNode.prompt, id,resultIdentity);
        }

        // Share the same original read with display and automatic download.
        if (!isVideo) {
          void (async () => {
            try {
              if(resultIdentity && currentNode.assetId)await registerCanvasResult({...currentNode,createdAt:generatedAt},rawSrc).catch(()=>{});
              const {assetId} = await cacheImageSource(rawSrc,15000,false,resultIdentity);
              const sameResult = () => {
                if(generationSession!==getStoredAuthSessionToken())return undefined;
                const latest = useCanvasStore.getState().nodes.find(n => n.id === id);
                return latest && latest.src === displaySrc && latest.createdAt === generatedAt ? latest : undefined;
              };
              if (assetId) {
                if (sameResult()) updateNode(id, { assetId }, true);
                updateLogAsset(logId, assetId);
                await assetStorage.ensurePreview(assetId);
                const meta = await assetStorage.getMeta(assetId);
                const latest = sameResult();
                if (latest && meta?.width && meta?.height) updateNode(id, { height: latest.width * meta.height / meta.width }, true);
              }
            } catch (e) { console.warn('Background asset cache failed', e); }
          })();
        }

    }, [autoDownloadGeneratedImage, updateNode]);

    return { handleInitGenerations, handleUpdateGeneration, handleUpdateProgress };
};
