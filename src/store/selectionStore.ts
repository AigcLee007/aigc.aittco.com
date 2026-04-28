import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, type PersistStorage } from 'zustand/middleware';
import { ToolMode, AppStatus } from '../../types';
import { useCanvasStore } from './canvasStore';
import { getVideoModelMaxReferenceImages } from '../config/videoModels';
import { assetStorage } from '../services/assetStorage';
import { v4 as uuidv4 } from 'uuid';

export interface ReferenceImage {
  id: string; // Unique UI ID
  src: string; // Display URL (can be data URL or blob URL for rendering)
  blob?: Blob; // Direct blob reference (solves CSP issue)
  assetId?: string; // IDB Key (persistent)
  type: 'blob' | 'url';
}

interface SelectionStore {
  // State
  selectedIds: string[];
  toolMode: ToolMode;
  status: AppStatus;
  showLayers: boolean;

  // Control Panel State
  isControlPanelOpen: boolean;
  panelMode: 'IMAGE' | 'VIDEO';
  videoModel: string;
  videoLine: string;
  imageModel: string;

  // Persistent Input State
  prompt: string;
  aspectRatio: string;
  customRatio: string;
  imageSize: string;
  thinkingLevel: string;
  quantity: number;
  videoAspectRatio: string;
  videoDuration: string;
  videoHd: boolean;
  brushSize: number;
  brushColor: string;
  imageLine: string;
  gptImageQuality: 'auto' | 'low' | 'medium' | 'high';
  gptImageOutputFormat: 'png' | 'jpeg' | 'webp';
  gptImageOutputCompression: number | null;
  gptImageModeration: 'auto' | 'low';
  grokReferenceMode: 'stable_fusion' | 'classic_multi';
  autoDownloadOnSuccess: boolean;

  // Context Menu State
  contextMenu: { x: number; y: number; nodeId: string } | null;

  // Lightbox State
  lightboxImage: string | null;

  // Reference Images (for Img2Img)
  referenceImages: ReferenceImage[];

  // Pending Prompt (for history reuse)
  pendingPrompt: string | null;

  // Actions - Selection
  select: (id: string | null, multi: boolean) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;
  isSelected: (id: string) => boolean;

  // Actions - Tool Mode
  setToolMode: (mode: ToolMode) => void;
  setPanelMode: (mode: 'IMAGE' | 'VIDEO') => void;
  setVideoModel: (model: string) => void;
  setVideoLine: (line: string) => void;
  setImageModel: (model: string) => void;

  // Actions - Inputs
  setPrompt: (prompt: string) => void;
  setAspectRatio: (ratio: string) => void;
  setCustomRatio: (ratio: string) => void;
  setImageSize: (size: string) => void;
  setThinkingLevel: (level: string) => void;
  setQuantity: (qty: number) => void;
  setVideoAspectRatio: (ratio: string) => void;
  setVideoDuration: (duration: string) => void;
  setVideoHd: (hd: boolean) => void;
  setBrushSize: (size: number) => void;
  setBrushColor: (color: string) => void;
  setImageLine: (line: string) => void;
  setGptImageQuality: (quality: 'auto' | 'low' | 'medium' | 'high') => void;
  setGptImageOutputFormat: (format: 'png' | 'jpeg' | 'webp') => void;
  setGptImageOutputCompression: (compression: number | null) => void;
  setGptImageModeration: (moderation: 'auto' | 'low') => void;
  setGrokReferenceMode: (mode: 'stable_fusion' | 'classic_multi') => void;
  setAutoDownloadOnSuccess: (enabled: boolean) => void;

  // Actions - Status
  setStatus: (status: AppStatus) => void;

  // Actions - UI
  setShowLayers: (show: boolean) => void;
  toggleLayers: () => void;
  showTooltips: boolean;
  toggleTooltips: () => void;
  setControlPanelOpen: (open: boolean) => void;
  toggleControlPanel: () => void;

  // Actions - Context Menu
  setContextMenu: (menu: { x: number; y: number; nodeId: string } | null) => void;
  closeContextMenu: () => void;

  // Actions - Lightbox
  openLightbox: (src: string) => void;
  closeLightbox: () => void;

  // Actions - Reference Images
  addReferenceImage: (src: string) => Promise<void>;
  addReferenceImages: (items: Array<{src: string, blob?: Blob}>, max?: number) => Promise<void>;
  removeReferenceImage: (index: number) => Promise<void>;
  clearReferenceImages: () => Promise<void>;
  setReferenceImages: (images: ReferenceImage[]) => void;
  refreshReferenceUrls: () => Promise<void>;

