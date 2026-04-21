import { useCallback, useRef } from 'react';
import Konva from 'konva';
import { useCanvasStore } from '../store/canvasStore';
import { useSelectionStore } from '../store/selectionStore';

/**
 * 处理画布缩放逻辑的 Hook
 * - 当有节点选中时，滚轮调整节点大小
 * - 当没有节点选中时，滚轮缩放画布
 */
export const useZoom = () => {
  const { nodes, setNodes, canvasState, setCanvasTransform, addToHistory } = useCanvasStore();
  const { selectedIds } = useSelectionStore();
  
  const lastWheelRef = useRef<number>(0);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    const selectedNodeIds = new Set(selectedIds);

    // 如果有节点选中，滚轮调整节点大小
    if (selectedNodeIds.size > 0) {
      const hasLockedNode = nodes.some(n => selectedNodeIds.has(n.id) && n.locked);
      if (hasLockedNode) return;

      // 节流：500ms 内只记录一次历史
      const now = Date.now();
      const shouldRecord = now - lastWheelRef.current > 500;
      if (shouldRecord) {
        lastWheelRef.current = now;
      }

      const resizeSensitivity = 0.001;
      const scaleFactor = 1 - e.evt.deltaY * resizeSensitivity;

      const newNodes = nodes.map(node => {
        if (selectedNodeIds.has(node.id)) {
          const newWidth = Math.max(20, node.width * scaleFactor);
          const newHeight = Math.max(20, node.height * scaleFactor);
          // 从中心缩放
          const dx = (node.width - newWidth) / 2;
          const dy = (node.height - newHeight) / 2;
          return { 
            ...node, 
            x: node.x + dx, 
            y: node.y + dy, 
            width: newWidth, 
            height: newHeight 
          };
        }
        return node;
      });

      setNodes(newNodes, !shouldRecord);
      return;
    }

    // 没有选中节点时，缩放画布
    const zoomSensitivity = 0.001;
    const zoomDelta = -e.evt.deltaY * zoomSensitivity;
    const newScale = Math.min(Math.max(0.1, canvasState.scale + zoomDelta), 5);

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // 基于鼠标指针位置缩放
    const canvasX = (pointer.x - canvasState.offset.x) / canvasState.scale;
    const canvasY = (pointer.y - canvasState.offset.y) / canvasState.scale;

    const newOffsetX = pointer.x - canvasX * newScale;
    const newOffsetY = pointer.y - canvasY * newScale;

    setCanvasTransform({ x: newOffsetX, y: newOffsetY }, newScale);
  }, [nodes, selectedIds, canvasState, setNodes, setCanvasTransform, addToHistory]);

  return { handleWheel };
};
