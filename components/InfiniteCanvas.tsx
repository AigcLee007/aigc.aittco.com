import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Group, Line, Transformer, Rect } from 'react-konva';
import Konva from 'konva';
import { NodeData, Point, ToolMode } from '../types';
import { useCanvasStore } from '../src/store/canvasStore';
import { useSelectionStore } from '../src/store/selectionStore';
import { useZoom } from '../src/hooks/useZoom';
import { useCanvasInteraction } from '../src/hooks/useCanvasInteraction';
import { useViewportCulling } from '../src/hooks/useViewportCulling';
import { isLowEndDevice } from '../src/utils/performance';
import CanvasNode from './CanvasNode';
import { RefreshCw } from 'lucide-react';

const SmartTooltip: React.FC<{ node: NodeData; x: number; y: number }> = ({ node, x, y }) => {
  if (!node) return null;
  const isVideo = node.type === 'VIDEO';
  return (
    <div
      className="fixed pointer-events-none z-100 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-opacity duration-200 animate-in fade-in zoom-in-95"
      style={{
        left: x + 20,
        top: y + 20,
        width: '240px'
      }}
    >
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
        {node.loading ? (
             <RefreshCw className="animate-spin text-blue-400" size={12} />
        ) : (
            node.error ? <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div> : <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
        )}
        <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest flex-1">
           {node.loading ? `生成中 ${Math.round(node.progress || 0)}%` : (isVideo ? 'AI VIDEO' : 'AI IMAGE')}
        </span>
      </div>
      
      {node.loading && (
          <div className="mb-2">
             <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-linear-to-r from-blue-600 to-purple-600 transition-all duration-300 ease-out" style={{ width: `${node.progress || 0}%` }} />
             </div>
             <div className="text-[10px] text-blue-300 mt-1.5 font-mono">{node.type === 'VIDEO' ? "Rendering frames..." : "Denoising..."}</div>
          </div>
      )}

      {node.prompt && (
         <div className="text-xs text-gray-400 line-clamp-4 leading-relaxed font-medium">
           {node.prompt}
         </div>
      )}
      
      {node.error && node.errorMessage && (
         <div className="text-xs text-red-300 mt-2 bg-red-500/10 p-2 rounded border border-red-500/20">
           {node.errorMessage}
         </div>
      )}
    </div>
  );
};

interface InfiniteCanvasProps {
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onNodeDoubleClick?: (node: NodeData) => void;
  onCanvasPointerDown?: (e: React.PointerEvent, canvasPos: Point) => void;
}

