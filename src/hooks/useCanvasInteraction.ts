import { useCallback, useState, useEffect } from 'react';
import Konva from 'konva';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';
import { Point, ToolMode } from '../../types';

interface UseCanvasInteractionProps {
  onCanvasPointerDown?: (e: React.PointerEvent, canvasPos: Point) => void;
}

interface UseCanvasInteractionReturn {
  // Stage event handlers
  onMouseDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onMouseMove: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onMouseUp: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent> | MouseEvent) => void;
  // Selection Box
  selectionBox: { x1: number, y1: number, x2: number, y2: number } | null;
  // Drawing state for preview (kept for compatibility)
  isDrawing: boolean;
  currentStroke: Point[];
}

/**
 * 处理画布交互逻辑的核心 Hook
 * - PAN: 平移画布
 * - SELECT: 点击选中
 * - GENERATE: 生成模式
 */
export const useCanvasInteraction = (
  props?: UseCanvasInteractionProps
): UseCanvasInteractionReturn => {
  const { canvasState, setCanvasTransform } = useCanvasStore();

  const {
    select, selectAll, toolMode, setToolMode, selectedIds
  } = useSelectionStore();

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Box Selection State
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((sx: number, sy: number): Point => {
    return {
      x: (sx - canvasState.offset.x) / canvasState.scale,
      y: (sy - canvasState.offset.y) / canvasState.scale,
    };
  }, [canvasState]);

  const handleSelectionComplete = useCallback((isShift: boolean) => {
    if (!selectionBox) return;

    const boxRect = {
      x: Math.min(selectionBox.x1, selectionBox.x2),
      y: Math.min(selectionBox.y1, selectionBox.y2),
      width: Math.abs(selectionBox.x1 - selectionBox.x2),
      height: Math.abs(selectionBox.y1 - selectionBox.y2)
    };

    if (boxRect.width > 5 || boxRect.height > 5) {
       // Convert box to absolute canvas coords
       const startCanvas = screenToCanvas(boxRect.x, boxRect.y);
       const endCanvas = screenToCanvas(boxRect.x + boxRect.width, boxRect.y + boxRect.height);
       
       const rect = {
           x: startCanvas.x,
           y: startCanvas.y,
           width: endCanvas.x - startCanvas.x,
           height: endCanvas.y - startCanvas.y
       };
       
       // Use getState() directly to prevent stale closures or circular requires
       const nodes = useCanvasStore.getState().nodes;
       const selectedNewIds = nodes.filter(n => {
           // Basic AABB intersection
           return (
             n.x < rect.x + rect.width &&
             n.x + n.width > rect.x &&
             n.y < rect.y + rect.height &&
             n.y + n.height > rect.y
           );
       }).map(n => n.id);

       if (selectedNewIds.length > 0) {
          if (isShift) {
             const resultIds = Array.from(new Set([...selectedIds, ...selectedNewIds]));
             selectAll(resultIds);
          } else {
             selectAll(selectedNewIds);
          }
       } else if (!isShift) {
          select(null, false);
       }
    } else {
      // Just a click without dragging
      if (!isShift) {
          select(null, false);
      }
    }

    setIsSelecting(false);
    setSelectionBox(null);
  }, [selectionBox, screenToCanvas, selectAll, select, selectedIds]);

  // Global mouse up for safety, catching releases outside the canvas
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isSelecting) {
        handleSelectionComplete(e.shiftKey);
      }
      setIsPanning(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isSelecting, handleSelectionComplete]);

  // ==================== Mouse Down ====================
  const onMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const clickedOnEmpty = e.target === stage || e.target.name() === 'background' || !e.target.parent;
    const nativeEvt = e.evt as MouseEvent;

    // 中键或 PAN 模式 - 开始平移
    if ((nativeEvt && nativeEvt.button === 1) || toolMode === ToolMode.PAN) {
      setIsPanning(true);
      setPanStart({ x: pointer.x - canvasState.offset.x, y: pointer.y - canvasState.offset.y });
      return;
    }

    // 点击空白区域
    if (clickedOnEmpty) {
      const isShift = nativeEvt ? nativeEvt.shiftKey : false;
      
      // If we are in SELECT mode (or holding Shift), we start marquee selection instead of panning
      if (toolMode === ToolMode.SELECT || isShift) {
        setIsSelecting(true);
        setSelectionBox({
          x1: pointer.x,
          y1: pointer.y,
          x2: pointer.x,
          y2: pointer.y
        });
        if (!isShift) { // If not appending, clear first
           select(null, false);
        }
      } else if (toolMode !== ToolMode.INPAINT && toolMode !== ToolMode.GENERATE) {
        // Only if we aren't using other specialized tools, fallback to PAN
        select(null, false);
        setToolMode(ToolMode.PAN);
        setIsPanning(true);
        setPanStart({ x: pointer.x - canvasState.offset.x, y: pointer.y - canvasState.offset.y });
      }
    }
  }, [toolMode, canvasState, select, setToolMode]);

  // ==================== Mouse Move ====================
  const onMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    if (isPanning && panStart) {
       const newX = pointer.x - panStart.x;
       const newY = pointer.y - panStart.y;
       setCanvasTransform({ x: newX, y: newY }, canvasState.scale);
       return;
    }

    if (isSelecting && selectionBox) {
       setSelectionBox({
         ...selectionBox,
         x2: pointer.x,
         y2: pointer.y
       });
       return;
    }

  }, [isPanning, panStart, canvasState.scale, setCanvasTransform, isSelecting, selectionBox]);

  // ==================== Mouse Up ====================
  const onMouseUp = useCallback((e?: Konva.KonvaEventObject<MouseEvent | TouchEvent> | MouseEvent) => {
    setIsPanning(false);

    if (isSelecting && selectionBox) {
       let isShift = false;
       if (e) {
          if ('evt' in e) {
             isShift = (e.evt as MouseEvent).shiftKey || false;
          } else {
             isShift = (e as MouseEvent).shiftKey || false;
          }
       }
       handleSelectionComplete(isShift);
    }
  }, [isSelecting, selectionBox, handleSelectionComplete]);

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    selectionBox,
    isDrawing: false,
    currentStroke: []
  };
};
