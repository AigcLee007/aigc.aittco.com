
export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  size: number;
  color: string;
}

export type NodeType = 'IMAGE' | 'VIDEO';

export interface HistoryItem {
  src: string;
  prompt?: string;
}

export interface NodeData {
  id: string;
  type: NodeType;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  locked?: boolean;

  // Image/Video specific
  src?: string; // Video URL for video nodes
  thumbnailSrc?: string;
  assetId?: string; // ID for Blob storage (IndexedDB)
  prompt?: string;
  createdAt?: string; // ISO timestamp for generated/imported asset display

  // Video specific
  videoModel?: string;
  videoAspectRatio?: string; // "16:9" | "9:16"
  videoHd?: boolean;
  videoDuration?: string; // "10" | "15" | "25"

  // Loading / Error States for async generation
  taskId?: string; // Task ID for polling
  loading?: boolean;
  progress?: number; // Real-time generation progress (0-100)
  error?: boolean;
  errorMessage?: string;

  // Grouping
  groupId?: string;

  // Selection / Dragging
  dragging?: boolean;
  
  // Inpainting Masks (Strokes)
  maskStrokes?: Stroke[];
  
  // Image History
  history?: HistoryItem[];
  historyIndex?: number;

  // Derived image-edit results
  sourceNodeId?: string;
}

export enum ToolMode {
  PAN = 'PAN',
  SELECT = 'SELECT',
  GENERATE = 'GENERATE',
  VIDEO = 'VIDEO',
  INPAINT = 'INPAINT',
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  ERROR = 'ERROR',
}

export interface CanvasState {
  offset: Point;
  scale: number;
}
