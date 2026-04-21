import { useMemo } from 'react';
import { NodeData, CanvasState } from '../../types';

interface ViewportCullingOptions {
  nodes: NodeData[];
  canvasState: CanvasState;
  stageSize: { width: number; height: number };
  buffer?: number;
}

/**
 * Filters nodes to returns only those currently visible in the viewport (plus a buffer)
 */
export const useViewportCulling = ({
  nodes,
  canvasState,
  stageSize,
  buffer = 500
}: ViewportCullingOptions) => {
  const visibleNodes = useMemo(() => {
    // Calculate the visible viewport in canvas coordinates
    // Canvas transform: screenX = x * scale + offset.x
    // Inverse: x = (screenX - offset.x) / scale
    
    const viewportX = -canvasState.offset.x / canvasState.scale;
    const viewportY = -canvasState.offset.y / canvasState.scale;
    const viewportW = stageSize.width / canvasState.scale;
    const viewportH = stageSize.height / canvasState.scale;

    return nodes.filter(node => {
      // Simple AABB intersection test
      return (
        node.x + node.width > viewportX - buffer &&
        node.x < viewportX + viewportW + buffer &&
        node.y + node.height > viewportY - buffer &&
        node.y < viewportY + viewportH + buffer
      );
    });
  }, [nodes, canvasState, stageSize, buffer]);

  return visibleNodes;
};