  // Actions - Pending Prompt
  setPendingPrompt: (prompt: string | null) => void;

  // Actions - API Key (Global)
  apiKey: string;
  setApiKey: (key: string) => void;
}

const parsePersistedSelectionValue = (rawValue: string | null, storageKey: string) => {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.warn(`[SelectionStore] Failed to parse persisted value for ${storageKey}`, error);
    return null;
  }
};

const selectionPersistStorage: PersistStorage<any> = {
  getItem: (name) => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return null;
    }

    try {
      const rawValue = window.localStorage.getItem(name);
      const parsed = parsePersistedSelectionValue(rawValue, name);
      if (!parsed && rawValue != null) {
        window.localStorage.removeItem(name);
      }
      return parsed;
    } catch (error) {
      console.warn(`[SelectionStore] Failed to read persisted state for ${name}`, error);
      try {
        window.localStorage.removeItem(name);
      } catch (_) {}
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(name, JSON.stringify(value));
    } catch (error) {
      console.warn(`[SelectionStore] Failed to persist state for ${name}`, error);
    }
  },
  removeItem: (name) => {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(name);
    } catch (error) {
      console.warn(`[SelectionStore] Failed to clear persisted state for ${name}`, error);
    }
  },
};

export const useSelectionStore = create<SelectionStore>()(
  persist(
    immer((set, get) => ({
      // Initial State
      selectedIds: [],
      toolMode: ToolMode.SELECT,
      status: AppStatus.IDLE,
      showLayers: true,
      showTooltips: true,
      isControlPanelOpen: true,
      panelMode: 'IMAGE',
      contextMenu: null,
      lightboxImage: null,
      referenceImages: [],
      pendingPrompt: null,
      apiKey: '', // Must be manually set by user
      videoModel: 'veo3.1-fast',
      videoLine: 'line1',
      imageModel: 'nano-banana',
      
      // Default Input State
      prompt: '',
      aspectRatio: '16:9',
      customRatio: '',
      imageSize: '2k',
      thinkingLevel: 'none',
      quantity: 1,
      videoAspectRatio: '16:9',
      videoDuration: '4',
      videoHd: false,
      brushSize: 40,
      brushColor: '#A855F7', // Purple default
      imageLine: 'line1',
      gptImageQuality: 'auto',
      gptImageOutputFormat: 'png',
      gptImageOutputCompression: null,
      gptImageModeration: 'auto',
      grokReferenceMode: 'stable_fusion',
      autoDownloadOnSuccess: true,

      // Actions - Selection
      select: (id, multi) =>
        set((state) => {
          state.contextMenu = null;

          if (id === null) {
            state.selectedIds = [];
            return;
          }

          // Group Auto-Select Logic
          let idsToSelect = [id];
          if (id !== null) {
              const nodes = useCanvasStore.getState().nodes;
              const targetNode = nodes.find((n: any) => n.id === id);
              if (targetNode?.groupId) {
                  idsToSelect = nodes.filter((n: any) => n.groupId === targetNode.groupId).map((n: any) => n.id);
              }
          }

          if (multi) {
             let newSelected = [...state.selectedIds];
             const isTargetSelected = state.selectedIds.includes(id);
             
             if (isTargetSelected) {
                  // Deselect the group
                  newSelected = newSelected.filter(sid => !idsToSelect.includes(sid));
             } else {
                  // Select the group (add unique)
                  idsToSelect.forEach(sid => {
                      if (!newSelected.includes(sid)) newSelected.push(sid);
                  });
             }
             state.selectedIds = newSelected;
          } else {
            // Normal click without shift/ctrl
            // If the clicked node is already selected and there are multiple selected,
            // standard behavior is to just keep it selected or reduce to only it.
            // Let's reduce to only this group.
            state.selectedIds = idsToSelect;
          }
        }),
        
      clearSelection: () =>
        set((state) => {
          state.selectedIds = [];
        }),

      selectAll: (ids) =>
        set((state) => {
          state.selectedIds = ids;
        }),

      isSelected: (id) => get().selectedIds.includes(id),

      // Actions - Inputs
      setPrompt: (val) => set(state => { state.prompt = val; }),
      setAspectRatio: (val) => set(state => { state.aspectRatio = val; }),
      setCustomRatio: (val) => set(state => { state.customRatio = val; }),
      setImageSize: (val) => set(state => { state.imageSize = val; }),
      setThinkingLevel: (val) => set(state => { state.thinkingLevel = val; }),
      setQuantity: (val) => set(state => { state.quantity = val; }),
      setVideoAspectRatio: (val) => set(state => { state.videoAspectRatio = val; }),
      setVideoDuration: (val) => set(state => { state.videoDuration = val; }),
      setVideoHd: (val) => set(state => { state.videoHd = val; }),
      setBrushSize: (val) => set(state => { state.brushSize = val; }),
      setBrushColor: (val) => set(state => { state.brushColor = val; }),
      setImageLine: (val) => set(state => { state.imageLine = val; }),
      setGptImageQuality: (val) => set(state => { state.gptImageQuality = val; }),
      setGptImageOutputFormat: (val) => set(state => { state.gptImageOutputFormat = val; }),
      setGptImageOutputCompression: (val) => set(state => { state.gptImageOutputCompression = val; }),
      setGptImageModeration: (val) => set(state => { state.gptImageModeration = val; }),
      setGrokReferenceMode: (val) => set(state => { state.grokReferenceMode = val; }),
      setAutoDownloadOnSuccess: (val) => set(state => { state.autoDownloadOnSuccess = val; }),

      toggleControlPanel: () =>
        set((state) => {
          state.isControlPanelOpen = !state.isControlPanelOpen;
        }),

      setPanelMode: (mode) =>
        set((state) => {
          state.panelMode = mode;
        }),

      // Actions - Tool Mode
      setToolMode: (mode) =>
        set((state) => {
          state.toolMode = mode;
          if (mode === ToolMode.VIDEO) {
              state.panelMode = 'VIDEO';
              state.isControlPanelOpen = true; // Auto-open panel
          } else if (mode === ToolMode.GENERATE) {
              state.panelMode = 'IMAGE';
              state.isControlPanelOpen = true; // Auto-open panel
          } else if (mode === ToolMode.INPAINT) {
              state.panelMode = 'IMAGE';
              state.isControlPanelOpen = true;
          }
        }),

      // Actions - Status
      setStatus: (status) =>
        set((state) => {
          state.status = status;
        }),

      // Actions - UI
      setShowLayers: (show) =>
        set((state) => {
          state.showLayers = show;
        }),

      toggleLayers: () =>
        set((state) => {
          state.showLayers = !state.showLayers;
        }),
      
      toggleTooltips: () =>
        set((state) => {
          state.showTooltips = !state.showTooltips;
        }),
      
      setControlPanelOpen: (open) =>
        set((state) => {
          state.isControlPanelOpen = open;
        }),

      // Actions - Context Menu
      setContextMenu: (menu) =>
        set((state) => {
          state.contextMenu = menu;
          if (menu && !state.selectedIds.includes(menu.nodeId)) {
            state.selectedIds = [menu.nodeId];
          }
        }),

      closeContextMenu: () =>
        set((state) => {
          state.contextMenu = null;
        }),

      // Actions - Lightbox
      openLightbox: (src) =>
        set((state) => {
          state.lightboxImage = src;
          state.contextMenu = null;
        }),

      closeLightbox: () =>
        set((state) => {
          state.lightboxImage = null;
        }),

      // Actions - Video Model
      setVideoModel: (model) =>
        set((state) => {
          state.videoModel = model;
        }),
      setVideoLine: (line) =>
        set((state) => {
          state.videoLine = line;
        }),

      // Actions - Image Model
      setImageModel: (model) =>
        set((state) => {
          state.imageModel = model;
        }),

      // Actions - Reference Images
      addReferenceImage: async (src, blob?: Blob) => {
           let assetId: string | undefined = undefined;
           let actualBlob: Blob | undefined = blob;
           
           // If blob is not provided but we have a data URL, convert it
           if (!actualBlob && src.startsWith('data:image')) {
               try {
                  const response = await fetch(src);
                  actualBlob = await response.blob();
               } catch (e) {
                   console.error("Failed to convert data URL to blob", e);
               }
           }

           // Store blob in assetStorage
           if (actualBlob) {
               try {
                  assetId = await assetStorage.storeBlob(actualBlob);
               } catch (e) {
                   console.error("Failed to store reference blob", e);
               }
           }

           set((state) => {
              let max = 10;
              const isVideoMode = state.panelMode === 'VIDEO' || state.toolMode === ToolMode.VIDEO;
              if (isVideoMode) {
                   max = getVideoModelMaxReferenceImages(state.videoModel);
              } else if (state.imageModel === 'gpt-image-2') {
                   max = 16;
              }

              if (state.referenceImages.length < max) {
                state.referenceImages.push({
                    id: uuidv4(),
                    src: src,
                    blob: actualBlob, // Store the Blob directly
                    assetId: assetId,
                    type: assetId ? 'blob' : 'url'
                });
              }
           });
      },

      addReferenceImages: async (items: Array<{src: string, blob?: Blob}>, max) => {
           const processedItems: ReferenceImage[] = await Promise.all(items.map(async (item) => {
               let assetId: string | undefined = undefined;
               let actualBlob: Blob | undefined = item.blob;
               
               // If blob not provided but it's a data URL, convert it
               if (!actualBlob && item.src.startsWith('data:image')) {
                   try {
                       const res = await fetch(item.src);
                       actualBlob = await res.blob();
                   } catch (e) {
                       console.error("Failed to convert data URL", e);
                   }
               }
               
               // Store blob in assetStorage
               if (actualBlob) {
                   try {
                       assetId = await assetStorage.storeBlob(actualBlob);
                   } catch (e) {
                       console.error("Failed to store reference blob", e);
                   }
               }
               
               return {
                   id: uuidv4(),
                   src: item.src,
                   blob: actualBlob,
                   assetId: assetId,
                   type: assetId ? 'blob' : 'url'
               };
           }));

           set((state) => {
              let limit = max;
              if (limit === undefined) {
                   limit = 10;
                   const isVideoMode = state.panelMode === 'VIDEO' || state.toolMode === ToolMode.VIDEO;
                   if (isVideoMode) {
                       limit = getVideoModelMaxReferenceImages(state.videoModel);
                   } else if (state.imageModel === 'gpt-image-2') {
                       limit = 16;
                   }
              }
              
              const remaining = limit - state.referenceImages.length;
              if (remaining > 0) {
                 const toAdd = processedItems.slice(0, remaining);
                 state.referenceImages.push(...toAdd);
              }
           });
      },

      removeReferenceImage: async (index) => {
          const item = get().referenceImages[index];
          if (item && item.assetId) {
             assetStorage.deleteBlob(item.assetId).catch(console.error);
          }
          
          set((state) => {
            state.referenceImages.splice(index, 1);
          });
      },

      clearReferenceImages: async () => {
          const items = get().referenceImages;
          items.forEach(item => {
              if (item.assetId) assetStorage.deleteBlob(item.assetId).catch(console.error);
          });
          
          set((state) => {
            state.referenceImages = [];
          });
      },

      setReferenceImages: (images) =>
        set((state) => {
          state.referenceImages = images;
        }),
      
      // Hydration Helper
      refreshReferenceUrls: async () => {
          const currentImages = get().referenceImages;
          let changed = false;
          
          const updatedImages = await Promise.all(currentImages.map(async (img) => {
              if (img.assetId) {
                  const freshUrl = await assetStorage.getAssetUrl(img.assetId);
                  if (freshUrl && freshUrl !== img.src) {
                      changed = true;
                      return { ...img, src: freshUrl };
                  }
              }
              return img;
          }));
          
          if (changed) {
              set((state) => {
                  state.referenceImages = updatedImages;
              });
          }
      },

      // Actions - Pending Prompt
      setPendingPrompt: (prompt) =>
        set((state) => {
          state.pendingPrompt = prompt;
        }),

      // Actions - API Key
      setApiKey: (key) =>
        set((state) => {
          state.apiKey = key;
        }),
    })),
    {
      name: 'selection-storage', // Key in localStorage
      storage: selectionPersistStorage,
      partialize: (state) => ({
        // Whitelist fields to persist
        apiKey: state.apiKey,
        prompt: state.prompt,
        referenceImages: state.referenceImages,
        videoModel: state.videoModel,
        videoLine: state.videoLine,
        imageModel: state.imageModel,
        aspectRatio: state.aspectRatio,
        customRatio: state.customRatio,
        imageSize: state.imageSize,
        thinkingLevel: state.thinkingLevel,
        quantity: state.quantity,
        videoAspectRatio: state.videoAspectRatio,
        videoDuration: state.videoDuration,
        videoHd: state.videoHd,
        brushSize: state.brushSize,
        brushColor: state.brushColor,
        panelMode: state.panelMode,
        isControlPanelOpen: state.isControlPanelOpen,
        imageLine: state.imageLine,
        gptImageQuality: state.gptImageQuality,
        gptImageOutputFormat: state.gptImageOutputFormat,
        gptImageOutputCompression: state.gptImageOutputCompression,
        gptImageModeration: state.gptImageModeration,
        grokReferenceMode: state.grokReferenceMode,
        autoDownloadOnSuccess: state.autoDownloadOnSuccess
      }),
    }
  )
);
