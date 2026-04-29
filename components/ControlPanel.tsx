import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppStatus, NodeData, ToolMode } from '../types';
import { useSelectionStore, type ReferenceImage } from '../src/store/selectionStore';
import { useCanvasStore } from '../src/store/canvasStore';
import { editImageApi, generateImageApi, generateGeminiImage } from '../services/api';
import { generateVideo } from '../services/videoService';
import { checkBalance } from '../services/geminiService';
import { assetStorage } from '../src/services/assetStorage';
import { fetchPromptToolConfig, optimizePrompt, PromptOption } from '../services/promptService';
import { useHistoryStore } from '../src/store/historyStore';
import { Wand2, Loader2, ImagePlus, X, Upload, Plus, Move, Sparkles, Minus, Maximize2, ChevronLeft, ChevronRight, Check, Clapperboard, Film, HelpCircle, LayoutGrid, MonitorPlay, Zap, Pin, PinOff, Eraser, Trash2, ShieldCheck } from 'lucide-react';
import VideoPricingModal from './VideoPricingModal';
import CoinIcon from './CoinIcon';
import ModelSelector from './ModelSelector';
import ImageFormConfig from './ImageFormConfig';
import VideoFormConfig from './VideoFormConfig';
import ImageEditPanel from './ImageEditPanel';
import { GoogleLogo, OpenAILogo } from './Logos';
import { findClosestRatio, extractRatioFromPrompt, getBase64FromUrl, calculateGptImageSize } from '../src/utils/imageUtils';
import { parsePromptReferenceTags } from '../src/utils/promptTags';
import {
  getImageModelNameForRoute,
  getSelectedImageRoute,
  isGeminiNativeImageRoute,
} from '../src/config/imageRoutes';
import {
  getImageModelById,
  getImageModelEffectiveRequestSize,
} from '../src/config/imageModels';
import { useImageRouteCatalog } from '../src/hooks/useImageRouteCatalog';
import { useImageModelCatalog } from '../src/hooks/useImageModelCatalog';
import {
  AUTH_SESSION_CHANGE_EVENT,
  fetchCurrentAuthSession,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';
import {
  getVideoModelById,
  getVideoModelMaxReferenceImages,
  getVideoModelReferenceLabels,
} from '../src/config/videoModels';
import { getSelectedVideoRoute, getVideoModelNameForRoute } from '../src/config/videoRoutes';
import { useVideoModelCatalog } from '../src/hooks/useVideoModelCatalog';
import { useVideoRouteCatalog } from '../src/hooks/useVideoRouteCatalog';
import ImageModelIcon from './ImageModelIcon';
import {
  DEFAULT_GENERATION_ERROR_MESSAGE,
  extractErrorMessage,
  toGenerationErrorMessage,
} from '../src/utils/errorDebug';

// Branding Icons are now in Logos.tsx

import logo from '../src/assets/logo.svg';

const USER_FACING_GENERATION_ERROR_MESSAGE = DEFAULT_GENERATION_ERROR_MESSAGE;

interface ControlPanelProps {
  onInitGenerations: (
    count: number,
    prompt: string,
    aspectRatio?: string,
    baseNode?: NodeData,
    type?: 'IMAGE' | 'VIDEO',
    options?: { preserveToolMode?: boolean },
  ) => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string, taskId?: string) => void;
  onUpdateProgress?: (id: string, progress: number) => void;
  onOpenBatchModal: () => void;
}

interface DragState {
  isDragging: boolean;
  position: { x: number; y: number };
  offset: { x: number; y: number };
}

interface MentionAutocompleteState {
  start: number;
  end: number;
  query: string;
}

interface ReferenceAtMenuState {
  x: number;
  y: number;
  refIndex: number;
}

type GenerationAccessState =
  | 'checking'
  | 'authenticated'
  | 'valid_api_key'
  | 'missing_credentials'
  | 'invalid_api_key';

