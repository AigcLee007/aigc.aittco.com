import React, { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Line as KonvaLine, Rect, Text as KonvaText } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { NodeData, Point, Stroke, ToolMode } from '../types';
import { useCanvasStore } from '../src/store/canvasStore';

interface CanvasNodeProps {
  node: NodeData;
  isSelected: boolean;
  isInViewport: boolean;
  toolMode: ToolMode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onPointerDown?: (e: Konva.KonvaEventObject<PointerEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => void;
  onDoubleClick: () => void;
  onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

const DreamingPlaceholder: React.FC<{ width: number; height: number; progress: number; statusText: string }> = ({
  width,
  height,
  progress,
  statusText,
}) => {
  return (
    <Group>
      <Rect width={width} height={height} fill="#0f172a" cornerRadius={30} />
      <Rect
        width={width}
        height={height}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: height }}
        fillLinearGradientColorStops={[0, '#1e1b4b', 0.5, '#312e81', 1, '#1e1b4b']}
        opacity={0.6}
        cornerRadius={30}
      />

      <Rect x={width * 0.15} y={height / 2 + 50} width={width * 0.7} height={4} fill="#334155" cornerRadius={2} />
      <Rect
        x={width * 0.15}
        y={height / 2 + 50}
        width={width * 0.7 * (progress / 100)}
        height={4}
        fill="#c084fc"
        shadowColor="#a855f7"
        shadowBlur={15}
        cornerRadius={2}
      />

      <KonvaText
        x={0}
        y={height / 2 - 20}
        width={width}
        text={`${Math.floor(progress)}%`}
        fontSize={36}
        fontFamily="'Courier New', monospace"
        fontStyle="bold"
        fill="#e2e8f0"
        align="center"
        shadowColor="#c084fc"
        shadowBlur={10}
      />

      <KonvaText
        x={0}
        y={height / 2 + 25}
        width={width}
        text={statusText}
        fontSize={13}
        fontFamily="'Courier New', monospace"
        fill="#94a3b8"
        align="center"
        opacity={0.9}
      />
    </Group>
  );
};

const ErrorPlaceholder: React.FC<{ width: number; height: number; message: string }> = ({ width, height, message }) => {
  return (
    <Group>
      <Rect width={width} height={height} fill="#7f1d1d" opacity={0.3} cornerRadius={30} stroke="#dc2626" strokeWidth={1} />
      <KonvaText x={0} y={height / 2 - 28} width={width} text="X" fontSize={32} fill="#ef4444" align="center" />
      <KonvaText
        x={10}
        y={height / 2 + 16}
        width={width - 20}
        text={message || 'Failed'}
        fontSize={12}
        fontFamily="monospace"
        fill="#fca5a5"
        align="center"
      />
    </Group>
  );
};

const MaskLayer: React.FC<{ strokes: Stroke[] }> = ({ strokes }) => {
  if (!strokes.length) return null;
  return (
    <Group opacity={0.6} listening={false}>
      {strokes.map((stroke, idx) => (
        <KonvaLine
          key={idx}
          points={stroke.points.flatMap((p: Point) => [p.x, p.y])}
          stroke={stroke.color}
          strokeWidth={stroke.size}
          lineCap="round"
          lineJoin="round"
          tension={0.5}
        />
      ))}
    </Group>
  );
};

const DownloadingPlaceholder: React.FC<{
  width: number;
  height: number;
}> = ({ width, height }) => {
  return (
    <Group>
      <Rect width={width} height={height} fill="#1e293b" cornerRadius={30} />
      <Rect width={width} height={height} fill="#334155" opacity={0.3} cornerRadius={30} />

      <Rect
        x={width / 2 - 40}
        y={height / 2 - 60}
        width={80}
        height={80}
        fill="#0f172a"
        cornerRadius={20}
        shadowColor="#000"
        shadowBlur={10}
        shadowOpacity={0.5}
      />
      <KonvaText x={width / 2 - 20} y={height / 2 - 45} text="..." fontSize={32} fill="#3b82f6" align="center" />
      <KonvaText
        x={0}
        y={height / 2 + 40}
        width={width}
        text="Loading asset..."
        fontSize={14}
        fontFamily="'Courier New', monospace"
        fontStyle="bold"
        fill="#e2e8f0"
        align="center"
      />
    </Group>
  );
};

