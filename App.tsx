import React, { useCallback, useEffect, useState } from "react";
import InfiniteCanvas from "./components/InfiniteCanvas";
import MobileView from "./components/MobileView";
import Toolbar from "./components/Toolbar";
import MultiSelectToolbar from "./components/MultiSelectToolbar";
import ControlPanel from "./components/ControlPanel";
import InpaintWindow from "./components/InpaintWindow";
import AdminDashboardPage from "./components/AdminDashboardPage";
import BillingCenterPage from "./components/BillingCenterPage";
import { Settings, CheckCircle, LayoutGrid, Wallet } from "lucide-react";
// ContextMenu is handled by ModalsContainer

import { useCanvasStore } from "./src/store/canvasStore";
import { useSelectionStore } from "./src/store/selectionStore";
import { NodeData, ToolMode, AppStatus, Point } from "./types";
import { useGlobalShortcuts } from "./src/hooks/useGlobalShortcuts";
import { useCanvasOperations } from "./src/hooks/useCanvasOperations";
import { MainLayout } from "./src/layouts/MainLayout";
import { ModalsContainer } from "./src/layouts/ModalsContainer";
import { assetStorage } from "./src/services/assetStorage";
import { isLowEndDevice } from "./src/utils/performance";
import {
  AUTH_SESSION_CHANGE_EVENT,
  fetchCurrentAuthSession,
  getStoredAuthSessionToken,
} from "./src/services/accountIdentity";
import wechatQr from "./wechat.png";

// New Hooks
import { useTaskRecovery } from "./src/hooks/useTaskRecovery";
import { useImageProcessor } from "./src/hooks/useImageProcessor";
import { useGenerationLogic } from "./src/hooks/useGenerationLogic";
import { useFileDrop } from "./src/hooks/useFileDrop";
import { useGlobalPolling } from "./src/hooks/useGlobalPolling";