const ControlPanel: React.FC<ControlPanelProps> = React.memo(({ onInitGenerations, onUpdateGeneration, onUpdateProgress, onOpenBatchModal }) => {
  useImageRouteCatalog();
  useImageModelCatalog();
  useVideoRouteCatalog();
  useVideoModelCatalog();
  const { 
    toolMode, 
    setToolMode, 
    selectedIds, 
    status, 
    setStatus,
    referenceImages, 
    addReferenceImage, 
    addReferenceImages,
    removeReferenceImage, 
    clearReferenceImages,
    pendingPrompt, 
    setPendingPrompt, 
    isControlPanelOpen, 
    setControlPanelOpen, 
    panelMode, 
    setPanelMode,
    videoModel,
    setVideoModel,
    videoLine,
    setVideoLine,
    lightboxImage,
    closeLightbox,
    apiKey,
    setApiKey,
    setReferenceImages,
    // Persistent Inputs
    prompt, setPrompt,
    aspectRatio, setAspectRatio,
    customRatio, setCustomRatio,
    imageSize, setImageSize,
    quantity, setQuantity,
    videoAspectRatio, setVideoAspectRatio,
    videoDuration, setVideoDuration,
    videoHd, setVideoHd,
    imageModel, setImageModel,
    imageLine, setImageLine,
    gptImageQuality,
    gptImageOutputFormat,
    gptImageOutputCompression,
    gptImageModeration,
    grokReferenceMode,
    thinkingLevel, setThinkingLevel
  } = useSelectionStore();

  // Auto-clear error when switching modes or models
  useEffect(() => {
    if (error) setError(null);
  }, [panelMode, videoModel, imageModel]);

  // Optimize: only listen to nodes list, ignore canvasState (pan/zoom)
  const { nodes, updateNode } = useCanvasStore();
  const { addLog } = useHistoryStore();
  const selectedNodes = nodes.filter(n => selectedIds.includes(n.id) && (n.type === 'IMAGE' || n.type === 'VIDEO'));
  const selectedEditNode =
    selectedIds.length === 1
      ? nodes.find((node) => node.id === selectedIds[0] && node.type === 'IMAGE') || null
      : null;
  const selectedImageRoute = getSelectedImageRoute(imageModel, imageLine);
  const selectedImageModelConfig = getImageModelById(imageModel);
  const selectedVideoRoute = getSelectedVideoRoute(videoModel, videoLine);
  const selectedVideoModelConfig = getVideoModelById(videoModel);

  // State moved to store: const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null);
  const [authSessionTokenSnapshot, setAuthSessionTokenSnapshot] = useState<string | null>(() =>
    getStoredAuthSessionToken(),
  );
  const [generationAccessState, setGenerationAccessState] =
    useState<GenerationAccessState>('checking');
  const [generationAccessMessage, setGenerationAccessMessage] = useState(
    '正在验证访问权限...',
  );

  // const [aspectRatio, setAspectRatio] = useState('Smart'); // Moved to store
  // const [customRatio, setCustomRatio] = useState(''); // Moved to store
  // const [imageSize, setImageSize] = useState('1k'); // Moved to store
  // const [videoModel, setVideoModel] = useState<string>('veo3.1-fast'); // Moved to store
  // const [videoAspectRatio, setVideoAspectRatio] = useState<string>('16:9'); // Moved to store
  // const [videoDuration, setVideoDuration] = useState<string>('4'); // Moved to store
  // const [videoHd, setVideoHd] = useState(false); // Moved to store
  // const [quantity, setQuantity] = useState(1); // Moved to store
  
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [promptToolConfig, setPromptToolConfig] = useState({
    model: 'gemini-3.1-pro-preview',
    optimizeCost: 0.5,
    reverseCost: 1,
  });
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [showPricingModal, setShowPricingModal] = useState(false);

  useEffect(() => {
    const syncSessionToken = () => {
      setAuthSessionTokenSnapshot(getStoredAuthSessionToken());
    };

    syncSessionToken();

    if (typeof window === 'undefined') return;

    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, syncSessionToken);
    window.addEventListener('storage', syncSessionToken);

    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, syncSessionToken);
      window.removeEventListener('storage', syncSessionToken);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchPromptToolConfig()
      .then((config) => {
        if (!active) return;
        setPromptToolConfig({
          model: config.model,
          optimizeCost: config.optimizeCost,
          reverseCost: config.reverseCost,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const trimmedApiKey = String(apiKey || '').trim();

    const validateGenerationAccess = async () => {
      if (authSessionTokenSnapshot) {
        setGenerationAccessState('checking');
        setGenerationAccessMessage('正在验证登录状态...');

        try {
          const session = await fetchCurrentAuthSession();
          if (!active) return;

          if (session?.authenticated) {
            setGenerationAccessState('authenticated');
            setGenerationAccessMessage('已登录，可直接查看和使用全部模型。');
            return;
          }
        } catch (sessionError) {
          console.warn('Failed to validate auth session', sessionError);
          if (!active) return;
        }
      }

      if (!trimmedApiKey) {
        setGenerationAccessState('missing_credentials');
        setGenerationAccessMessage('请先登录，或在设置中输入并验证有效的 API Key。');
        return;
      }

      if (trimmedApiKey.length < 10) {
        setGenerationAccessState('invalid_api_key');
        setGenerationAccessMessage('当前 API Key 看起来不完整，请重新输入后再试。');
        return;
      }

      setGenerationAccessState('checking');
      setGenerationAccessMessage('正在验证你输入的 API Key...');

      try {
        const balance = await checkBalance(trimmedApiKey);
        if (!active) return;

        if (balance?.success) {
          setGenerationAccessState('valid_api_key');
          setGenerationAccessMessage(
            balance?.status_valid === false
              ? 'API Key 已验证，但额度可能不足。'
              : 'API Key 已验证，已为你解锁可用模型。',
          );
          return;
        }

        setGenerationAccessState('invalid_api_key');
        setGenerationAccessMessage('当前 API Key 无法通过验证，请检查后重试。');
      } catch (keyError: any) {
        if (!active) return;
        const rawKeyErrorMessage = String(keyError?.message || '');
        const normalizedKeyErrorMessage =
          /invalid api key|http 401|unauthorized/i.test(rawKeyErrorMessage)
            ? '当前 API Key 无法通过验证，请检查后重试。'
            : rawKeyErrorMessage || '当前 API Key 无法通过验证，请检查后重试。';
        setGenerationAccessState('invalid_api_key');
        setGenerationAccessMessage(normalizedKeyErrorMessage);
      }
    };

    const timerId = window.setTimeout(() => {
      void validateGenerationAccess();
    }, authSessionTokenSnapshot ? 0 : 350);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [apiKey, authSessionTokenSnapshot]);

  useEffect(() => {
    if (generationAccessState === 'checking') {
      setError(null);
      return;
    }

    if (
      generationAccessState === 'authenticated' ||
      generationAccessState === 'valid_api_key'
    ) {
      setError(null);
    }
  }, [generationAccessState]);

  // Auto-collapse states
  const [isHovered, setIsHovered] = useState(false);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Prompt option selector state
  const [promptOptions, setPromptOptions] = useState<PromptOption[]>([]);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [mentionAutocomplete, setMentionAutocomplete] = useState<MentionAutocompleteState | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [referenceAtMenu, setReferenceAtMenu] = useState<ReferenceAtMenuState | null>(null);

  const panelFileInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isGenerateMode = toolMode === ToolMode.GENERATE;
  // Use persistent panelMode instead of transient toolMode
  const isVideoMode = panelMode === 'VIDEO';

  const isImg2ImgMode = !isGenerateMode && !isVideoMode && selectedNodes.length > 0;
  const primaryNode = selectedNodes.length > 0 ? selectedNodes[0] : null;

  // Sync panel mode when selecting nodes - REMOVED to prevent unwanted switching
  // User wants "Sticky" behavior: If I am in Video Mode, clicking an image should NOT switch me to Image Mode.
  // The mode should only change when explicitly requested (e.g. via Toolbar) or maybe when strictly selecting a Video node if we weren't already.
  // For now, removing this entirely gives maximum stability.
  /*
  useEffect(() => {
    if (primaryNode) {
        if (primaryNode.type === 'VIDEO' && panelMode !== 'VIDEO') {
            setPanelMode('VIDEO');
        } else if (primaryNode.type === 'IMAGE' && panelMode !== 'IMAGE') {
            setPanelMode('IMAGE');
        }
    }
  }, [primaryNode, panelMode, setPanelMode]);
  */
  const isMultiSelect = selectedNodes.length > 1;
  const isGenerating = status === AppStatus.LOADING;
  const hasAuthenticatedSession = generationAccessState === 'authenticated';
  const hasUnlockedImageGenerationAccess =
    hasAuthenticatedSession || generationAccessState === 'valid_api_key';
  const hasUnlockedVideoGenerationAccess = hasAuthenticatedSession;
  const hasUnlockedGenerationAccess = isVideoMode
    ? hasUnlockedVideoGenerationAccess
    : hasUnlockedImageGenerationAccess;
  const isCheckingGenerationAccess = generationAccessState === 'checking';



  // Keep user-entered prompt stable; selecting existing nodes should not overwrite input.

  // Clear reference images when switching modes (e.g. from Image to Video)
  // FIXED: If persistence is desired, maybe we SHOULD NOT clear reference images on mode switch?
  // User asked for "input reference images... disappear on refresh".
  // But if I switch mode, clearing might still be desired as contexts differ.
  // However, persistence across refresh means we shouldn't clear on mount.
  // This useEffect runs when panelMode changes.
  useEffect(() => {
    // Only clear if the list is invalid for the new mode?
    // Or just let user decide. 
    // For now, let's DISABLE auto-clear on mode switch to make it more "persistent" feel if user accidentally switches.
    // Or keep it? User specifically asked about page refresh.
    // Let's keep it but maybe only if empty?
    // Actually, comment it out for now to test "maximum persistence"
    // setReferenceImages([]);
  }, [panelMode, setReferenceImages]);

  useEffect(() => {
    if (pendingPrompt) {
        // Delay setting prompt to ensure UI is ready and overrides other effects
        const t = setTimeout(() => {
            setPrompt(pendingPrompt);
            setPendingPrompt(null);
        }, 50);
        return () => clearTimeout(t);
    }
  }, [pendingPrompt, setPendingPrompt]);

  // 閹锋牗瀚块惄绋垮彠 Refs - UNIFIED POSITIONING
  const panelRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 20, y: 80 });

  const dragStartPos = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const updatePanelTransform = (x: number, y: number) => {
    if (panelRef.current) {
      panelRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  };

  // Initialize panel position on mount (top-left anchor)
  useEffect(() => {
    const initialX = 20; // left margin
    const initialY = 20; // top margin
    
    posRef.current = { x: initialX, y: initialY };
    updatePanelTransform(posRef.current.x, posRef.current.y);
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX - posRef.current.x,
      y: e.clientY - posRef.current.y
    };

    // Prevent accidental text selection while dragging
    document.body.style.userSelect = 'none';
  }, []);

  const handleDragMove = useCallback((e: MouseEvent) => {
    // Native event drag handling for smoother movement
    const panel = panelRef.current;
    if (!panel) return;

    let newX = e.clientX - dragStartPos.current.x;
    let newY = e.clientY - dragStartPos.current.y;

    // Clamp inside viewport bounds
    const maxX = window.innerWidth - panel.offsetWidth - 10;
    const maxY = window.innerHeight - panel.offsetHeight - 10;
    newX = Math.max(10, Math.min(newX, maxX));
    newY = Math.max(10, Math.min(newY, maxY));

    posRef.current = { x: newX, y: newY };
    updatePanelTransform(newX, newY);
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = '';
  }, []);

  // Touch handlers for mobile drag
  const handleTouchMove = useCallback((e: TouchEvent) => {
    const panel = panelRef.current;
    if (!panel) return;

    if (e.cancelable) e.preventDefault(); // Prevent scrolling while dragging panel

    const touch = e.touches[0];
    let newX = touch.clientX - dragStartPos.current.x;
    let newY = touch.clientY - dragStartPos.current.y;

    const maxX = window.innerWidth - panel.offsetWidth - 10;
    const maxY = window.innerHeight - panel.offsetHeight - 10;
    
    // On Mobile, we might want to constrain to Y axis only if it's a bottom sheet?
    // user said "Canvas or Video window cannot be dragged", implying they want to move it.
    // Let's allow free drag but keep bounds.
    
    newX = Math.max(10, Math.min(newX, maxX));
    newY = Math.max(10, Math.min(newY, maxY));

    posRef.current = { x: newX, y: newY };
    updatePanelTransform(newX, newY);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.overflow = ''; // Restore scrolling
  }, []);

  const handleTouchStartRaw = useCallback((e: React.TouchEvent) => {
    // e.preventDefault(); // Do not prevent default here immediately or clicks fail, but for a drag handle it's fine
    setIsDragging(true);
    const touch = e.touches[0];
    dragStartPos.current = {
      x: touch.clientX - posRef.current.x,
      y: touch.clientY - posRef.current.y
    };
    document.body.style.overflow = 'hidden'; // Lock scrolling
  }, []);


  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove, { passive: true });
      window.addEventListener('mouseup', handleDragEnd);
      
      // Add non-passive listener for touch move to prevent scroll
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd, handleTouchMove, handleTouchEnd]);

  // findClosestRatio and extractRatioFromPrompt moved to imageUtils.ts

  const createCollageFromSrcs = async (srcs: string[]): Promise<string> => {
    if (srcs.length === 0) return '';
    // Removed short-circuit: Always convert to base64 via canvas to ensure valid data payload
    // if (srcs.length === 1) return srcs[0];
    return new Promise((resolve, reject) => {
      const loadedImages: HTMLImageElement[] = [];
      let loadedCount = 0;
      let hasError = false;
      srcs.forEach(src => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (hasError) return;
          loadedCount++;
          if (loadedCount === srcs.length) renderCollage();
        };
        img.onerror = () => { hasError = true; reject(new Error("加载参考图失败")); };
        img.src = src;
        loadedImages.push(img);
      });
      const renderCollage = () => {
        const gap = 10;
        let maxHeight = 0;
        loadedImages.forEach(img => { maxHeight = Math.max(maxHeight, img.height); });
        const scale = maxHeight > 1024 ? 1024 / maxHeight : 1;
        let scaledTotalWidth = 0;
        loadedImages.forEach(img => { scaledTotalWidth += (img.width * scale) + gap; });
        const canvas = document.createElement('canvas');
        canvas.width = scaledTotalWidth - gap;
        canvas.height = maxHeight * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error("Canvas 创建失败")); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        let currentX = 0;
        loadedImages.forEach(img => {
          const w = img.width * scale;
          ctx.drawImage(img, currentX, 0, w, img.height * scale);
          currentX += w + gap;
        });
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
    });
  };

  const fileToDataUrl = async (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Failed to convert file to data URL'));
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });

  const handleRefDragStart = (e: React.DragEvent, index: number) => {
    setDraggingIndex(index);
    e.dataTransfer.setData('application/x-sort-index', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleRefDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceIndexStr = e.dataTransfer.getData('application/x-sort-index');
    if (sourceIndexStr) {
      const sourceIndex = parseInt(sourceIndexStr);
      if (!isNaN(sourceIndex) && sourceIndex !== targetIndex) {
        const newArr = [...referenceImages];
        const [moved] = newArr.splice(sourceIndex, 1);
        newArr.splice(targetIndex, 0, moved);
        setReferenceImages(newArr);
      }
    }
    setDraggingIndex(null);
  };

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('application/x-sort-index')) return;

    const max = isVideoMode
      ? getVideoModelMaxReferenceImages(selectedVideoModelConfig.id)
      : (imageModel === 'gpt-image-2' ? 16 : 10);
    
    // DEBUG ALERT
    // alert(`[Debug] Drop: Max=${max}, Current=${referenceImages.length}, IsVideo=${isVideoMode}, Model=${videoModel}`);

    // We still check remaining slots for immediate UI feedback, 
    // but the store action will be the final gatekeeper.
    const remainingSlots = max - referenceImages.length;
    if (remainingSlots <= 0) {
       setError(`最多只能上传 ${max} 张参考图`);
       return;
    }

    const newImages: Array<{src: string, blob?: Blob}> = [];

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      
      if (files.length > remainingSlots) {
         setError(`当前模型限制 ${max} 张参考图，您选择了 ${files.length} 张`);
        // We can either return or take the first N. Let's return to match previous behavior (fail fast).
        return; 
      }

      // Prefer data URLs for preview to avoid browser blocking blob: URLs in strict contexts.
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
          console.warn('File too large:', file.name);
          continue;
        }
        try {
          const dataUrl = await fileToDataUrl(file);
          newImages.push({ src: dataUrl, blob: file });
        } catch (error) {
          console.warn('Failed to read dropped file as data URL:', error);
        }
      }
    } else {
      // Handle HTML/URI drops
      const html = e.dataTransfer.getData('text/html');
      if (html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('img').forEach((img, idx) => {
          if (img.src && !img.src.startsWith('blob:')) newImages.push({ src: img.src });
        });
      } else {
        const uri = e.dataTransfer.getData('text/uri-list');
        if (uri) {
           uri.split('\n')
              .filter(u => u.trim() && !u.startsWith('#'))
              .forEach(u => newImages.push({ src: u }));
        }
      }
    }

    if (newImages.length > 0) {
       // Atomic add with limit enforcement
       useSelectionStore.getState().addReferenceImages(newImages, max);
    }
  };

  const handlePanelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const max = isVideoMode
        ? getVideoModelMaxReferenceImages(selectedVideoModelConfig.id)
        : (imageModel === 'gpt-image-2' ? 16 : 10);
      const remainingSlots = max - referenceImages.length;

      if (remainingSlots <= 0) {
         setError(`最多只能上传 ${max} 张参考图`);
         e.target.value = ''; // Reset
         return;
      }

      if (files.length > remainingSlots) {
         setError(`只能再上传 ${remainingSlots} 张图片（当前限制: ${max}）`);
         e.target.value = '';
         return;
      }

      const newImages: Array<{src: string, blob: Blob}> = [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) { 
          setError("文件过大（最大 10MB）");
          continue;
        }
        try {
          const dataUrl = await fileToDataUrl(file);
          newImages.push({ src: dataUrl, blob: file });
        } catch (error) {
          console.warn('Failed to read selected file as data URL:', error);
        }
      }

      if (newImages.length > 0) {
         useSelectionStore.getState().addReferenceImages(newImages, max);
      }
      
      e.target.value = '';
    }
  };

  const detectMentionContext = (text: string, caret: number): MentionAutocompleteState | null => {
    const safeCaret = Math.max(0, Math.min(caret, text.length));
    const before = text.slice(0, safeCaret);
    const mentionMatch = before.match(/@(?:图\s*)?(\d*)$/i);
    if (!mentionMatch) return null;

    const token = mentionMatch[0];
    const start = safeCaret - token.length;
    const prevChar = start > 0 ? text[start - 1] : '';
    if (prevChar && !/[\s,，。.!！？;；:：()（）[\]【】{}"“”'‘’]/.test(prevChar)) {
      return null;
    }

    return {
      start,
      end: safeCaret,
      query: mentionMatch[1] || ''
    };
  };

  const syncMentionAutocomplete = useCallback((nextText?: string, nextCaret?: number) => {
    const sourceText = nextText ?? prompt;
    if (referenceImages.length === 0) {
      setMentionAutocomplete(null);
      return;
    }
    const textarea = promptTextareaRef.current;
    const caret = typeof nextCaret === 'number'
      ? nextCaret
      : (textarea?.selectionStart ?? sourceText.length);
    const mention = detectMentionContext(sourceText, caret);
    setMentionAutocomplete(mention);
  }, [prompt, referenceImages.length]);

  const mentionSuggestionNumbers = useMemo(() => {
    if (!mentionAutocomplete || referenceImages.length === 0) return [];
    const base = Array.from({ length: referenceImages.length }, (_v, i) => i + 1);
    if (!mentionAutocomplete.query) return base;
    return base.filter((n) => String(n).startsWith(mentionAutocomplete.query));
  }, [mentionAutocomplete, referenceImages.length]);

  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionAutocomplete?.query, mentionSuggestionNumbers.length]);

  useEffect(() => {
    if (referenceImages.length > 0) return;
    setMentionAutocomplete(null);
    setReferenceAtMenu(null);
  }, [referenceImages.length]);

  const insertReferenceTagIntoPrompt = useCallback((oneBasedIndex: number, replaceMentionToken: boolean) => {
    const tag = `@图${oneBasedIndex}`;
    const textarea = promptTextareaRef.current;
    const currentPrompt = prompt;

    let replaceStart = textarea?.selectionStart ?? currentPrompt.length;
    let replaceEnd = textarea?.selectionEnd ?? currentPrompt.length;

    if (replaceMentionToken && mentionAutocomplete) {
      replaceStart = mentionAutocomplete.start;
      replaceEnd = mentionAutocomplete.end;
    }

    const before = currentPrompt.slice(0, replaceStart);
    const after = currentPrompt.slice(replaceEnd);
    const leftSpacer = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const rightSpacer = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    const nextPrompt = `${before}${leftSpacer}${tag}${rightSpacer}${after}`;
    const nextCaret = (before + leftSpacer + tag + rightSpacer).length;

    setPrompt(nextPrompt);
    setMentionAutocomplete(null);
    setReferenceAtMenu(null);

    requestAnimationFrame(() => {
      const target = promptTextareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(nextCaret, nextCaret);
    });
  }, [mentionAutocomplete, prompt, setPrompt]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    setPrompt(nextValue);
    syncMentionAutocomplete(nextValue, e.target.selectionStart ?? nextValue.length);
  };

  const handlePromptCursorSync = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    syncMentionAutocomplete(target.value, target.selectionStart ?? target.value.length);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionAutocomplete) return;
    if (mentionSuggestionNumbers.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionAutocomplete(null);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionActiveIndex((prev) => (prev + 1) % mentionSuggestionNumbers.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionActiveIndex((prev) => (prev - 1 + mentionSuggestionNumbers.length) % mentionSuggestionNumbers.length);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const targetNumber = mentionSuggestionNumbers[Math.min(mentionActiveIndex, mentionSuggestionNumbers.length - 1)];
      if (targetNumber) {
        insertReferenceTagIntoPrompt(targetNumber, true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMentionAutocomplete(null);
    }
  };

  const handleReferenceThumbnailContextMenu = (e: React.MouseEvent, refIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setMentionAutocomplete(null);
    setReferenceAtMenu({
      x: e.clientX,
      y: e.clientY,
      refIndex,
    });
  };

  useEffect(() => {
    if (!referenceAtMenu) return;

    const closeMenu = () => setReferenceAtMenu(null);
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [referenceAtMenu]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Submit triggered", { prompt, apiKey });
    if (!prompt.trim()) {
      setError("请输入提示词");
      return;
    }
    const parsedPromptResult = parsePromptReferenceTags(prompt, referenceImages.length);
    if (parsedPromptResult.error) {
      setError(parsedPromptResult.error);
      return;
    }
    const parsedPrompt = parsedPromptResult.prompt;
    const effectiveReferenceImages: ReferenceImage[] =
      parsedPromptResult.referencedIndexes.length > 0
        ? parsedPromptResult.referencedIndexes
            .map((idx) => referenceImages[idx])
            .filter((img): img is ReferenceImage => Boolean(img))
        : referenceImages;

    setError(null);
    let effectiveRatio = aspectRatio;

    if (aspectRatio === 'Smart') {
      if (isImg2ImgMode && selectedNodes.length > 0) {
        effectiveRatio = findClosestRatio(selectedNodes[0].width / selectedNodes[0].height);
      } else if (effectiveReferenceImages.length > 0) {
        effectiveRatio = '1:1';
      } else {
        effectiveRatio = extractRatioFromPrompt(parsedPrompt) || '16:9';
      }
    } else if (aspectRatio === 'Custom') {
      if (!/^\d+:\d+$/.test(customRatio)) {
        setError("自定义比例格式错误，请使用“宽:高”格式");
        return;
      }
      effectiveRatio = customRatio;
    }

    // Auto-append ratio argument to prompt for model compatibility (double safety)
    const LINE2_SUPPORTED_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
    const normalizeLine2Ratio = (ratio: string): string => {
      if (!/^\d+:\d+$/.test(ratio)) return ratio;
      if (LINE2_SUPPORTED_RATIOS.includes(ratio)) return ratio;
      const [w, h] = ratio.split(':').map(Number);
      if (!w || !h) return ratio;
      const target = w / h;
      let best = LINE2_SUPPORTED_RATIOS[0];
      let minDiff = Infinity;
      for (const key of LINE2_SUPPORTED_RATIOS) {
        const [kw, kh] = key.split(':').map(Number);
        const diff = Math.abs(kw / kh - target);
        if (diff < minDiff) {
          minDiff = diff;
          best = key;
        }
      }
      return best;
    };

    const modelName = getImageModelNameForRoute({
      imageModel,
      imageLine,
      imageSize,
    });
    const shouldUseGeminiNative = isGeminiNativeImageRoute(selectedImageRoute);
    const shouldUseGeminiNativeSync =
      shouldUseGeminiNative &&
      String(selectedImageRoute.mode || '').trim().toLowerCase() === 'sync';
    if (shouldUseGeminiNativeSync) {
      effectiveRatio = normalizeLine2Ratio(effectiveRatio);
    }
    const geminiNativePayloadFields = shouldUseGeminiNative
      ? {
          image_size: /^\d+K$/i.test(String(imageSize || '1K').trim())
            ? String(imageSize || '1K').trim().toUpperCase()
            : '1K',
        }
      : {};

    const isGptImage2RequestModel = (model: string) =>
      model === 'gpt-image-2' || model === 'gpt-image-2-all';
    const isGptImage2Model = imageModel === 'gpt-image-2' || isGptImage2RequestModel(modelName);
    const promptWithoutAr = parsedPrompt.replace(/\s*--ar\s*\d+\s*[:：]\s*\d+/gi, '').trim();
    const promptWithRatio = `${promptWithoutAr} --ar ${effectiveRatio}`;
    const currentPrompt = isGptImage2Model ? promptWithoutAr : promptWithRatio;
    // Decision Logic:
    // User explicitly requested NO "Regenerate" / "Edit Mode".
    // Panel always functions as "Create New". References must be added manually.
    const effectiveImg2ImgMode = false; // Forced to false per user request

    const isSyncMode =
      modelName === 'grok-4.2-image' &&
      selectedImageRoute.mode === 'sync' &&
      selectedImageRoute.transport === 'openai-image';

    const getEffectiveSize = () => {
      if (isGptImage2Model) {
        return calculateGptImageSize(imageSize, effectiveRatio);
      }
      return getImageModelEffectiveRequestSize({
        modelId: selectedImageModelConfig.id,
        imageSize,
        aspectRatio: effectiveRatio,
      });
    };

    const getGptImagePayload = (basePrompt: string, n = 1) => {
      const payload: any = {
        model: modelName,
        modelId: selectedImageModelConfig.id,
        prompt: basePrompt,
        size: calculateGptImageSize(imageSize, effectiveRatio),
        image_size: imageSize,
        quality: gptImageQuality,
        output_format: gptImageOutputFormat,
        moderation: gptImageModeration,
        n,
        routeId: selectedImageRoute.id,
      };

      if (gptImageOutputFormat !== 'png' && gptImageOutputCompression !== null) {
        payload.output_compression = Math.max(0, Math.min(100, gptImageOutputCompression));
      }

      return payload;
    };

    const referenceToDataUrl = async (ref: ReferenceImage): Promise<string | null> => {
      try {
        if (ref.blob) {
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (typeof reader.result === 'string') resolve(reader.result);
              else reject(new Error('Failed to read blob as data URL'));
            };
            reader.onerror = () => reject(reader.error || new Error('FileReader error'));
            reader.readAsDataURL(ref.blob as Blob);
          });
        }
        return await getBase64FromUrl(ref.src);
      } catch (error) {
        console.error('Failed to convert reference image:', error);
        return null;
      }
    };

    const isGrokImageModel = (model: string) => model.startsWith('grok-');
    const getGrokPrompt = (basePrompt: string, model: string) => {
      if (!isGrokImageModel(model)) return basePrompt;
      return `${basePrompt}，${effectiveRatio}，超高品质${imageSize.toUpperCase()}分辨率`;
    };

  const buildGrokReferencePayload = (imageDataUrls: string[]) => {
      const rawImages = imageDataUrls.map((item) => item.includes(',') ? item.split(',')[1] : item);
      const rawPrimary = rawImages[0];
      const isMulti = rawImages.length > 1;
      return {
        reference_mode: grokReferenceMode,
        image: grokReferenceMode === 'classic_multi' && isMulti ? rawImages : rawPrimary,
        images: rawImages,
        reference_image: rawPrimary,
        reference_images: rawImages,
      };
    };



    if (effectiveImg2ImgMode && selectedNodes.length > 0) {
      for (const node of selectedNodes) {
        if (!node.src) continue;
        const placeholderIds = onInitGenerations(quantity, currentPrompt, effectiveRatio, node);
        placeholderIds.forEach(pid => {
            const payload: any = {
              model: modelName,
              modelId: selectedImageModelConfig.id,
              prompt: currentPrompt,
              size: getEffectiveSize(),
              aspect_ratio: effectiveRatio,
              n: 1,
              image: node.src!.includes(',') ? node.src!.split(',')[1] : node.src,
              routeId: selectedImageRoute.id,
            };
           
           generateImageApi(apiKey, payload)
            .then((res: any) => {
               if (res.taskId) {
                 onUpdateGeneration(pid, null, undefined, res.taskId);
               } else if (res.data && res.data[0] && res.data[0].url) {
                 onUpdateGeneration(pid, res.data[0].url);
               } else if (res.url) {
                 onUpdateGeneration(pid, res.url);
               } else {
                 onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE);
               }
            })
            .catch((err: any) => { 
              onUpdateGeneration(
                pid,
                null,
                toGenerationErrorMessage(extractErrorMessage(err), USER_FACING_GENERATION_ERROR_MESSAGE),
              );
            });
        });
      }
    } else {

      // Gemini native sync-only path.
      if (shouldUseGeminiNativeSync) {
        const placeholderIds = onInitGenerations(quantity, currentPrompt, effectiveRatio);
        const mapSize = (s: string) => {
          const normalized = String(s || '1k').trim().toUpperCase();
          return /^\d+K$/.test(normalized) ? normalized : '1K';
        };

        const executeGeminiCall = async () => {
          try {
            const parts: any[] = [{ text: currentPrompt }];
            
            if (effectiveReferenceImages.length > 0) {
              const srcs = effectiveReferenceImages.map(r => r.src);
              for (const src of srcs) {
                // Get clean base64 data (without prefix)
                let base64Data = '';
                let mimeType = 'image/jpeg';
                
                if (src.startsWith('data:')) {
                  const match = src.match(/^data:([^;]+);base64,(.+)$/);
                  if (match) {
                    mimeType = match[1];
                    base64Data = match[2];
                  }
                } else {
                  // If it's a URL or blob URL, we need to fetch it first
                  try {
                    const res = await fetch(src);
                    const blob = await res.blob();
                    mimeType = blob.type;
                    const reader = new FileReader();
                    base64Data = await new Promise((resolve) => {
                      reader.onloadend = () => {
                        const result = reader.result as string;
                        resolve(result.split(',')[1]);
                      };
                      reader.readAsDataURL(blob);
                    });
                  } catch (e) {
                      console.error("Failed to fetch reference image for Gemini native call", e);
                  }
                }

                if (base64Data) {
                  parts.push({
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Data
                    }
                  });
                }
              }
            }

            const payload: any = {
              model: modelName,
              modelId: selectedImageModelConfig.id,
              prompt: currentPrompt, // Added as fallback for proxy validation
              aspect_ratio: effectiveRatio,
              image_size: mapSize(imageSize),
              routeId: selectedImageRoute.id,
              strict_native_config: true,
              n: quantity,
              contents: [
                {
                  role: "user",
                  parts: parts
                }
              ],
              generationConfig: {
                imageConfig: {
                  aspectRatio: effectiveRatio,
                  imageSize: mapSize(imageSize)
                },
                candidateCount: quantity
              }
            };

            const res: any = await generateGeminiImage(apiKey, payload);
            console.log("[Gemini Native] Response received:", res);
            
            const generatedImages: string[] = [];
            
            // 1. Handle native Gemini format (candidates array)
            if (res.candidates && Array.isArray(res.candidates)) {
              res.candidates.forEach((cand: any) => {
                const parts = cand.content?.parts;
                if (parts && Array.isArray(parts)) {
                  parts.forEach((part: any) => {
                    // Handle both camelCase and snake_case
                    const inlineData = part.inlineData || part.inline_data;
                    if (inlineData && inlineData.data) {
                      const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
                      generatedImages.push(`data:${mimeType};base64,${inlineData.data}`);
                    }
                  });
                }
              });
            } 
            // 2. Handle proxy format ({success: true, images: [...]})
            else if (res.images && Array.isArray(res.images)) {
              generatedImages.push(...res.images);
            }
            // 3. Handle OpenAI-like format ({data: [{url: ...}]})
            else if (res.data && Array.isArray(res.data)) {
               res.data.forEach((item: any) => {
                  if (item.url) generatedImages.push(item.url);
                  else if (item.b64_json) generatedImages.push(`data:image/png;base64,${item.b64_json}`);
               });
            }

            if (generatedImages.length > 0) {
              generatedImages.forEach((imgData, idx) => {
                if (placeholderIds[idx]) {
                  onUpdateGeneration(placeholderIds[idx], imgData);
                }
              });
              // Fail remaining placeholders if any
              if (generatedImages.length < quantity) {
                for (let i = generatedImages.length; i < quantity; i++) {
                   onUpdateGeneration(placeholderIds[i], null, USER_FACING_GENERATION_ERROR_MESSAGE);
                }
              }
            } else {
              throw new Error(USER_FACING_GENERATION_ERROR_MESSAGE);
            }
          } catch (err: any) {
            console.error("Gemini Native Call Error:", err);
            const nextError = toGenerationErrorMessage(
              extractErrorMessage(err),
              USER_FACING_GENERATION_ERROR_MESSAGE,
            );
            placeholderIds.forEach(pid => onUpdateGeneration(pid, null, nextError));
          }
        };

        executeGeminiCall();
      } else if (effectiveReferenceImages.length > 0) {
        // Extract srcs from ReferenceImage objects
	        const refSrcs = effectiveReferenceImages.map(r => r.src);
	        const isDoubao = modelName.startsWith('doubao');
          const isGrok = isGrokImageModel(modelName);
          const isGptImage2 = isGptImage2Model;
	                const processSubmission = async (imagePayload: any, customPrompt?: string) => {
          const perRequestImageCount = 1;
          for (let reqIdx = 0; reqIdx < quantity; reqIdx++) {
            const placeholderIds = onInitGenerations(perRequestImageCount, currentPrompt, effectiveRatio);
            const promptForModel = getGrokPrompt(customPrompt || currentPrompt, modelName);
            const payload: any = {
              model: modelName,
              modelId: selectedImageModelConfig.id,
              prompt: promptForModel,
              size: getEffectiveSize(),
              ...geminiNativePayloadFields,
              aspect_ratio: effectiveRatio,
              n: 1,
              routeId: selectedImageRoute.id,
              ...(isSyncMode ? { isSync: true } : {}),
              ...imagePayload
            };
            generateImageApi(apiKey, payload)
              .then((res: any) => {
                if (res.taskId) {
                  placeholderIds.forEach(pid => onUpdateGeneration(pid, null, undefined, res.taskId));
                } else if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                  if (isGrok && placeholderIds.length === 1 && res.data.length > 1) {
                    const item = res.data[res.data.length - 1];
                    if (item?.url) onUpdateGeneration(placeholderIds[0], item.url);
                    else if (item?.b64_json) onUpdateGeneration(placeholderIds[0], `data:image/png;base64,${item.b64_json}`);
                    else onUpdateGeneration(placeholderIds[0], null, USER_FACING_GENERATION_ERROR_MESSAGE);
                  } else {
                    placeholderIds.forEach((pid, idx) => {
                      const item = res.data[idx];
                      if (item?.url) onUpdateGeneration(pid, item.url);
                      else if (item?.b64_json) onUpdateGeneration(pid, `data:image/png;base64,${item.b64_json}`);
                      else onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE);
                    });
                  }
                } else if (res.url) {
                  onUpdateGeneration(placeholderIds[0], res.url);
                  for (let i = 1; i < placeholderIds.length; i++) {
                    onUpdateGeneration(placeholderIds[i], null, USER_FACING_GENERATION_ERROR_MESSAGE);
                  }
                } else {
                  placeholderIds.forEach(pid => onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE));
                }
              })
              .catch((err: any) => {
                const nextError = toGenerationErrorMessage(
                  extractErrorMessage(err),
                  USER_FACING_GENERATION_ERROR_MESSAGE,
                );
                placeholderIds.forEach(pid => onUpdateGeneration(pid, null, nextError));
              });
          }
        };

        const processEditSubmission = async (imageDataUrls: string[], customPrompt?: string) => {
          const perRequestImageCount = 1;
          for (let reqIdx = 0; reqIdx < quantity; reqIdx++) {
            const placeholderIds = onInitGenerations(perRequestImageCount, currentPrompt, effectiveRatio);
            const promptForModel = customPrompt || currentPrompt;
            const payload: any = {
              ...getGptImagePayload(promptForModel, 1),
              images: imageDataUrls,
            };
            editImageApi(apiKey, payload)
              .then((res: any) => {
                if (res.taskId) {
                  placeholderIds.forEach((pid) => onUpdateGeneration(pid, null, undefined, res.taskId));
                } else if (res.url) {
                  placeholderIds.forEach((pid) => onUpdateGeneration(pid, res.url));
                } else if (Array.isArray(res.images) && res.images.length > 0) {
                  placeholderIds.forEach((pid, idx) => {
                    onUpdateGeneration(pid, res.images[idx] || res.images[0] || null, res.images[idx] || res.images[0] ? undefined : USER_FACING_GENERATION_ERROR_MESSAGE);
                  });
                } else {
                  placeholderIds.forEach((pid) =>
                    onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE),
                  );
                }
              })
              .catch((err: any) => {
                const nextError = toGenerationErrorMessage(
                  extractErrorMessage(err),
                  USER_FACING_GENERATION_ERROR_MESSAGE,
                );
                placeholderIds.forEach((pid) => onUpdateGeneration(pid, null, nextError));
              });
          }
        };

	        if (isDoubao) {
	          // Doubao models support multi-image array natively
	          const imageArray = refSrcs.map(src => src.includes(',') ? src.split(',')[1] : src);
	          processSubmission({ image: imageArray });
          } else if (isGptImage2) {
            const imageDataUrls = (await Promise.all(
              effectiveReferenceImages.map((ref) => referenceToDataUrl(ref)),
            )).filter((value): value is string => !!value);
            if (imageDataUrls.length === 0) {
              setError("参考图处理失败，请重新上传后再试");
              return;
            }
            processEditSubmission(imageDataUrls, currentPrompt);
          } else if (isGrok) {
            // Grok 图生图必须传可读图片数据，避免 blob/url 导致参考图失效。
            const base64Results = await Promise.all(
              effectiveReferenceImages.map(async (ref) => {
                try {
                  let dataUrl = '';
                  if (ref.blob) {
                    dataUrl = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        if (typeof reader.result === 'string') resolve(reader.result);
                        else reject(new Error('Failed to read blob as data URL'));
                      };
                      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
                      reader.readAsDataURL(ref.blob as Blob);
                    });
                  } else {
                    dataUrl = await getBase64FromUrl(ref.src);
                  }
                  // Keep data-url form; payload builder will derive raw base64 too.
                  return dataUrl;
                } catch (error) {
                  console.error('Failed to convert Grok reference image:', error);
                  return null;
                }
              })
            );
            const imageArray = base64Results.filter((v): v is string => !!v);
            if (imageArray.length === 0) {
              setError("参考图处理失败，请重新上传后再试");
              return;
            }
            console.log('[Grok I2I] Payload refs:', {
              mode: grokReferenceMode,
              count: imageArray.length,
              firstHasDataPrefix: imageArray[0]?.startsWith('data:'),
              firstRawLength: imageArray[0]?.includes(',') ? imageArray[0].split(',')[1].length : imageArray[0]?.length,
            });
            processSubmission(buildGrokReferencePayload(imageArray));
	        } else {
          // Legacy/Gemini models still use collage
          createCollageFromSrcs(refSrcs).then(collageBase64 => {
            const compositePrompt = effectiveReferenceImages.length > 1
              ? `[多图参考] 输入是 ${effectiveReferenceImages.length} 张图片的拼贴。${currentPrompt}`
              : currentPrompt;
            processSubmission({ 
              image: collageBase64.split(',')[1],
              images: [collageBase64.split(',')[1]]
            }, compositePrompt);
          }).catch((err: any) => {
            setError(
              toGenerationErrorMessage(
                extractErrorMessage(err),
                USER_FACING_GENERATION_ERROR_MESSAGE,
              ),
            );
          });
      }
	            } else {
        const promptForModel = getGrokPrompt(currentPrompt, modelName);
        const isGrokModel = isGrokImageModel(modelName);
        const perRequestImageCount = 1;
        for (let reqIdx = 0; reqIdx < quantity; reqIdx++) {
          const placeholderIds = onInitGenerations(perRequestImageCount, currentPrompt, effectiveRatio);
            const payload: any = isGptImage2Model
              ? getGptImagePayload(currentPrompt, 1)
              : {
                  model: modelName,
                  modelId: selectedImageModelConfig.id,
                  prompt: promptForModel,
                  size: getEffectiveSize(),
                  ...geminiNativePayloadFields,
                  aspect_ratio: effectiveRatio,
                  n: 1,
                  routeId: selectedImageRoute.id,
                  ...(isSyncMode ? { isSync: true } : {})
                };
          generateImageApi(apiKey, payload)
            .then((res: any) => {
              if (res.taskId) {
                placeholderIds.forEach(pid => onUpdateGeneration(pid, null, undefined, res.taskId));
              } else if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                if (isGrokModel && placeholderIds.length === 1 && res.data.length > 1) {
                  const item = res.data[res.data.length - 1];
                  if (item?.url) onUpdateGeneration(placeholderIds[0], item.url);
                  else if (item?.b64_json) onUpdateGeneration(placeholderIds[0], `data:image/png;base64,${item.b64_json}`);
                  else onUpdateGeneration(placeholderIds[0], null, USER_FACING_GENERATION_ERROR_MESSAGE);
                } else {
                  placeholderIds.forEach((pid, idx) => {
                    const item = res.data[idx];
                    if (item?.url) onUpdateGeneration(pid, item.url);
                    else if (item?.b64_json) onUpdateGeneration(pid, `data:image/png;base64,${item.b64_json}`);
                    else onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE);
                  });
                }
              } else if (res.url) {
                onUpdateGeneration(placeholderIds[0], res.url);
                for (let i = 1; i < placeholderIds.length; i++) {
                  onUpdateGeneration(placeholderIds[i], null, USER_FACING_GENERATION_ERROR_MESSAGE);
                }
              } else {
                placeholderIds.forEach(pid => onUpdateGeneration(pid, null, USER_FACING_GENERATION_ERROR_MESSAGE));
              }
            })
            .catch((err: any) => {
              const nextError = toGenerationErrorMessage(
                extractErrorMessage(err),
                USER_FACING_GENERATION_ERROR_MESSAGE,
              );
              placeholderIds.forEach(pid => onUpdateGeneration(pid, null, nextError));
            });
        }
      }
    }
  };

  const handleVideoSubmit = async () => {
    console.log("Video Submit triggered", { prompt, apiKey, videoModel });
    if (!prompt.trim()) {
      setError("请输入提示词");
      return;
    }

    const parsedPromptResult = parsePromptReferenceTags(prompt, referenceImages.length);
    if (parsedPromptResult.error) {
      setError(parsedPromptResult.error);
      return;
    }
    const parsedPrompt = parsedPromptResult.prompt;
    const effectiveVideoReferenceImages: ReferenceImage[] =
      parsedPromptResult.referencedIndexes.length > 0
        ? parsedPromptResult.referencedIndexes
            .map((idx) => referenceImages[idx])
            .filter((img): img is ReferenceImage => Boolean(img))
        : referenceImages;

    // Auto-append ratio argument to prompt for model compatibility (double safety)
    const promptWithRatio = `${parsedPrompt} --ar ${videoAspectRatio}`;
    const currentPrompt = promptWithRatio;

    // Init generation node (VIDEO type)
    const placeholderIds = onInitGenerations(1, currentPrompt, '16:9', undefined, 'VIDEO');
    const pid = placeholderIds[0];

    try {
      // Convert reference images to base64 on client side (browser environment)
      // This is necessary because assetStorage (IndexedDB) is not available in Node.js backend
      const base64Images: string[] = [];
      
      if (effectiveVideoReferenceImages.length > 0) {
        for (const imgRef of effectiveVideoReferenceImages) {
          try {
            let blob: Blob | undefined;

            // Priority 1: Use directly stored blob object (fastest, no CSP issue)
            if (imgRef.blob) {
              blob = imgRef.blob;
            }
            // Priority 2: Get from assetStorage
            else if (imgRef.assetId) {
              const storedBlob = await assetStorage.getBlob(imgRef.assetId);
              if (!storedBlob) {
                throw new Error('Asset not found in storage');
              }
              blob = storedBlob;
            }
            // Priority 3: Data URL (convert to blob)
            else if (imgRef.src.startsWith('data:image')) {
              const res = await fetch(imgRef.src);
              blob = await res.blob();
            }
            // Priority 4: HTTP/HTTPS URL (external images)
            else if (imgRef.src.startsWith('http')) {
              const response = await fetch(imgRef.src);
              if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status}`);
              }
              blob = await response.blob();
            }
            // Priority 5: Blob URL (local preview images)
            else if (imgRef.src.startsWith('blob:')) {
              const response = await fetch(imgRef.src);
              if (!response.ok) {
                throw new Error(`Failed to fetch blob: ${response.status}`);
              }
              blob = await response.blob();
            }
            else {
              throw new Error(`Unsupported image source: ${imgRef.src.substring(0, 50)}`);
            }

            if (blob) {
              // Ensure blob is a valid Blob instance (fixes "Overload resolution failed" in strict environments/builds)
              // Sometimes objects passed around lose their prototype chain or are duck-typed
              const safeBlob = blob instanceof Blob ? blob : new Blob([blob as any], { type: (blob as any).type || 'image/png' });

              // Compress/Resize Image
              const base64 = await new Promise<string>((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(safeBlob);
                
                img.onload = () => {
                  URL.revokeObjectURL(url);
                  let width = img.width;
                  let height = img.height;
                  const MAX_DIM = 1280; // Limit resolution to reduce payload size

                  if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                      height = Math.round((height * MAX_DIM) / width);
                      width = MAX_DIM;
                    } else {
                      width = Math.round((width * MAX_DIM) / height);
                      height = MAX_DIM;
                    }
                  }

                  const canvas = document.createElement('canvas');
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    reject(new Error("Canvas context failed"));
                    return;
                  }

                  // Fill white background for transparency handling (optional but good for JPEG)
                  ctx.fillStyle = '#FFFFFF';
                  ctx.fillRect(0, 0, width, height);
                  ctx.drawImage(img, 0, 0, width, height);

                  // Export as JPEG quality 0.85
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                  resolve(dataUrl.split(',')[1]);
                };
                
                img.onerror = (e) => {
                   URL.revokeObjectURL(url);
                   reject(new Error("Image load failed")); 
                };
                
                img.src = url;
              });

              base64Images.push(base64);
            }

          } catch (error) {
            console.error('Failed to process reference image:', error);
            throw new Error(`参考图处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
          }
        }
      }

      const videoUrl = await generateVideo(apiKey, getVideoModelNameForRoute({
        videoModel: selectedVideoModelConfig.id,
        videoLine,
      }), currentPrompt, base64Images.length > 0 ? base64Images : undefined, (progress) => {
        if (onUpdateProgress) onUpdateProgress(pid, progress);
      }, {
        modelId: selectedVideoModelConfig.id,
        routeId: selectedVideoRoute.id,
        aspect_ratio: videoAspectRatio,
        hd: videoHd,
        duration: videoDuration
      });
      onUpdateGeneration(pid, videoUrl);
    } catch (err: any) {
      onUpdateGeneration(
        pid,
        null,
        toGenerationErrorMessage(extractErrorMessage(err), USER_FACING_GENERATION_ERROR_MESSAGE),
      );
    }
  };

  // Wrap original submit to handle video mode
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasUnlockedGenerationAccess) {
      setError(
        isCheckingGenerationAccess
          ? '正在验证访问权限，请稍后再试'
          : isVideoMode
            ? '视频生成功能需要先登录账户'
            : '请先登录，或输入并验证有效的 API Key 后再开始创作',
      );
      return;
    }
    if (isVideoMode) {
      handleVideoSubmit();
    } else {
      handleSubmit(e);
    }
  };

  const handleInputFocus = () => { /* onRegisterHistory(); */ };
  // Prompt optimization also supports video mode.
  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) {
      setError("请先输入提示词");
      return;
    }

    setIsOptimizing(true);
    setError(null);
    setShowOptionsPanel(false); // Reset panel

    try {
      const type = isVideoMode ? 'VIDEO' : 'IMAGE';
      const options = await optimizePrompt(prompt, type);
      setPromptOptions(options);
      setSelectedOptionIndex(0);
      setShowOptionsPanel(true);
      // Auto-apply the first option? No, let user choose.
      // But maybe we can preview it?
    } catch (e: any) {
      setError(e.message || "优化失败，请重试");
    } finally {
      setIsOptimizing(false);
    }
  };

  // Navigate to the previous optimized prompt option.
  const handlePrevOption = () => {
    setSelectedOptionIndex(prev => (prev > 0 ? prev - 1 : promptOptions.length - 1));
  };

  const handleNextOption = () => {
    setSelectedOptionIndex(prev => (prev < promptOptions.length - 1 ? prev + 1 : 0));
  };

  // Apply the currently selected optimized prompt option.
  const handleConfirmOption = () => {
    if (promptOptions.length > 0 && promptOptions[selectedOptionIndex]) {
      setPrompt(promptOptions[selectedOptionIndex].prompt);
      setShowOptionsPanel(false);
      setPromptOptions([]);
    }
  };

  // Close options panel
  const handleCloseOptions = () => {
    setShowOptionsPanel(false);
    setPromptOptions([]);
  };

  const getImageModelTitle = () => selectedImageModelConfig.label || 'Image Model';

  const getImageTitleIcon = () => (
    <ImageModelIcon
      iconKind={selectedImageModelConfig.iconKind}
      line={selectedImageRoute.line}
      variant="title"
    />
  );

  const imagePanelTitle = hasUnlockedImageGenerationAccess ? getImageModelTitle() : 'AI IMAGE';
  const titleIcon = hasUnlockedImageGenerationAccess ? (
    getImageTitleIcon()
  ) : (
    <Wand2 size={20} className="text-yellow-400" />
  );
  const titleText = (
    <span className="bg-linear-to-r from-yellow-200 via-yellow-400 to-orange-500 bg-clip-text text-transparent font-black tracking-tighter drop-shadow-sm italic text-lg pr-2">
      {imagePanelTitle}
    </span>
  );

  const videoPanelTitle = hasUnlockedVideoGenerationAccess
    ? selectedVideoModelConfig.label || 'AIGC Video'
    : 'AI VIDEO';
  const videoTitleText = (
    <span className="bg-linear-to-r from-blue-300 via-purple-300 to-indigo-300 bg-clip-text text-transparent italic">
      {videoPanelTitle}
    </span>
  );

  const ratioOptions = [
    { label: '智能', value: 'Smart' },
    { label: '自定义', value: 'Custom' },
    { label: '1:1', value: '1:1' },
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '4:3', value: '4:3' },
    { label: '3:4', value: '3:4' },
    { label: '3:2', value: '3:2' },
    { label: '2:3', value: '2:3' },
    { label: '21:9', value: '21:9' },
    { label: '9:21', value: '9:21' },
    { label: '5:4', value: '5:4' }
  ];
  const maxReferenceImages = isVideoMode
    ? getVideoModelMaxReferenceImages(selectedVideoModelConfig.id)
    : (imageModel === 'gpt-image-2' ? 16 : 10);
  const promptReferenceMentionState = useMemo(() => {
    const referenceTagRegex = /@图\s*([1-9]\d*)/gi;
    const mentionedOneBased: number[] = [];
    const seen = new Set<number>();

    let match: RegExpExecArray | null;
    while ((match = referenceTagRegex.exec(prompt)) !== null) {
      const num = Number(match[1]);
      if (!Number.isNaN(num) && !seen.has(num)) {
        seen.add(num);
        mentionedOneBased.push(num);
      }
    }

    const validOneBased = mentionedOneBased.filter((n) => n <= referenceImages.length && n >= 1);
    const invalidOneBased = mentionedOneBased.filter((n) => n > referenceImages.length || n < 1);
    return {
      hasMentions: mentionedOneBased.length > 0,
      mentionedOneBased,
      validOneBased,
      validIndexSet: new Set(validOneBased.map((n) => n - 1)),
      invalidOneBased,
    };
  }, [prompt, referenceImages.length]);

  // CRITICAL FIX: Move isMobile state BEFORE conditional return to avoid hooks rule violation
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
       const mobile = window.innerWidth < 640; // Match App.tsx threshold
       setIsMobile(mobile);
       if (mobile && panelRef.current) {
         // Clear desktop drag transform; mobile animation uses Tailwind transform classes.
         panelRef.current.style.transform = '';
       } else if (panelRef.current) {
         // Restore transform on desktop
         updatePanelTransform(posRef.current.x, posRef.current.y);
       }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-collapse logic
  useEffect(() => {
    if (isMobile || isDragging || panelMinimized || isGenerating || isHovered || isPinned) {
      setAutoCollapsed(false);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      return;
    }

    // When mouse stands still outside panel for 2.5s, collapse it
    hoverTimerRef.current = setTimeout(() => {
       setAutoCollapsed(true);
    }, 2500);

    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    }
  }, [isHovered, isDragging, panelMinimized, isMobile, isGenerating, isPinned]);

  const [shouldRenderPanel, setShouldRenderPanel] = useState(isControlPanelOpen);
  useEffect(() => {
    if (isControlPanelOpen) {
      setShouldRenderPanel(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setShouldRenderPanel(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [isControlPanelOpen]);

  if (!shouldRenderPanel) return null;

  // Panel layout configuration.
  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    bottom: 0,
    left: 0,
    width: '100%',
    maxHeight: '86dvh',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    zIndex: 60,
    willChange: 'auto'
  } : {
    position: 'fixed',
    top: 0,
    left: 0,
    width: autoCollapsed ? '24px' : '320px',
    zIndex: 40,
    cursor: autoCollapsed ? 'pointer' : (isDragging ? 'grabbing' : 'default'),
    willChange: 'transform, width',
    transition: isDragging ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  };

  const desktopWidthClass = autoCollapsed 
    ? 'w-6 h-32 ml-0 rounded-r-2xl border-l-0 opacity-40 hover:opacity-100 overflow-hidden' 
    : 'rounded-[28px] w-[320px] overflow-hidden';

  // Remove backdrop blur during drag for performance
  const panelAnimationClass = isControlPanelOpen
    ? 'opacity-100 scale-100 translate-y-0 translate-x-0'
    : (isMobile ? 'opacity-0 translate-y-full scale-[0.98]' : 'opacity-0 -translate-x-4 scale-[0.98]');

  const panelClass = isDragging 
      ? "bg-black/90 border border-white/20 rounded-[28px] shadow-none flex flex-col overflow-hidden"
      : `bg-[#121212]/95 backdrop-blur-xl border border-white/10 ${isMobile ? 'rounded-t-[20px] w-full max-h-[86dvh] overflow-hidden' : desktopWidthClass} shadow-[0_30px_60px_rgba(0,0,0,0.6)] flex flex-col transition-all duration-200 ${panelAnimationClass} ${isControlPanelOpen ? 'pointer-events-auto' : 'pointer-events-none'}`;

  const safeDragStart = (e: React.MouseEvent) => {
    if (isMobile) return;
    if (!autoCollapsed) handleDragStart(e);
  };
  const safeTouchStart = (e: React.TouchEvent) => {
    if (isMobile) return;
    if (!autoCollapsed) handleTouchStartRaw(e);
  };

  return (
    <div 
       ref={panelRef} 
       style={panelStyle} 
       className={panelClass}
       onMouseEnter={() => autoCollapsed ? setAutoCollapsed(false) : setIsHovered(true)}
       onMouseLeave={() => setIsHovered(false)}
    >
      {autoCollapsed && !isMobile ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-white/5 pointer-events-none gap-1.5 transition-all">
          <div className="w-1 h-3 bg-white/20 rounded-full"></div>
          <div className="w-1 h-12 bg-white/40 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)]"></div>
          <div className="w-1 h-3 bg-white/20 rounded-full"></div>
        </div>
      ) : (
        <>
          {/* Unified header */}
          <div 
            className="border-b border-white/5 bg-white/5 backdrop-blur-md select-none touch-none"
            onMouseDown={safeDragStart}
            onTouchStart={safeTouchStart}
          >
            <div className="flex items-center justify-center py-3 cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors">
          <div className="w-16 h-1.5 rounded-full bg-white/20"></div>
        </div>
        
        {!panelMinimized && (
        <div className="px-4 pb-3">
           <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-200 flex items-center gap-2 select-none">
                {isVideoMode ? <MonitorPlay size={20} className="text-blue-400" /> : titleIcon}
                {isVideoMode ? videoTitleText : imagePanelTitle}
              </h2>
               <div className="flex items-center gap-1">
                 <button
                  onClick={() => setIsPinned(!isPinned)}
                  className={`${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98] ${isPinned ? 'text-blue-400 bg-blue-500/10' : 'text-gray-400 hover:text-white'}`}
                  title={isPinned ? "取消固定" : "固定面板（取消自动隐藏）"}
                 >
                   {isPinned ? <Pin size={14} className="fill-current" /> : <PinOff size={14} />}
                 </button>
                 <button
                  onClick={() => setPanelMinimized(true)}
                  className={`text-gray-400 hover:text-white ${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98]`}
                 >
                   <Minus size={14} />
                 </button>
                 <button
                  onClick={() => setControlPanelOpen(false)}
                  className={`text-gray-400 hover:text-white ${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98]`}
                 >
                   <X size={14} />
                 </button>
               </div>
           </div>
        </div>
        )}
        
        {/* Minimized Header */}
        {panelMinimized && (
          <div className="px-4 pb-3 flex items-center justify-between">
             <div className="text-xs font-bold text-white flex items-center gap-2 select-none">
               {isVideoMode ? <MonitorPlay size={16} className="text-blue-400" /> : titleIcon}
               {isVideoMode ? videoPanelTitle : imagePanelTitle}
             </div>
             <div className="flex items-center gap-1">
               <button
                onClick={() => setIsPinned(!isPinned)}
                className={`${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98] ${isPinned ? 'text-blue-400 bg-blue-500/10' : 'text-gray-400 hover:text-white'}`}
                title={isPinned ? "取消固定" : "固定面板"}
               >
                 {isPinned ? <Pin size={14} className="fill-current" /> : <PinOff size={14} />}
               </button>
               <button
                onClick={() => setPanelMinimized(false)}
                className={`text-gray-400 hover:text-white ${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98]`}
               >
                 <Maximize2 size={14} />
               </button>
               <button
                onClick={() => setControlPanelOpen(false)}
                className={`text-gray-400 hover:text-white ${isMobile ? 'p-2.5' : 'p-1.5'} hover:bg-white/10 rounded-full transition-colors touch-manipulation active:scale-[0.98]`}
               >
                 <X size={14} />
               </button>
             </div>
          </div>
        )}
      </div>

              {/* Content area */}
      {!panelMinimized && (
        <div className={`p-4 ${isMobile ? 'pt-3' : ''} flex flex-col gap-4 overflow-y-auto overflow-x-hidden sleek-scroll-y ${isMobile ? 'max-h-[calc(86dvh-92px)] pb-[max(1rem,env(safe-area-inset-bottom))]' : 'max-h-[85vh]'}`}>
          {toolMode === ToolMode.INPAINT ? (
            <>
              {hasUnlockedGenerationAccess ? (
                <ImageEditPanel
                  selectedNode={selectedEditNode}
                  hasUnlockedGenerationAccess={hasUnlockedGenerationAccess}
                  isCheckingGenerationAccess={isCheckingGenerationAccess}
                  directKeyOnly={generationAccessState === 'valid_api_key'}
                  onInitGenerations={onInitGenerations}
                  onUpdateGeneration={onUpdateGeneration}
                />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                        isCheckingGenerationAccess
                          ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
                          : 'border-amber-400/25 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      {isCheckingGenerationAccess ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={18} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {isCheckingGenerationAccess
                          ? '正在验证访问权限'
                          : '请先登录或验证 API Key'}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-gray-400">
                        {generationAccessMessage}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-gray-400">
                    图片编辑会按你选择的模型和线路走 `/api/edit`，登录后可使用平台积分线路；如果你是旧用户，也可以输入兼容的 API Key。
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
          {/* Reference image area (shared by image/video mode) */}
              <div id="reference-drop-zone" 
                   className="border border-dashed border-gray-600 rounded-lg p-3 bg-gray-800/30 relative"
                   onDrop={handlePanelDrop} 
                   onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                   // onClick={() => alert(`[Click Debug] Max=${isVideoMode ? (VIDEO_LOSS_CONFIG[videoModel as any]?.max) : 10}, Current=${referenceImages.length}`)}
              >
                  {/* VISIBLE DEBUG info */}
                  {/* <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] px-1 pointer-events-none z-50">
                     DEBUG: Max={isVideoMode ? (VIDEO_LOSS_CONFIG[videoModel as any]?.max) : 10} / Count={referenceImages.length}
                  </div> */}

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">参考图</span>
                    <span className="inline-flex items-center rounded-md border border-blue-400/35 bg-blue-500/15 px-1.5 py-[1px] text-[10px] font-medium text-blue-200">
                      {referenceImages.length}/{maxReferenceImages}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => panelFileInputRef.current?.click()} className={`${isMobile ? 'text-sm min-h-9 px-2' : 'text-xs'} text-blue-400 hover:text-blue-300 flex items-center gap-1 rounded-lg touch-manipulation active:scale-[0.98]`}>
                      <Upload size={12} /> 上传
                    </button>
                    <button
                      type="button"
                      onClick={() => { void clearReferenceImages(); }}
                      disabled={referenceImages.length === 0}
                      title="清空参考图"
                      className={`${isMobile ? 'min-h-9 w-8' : 'h-6 w-6'} inline-flex items-center justify-center rounded-md border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/25 hover:bg-white/5 disabled:opacity-35 disabled:cursor-not-allowed transition-colors`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              {referenceImages.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1 pr-1 sleek-scroll-x">
                  {referenceImages.map((item, idx) => {
                    const label = isVideoMode
                      ? getVideoModelReferenceLabels(selectedVideoModelConfig.id)?.[idx]
                      : null;
                    const isPromptLinked = promptReferenceMentionState.validIndexSet.has(idx);

                    return (
                    <div
                      key={item.id || idx}
                      className={`group/ref relative shrink-0 ${isMobile ? 'w-16 h-16 rounded-[10px]' : 'w-[76px] h-[76px] rounded-[12px]'} overflow-hidden border ${
                        isPromptLinked
                          ? 'border-purple-300/80 shadow-[0_0_0_1px_rgba(196,181,253,0.75),0_0_16px_rgba(139,92,246,0.35)]'
                          : (draggingIndex === idx
                            ? 'border-yellow-400 shadow-[0_0_0_1px_rgba(250,204,21,0.5)]'
                            : 'border-[#d8dde7]/45')
                      } bg-black/20 transition-all`}
                      draggable
                      onDragStart={(e) => handleRefDragStart(e, idx)}
                      onDrop={(e) => handleRefDrop(e, idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onContextMenu={(e) => handleReferenceThumbnailContextMenu(e, idx)}
                    >
                      <img src={item.src} alt="" className="w-full h-full object-cover" />
                      {isPromptLinked && (
                        <div className="absolute top-1 left-1 px-1 py-0.5 rounded-[5px] bg-purple-600/85 border border-purple-200/40 text-white text-[9px] leading-none font-semibold">
                          @图{idx + 1}
                        </div>
                      )}
                      
                      <button
                        onClick={() => removeReferenceImage(idx)}
                        className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/65 border border-white/45 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 focus:opacity-100 hover:bg-red-500/90 transition-all"
                      >
                        <X size={10} />
                      </button>

                      <div className={`absolute left-1 bottom-1 px-1.5 py-0.5 rounded-[6px] text-white text-[10px] leading-none font-medium border ${
                        isPromptLinked
                          ? 'bg-purple-500/88 border-purple-100/55 shadow-[0_2px_8px_rgba(139,92,246,0.45)]'
                          : 'bg-black/72 border-white/15'
                      }`}>
                        {label || `图${idx + 1}`}
                      </div>
                    </div>
                  )})}
                  
                  {/* Dynamic Add Button Logic */}
                  {(() => {
                     if (referenceImages.length < maxReferenceImages) {
                         return (
                             <button
                              onClick={() => panelFileInputRef.current?.click()}
                              className={`${isMobile ? 'w-16 h-16 rounded-[10px]' : 'w-[76px] h-[76px] rounded-[12px]'} shrink-0 border border-white/20 bg-[#202734] flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors touch-manipulation active:scale-[0.98]`}
                            >
                              <div className={`${isMobile ? 'w-10 h-10 rounded-[8px]' : 'w-12 h-12 rounded-[10px]'} border border-dashed border-white/35 flex items-center justify-center`}>
                                <Plus size={16} />
                              </div>
                            </button>
                         );
                     }
                     return null;
                  })()}
                </div>
              ) : (
                <div className="flex items-start">
                  <button
                    type="button"
                    onClick={() => panelFileInputRef.current?.click()}
                    className={`${isMobile ? 'w-16 h-16 rounded-[10px]' : 'w-[76px] h-[76px] rounded-[12px]'} border border-white/20 bg-[#202734] flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors touch-manipulation active:scale-[0.98]`}
                  >
                    <div className={`${isMobile ? 'w-10 h-10 rounded-[8px]' : 'w-12 h-12 rounded-[10px]'} border border-dashed border-white/35 flex items-center justify-center`}>
                      <Plus size={16} />
                    </div>
                  </button>
                </div>
              )}
              <input ref={panelFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePanelFileSelect} />
            </div>
          



              {/* Prompt form */}
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-gray-400">提示词</label>
                <button
                  type="button"
                  onClick={handleOptimizePrompt}
                  disabled={isOptimizing || !prompt.trim()}
                  className={`${isMobile ? 'text-sm min-h-9 px-2.5' : 'text-xs px-2 py-0.5'} flex items-center gap-1 rounded transition-colors touch-manipulation active:scale-[0.98] ${isOptimizing || !prompt.trim() ? 'text-gray-500 cursor-not-allowed' : 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/20'}`}
                  title={`使用 ${promptToolConfig.model} 优化提示词，扣 ${promptToolConfig.optimizeCost} 金币`}
                >
                  {isOptimizing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                  优化 ({promptToolConfig.optimizeCost} 金币)
                </button>
              </div>
              <div className="relative">
                <textarea
                  ref={promptTextareaRef}
                  value={prompt}
                  onChange={handlePromptChange}
                  onFocus={(e) => {
                    handleInputFocus();
                    syncMentionAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
                  }}
                  onClick={handlePromptCursorSync}
                  onKeyUp={handlePromptCursorSync}
                  onKeyDown={handlePromptKeyDown}
                  onBlur={() => {
                    window.setTimeout(() => setMentionAutocomplete(null), 120);
                  }}
                  placeholder={isVideoMode ? "描述你想要生成的视频内容..." : "描述你想要生成的图片..."}
                  className={`w-full ${isMobile ? 'h-28 min-h-28 text-base' : 'h-24 min-h-24 text-sm'} bg-white/5 border border-white/10 rounded-xl p-3 text-gray-100 resize-y focus:border-purple-500/50 focus:bg-white/10 focus:outline-none transition-all placeholder:text-gray-500`}
                />
                {mentionAutocomplete && (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-xl border border-purple-300/30 bg-[#101520]/95 backdrop-blur-md shadow-[0_12px_30px_rgba(0,0,0,0.45)] overflow-hidden">
                    {mentionSuggestionNumbers.length > 0 ? (
                      <div className="max-h-44 overflow-y-auto sleek-scroll-y py-1">
                        {mentionSuggestionNumbers.map((num, idx) => {
                          const active = idx === mentionActiveIndex;
                          return (
                            <button
                              key={num}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertReferenceTagIntoPrompt(num, true);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                active
                                  ? 'bg-purple-500/25 text-purple-100'
                                  : 'text-gray-200 hover:bg-white/8'
                              }`}
                            >
                              图{num}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-xs text-gray-400">
                        没有匹配的参考图编号
                      </div>
                    )}
                  </div>
                )}
              </div>
              {referenceImages.length > 0 && !promptReferenceMentionState.hasMentions && (
                <div className="mt-2 text-[11px] text-gray-400">
                  可在提示词中输入 `@图1`、`@图2` 指定参考图，输入后会自动高亮对应卡片。
                </div>
              )}
              {promptReferenceMentionState.hasMentions && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-purple-200 bg-purple-500/10 border border-purple-300/25 rounded-md px-2 py-1">
                    <Sparkles size={11} className="text-purple-300" />
                    <span>
                      已引用：{promptReferenceMentionState.validOneBased.length > 0
                        ? promptReferenceMentionState.validOneBased.map((n) => `图${n}`).join('、')
                        : '暂无可用引用'}
                    </span>
                  </div>
                  {promptReferenceMentionState.invalidOneBased.length > 0 && (
                    <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-300/25 rounded-md px-2 py-1">
                      未找到：{promptReferenceMentionState.invalidOneBased.map((n) => `图${n}`).join('、')}（当前仅 {referenceImages.length} 张参考图）
                    </div>
                  )}
                </div>
              )}




              {/* Optimized prompt options panel */}
              {showOptionsPanel && promptOptions.length > 0 && (
                <div className="mt-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                  {/* Panel header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-linear-to-r from-purple-500/20 to-blue-500/20 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <Sparkles size={12} className="text-purple-400" />
                      <span className="text-xs text-purple-300 font-medium">
                        优化方案 ({selectedOptionIndex + 1}/{promptOptions.length})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handlePrevOption}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
                        title="上一个方案"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={handleNextOption}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
                        title="下一个方案"
                      >
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={handleCloseOptions}
                        className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700/50 rounded transition-colors ml-1"
                        title="关闭"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Panel body */}
                  <div className="p-3">
                    {/* Option style tag */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-purple-600/40 text-purple-200 text-[10px] font-medium rounded-full">
                        {promptOptions[selectedOptionIndex]?.style || '优化结果'}
                      </span>
                    </div>

                    {/* Option prompt content */}
                    <div className="text-xs text-gray-300 leading-relaxed max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
                      {promptOptions[selectedOptionIndex]?.prompt || ''}
                    </div>
                  </div>

                  {/* Pagination dots */}
                  <div className="flex items-center justify-center gap-1.5 py-2 border-t border-gray-700/50">
                    {promptOptions.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedOptionIndex(idx)}
                        className={`w-2 h-2 rounded-full transition-all ${idx === selectedOptionIndex
                          ? 'bg-purple-500 scale-110'
                          : 'bg-gray-600 hover:bg-gray-500'
                          }`}
                      />
                    ))}
                  </div>

                  {/* Confirm action */}
                  <div className="px-3 pb-3">
                    <button
                      type="button"
                      onClick={handleConfirmOption}
                      className="w-full py-2 bg-linear-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-lg"
                    >
                      <Check size={12} />
                      使用此方案
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Model-specific configuration form */}
            {hasUnlockedGenerationAccess ? (
              isVideoMode ? (
                <VideoFormConfig
                  restrictToDirectKeyCompatible={false}
                />
              ) : (
                <ImageFormConfig
                  restrictToDirectKeyCompatible={generationAccessState === 'valid_api_key'}
                />
              )
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                      isCheckingGenerationAccess
                        ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
                        : 'border-amber-400/25 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    {isCheckingGenerationAccess ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={18} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {isCheckingGenerationAccess
                        ? '正在验证访问权限'
                        : isVideoMode
                          ? '请先登录后使用视频生成'
                          : '请先登录或验证 API Key'}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-gray-400">
                      {generationAccessMessage}
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-gray-400">
                  {isVideoMode
                    ? '视频模型只支持登录后按账户点数计费。'
                    : '登录后可查看并使用全部模型；如果你是旧用户，也可以在设置里输入自己的 API Key，验证通过后再显示兼容模型。'}
                </div>
              </div>
            )}

            {error && (
              <div className="text-red-400 text-xs bg-red-900/20 border border-red-800/50 rounded p-2">{error}</div>
            )}

            <button
              type="submit"
              disabled={
                isGenerating ||
                isCheckingGenerationAccess ||
                !hasUnlockedGenerationAccess ||
                (!prompt.trim() && toolMode !== ToolMode.INPAINT)
              }
              className={`w-full ${isMobile ? 'py-3.5 rounded-xl text-base min-h-[50px]' : 'py-2.5 rounded-lg text-sm'} font-medium flex items-center justify-center gap-2 transition-all touch-manipulation active:scale-[0.98] ${
                isGenerating ||
                isCheckingGenerationAccess ||
                !hasUnlockedGenerationAccess ||
                (!prompt.trim() && toolMode !== ToolMode.INPAINT)
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg'
              }`}
            >
              {isGenerating ? (
                <><Loader2 size={16} className="animate-spin" />正在工作中...</>
              ) : isCheckingGenerationAccess ? (
                <><Loader2 size={16} className="animate-spin" />正在验证访问权限...</>
              ) : !hasUnlockedGenerationAccess ? (
                <><ShieldCheck size={16} />请先登录或验证 Key</>
              ) : (
                <>
                  {toolMode === ToolMode.INPAINT ? <Zap size={16} /> : (isVideoMode ? <Film size={16} /> : <Wand2 size={16} />)}
                  {toolMode === ToolMode.INPAINT ? '开始图片编辑' : (isVideoMode ? '立即生成视频' : '立即开始创作')}
                </>
              )}
            </button>
            {/* Removed Exit Edit Mode button as Edit Mode is disabled */}
          </form>
          </>
          )}
        </div>
      )}
      </>
      )}
      {referenceAtMenu && (
        <div
          className="fixed z-[120] rounded-lg border border-purple-300/35 bg-[#111827]/95 backdrop-blur-md p-1 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.max(8, Math.min(referenceAtMenu.x, window.innerWidth - 170)),
            top: Math.max(8, Math.min(referenceAtMenu.y, window.innerHeight - 56)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-purple-100 rounded-md hover:bg-purple-500/20 transition-colors"
            onClick={() => insertReferenceTagIntoPrompt(referenceAtMenu.refIndex + 1, false)}
          >
            @引用 图{referenceAtMenu.refIndex + 1}
          </button>
        </div>
      )}
      <VideoPricingModal isOpen={showPricingModal} onClose={() => setShowPricingModal(false)} />
    </div>
  );
});

export default ControlPanel;