const ImageNode: React.FC<{ node: NodeData; progress: number; statusText: string; onLoad?: () => void }> = ({
  node,
  progress,
  statusText,
  onLoad,
}) => {
  const [source, setSource] = useState(node.src || '');
  const [image, status] = useImage(source, 'anonymous');

  useEffect(() => {
    setSource(node.src || '');
  }, [node.src]);

  const fallbackToRaw = () => {
    if (!source.startsWith('/api/proxy/image?url=')) return;
    try {
      const url = new URL(source, window.location.origin);
      const raw = url.searchParams.get('url');
      if (raw) {
        setSource(raw);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (image && onLoad) onLoad();
  }, [image, onLoad]);

  useEffect(() => {
    if (status === 'failed') {
      fallbackToRaw();
    }
  }, [status]);

  if (node.loading) {
    return <DreamingPlaceholder width={node.width} height={node.height} progress={progress} statusText={statusText} />;
  }
  if (node.error) {
    return <ErrorPlaceholder width={node.width} height={node.height} message={node.errorMessage || 'Failed'} />;
  }
  if (!image) {
    return <DownloadingPlaceholder width={node.width} height={node.height} />;
  }

  return (
    <Group
      clipFunc={(ctx) => {
        ctx.beginPath();
        ctx.roundRect(0, 0, node.width, node.height, 30);
        ctx.closePath();
      }}
    >
      <KonvaImage image={image} width={node.width} height={node.height} />
      {!!node.maskStrokes?.length && <MaskLayer strokes={node.maskStrokes} />}
    </Group>
  );
};

const VideoNode: React.FC<{ node: NodeData; progress: number; statusText: string; isInViewport: boolean }> = ({
  node,
  progress,
  statusText,
  isInViewport,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<Konva.Image>(null);
  const [videoImage, setVideoImage] = useState<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const updateNode = useCanvasStore((state) => state.updateNode);

  useEffect(() => {
    if (!node.src || node.type !== 'VIDEO') return;

    if (!videoRef.current) {
      const vid = document.createElement('video');
      vid.src = node.src;
      vid.crossOrigin = 'anonymous';
      vid.loop = true;
      vid.muted = true;

      vid.onloadedmetadata = () => {
        const videoWidth = vid.videoWidth;
        const videoHeight = vid.videoHeight;
        if (videoWidth && videoHeight) {
          const newHeight = node.width * (videoHeight / videoWidth);
          if (Math.abs(newHeight - node.height) > 1) {
            updateNode(node.id, { height: newHeight });
          }
        }
        vid.currentTime = 0.1;
      };

      videoRef.current = vid;
      setVideoImage(vid);
    } else if (videoRef.current.src !== node.src) {
      videoRef.current.src = node.src;
      setIsPlaying(false);
    }

    return () => {
      if (videoRef.current) videoRef.current.pause();
    };
  }, [node.src, node.width, node.height, node.id, node.type, updateNode]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (isPlaying && isInViewport) {
      vid.muted = isMuted;
      vid.play().catch(() => setIsPlaying(false));
    } else {
      vid.pause();
    }
  }, [isPlaying, isMuted, isInViewport]);

  useEffect(() => {
    if (!videoImage || !isPlaying || !imageRef.current) return;
    const anim = new Konva.Animation(() => {}, imageRef.current.getLayer());
    anim.start();
    return () => {
      anim.stop();
    };
  }, [videoImage, isPlaying]);

  const togglePlay = () => setIsPlaying((prev) => !prev);
  const toggleMute = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    setIsMuted((prev) => !prev);
  };

  if (node.loading) {
    return <DreamingPlaceholder width={node.width} height={node.height} progress={progress} statusText={statusText || 'Generating video...'} />;
  }
  if (node.error) {
    return <ErrorPlaceholder width={node.width} height={node.height} message={node.errorMessage || 'Failed'} />;
  }
  if (!videoImage) {
    return <Rect width={node.width} height={node.height} fill="#000" cornerRadius={30} />;
  }

  return (
    <Group>
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath();
          ctx.roundRect(0, 0, node.width, node.height, 30);
          ctx.closePath();
        }}
        onClick={togglePlay}
        onTap={togglePlay as any}
      >
        <KonvaImage ref={imageRef} image={videoImage} width={node.width} height={node.height} />
      </Group>

      {!isPlaying && (
        <Group x={node.width / 2 - 25} y={node.height / 2 - 25} onClick={togglePlay} onTap={togglePlay as any}>
          <Rect width={50} height={50} fill="rgba(0,0,0,0.6)" cornerRadius={25} />
          <KonvaText text=">" x={18} y={15} fontSize={24} fill="#fff" listening={false} />
        </Group>
      )}

      <Group x={node.width - 40} y={node.height - 40} onClick={toggleMute} onTap={toggleMute as any}>
        <Rect width={32} height={32} fill="rgba(0,0,0,0.5)" cornerRadius={4} />
        <KonvaText text={isMuted ? 'M' : 'S'} x={9} y={8} fontSize={14} fill="#fff" listening={false} />
      </Group>
    </Group>
  );
};