const InfiniteCanvas: React.FC<InfiniteCanvasProps> = ({
  onContextMenu,
  onNodeDoubleClick,
  onCanvasPointerDown
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDrawingMask, setIsDrawingMask] = useState(false);

  // Store state
  const { nodes, canvasState, updateNode, moveNode } = useCanvasStore();
  const { selectedIds, select, toolMode, setToolMode, addReferenceImage, showTooltips, brushSize, brushColor } = useSelectionStore();
  const selectedNodeIds = new Set(selectedIds);

  // Custom hooks
  const { handleWheel } = useZoom();
  const { onMouseDown, onMouseMove, onMouseUp, selectionBox } = useCanvasInteraction({
    onCanvasPointerDown
  });
  const lowEndMode = useMemo(() => isLowEndDevice(), []);
  
  // Virtualization Hook - Expand buffer for smoother panning
  // We keep a larger set of nodes in the React tree (renderedNodes)
  // but we detect the exact viewport (isInViewport) for precise optimization
  const RENDER_BUFFER = lowEndMode ? 900 : 2000; 
  const renderedNodes = useViewportCulling({
    nodes,
    canvasState,
    stageSize,
    buffer: RENDER_BUFFER
  });

  // Calculate the exact viewport in canvas coordinates for per-node optimization (pause/cache)
  const viewportX = -canvasState.offset.x / canvasState.scale;
  const viewportY = -canvasState.offset.y / canvasState.scale;
  const viewportW = stageSize.width / canvasState.scale;
  const viewportH = stageSize.height / canvasState.scale;

  // Snapshot ref for undo
  const startInteractionNodesRef = useRef<NodeData[]>([]);

  const pendingMaskPointRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  const maskFrameRef = useRef<number | null>(null);

  const clampMaskPoint = useCallback((node: NodeData, x: number, y: number) => {
    return {
      x: Math.min(Math.max(0, x), node.width),
      y: Math.min(Math.max(0, y), node.height),
    };
  }, []);

  const scheduleMaskStrokeAppend = useCallback((nodeId: string, x: number, y: number) => {
    pendingMaskPointRef.current = { nodeId, x, y };
    if (maskFrameRef.current !== null) return;

    maskFrameRef.current = window.requestAnimationFrame(() => {
      maskFrameRef.current = null;
      const point = pendingMaskPointRef.current;
      if (!point) return;
      pendingMaskPointRef.current = null;

      const latestNode = useCanvasStore.getState().nodes.find((n) => n.id === point.nodeId);
      if (!latestNode?.maskStrokes?.length) return;

      const newStrokes = [...latestNode.maskStrokes];
      const lastStroke = { ...newStrokes[newStrokes.length - 1] };
      lastStroke.points = [...lastStroke.points, { x: point.x, y: point.y }];
      newStrokes[newStrokes.length - 1] = lastStroke;
      updateNode(point.nodeId, { maskStrokes: newStrokes });
    });
  }, [updateNode]);

  const handleNodeMouseEnter = useCallback((e: Konva.KonvaEventObject<MouseEvent>, node: NodeData) => {
    if (lowEndMode) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'pointer';
    
    setHoveredNode(node);
    setHoverPosition({ x: e.evt.clientX, y: e.evt.clientY });
  }, [lowEndMode]);

  const handleNodeMouseLeave = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
    
    setHoveredNode(null);
    setHoverPosition(null);
  }, []);

  // Update hover pos on move relative to viewport
  useEffect(() => {
     if(hoveredNode) {
        const handleGlobalMove = (e: MouseEvent) => {
            setHoverPosition({ x: e.clientX, y: e.clientY });
        }
        window.addEventListener('mousemove', handleGlobalMove);
        return () => window.removeEventListener('mousemove', handleGlobalMove);
     }
  }, [hoveredNode]);

  // Resize stage on window resize
  useEffect(() => {
    const handleResize = () => {
      setStageSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    const stage = stageRef.current;
    const selectedNodes: Konva.Node[] = [];

    selectedNodeIds.forEach(id => {
      // Need to find node. But if node is virtualized out, findOne might return null?
      // Yes, if node is not rendered, transformer won't attach.
      // Transformer logic needs to handle invisible nodes gracefully.
      const node = stage.findOne(`#node-${id}`);
      if (node) selectedNodes.push(node);
    });

    transformerRef.current.nodes(selectedNodes);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedNodeIds, nodes, renderedNodes]); // Depend on renderedNodes so transformer updates on scroll

  // ==================== Node Event Handlers ====================
  const handleNodeClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>, node: NodeData) => {
    e.cancelBubble = true;

    // Always switch to SELECT mode when clicking a node ONLY if not in special modes like INPAINT/GENERATE
    if (toolMode !== ToolMode.SELECT && toolMode !== ToolMode.INPAINT && toolMode !== ToolMode.GENERATE) {
      setToolMode(ToolMode.SELECT);
    }

    const isMulti = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    select(node.id, isMulti);
  }, [toolMode, setToolMode, select]);

  const handleNodePointerDown = useCallback((e: Konva.KonvaEventObject<PointerEvent>, node: NodeData) => {
    if (toolMode === ToolMode.INPAINT) {
        e.cancelBubble = true;
        
        if (!selectedIds.includes(node.id)) {
            select(node.id, false);
        }

        setIsDrawingMask(true);
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer) {
            const localX = (pointer.x - canvasState.offset.x) / canvasState.scale - node.x;
            const localY = (pointer.y - canvasState.offset.y) / canvasState.scale - node.y;
            const clamped = clampMaskPoint(node, localX, localY);
            
            const newStrokes = [...(node.maskStrokes || []), { points: [{ x: clamped.x, y: clamped.y }], size: brushSize, color: brushColor }];
            updateNode(node.id, { maskStrokes: newStrokes });
        }
    }
  }, [toolMode, selectedIds, select, canvasState, updateNode, brushSize, brushColor, clampMaskPoint]);

  const handleNodeDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>, node: NodeData) => {
    if (node.locked) {
      e.target.stopDrag();
      return;
    }
    startInteractionNodesRef.current = nodes;
    // Set dragging state to optimize performance (disable cache)
    updateNode(node.id, { dragging: true });
  }, [nodes, updateNode]);

  const handleNodeDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>, node: NodeData) => {
    const newX = e.target.x();
    const newY = e.target.y();

    // Check for drop on Control Panel Reference Zone
    const nativeEvt = e.evt;
    if (nativeEvt) {
      const elem = document.elementFromPoint(nativeEvt.clientX, nativeEvt.clientY);
      const dropZone = elem?.closest('#reference-drop-zone');
      
      if (dropZone && node.src && (node.type === 'IMAGE' || node.type === 'VIDEO')) {
          addReferenceImage(node.src);
      }
    }

    // Use moveNode command to register history properly
    const startNode = startInteractionNodesRef.current.find(n => n.id === node.id);
    if (startNode) {
       const dx = newX - startNode.x;
       const dy = newY - startNode.y;
       
       if (node.groupId) {
           // Move all nodes in the same group by the delta
           const groupNodes = startInteractionNodesRef.current.filter(n => n.groupId === node.groupId);
           groupNodes.forEach(gn => {
               if (gn.id === node.id) {
                   moveNode(gn.id, { x: startNode.x, y: startNode.y }, { x: newX, y: newY });
               } else {
                   const gnNewX = gn.x + dx;
                   const gnNewY = gn.y + dy;
                   moveNode(gn.id, { x: gn.x, y: gn.y }, { x: gnNewX, y: gnNewY });
               }
           });
       } else {
           moveNode(node.id, { x: startNode.x, y: startNode.y }, { x: newX, y: newY });
       }
    } else {
       // Fallback if not found
       updateNode(node.id, { x: newX, y: newY, dragging: false });
    }
    
    // Ensure dragging is reset even if moveNode is used
    updateNode(node.id, { dragging: false });
  }, [nodes, moveNode, updateNode]);

  const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    // node-id -> id
    const nodeId = node.id().replace('node-', '');

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    // This updateNode will trigger a command (skipHistory=false by default)
    updateNode(nodeId, {
      x: node.x(),
      y: node.y(),
      width: Math.max(20, node.width() * scaleX),
      height: Math.max(20, node.height() * scaleY),
    });
  }, [updateNode]);

  const handleContextMenuEvent = useCallback((e: Konva.KonvaEventObject<PointerEvent>, node: NodeData) => {
    e.evt.preventDefault();
    const syntheticEvent = {
      preventDefault: () => { },
      clientX: e.evt.clientX,
      clientY: e.evt.clientY,
    } as React.MouseEvent;
    onContextMenu(syntheticEvent, node.id);
  }, [onContextMenu]);

  const handleNodeDoubleClickEvent = useCallback((node: NodeData) => {
    if (onNodeDoubleClick) {
      onNodeDoubleClick(node);
    }
  }, [onNodeDoubleClick]);

  // Get cursor style based on tool mode
  const getCursorStyle = () => {
    switch (toolMode) {
      case ToolMode.PAN: return 'grab';
      case ToolMode.GENERATE: return 'crosshair';
      case ToolMode.INPAINT: return 'crosshair';
      default: return 'default';
    }
  };

  // Handle stage mouse up
  const handleStageMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDrawingMask) {
        setIsDrawingMask(false);
    }
    pendingMaskPointRef.current = null;
    onMouseUp(e);
  }, [isDrawingMask, onMouseUp]);

  useEffect(() => {
    return () => {
      if (maskFrameRef.current !== null) {
        window.cancelAnimationFrame(maskFrameRef.current);
      }
      maskFrameRef.current = null;
      pendingMaskPointRef.current = null;
    };
  }, []);

  // Handle touch events for pinch zoom
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastDistRef = useRef<number>(0);

  const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  const getCenter = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
  };

  const handleTouchStart = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault();
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    if (touch1 && touch2) {
      // Logic for 2 fingers
      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };

      lastCenterRef.current = getCenter(p1, p2);
      lastDistRef.current = getDistance(p1, p2);
    } else {
      // Single touch - fallback to mouse handlers via simple forwarding if needed, 
      // but Konva usually handles single touch as click/drag.
      onMouseDown(e as any);
    }
  }, [onMouseDown]);

  const handleTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    e.evt.preventDefault(); // Prevent scrolling
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    if (touch1 && touch2) {
       // Pinch Zoom Logic
       const stage = stageRef.current;
       if (!stage) return;

       const p1 = { x: touch1.clientX, y: touch1.clientY };
       const p2 = { x: touch2.clientX, y: touch2.clientY };

       if (!lastCenterRef.current || lastDistRef.current === 0) {
          return;
       }

       const newCenter = getCenter(p1, p2);
       const newDist = getDistance(p1, p2);

       const pointTo = {
         x: (newCenter.x - canvasState.offset.x) / canvasState.scale,
         y: (newCenter.y - canvasState.offset.y) / canvasState.scale,
       };

       const scaleBy = newDist / lastDistRef.current;
       const newScale = Math.min(Math.max(0.1, canvasState.scale * scaleBy), 10);

       // Calculate new offset
       const dx = newCenter.x - lastCenterRef.current.x;
       const dy = newCenter.y - lastCenterRef.current.y;

       const newPos = {
         x: newCenter.x - pointTo.x * newScale + dx,
         y: newCenter.y - pointTo.y * newScale + dy,
       };

       // Update Store
       useCanvasStore.getState().setCanvasTransform(newPos, newScale);

       lastDistRef.current = newDist;
       lastCenterRef.current = newCenter;
       
    } else {
       // Single touch move
       onMouseMove(e as any);
    }
  }, [canvasState, onMouseMove]);

  const handleTouchEnd = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    lastDistRef.current = 0;
    lastCenterRef.current = null;
    onMouseUp(e as any);
  }, [onMouseUp]);


  // Handle mouse move for hover detection and Inpainting
  const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDrawingMask && toolMode === ToolMode.INPAINT && selectedIds.length === 1) {
        const nodeId = selectedIds[0];
        const node = nodes.find(n => n.id === nodeId);
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        
        if (node && pointer) {
            const localX = (pointer.x - canvasState.offset.x) / canvasState.scale - node.x;
            const localY = (pointer.y - canvasState.offset.y) / canvasState.scale - node.y;
            const clamped = clampMaskPoint(node, localX, localY);
            scheduleMaskStrokeAppend(nodeId, clamped.x, clamped.y);
        }
        return;
    }
    onMouseMove(e);
  }, [isDrawingMask, toolMode, selectedIds, nodes, canvasState, onMouseMove, clampMaskPoint, scheduleMaskStrokeAppend]);

  // ==================== Render ====================
  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative canvas-bg"
      style={{ cursor: getCursorStyle(), touchAction: 'none' }}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onWheel={handleWheel}
        onMouseDown={onMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseLeave={handleStageMouseUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer>
          {/* Background for click detection */}
          <Line
            name="background"
            points={[0, 0, stageSize.width, 0, stageSize.width, stageSize.height, 0, stageSize.height]}
            closed
            fill="transparent"
          />

          {/* Main content group with transform */}
          <Group
            x={canvasState.offset.x}
            y={canvasState.offset.y}
            scaleX={canvasState.scale}
            scaleY={canvasState.scale}
          >
            {/* Render Contextualized Nodes */}
            {renderedNodes.map(node => {
              const isInViewport = (
                node.x + node.width > viewportX &&
                node.x < viewportX + viewportW &&
                node.y + node.height > viewportY &&
                node.y < viewportY + viewportH
              );

              return (
                <CanvasNode
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeIds.has(node.id)}
                  isInViewport={isInViewport} // NEW PROP
                  toolMode={toolMode}
                  onClick={(e) => handleNodeClick(e, node)}
                  onPointerDown={(e) => handleNodePointerDown(e, node as NodeData)}
                  onDragStart={(e) => handleNodeDragStart(e, node)}
                  onDragEnd={(e) => handleNodeDragEnd(e, node)}
                  onContextMenu={(e) => handleContextMenuEvent(e, node)}
                  onDoubleClick={() => handleNodeDoubleClickEvent(node)}
                  onMouseEnter={(e) => handleNodeMouseEnter(e, node)}
                  onMouseLeave={handleNodeMouseLeave}
                />
              );
            })}

          </Group>

          {/* Transformer for selected nodes */}
          <Transformer
            ref={transformerRef}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 20 || newBox.height < 20) {
                return oldBox;
              }
              return newBox;
            }}
            onTransformStart={() => {
              startInteractionNodesRef.current = nodes;
            }}
            onTransformEnd={handleTransformEnd}
            rotateEnabled={false}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            anchorSize={10}
            anchorCornerRadius={5}
            borderStroke="#3b82f6"
            anchorStroke="#3b82f6"
            anchorFill="#ffffff"
          />

          {/* Selection Box */}
          {selectionBox && (
            <Rect
              x={Math.min(selectionBox.x1, selectionBox.x2)}
              y={Math.min(selectionBox.y1, selectionBox.y2)}
              width={Math.abs(selectionBox.x1 - selectionBox.x2)}
              height={Math.abs(selectionBox.y1 - selectionBox.y2)}
              fill="rgba(168, 85, 247, 0.15)"
              stroke="#A855F7"
              strokeWidth={1.5}
              dash={[4, 4]}
              listening={false}
            />
          )}

        </Layer>
      </Stage>

      {/* Smart Tooltip Overlay */}
  {showTooltips && !lowEndMode && hoveredNode && hoverPosition && (
        <SmartTooltip node={hoveredNode} x={hoverPosition.x} y={hoverPosition.y} />
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 bg-gray-900/80 text-white px-3 py-1 rounded text-sm pointer-events-none backdrop-blur-sm z-50">
        Zoom: {Math.round(canvasState.scale * 100)}%
      </div>
    </div>
  );
};

export default InfiniteCanvas;
