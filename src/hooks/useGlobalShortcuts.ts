import { useEffect } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { ToolMode, NodeData } from '../../types';

// ... imports

export const useGlobalShortcuts = (
  nodes: NodeData[],
  handleDeleteSelected: () => void,
  handleUpload: () => void,
  handleClearAll?: () => void,
  handleArrange?: () => void,
  handleDownload?: () => void,
  handleReverse?: () => void,
  handleOpenHistory?: () => void
) => {
  const { setToolMode, selectAll } = useSelectionStore();
  const { undo: canvasUndo, redo: canvasRedo } = useCanvasStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive = activeTag === 'input' || activeTag === 'textarea';

      // Ignore if input is active
      if (isInputActive) return;

      const key = e.key.toLowerCase();
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;

      // Tool Modes & Actions (No Modifiers)
      if (!hasModifier) {
        // P -> Generate Image
        if (key === 'p') {
          setToolMode(ToolMode.GENERATE);
        }
        // V -> Generate Video
        if (key === 'v') {
          setToolMode(ToolMode.VIDEO);
        }
        // S -> Download
        if (key === 's') {
          e.preventDefault(); // Prevent browser save
          handleDownload?.();
        }
        // U -> Upload
        if (key === 'u') {
          e.preventDefault();
          handleUpload();
        }
        // A -> Arrange
        if (key === 'a') {
          handleArrange?.();
        }
        // H -> History
        if (key === 'h') {
          handleOpenHistory?.();
        }
        // Space -> Pan (native usually handles this, but explicit set is good)
        if (e.key === ' ') {
          setToolMode(ToolMode.PAN);
        }
        // Esc -> Select (Common fallback since S is taken)
        if (e.key === 'Escape') {
             setToolMode(ToolMode.SELECT);
        }
      }

      // Undo / Redo (Ctrl+Z / Ctrl+Y)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        e.preventDefault();
        canvasUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        canvasRedo();
      }

      // Select All (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
        selectAll(nodes.map(n => n.id));
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteSelected();
      }
      
      // Clear All (Ctrl + Shift + Delete) - keep safe
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        handleClearAll?.();
      }

      // Reverse Prompt (Shift + R) - keep safe? Or make R?
      // User didn't specify modifier for Reverse, but R is commonly Rotate or Ruler. 
      // Existing was Shift+R. User didn't explicitly change this one in the prompt list 
      // (User listed: A, P, V, U, S, H). 
      // I'll keep Shift+R for Reverse to avoid accidental trigger.
      if (e.shiftKey && key === 'r') {
        handleReverse?.();
      }

      // Copy (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && key === 'c') {
         // ... copy logic ...
         e.preventDefault();
         const { selectedIds } = useSelectionStore.getState();
         const selectedNodes = nodes.filter(n => selectedIds.includes(n.id));
         if (selectedNodes.length > 0) {
           const clipboardData = { type: 'huabu-nodes-v1', data: selectedNodes };
           navigator.clipboard.writeText(JSON.stringify(clipboardData)).catch(console.error);
         }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasUndo, canvasRedo, handleDeleteSelected, nodes, selectAll, setToolMode, handleUpload, handleClearAll, handleArrange, handleDownload, handleReverse, handleOpenHistory]);
};
