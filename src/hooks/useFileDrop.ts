import { useEffect, useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { NodeData, ToolMode, Point } from '../../types';

export const useFileDrop = (
  processFiles: (items: (File | string)[], centerPoint?: Point) => Promise<void>
) => {
  
  // Paste Handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // 1. Check for Internal Node Data (JSON)
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.type === 'huabu-nodes-v1' && Array.isArray(parsed.data)) {
             e.preventDefault();
             const { addNode, generateId } = useCanvasStore.getState();
             const { selectAll } = useSelectionStore.getState();
             const newIds: string[] = [];
             
             parsed.data.forEach((node: NodeData) => {
               const newNodeId = generateId();
               const newNode = {
                 ...node,
                 id: newNodeId,
                 x: node.x + 20,
                 y: node.y + 20,
                 selected: false
               };
               addNode(newNode);
               newIds.push(newNodeId);
             });
             
             // Select new nodes after a brief delay to ensure render
             setTimeout(() => selectAll(newIds), 50);
             return; // Stop processing other types
          }
        } catch (err) {
            // Not valid JSON or not our data, ignore and continue
        }
      }

      // 2. Handle Files and Images
      console.log('[Paste Debug] Clipboard Event:', e);
      const items: (File | string)[] = [];
      if (e.clipboardData) {
         console.log('[Paste Debug] Types:', e.clipboardData.types);
         if (e.clipboardData.files.length > 0) {
            console.log(`[Paste Debug] Found ${e.clipboardData.files.length} files`);
            for (let i = 0; i < e.clipboardData.files.length; i++) {
                const file = e.clipboardData.files[i];
                console.log(`[Paste Debug] File ${i}: name=${file.name}, type=${file.type}, size=${file.size}`);
                items.push(file);
            }
         } else {
             console.log('[Paste Debug] No direct files in clipboardData.files');
             // Try items fallback for some browsers/OS
             if (e.clipboardData.items) {
                 for (let i = 0; i < e.clipboardData.items.length; i++) {
                     const item = e.clipboardData.items[i];
                     if (item.kind === 'file') {
                         const f = item.getAsFile();
                         if (f) {
                             console.log(`[Paste Debug] extracted file from item: type=${f.type}`);
                             items.push(f);
                         }
                     }
                 }
             }
         }
      }
      
      if (e.clipboardData) {
        const html = e.clipboardData.getData('text/html');
        if (html) {
          const parser = new DOMParser(); 
          const doc = parser.parseFromString(html, 'text/html');
          const imgs = doc.querySelectorAll('img'); 
          imgs.forEach(img => { if (img.src) items.push(img.src); });
        }
      }
      if (items.length > 0) { 
        e.preventDefault(); 
        processFiles(items); 
      }
    };
    
    window.addEventListener('paste', handlePaste);
    return () => { window.removeEventListener('paste', handlePaste); };
  }, [processFiles]);

  // Drag & Drop Handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const items: (File | string)[] = [];
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) items.push(e.dataTransfer.files[i]);
    }
    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const parser = new DOMParser(); 
      const doc = parser.parseFromString(html, 'text/html');
      const imgs = doc.querySelectorAll('img'); 
      imgs.forEach(img => { if (img.src) items.push(img.src); });
    } else {
      const uri = e.dataTransfer.getData('text/uri-list');
      if (uri) items.push(uri);
    }
    if (items.length > 0) processFiles(items, { x: e.clientX, y: e.clientY });
  }, [processFiles]);

  return { handleDragOver, handleDrop };
};
