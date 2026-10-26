
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
export type GenerationProgressSource = 'reported' | 'estimated';
export type GenerationProgressCallback = (progress: number, source?: GenerationProgressSource, status?: string) => void;
export type NodeGenerationProgressCallback = (id: string, progress: number, source?: GenerationProgressSource, status?: string) => void;

export interface HistoryItem {
  src: string;
  assetId?: string;
  thumbnailSrc?: string;
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
  fastDownloadSrc?: string; // Smaller JPEG copy of a server-saved original
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
  clientRequestId?: string;
  generationOwnerId?: string;
  generationStartedAt?: number;
  generationConnectionStatus?: 'recovering' | 'unconfirmed' | 'result-unavailable';
  generationStorageStatus?: 'pending' | 'saved' | 'failed';
  generationResultIndex?: number;
  generationResultSrc?: string;
  loading?: boolean;
  progress?: number; // Real-time generation progress (0-100)
  progressSource?: GenerationProgressSource;
  generationStatus?: string; // Last confirmed upstream task status.
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
  // Set on an upscale result: which engine made it and the source node it can be compared with.
  upscaleOf?: { sourceNodeId: string; engineLabel: string; factor: number };
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
