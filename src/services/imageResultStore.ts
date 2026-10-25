// The same browser module is loaded by classic HTML and bundled into canvas.
import '../../public/shared/image-result-store.js';

export type ImageStorageMode = 'standard' | 'fast';
export interface ImageStorageSummary {
  originalBytes: number; previewBytes: number; results: number; cachedOriginals: number;
  budgetBytes: number; previewBudgetBytes: number;
  usage: number | null; quota: number | null; persisted: boolean | null;
}
export interface ImageResultIdentity { ownerId: string; jobId: string; outputIndex?: number }
export interface ImageResultInput extends ImageResultIdentity {
  originalUrl?: string; previewUrl?: string; createdAt?: number;
  cloudExpiresAt?: number; cloudBacked?: boolean; storageStatus?: string;
  legacyClassicId?: string;
}
export interface ImageResultInfo extends ImageResultInput {
  id: string; outputIndex: number; createdAt: number; updatedAt: number;
  originalBytes?: number; previewBytes?: number; width?: number; height?: number; previewVersion?: number;
  cacheError?: string | null; download?: { state: 'claimed' | 'started'; token: string; claimant: string; claimedAt: number; startedAt?: number };
}
export interface ImageResultState extends ImageResultInfo { originalCached: boolean; previewCached: boolean; downloadState: 'claimed' | 'started' | null }
export interface ImageResultStore {
  resultId(ownerId: string, jobId: string, outputIndex?: number): string;
  register(input: ImageResultInput): Promise<ImageResultInfo>;
  find(ownerId: string, source: string): Promise<ImageResultInfo | undefined>;
  getOriginal(id: string): Promise<Blob | undefined>;
  getPreview(id: string): Promise<Blob | undefined>;
  putOriginal(id: string, blob: Blob, metadata?: Partial<ImageResultInfo>): Promise<ImageResultState>;
  putPreview(id: string, blob: Blob, metadata?: Partial<ImageResultInfo>): Promise<ImageResultState>;
  getState(id: string): Promise<ImageResultState>;
  adoptLegacy(id: string, legacyAssetId: string, confirmedOwnerId: string): Promise<boolean>;
  linkLegacySource(id: string, confirmedOwnerId: string): Promise<void>;
  claimDownload(id: string, claimant?: string): Promise<string | null>;
  markDownloadStarted(id: string, token: string): Promise<boolean>;
  pin(id: string): () => void;
  getAutoDownloadPreference(fallback?: boolean): boolean;
  setAutoDownloadPreference(enabled: boolean): void;
  getStorageModePreference(): ImageStorageMode;
  setStorageModePreference(mode: ImageStorageMode): void;
  prepareStorage(): Promise<{ persisted: boolean; budgetBytes: number; previewBudgetBytes: number }>;
  getStorageSummary(): Promise<ImageStorageSummary>;
  close(): void;
}
type ResultStoreFactory = ImageResultStore & { createStore(options?: { budgetBytes?: number; previewBudgetBytes?: number; timeoutMs?: number; indexedDB?: IDBFactory }): ImageResultStore };
export const imageResultStore = (globalThis as unknown as { ImageResultStore: ResultStoreFactory }).ImageResultStore;
export const createImageResultStore = imageResultStore.createStore;