const App: React.FC = () => {
  const classicModePreferred =
    typeof window !== "undefined" &&
    window.location.pathname === "/" &&
    window.localStorage.getItem("preferred-create-ui") === "classic";
  const isAdminRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin");
  const isBillingRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/billing");

  if (isAdminRoute) {
    return <AdminDashboardPage />;
  }

  if (isBillingRoute) {
    return <BillingCenterPage />;
  }

  if (classicModePreferred) {
    window.location.replace("/create/classic");
    return null;
  }

  // Get state and actions from stores
  const {
    nodes,
    setNodes,
    deleteNodes,
    resetCanvasView,
    setCanvasTransform,
    undo,
    redo,
    generateId,
  } = useCanvasStore();

  const [hydrated, setHydrated] = useState(false);
  const [isAccountAuthenticated, setIsAccountAuthenticated] = useState<boolean>(() =>
    Boolean(getStoredAuthSessionToken()),
  );

  useEffect(() => {
    // Check if already hydrated
    // @ts-ignore
    if (useCanvasStore.persist.hasHydrated()) {
      setHydrated(true);
    }

    // @ts-ignore
    const unsub = useCanvasStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );

    // Failsafe: Force hydrated after 1s if event doesn't fire (prevents infinite loading)
    const timer = setTimeout(() => {
      setHydrated(true);
    }, 1000);

    return () => {
      // unsub(); // persisted store unsubscribe might not be a function in all versions, safe to ignore for singleton app
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const hydrate = async () => {
      // Iterate store nodes to find assets that need hydration
      for (const node of nodes) {
        if (node.assetId && (!node.src || node.src.startsWith("blob:"))) {
          const url = await assetStorage.getAssetUrl(node.assetId);
          if (url && url !== node.src) {
            useCanvasStore.getState().updateNode(node.id, { src: url }, true);
          }
        }
      }
    };
    hydrate();
  }, [hydrated]); // Removed nodes from dep array to avoid infinite loop. Runs once on hydration.

  useEffect(() => {
    let active = true;
    const syncAuthState = async () => {
      const hasToken = Boolean(getStoredAuthSessionToken());
      if (!hasToken) {
        if (active) setIsAccountAuthenticated(false);
        return;
      }
      if (active) setIsAccountAuthenticated(true);
      try {
        const session = await fetchCurrentAuthSession();
        if (!active) return;
        setIsAccountAuthenticated(Boolean(session?.authenticated));
      } catch (_) {
        if (!active) return;
        setIsAccountAuthenticated(false);
      }
    };

    void syncAuthState();

    if (typeof window === "undefined") {
      return () => {
        active = false;
      };
    }

    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, syncAuthState);
    window.addEventListener("storage", syncAuthState);
    return () => {
      active = false;
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, syncAuthState);
      window.removeEventListener("storage", syncAuthState);
    };
  }, []);

  const {
    selectedIds,
    select,
    clearSelection,
    selectAll,
    toolMode,
    setToolMode,
    status,
    setStatus,
    contextMenu,
    setContextMenu,
    closeContextMenu,
    lightboxImage,
    openLightbox,
    closeLightbox,
    apiKey, // Added apiKey
  } = useSelectionStore();

  const selectedNodeIds = new Set(selectedIds);

  const handleSelection = useCallback(
    (id: string | null, multi: boolean) => {
      closeContextMenu();
      if (id === null) {
        clearSelection();
        return;
      }
      select(id, multi);
    },
    [closeContextMenu, clearSelection, select],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
    },
    [setContextMenu],
  );

  // --- De-coupled Logic Hooks ---

  // 1. Task Recovery
  useTaskRecovery(apiKey);

  // 2. Generation Logic
  const {
    handleInitGenerations,
    handleUpdateGeneration,
    handleUpdateProgress,
  } = useGenerationLogic();

  // 3. Global Polling (Replaces local polling)
  // This ensures tasks update even if nodes are virtualized off-screen
  useGlobalPolling(apiKey, handleUpdateGeneration, handleUpdateProgress);

  // 4. Image Processing (Upload/Paste)
  const { processFiles, handleUpload } = useImageProcessor();

  // Reference Image Hydration (Refresh Blob URLs from IndexedDB)
  useEffect(() => {
    useSelectionStore.getState().refreshReferenceUrls();
  }, []);

  // Canvas Operations Hook
  const {
    handleDuplicate,
    handleRemoveBackground,
    handleDownloadNode,
    handleClearAll,
    confirmClearAll,
    showClearConfirm,
    setShowClearConfirm,
    handleArrangeNodes,
    handleDownloadAllCanvas,
    isDownloadingCanvas,
  } = useCanvasOperations();

  // Delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    deleteNodes(new Set(selectedIds));
    clearSelection();
    closeContextMenu();
  }, [selectedIds, deleteNodes, clearSelection, closeContextMenu]);

  // Global Shortcuts
  useGlobalShortcuts(
    nodes,
    handleDeleteSelected,
    () =>
      document.querySelector<HTMLInputElement>('input[type="file"]')?.click(),
    handleClearAll,
    handleArrangeNodes,
    handleDownloadAllCanvas,
    () => setReversePromptOpen(true),
    () => openModal("history"),
  );

  // File Drop
  const { handleDragOver, handleDrop } = useFileDrop(processFiles);

  // Canvas pointer down handler
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent, canvasPos: Point) => {
      // No longer creating text or shapes on canvas click
    },
    [],
  );

  const handleDoubleClickNode = (node: NodeData) => {
    if (node.type === "IMAGE" && node.src) openLightbox(node.src);
  };

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"settings" | "history">("settings");
  const [reversePromptOpen, setReversePromptOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const handleOpenBatch = useCallback(() => setBatchModalOpen(true), []);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Mobile Detection - Use 640px threshold to avoid F12 devtools triggering mobile view
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useEffect(() => {
    const lowEnd = isLowEndDevice();
    document.documentElement.classList.toggle("low-end-device", lowEnd);
    document.documentElement.classList.toggle("reduced-motion", lowEnd);
    return () => {
      document.documentElement.classList.remove("low-end-device");
      document.documentElement.classList.remove("reduced-motion");
    };
  }, []);
  useEffect(() => {
    if (isMobile) {
      useSelectionStore.getState().setControlPanelOpen(false);
    }
  }, [isMobile]);

  const openModal = useCallback((tab: "settings" | "history") => {
    setModalTab(tab);
    setModalOpen(true);
  }, []);

  const openClassicMode = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("preferred-create-ui", "classic");
    window.location.href = "/create/classic";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.pathname.startsWith("/create/classic")) {
      window.localStorage.setItem("preferred-create-ui", "canvas");
    }
  }, []);

  const handleDownloadImage = useCallback(
    async (src: string, prompt?: string, id?: string) => {
      const cleanPrompt = (prompt || "image")
        .slice(0, 30)
        .replace(/[^a-z0-9]/gi, "_")
        .trim();

      const isVideo = src.toLowerCase().endsWith(".mp4");
      const ext = isVideo ? "mp4" : "png";
      const filename = `${cleanPrompt || "image"}_${id || Date.now()}.${ext}`;

      try {
        let blob: Blob | null = null;

        if (src.startsWith("data:") || src.startsWith("blob:")) {
          const res = await fetch(src);
          if (res.ok) blob = await res.blob();
        } else if (src.startsWith("http") || src.startsWith("/")) {
          const fetchUrl =
            src.startsWith("/api/")
              ? src
              : src.startsWith("http")
                ? `/api/proxy/image?url=${encodeURIComponent(src)}`
                : src;
          const res = await fetch(fetchUrl);
          if (res.ok) blob = await res.blob();
        }

        if (blob) {
          const href = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = href;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(href), 800);
          return;
        }

        const link = document.createElement("a");
        link.href = src;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        window.open(src, "_blank");
      }
    },
    [],
  );

  const [mobileViewMode, setMobileViewMode] = useState<'grid' | 'canvas'>('grid');

  // Mobile Render Path
  if (isMobile && hydrated) {
    if (mobileViewMode === 'canvas') {
       return (
         <div className="fixed inset-0 w-full h-full bg-neutral-900 overflow-hidden text-white">
           <div className="absolute top-6 left-1/2 -translate-x-1/2 z-60">
             <button
               onClick={() => {
                 setMobileViewMode('grid');
                 useSelectionStore.getState().setToolMode(ToolMode.PAN);
               }}
               className="bg-black/70 backdrop-blur-md border border-white/10 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center gap-2 transition-all active:scale-95"
             >
               <LayoutGrid size={16} className="text-gray-300" />
               返回作品流
             </button>
           </div>
           
           <MainLayout
             onContextMenuClose={closeContextMenu}
             onDragOver={handleDragOver}
             onDrop={handleDrop}
           >
             <div className="flex-1 relative z-0">
               <InfiniteCanvas
                 onContextMenu={handleContextMenu}
                 onNodeDoubleClick={handleDoubleClickNode}
                 onCanvasPointerDown={handleCanvasPointerDown}
               />
             </div>
           </MainLayout>

           <ModalsContainer
             settingsOpen={modalOpen}
             settingsTab={modalTab}
             onCloseSettings={() => setModalOpen(false)}
             onOpenSettings={() => openModal("settings")}
             onReusePrompt={(prompt, type) => {
               setModalOpen(false);
               useSelectionStore
                 .getState()
                 .setToolMode(
                   type === "video" ? ToolMode.VIDEO : ToolMode.GENERATE,
                 );
               setTimeout(() => {
                 useSelectionStore.getState().setPendingPrompt(prompt);
                 setMobileViewMode('grid'); // switch back on reuse
               }, 100);
             }}
             onViewImage={openLightbox}
             onUseAsReference={(src) => {
               useSelectionStore.getState().addReferenceImage(src);
               setModalOpen(false);
               useSelectionStore.getState().setToolMode(ToolMode.GENERATE);
               setMobileViewMode('grid');
             }}
             onDownloadImage={handleDownloadImage}
             reversePromptOpen={false}
             onCloseReversePrompt={() => {}}
             onUsePrompt={() => {}}
             batchModalOpen={false}
             onCloseBatchModal={() => {}}
             batchApiKey=""
             onInitGenerations={() => []}
             onUpdateGeneration={async () => {}}
             instructionsOpen={false}
             onCloseInstructions={() => {}}
             lightboxImage={lightboxImage}
             onCloseLightbox={closeLightbox}
             showClearConfirm={false}
             onCloseClearConfirm={() => {}}
             onConfirmClear={() => {}}
             onDuplicate={() => {}}
             onRemoveBackground={() => {}}
             onDownloadNode={() => {}}
             onCopyLink={async () => {}}
           />
         </div>
       );
    }

    return (
      <div className="fixed inset-0 w-full h-full bg-neutral-900 overflow-hidden text-white">
        <MobileView
          onOpenHistory={() => openModal("history")}
          onOpenSettings={() => openModal("settings")}
          onOpenCanvas={() => {
            setMobileViewMode("canvas");
            useSelectionStore.getState().setToolMode(ToolMode.PAN);
          }}
          onOpenClassicMode={openClassicMode}
        />
        <ControlPanel
          onInitGenerations={handleInitGenerations}
          onUpdateGeneration={handleUpdateGeneration}
          onUpdateProgress={handleUpdateProgress}
          onOpenBatchModal={handleOpenBatch}
        />
        <InpaintWindow />
        <ModalsContainer
          settingsOpen={modalOpen}
          settingsTab={modalTab}
          onCloseSettings={() => setModalOpen(false)}
          onOpenSettings={() => openModal("settings")}
          onReusePrompt={(prompt, type) => {
            setModalOpen(false);
            useSelectionStore
              .getState()
              .setToolMode(
                type === "video" ? ToolMode.VIDEO : ToolMode.GENERATE,
              );
            setTimeout(() => {
              useSelectionStore.getState().setPendingPrompt(prompt);
            }, 100);
          }}
          onViewImage={openLightbox}
          onUseAsReference={(src) => {
            useSelectionStore.getState().addReferenceImage(src);
            setModalOpen(false);
            useSelectionStore.getState().setToolMode(ToolMode.GENERATE);
          }}
          onDownloadImage={handleDownloadImage}
          lightboxImage={lightboxImage}
          onCloseLightbox={closeLightbox}
          // Pass other required props as no-ops or valid handlers if needed
          reversePromptOpen={false}
          onCloseReversePrompt={() => {}}
          onUsePrompt={() => {}}
          batchModalOpen={false}
          onCloseBatchModal={() => {}}
          batchApiKey=""
          onInitGenerations={() => []}
          onUpdateGeneration={async () => {}}
          instructionsOpen={false}
          onCloseInstructions={() => {}}
          showClearConfirm={false}
          onCloseClearConfirm={() => {}}
          onConfirmClear={() => {}}
          onDuplicate={() => {}}
          onRemoveBackground={() => {}}
          onDownloadNode={() => {}}
          onCopyLink={async () => {}}
        />
      </div>
    );
  }

  return (
    <>
      {!hydrated && (
        <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-100">
          <div className="text-white flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div>加载资源中...</div>
          </div>
        </div>
      )}
      <MainLayout
        onContextMenuClose={closeContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex-1 relative z-0">
          <InfiniteCanvas
            onContextMenu={handleContextMenu}
            onNodeDoubleClick={handleDoubleClickNode}
            onCanvasPointerDown={handleCanvasPointerDown}
          />
        </div>

        <Toolbar
          onUpload={handleUpload}
          onClearAll={handleClearAll}
          onOpenSettings={() => openModal("settings")}
          onOpenHistory={() => openModal("history")}
          onOpenInstructions={() => setInstructionsOpen(true)}
          onArrange={handleArrangeNodes}
          onOpenReversePrompt={() => setReversePromptOpen(true)}
          onOpenBatchModal={handleOpenBatch}
          onDownloadAllCanvas={handleDownloadAllCanvas}
          isDownloadingCanvas={isDownloadingCanvas}
          onOpenClassicMode={openClassicMode}
        />

        <MultiSelectToolbar />

        <ControlPanel
          onInitGenerations={handleInitGenerations}
          onUpdateGeneration={handleUpdateGeneration}
          onUpdateProgress={handleUpdateProgress}
          onOpenBatchModal={handleOpenBatch}
        />

        <InpaintWindow />

        <ModalsContainer
          settingsOpen={modalOpen}
          settingsTab={modalTab}
          onCloseSettings={() => setModalOpen(false)}
          onOpenSettings={() => openModal("settings")}
          onReusePrompt={(prompt, type) => {
            setModalOpen(false);
            useSelectionStore
              .getState()
              .setToolMode(
                type === "video" ? ToolMode.VIDEO : ToolMode.GENERATE,
              );
            setTimeout(() => {
              useSelectionStore.getState().setPendingPrompt(prompt);
            }, 100);
          }}
          onViewImage={openLightbox}
          onUseAsReference={(src) => {
            useSelectionStore.getState().addReferenceImage(src);
            setModalOpen(false);
            useSelectionStore.getState().setToolMode(ToolMode.GENERATE);
          }}
          onDownloadImage={handleDownloadImage}
          reversePromptOpen={reversePromptOpen}
          onCloseReversePrompt={() => setReversePromptOpen(false)}
          onUsePrompt={(prompt) => {
            useSelectionStore.getState().setPendingPrompt(prompt);
            setToolMode(ToolMode.GENERATE);
          }}
          batchModalOpen={batchModalOpen}
          onCloseBatchModal={() => setBatchModalOpen(false)}
          batchApiKey={useSelectionStore.getState().apiKey}
          onInitGenerations={handleInitGenerations}
          onUpdateGeneration={handleUpdateGeneration}
          instructionsOpen={instructionsOpen}
          onCloseInstructions={() => setInstructionsOpen(false)}
          lightboxImage={lightboxImage}
          onCloseLightbox={closeLightbox}
          showClearConfirm={showClearConfirm}
          onCloseClearConfirm={() => setShowClearConfirm(false)}
          onConfirmClear={confirmClearAll}
          onDuplicate={handleDuplicate}
          onRemoveBackground={handleRemoveBackground}
          onDownloadNode={handleDownloadNode}
          onCopyLink={async () => {
            if (!contextMenu) return;
            const node = nodes.find((n) => n.id === contextMenu.nodeId);
            if (node && node.src) {
              await navigator.clipboard.writeText(node.src);
              alert("链接已复制到剪贴板");
            }
            closeContextMenu();
          }}
        />

        {nodes.length === 0 && status === AppStatus.IDLE && !isAccountAuthenticated && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center justify-center select-none w-full max-w-2xl mt-[-5vh]">
            <h1 className="text-3xl font-light text-white tracking-[0.3em] uppercase opacity-40 mb-12 flex items-center justify-center font-sans">
              Nano Banana Pro
            </h1>

            <div className="flex flex-col items-center bg-[#121212]/60 backdrop-blur-xl p-10 rounded-[32px] border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.5)] max-w-lg text-center relative pointer-events-auto">
              <div className="absolute top-6 right-6 flex h-3 w-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]"></span>
                </span>
              </div>

              <div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-emerald-400/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center mb-6 shadow-inner">
                <Wallet size={32} className="text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
              </div>

              <h2 className="text-2xl font-bold tracking-tight text-white mb-3">
                账号制创作工作台
              </h2>

              <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-sm">
                现在支持注册、密码登录、点数账本和管理员后台。打开设置即可登录账户并管理用户。
              </p>

              <button
                onClick={() => openModal('settings')}
                className="group relative inline-flex items-center justify-center gap-3 px-8 py-3.5 bg-white text-black rounded-full font-bold text-[15px] hover:scale-105 active:scale-95 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] overflow-hidden"
              >
                <div className="absolute inset-0 bg-linear-to-r from-emerald-200 via-white to-cyan-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <Settings size={18} className="relative z-10 text-black/80" />
                <span className="relative z-10">登录 / 管理账户</span>
              </button>

              <div className="mt-6 flex flex-col items-center">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                  <img
                    src={wechatQr}
                    alt="WeChat QR"
                    className="h-28 w-28 rounded-xl object-cover sm:h-32 sm:w-32"
                    loading="lazy"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-400">扫码联系支持，手动充值点数</p>
              </div>
            </div>

            <div className="mt-8 px-6 py-2.5 bg-white/[0.03] rounded-full border border-white/5 text-xs text-gray-500 flex items-center gap-2.5 backdrop-blur-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              也可以直接拖拽本地图片到画布开始创作
            </div>
          </div>
        )}
      </MainLayout>
    </>
  );
};

export default App;
