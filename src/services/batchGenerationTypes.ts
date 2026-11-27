export type BatchMode = 't2i' | 'i2i';

export type BatchGenerationStatus = 'draft' | 'running' | 'paused' | 'completed';

export type BatchTaskStatus =
  | 'pending'
  | 'submitting'
  | 'awaiting-confirmation'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface BatchGenerationSettings {
  modelId: string;
  routeId: string;
  aspectRatio: string;
  imageSize: string;
  outputCount: number;
  concurrency: 1 | 3 | 6;
  autoDownload: boolean;
}

export interface BatchInputGroup {
  id: string;
  prompt: string;
  referenceAssetIds: string[];
  outputCount: number;
  enabled: boolean;
}

export interface BatchGenerationTask {
  id: string;
  groupId: string;
  prompt: string;
  referenceAssetIds: string[];
  outputIndex: number;
  requestId: string;
  nodeId?: string;
  serverTaskId?: string;
  status: BatchTaskStatus;
  progress?: number;
  resultUrl?: string;
  resultUrls?: string[];
  error?: string;
}

export interface BatchGenerationRecord {
  id: string;
  ownerId: string;
  schemaVersion: 1;
  title: string;
  mode: BatchMode;
  status: BatchGenerationStatus;
  settings: BatchGenerationSettings;
  groups: BatchInputGroup[];
  tasks: BatchGenerationTask[];
  createdAt: number;
  updatedAt: number;
}
