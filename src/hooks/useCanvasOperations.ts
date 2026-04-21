import { useState, useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { useHistoryStore } from '../store/historyStore'; // If needed for logging
import { editImage } from '../../services/geminiService';
import { arrangeNodes } from '../../src/utils/layout';
import { AppStatus } from '../../types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { v4 as uuidv4 } from 'uuid';

export const useCanvasOperations = () => {
  const {
    nodes, setNodes, addNode, updateNode, deleteNodes,
    canvasState, resetCanvasView, addToHistory, generateId
  } = useCanvasStore();

  const {
    selectedIds, select, clearSelection,
    contextMenu, setContextMenu, closeContextMenu,
    setStatus, apiKey
  } = useSelectionStore();

  // Dialog States
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isDownloadingCanvas, setIsDownloadingCanvas] = useState(false);

  // Duplicate node
  const handleDuplicate = useCallback(() => {
    if (!contextMenu) return;
    // addToHistory(); // Handled by addNode command
    const nodeToDuplicate = nodes.find(n => n.id === contextMenu.nodeId);
    if (nodeToDuplicate) {
      const newNode = {
        ...nodeToDuplicate,
        id: generateId(),
        x: nodeToDuplicate.x + 20,
        y: nodeToDuplicate.y + 20,
        history: nodeToDuplicate.src ? [{ src: nodeToDuplicate.src, prompt: nodeToDuplicate.prompt }] : undefined,
        historyIndex: 0
      };
      addNode(newNode);
      select(newNode.id, false);
    }
    closeContextMenu();
  }, [nodes, contextMenu, generateId, addNode, select, closeContextMenu]);

  // Remove background
  const handleRemoveBackground = useCallback(async () => {
    if (!contextMenu) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (!node || node.type !== 'IMAGE' || !node.src) return;
    
    if (!apiKey) { 
      alert("请先在设置中输入 API Key"); 
      closeContextMenu(); 
      return; 
    }
    
    // addToHistory(); // Handled by updateNode command
    closeContextMenu();
    setStatus(AppStatus.LOADING);
    
    try {
      const resultSrcs = await editImage(apiKey, node.src as string, "Remove the background, keep only the main subject");
      const newSrc = resultSrcs[0];
      const oldHistory = node.history || [{ src: node.src!, prompt: node.prompt }];
      const oldIndex = node.historyIndex ?? 0;
      const newHistory = [...oldHistory.slice(0, oldIndex + 1), { src: newSrc, prompt: "Background Removed" }];
      updateNode(node.id, { src: newSrc, prompt: "Background Removed", history: newHistory, historyIndex: newHistory.length - 1 });
      setStatus(AppStatus.IDLE);
    } catch (e) { 
      console.error(e); 
      setStatus(AppStatus.ERROR); 
    }
  }, [nodes, contextMenu, closeContextMenu, setStatus, updateNode, apiKey]);

  // Download node
  const handleDownloadNode = useCallback(async () => {
    if (!contextMenu) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (node && node.src) {
      try {
        let href = node.src; let isBlob = false;
        if (node.src.startsWith('http')) {
          const response = await fetch(node.src);
          const blob = await response.blob();
          href = URL.createObjectURL(blob); isBlob = true;
        }
        const link = document.createElement('a');
        link.href = href;
        const isVideo = node.type === 'VIDEO' || node.src.toLowerCase().endsWith('.mp4') || node.src.toLowerCase().includes('format=mp4');
        const ext = isVideo ? 'mp4' : 'png';
        const filename = (node.prompt ? node.prompt.slice(0, 20).replace(/[^a-z0-9]/gi, '_').trim() : (isVideo ? 'video' : 'image')) + `_${node.id}.${ext}`;
        link.download = filename;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        if (isBlob) URL.revokeObjectURL(href);
      } catch (err) {
        console.error("Failed to download asset", err);
        const link = document.createElement('a'); link.href = node.src; link.target = "_blank"; 
        const isVideo = node.type === 'VIDEO' || node.src.toLowerCase().endsWith('.mp4');
        link.download = `asset_${node.id}.${isVideo ? 'mp4' : 'png'}`; 
        link.click();
      }
    }
    closeContextMenu();
  }, [contextMenu, nodes, closeContextMenu]);

  // Clear all
  const handleClearAll = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const confirmClearAll = useCallback(() => {
    // addToHistory(); // Handled by SetNodesCommand internally
    setNodes([]);
    clearSelection();
    resetCanvasView();
    setShowClearConfirm(false);
  }, [setNodes, clearSelection, resetCanvasView]);

  // Arrange nodes
  const handleArrangeNodes = useCallback(() => {
    // addToHistory(); // Handled by SetNodesCommand
    const currentNodes = useCanvasStore.getState().nodes;
    const screenStartX = 360;
    const canvasStartX = (screenStartX - canvasState.offset.x) / canvasState.scale;
    const screenStartY = 100;
    const canvasStartY = (screenStartY - canvasState.offset.y) / canvasState.scale;

    const newNodes = arrangeNodes(currentNodes, {
      startX: canvasStartX,
      startY: canvasStartY,
      gap: 20,
      maxRows: 3
    });
    setNodes(newNodes);
  }, [canvasState, setNodes]);

  // Download all canvas images
  const handleDownloadAllCanvas = useCallback(async () => {
    const imageNodes = nodes.filter(n => n.type === 'IMAGE' && n.src);
    if (imageNodes.length === 0) {
      alert("画布上没有可下载的图片");
      return;
    }

    setIsDownloadingCanvas(true);
    try {
      const zip = new JSZip();
      const promises = imageNodes.map(async (node, idx) => {
        try {
          const response = await fetch(node.src!);
          const blob = await response.blob();
          const cleanPrompt = (node.prompt || 'image').slice(0, 30).replace(/[^a-z0-9]/gi, '_').trim();
          const ext = blob.type.split('/')[1] || 'png';
          const filename = `${String(idx + 1).padStart(3, '0')}_${cleanPrompt}.${ext}`;
          zip.file(filename, blob);
        } catch (e) {
          console.warn("Failed to fetch image for ZIP:", node.src, e);
        }
      });

      await Promise.all(promises);
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `canvas_images_${new Date().toISOString().split('T')[0]}.zip`);
    } catch (err) {
      console.error("ZIP creation failed:", err);
      alert("下载失败，请重试");
    } finally {
      setIsDownloadingCanvas(false);
    }
  }, [nodes]);

  // Handle Grouping
  const handleGroup = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    if (ids.length < 2) return;
    const currentNodes = useCanvasStore.getState().nodes;
    const newGroupId = uuidv4();
    const newNodes = currentNodes.map(n => 
      ids.includes(n.id) ? { ...n, groupId: newGroupId } : n
    );
    setNodes(newNodes);
  }, [setNodes]);

  const handleUngroup = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    if (ids.length < 2) return;
    const currentNodes = useCanvasStore.getState().nodes;
    const newNodes = currentNodes.map(n => 
      ids.includes(n.id) ? { ...n, groupId: undefined } : n
    );
    setNodes(newNodes);
  }, [setNodes]);

  // Handle Aligning
  const handleAlign = useCallback((alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal-distribute' | 'vertical-distribute') => {
    const ids = useSelectionStore.getState().selectedIds;
    if (ids.length < 2) return;
    const currentNodes = useCanvasStore.getState().nodes;
    const selectedNodes = currentNodes.filter(n => ids.includes(n.id));
    
    if (selectedNodes.length < 2) return;

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedNodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    let newNodes = [...currentNodes];

    if (alignment === 'horizontal-distribute' || alignment === 'vertical-distribute') {
        if (selectedNodes.length < 3) return; // Distribute requires at least 3 nodes
        
        let sortedNodes = [...selectedNodes];
        if (alignment === 'horizontal-distribute') {
             sortedNodes.sort((a, b) => a.x - b.x);
             const firstCenter = sortedNodes[0].x + sortedNodes[0].width / 2;
             const lastCenter = sortedNodes[sortedNodes.length - 1].x + sortedNodes[sortedNodes.length - 1].width / 2;
             const spacing = (lastCenter - firstCenter) / (sortedNodes.length - 1);
             
             newNodes = currentNodes.map(n => {
                 if (!ids.includes(n.id)) return n;
                 const idx = sortedNodes.findIndex(sn => sn.id === n.id);
                 if (idx === 0 || idx === sortedNodes.length - 1) return n; // Keep ends fixed
                 const newTargetCenter = firstCenter + spacing * idx;
                 return { ...n, x: newTargetCenter - n.width / 2 };
             });
        } else {
             sortedNodes.sort((a, b) => a.y - b.y);
             const firstCenter = sortedNodes[0].y + sortedNodes[0].height / 2;
             const lastCenter = sortedNodes[sortedNodes.length - 1].y + sortedNodes[sortedNodes.length - 1].height / 2;
             const spacing = (lastCenter - firstCenter) / (sortedNodes.length - 1);
             
             newNodes = currentNodes.map(n => {
                 if (!ids.includes(n.id)) return n;
                 const idx = sortedNodes.findIndex(sn => sn.id === n.id);
                 if (idx === 0 || idx === sortedNodes.length - 1) return n; // Keep ends fixed
                 const newTargetCenter = firstCenter + spacing * idx;
                 return { ...n, y: newTargetCenter - n.height / 2 };
             });
        }
    } else {
      newNodes = currentNodes.map(n => {
        if (!ids.includes(n.id)) return n;
        let newX = n.x;
        let newY = n.y;
        switch(alignment) {
          case 'left': newX = minX; break;
          case 'center': newX = minX + (maxX - minX)/2 - n.width/2; break;
          case 'right': newX = maxX - n.width; break;
          case 'top': newY = minY; break;
          case 'middle': newY = minY + (maxY - minY)/2 - n.height/2; break;
          case 'bottom': newY = maxY - n.height; break;
        }
        return { ...n, x: newX, y: newY };
      });
    }

    setNodes(newNodes);
  }, [setNodes]);

  // Delete Selected
  const handleDeleteSelected = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    if (ids.length === 0) return;
    deleteNodes(new Set(ids));
    clearSelection();
    closeContextMenu();
  }, [deleteNodes, clearSelection, closeContextMenu]);

  return {
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
    handleGroup,
    handleUngroup,
    handleAlign,
    handleDeleteSelected
  };
};