const getProgressText = (progress: number): string => {
  if (progress < 20) return 'Analyzing prompt...';
  if (progress < 40) return 'Building composition...';
  if (progress < 60) return 'Rendering details...';
  if (progress < 80) return 'Refining colors...';
  return 'Final polish...';
};

const CanvasNode: React.FC<CanvasNodeProps> = React.memo(
  ({ node, isSelected, isInViewport, toolMode, onClick, onPointerDown, onDragStart, onDragEnd, onContextMenu, onDoubleClick, onMouseEnter, onMouseLeave }) => {
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('Initializing...');
    const [isResourceLoaded, setIsResourceLoaded] = useState(false);
    const groupRef = useRef<Konva.Group>(null);

    useEffect(() => {
      // Source swap (remote URL -> cached blob URL) must invalidate cache readiness.
      setIsResourceLoaded(false);
    }, [node.id, node.src]);

    useEffect(() => {
      if (!node.loading) {
        setProgress(0);
        return;
      }

      const startTime = Date.now();
      const duration = 70000;
      setProgress(1);
      setStatusText(getProgressText(1));

      const interval = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        let p = 0;

        if (elapsed < duration) {
          p = (elapsed / duration) * 90;
        } else {
          const extraTime = elapsed - duration;
          p = 90 + (1 - Math.exp(-extraTime / 20000)) * 9;
        }

        p = Math.min(p, 99);
        setProgress(p);
        setStatusText(getProgressText(p));
      }, 100);

      return () => window.clearInterval(interval);
    }, [node.loading, node.id]);

    useEffect(() => {
      if (!groupRef.current) return;
      const group = groupRef.current;
      // Always invalidate stale cache first, especially after src swaps.
      group.clearCache();

      const isQuiet = !isSelected && !node.loading && !node.dragging && isResourceLoaded;
      if (!(isQuiet && node.type === 'IMAGE')) {
        group.getLayer()?.batchDraw();
        return undefined;
      }

      const timer = window.setTimeout(() => {
        if (!groupRef.current) return;
        // Rebuild scene+hit cache with deterministic ratio to keep hit-test stable.
        groupRef.current.cache({ pixelRatio: 1, hitCanvasPixelRatio: 1 });
        groupRef.current.getLayer()?.batchDraw();
      }, 120);

      return () => window.clearTimeout(timer);
    }, [
      isSelected,
      node.loading,
      node.dragging,
      node.type,
      isInViewport,
      isResourceLoaded,
      node.src,
      node.error,
      node.width,
      node.height,
      node.maskStrokes?.length,
    ]);

    const isDraggable = !node.locked && toolMode === ToolMode.SELECT;
    const statusWithTask = node.loading && node.taskId ? `${statusText} #${node.taskId.slice(-6)}` : statusText;

    return (
      <Group
        id={`node-${node.id}`}
        ref={groupRef}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        draggable={isDraggable}
        opacity={node.opacity ?? 1}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onTap={(e) => onClick(e as unknown as Konva.KonvaEventObject<MouseEvent>)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onContextMenu={onContextMenu}
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
        hitStrokeWidth={0}
      >
        {/* Stable hit area to prevent temporary unclickable nodes during asset swaps/caching. */}
        <Rect
          width={node.width}
          height={node.height}
          cornerRadius={30}
          fill="rgba(0,0,0,0.01)"
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />

        {node.type === 'VIDEO' ? (
          <VideoNode node={node} progress={progress} statusText={statusWithTask} isInViewport={isInViewport} />
        ) : (
          <ImageNode node={node} progress={progress} statusText={statusWithTask} onLoad={() => setIsResourceLoaded(true)} />
        )}

        {isSelected && (
          <Rect
            width={node.width}
            height={node.height}
            stroke="#3b82f6"
            strokeWidth={2}
            dash={[5, 5]}
            cornerRadius={30}
            listening={false}
            perfectDrawEnabled={false}
            shadowForStrokeEnabled={false}
          />
        )}

        {node.locked && (
          <Group x={node.width - 24} y={4}>
            <Rect width={20} height={20} fill="rgba(0,0,0,0.5)" cornerRadius={10} perfectDrawEnabled={false} />
            <KonvaText x={7} y={3} text="L" fontSize={11} fill="#fff" perfectDrawEnabled={false} />
          </Group>
        )}
      </Group>
    );
  },
);

export default CanvasNode;
