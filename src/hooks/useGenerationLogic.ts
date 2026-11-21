import { useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { useHistoryStore } from '../store/historyStore';
import { assetStorage } from '../services/assetStorage';
import { cacheImageSource } from '../services/imageAssetCache';
import { findCanvasFreePositions } from '../utils/canvasPlacement';
import { getLocalLine4ThumbnailUrl } from '../utils/generatedImageStorage';
import { getProxiedImageUrl, unwrapMiswrappedImageUrl } from '../utils/mediaProxy';
import { revokeDownloadObjectUrlLater } from '../utils/downloadObjectUrl';
import { NodeData, ToolMode } from '../../types';
import { getImageJobOwner } from '../services/imageJobClient';
import { getStoredAuthSessionToken, buildBillingIdentityHeaders } from '../services/accountIdentity';
import { imageResultStore, type ImageResultInput } from '../services/imageResultStore';
import { canvasResultIdentity, registerCanvasResult } from '../services/canvasResultIdentity';
import { saveToLocalFolder } from '../services/localFolderSave';
import { getCanvasCenter } from '../utils/canvasViewport';

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
            const name = `${seq}_${filenameBase}_${item.id || Date.now()}.${ext}`;
            // A chosen local folder takes the file directly; otherwise a normal download.
            const saved = await saveToLocalFolder(blob, name).catch(error => { console.warn('Local folder save failed; using download', error); return null; });
            if (!saved) {
              const href = URL.createObjectURL(blob);
              try { triggerDownload(href, name); } finally { revokeDownloadObjectUrlLater(href); }
            }
            if(resultId && token)await imageResultStore.markDownloadStarted(resultId,token).catch(()=>false);
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

const getCanvasFrameSize = (aspectRatio: string, baseNode?: NodeData) => {
    let width = 512;
    let height = 512;

    if (aspectRatio !== 'Smart' && aspectRatio) {
        const parts = aspectRatio.split(':').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            const ratio = parts[0] / parts[1];
            if (ratio > 1) {
                height = Math.round(512 / ratio);
            } else {
                width = Math.round(512 * ratio);
            }
        }
    } else if (baseNode?.width && baseNode.height) {
        const ratio = baseNode.width / baseNode.height;
        if (ratio > 1) {
            height = Math.round(512 / ratio);
        } else if (ratio > 0) {
            width = Math.round(512 * ratio);
        }
    }

    return { width, height };
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
        const { width, height } = getCanvasFrameSize(aspectRatio, baseNode);

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
        const { x: screenCenterX, y: screenCenterY } = getCanvasCenter();
        const anchor = {
            x: (screenCenterX - canvasState.offset.x) / canvasState.scale - width / 2,
            y: (screenCenterY - canvasState.offset.y) / canvasState.scale - height / 2,
        };
        const positions = findCanvasFreePositions(
            currentNodes
                .filter((node) => Number.isFinite(node.width) && Number.isFinite(node.height))
                .map(({ x, y, width: nodeWidth, height: nodeHeight }) => ({
                    x,
                    y,
                    width: nodeWidth,
                    height: nodeHeight,
                })),
            newNodes.map(({ width: nodeWidth, height: nodeHeight }) => ({
                width: nodeWidth,
                height: nodeHeight,
            })),
            anchor,
            20,
        );
        const positionedNewNodes = newNodes.map((node, index) => ({
            ...node,
            ...positions[index],
        }));
        const finalNodes = [...currentNodes, ...positionedNewNodes];

        setNodes(finalNodes);
        if (!options.preserveToolMode) {
            // Switch to SELECT mode so user can see what's happening
            setToolMode(ToolMode.SELECT);
        }

        // Auto-pan to new nodes
        const arrangedNewNodes = positionedNewNodes;

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

            // Offset = ScreenCenter - CanvasCenter * Scale
            const newOffsetX = screenCenterX - centerX * canvasState.scale;
            const newOffsetY = screenCenterY - centerY * canvasState.scale;

            setCanvasTransform({ x: newOffsetX, y: newOffsetY }, canvasState.scale);
        }

        return newNodes.map(n => n.id);
    }, [generateId, setNodes, setToolMode, canvasState, setCanvasTransform]);

    const handleInitBatchGenerations = useCallback((
        items: BatchPlaceholderRequest[],
        options: { focus?: boolean; preserveToolMode?: boolean } = {},
    ) => {
        if (!items.length) return {};

        const currentNodes = useCanvasStore.getState().nodes;
        const currentById = new Map(currentNodes.map((node) => [node.id, node]));
        const nodeIds: Record<string, string> = {};
        const updatesById = new Map<string, NodeData>();
        const newNodes: NodeData[] = [];

        for (const item of items) {
            const existing = item.nodeId ? currentById.get(item.nodeId) : undefined;
            if (existing) {
                nodeIds[item.taskId] = existing.id;
                updatesById.set(existing.id, {
                    ...existing,
                    batchId: item.batchId,
                    batchTaskId: item.taskId,
                    batchAutoDownloadOnSuccess: item.autoDownload,
                    prompt: item.prompt,
                    src: '',
                    thumbnailSrc: undefined,
                    assetId: undefined,
                    imageAspectRatio: undefined,
                    generationResultSrc: undefined,
                    generationResultIndex: undefined,
                    taskId: undefined,
                    clientRequestId: item.requestId,
                    generationOwnerId: undefined,
                    generationStartedAt: Date.now(),
                    generationConnectionStatus: undefined,
                    generationStorageStatus: undefined,
                    generationStatus: undefined,
                    progress: undefined,
                    progressSource: undefined,
                    loading: true,
                    error: false,
                    errorMessage: undefined,
                });
                continue;
            }

            const { width, height } = getCanvasFrameSize(item.aspectRatio);
            const id = generateId();
            nodeIds[item.taskId] = id;
            newNodes.push({
                id,
                type: 'IMAGE',
                x: 0,
                y: 0,
                width,
                height,
                opacity: 1,
                locked: false,
                loading: true,
                generationStartedAt: Date.now(),
                src: '',
                prompt: item.prompt,
                batchId: item.batchId,
                batchTaskId: item.taskId,
                batchAutoDownloadOnSuccess: item.autoDownload,
                clientRequestId: item.requestId,
                history: [],
                historyIndex: 0,
            });
        }

        const anchor = (() => {
            const firstSize = newNodes[0];
            const { x: screenCenterX, y: screenCenterY } = getCanvasCenter();
            const width = firstSize?.width || 512;
            const height = firstSize?.height || 512;
            return {
                x: (screenCenterX - canvasState.offset.x) / canvasState.scale - width / 2,
                y: (screenCenterY - canvasState.offset.y) / canvasState.scale - height / 2,
            };
        })();
        const positions = findCanvasFreePositions(
            currentNodes
                .filter((node) => Number.isFinite(node.width) && Number.isFinite(node.height))
                .map(({ x, y, width, height }) => ({ x, y, width, height })),
            newNodes.map(({ width, height }) => ({ width, height })),
            anchor,
            20,
        );
        const positionedNewNodes = newNodes.map((node, index) => ({
            ...node,
            ...positions[index],
        }));
        const finalNodes = [
            ...currentNodes.map((node) => updatesById.get(node.id) || node),
            ...positionedNewNodes,
        ];

        setNodes(finalNodes);
        if (!options.preserveToolMode) setToolMode(ToolMode.SELECT);

        if (options.focus !== false && positionedNewNodes.length > 0) {
            const minX = Math.min(...positionedNewNodes.map((node) => node.x));
            const maxX = Math.max(...positionedNewNodes.map((node) => node.x + node.width));
            const minY = Math.min(...positionedNewNodes.map((node) => node.y));
            const maxY = Math.max(...positionedNewNodes.map((node) => node.y + node.height));
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const { x: screenCenterX, y: screenCenterY } = getCanvasCenter();
            setCanvasTransform(
                {
                    x: screenCenterX - centerX * canvasState.scale,
                    y: screenCenterY - centerY * canvasState.scale,
                },
                canvasState.scale,
            );
        }

        return nodeIds;
    }, [canvasState, generateId, setCanvasTransform, setNodes, setToolMode]);

    // Update progress
    const handleUpdateProgress = useCallback((id: string, progress: number, source: 'reported' | 'estimated' = 'estimated', status?: string) => {
        const node = useCanvasStore.getState().nodes.find(item => item.id === id);
        if (!node?.loading || node.error || !Number.isFinite(progress)) return;
        const updates: Partial<NodeData> = {};
        if (status && status !== node.generationStatus) updates.generationStatus = status;
        if (source === 'reported' && progress > 0 && progress < 100 && (node.progressSource !== 'reported' || progress > (node.progress ?? 0))) {
            updates.progress = progress;
            updates.progressSource = source;
        }
        if (Object.keys(updates).length) updateNode(id, updates, true);
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
        updateNode(id, { loading: false, error: true, errorMessage: error || 'Invalid image source', progress: undefined, progressSource: undefined });
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
            progress: 100,
            progressSource: 'reported',
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

        if (!isVideo && (currentNode.batchAutoDownloadOnSuccess === undefined
            ? imageResultStore.getAutoDownloadPreference(useSelectionStore.getState().autoDownloadOnSuccess)
            : currentNode.batchAutoDownloadOnSuccess)) {
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
                if (sameResult() && meta?.width && meta?.height) {
                  updateNode(id, { imageAspectRatio: meta.width / meta.height }, true);
                }
              }
            } catch (e) { console.warn('Background asset cache failed', e); }
          })();
        }

    }, [autoDownloadGeneratedImage, updateNode]);

    return { handleInitGenerations, handleInitBatchGenerations, handleUpdateGeneration, handleUpdateProgress };
};

export interface BatchPlaceholderRequest {
    batchId: string;
    taskId: string;
    prompt: string;
    aspectRatio: string;
    nodeId?: string;
    requestId?: string;
    autoDownload?: boolean;
}
