// The same browser module is loaded by classic HTML and bundled into canvas.
import '../../public/shared/local-folder-save.js';

export type LocalFolderState = 'granted' | 'prompt' | 'denied' | 'none' | 'unsupported';
export interface LocalFolderSaveApi {
  supported: boolean;
  getStatus(): Promise<{ state: LocalFolderState; name: string }>;
  chooseFolder(): Promise<string>;
  forgetFolder(): Promise<void>;
  requestAccess(): Promise<boolean>;
  saveBlob(blob: Blob, name: string): Promise<string | null>;
  subscribe(listener: () => void): () => void;
}

export const localFolderSave = (globalThis as unknown as { LocalFolderSave: LocalFolderSaveApi }).LocalFolderSave;
export const saveToLocalFolder = (blob: Blob, name: string) => localFolderSave.saveBlob(blob, name);
