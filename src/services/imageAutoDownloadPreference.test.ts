import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { imageResultStore } from './imageResultStore';
import { useSelectionStore } from '../store/selectionStore';
beforeEach(()=>{localStorage.clear();});
it('preserves a disabled persisted canvas setting on first shared preference migration',async()=>{
  localStorage.setItem('selection-storage',JSON.stringify({state:{autoDownloadOnSuccess:false},version:0}));
  await useSelectionStore.persist.rehydrate();
  expect(useSelectionStore.getState().autoDownloadOnSuccess).toBe(false);
  expect(localStorage.getItem('image-auto-download-v1')).toBe('false');
});
it('syncs the canvas toggle and an already-open classic preference change both ways',()=>{
  useSelectionStore.getState().setAutoDownloadOnSuccess(true);
  expect(imageResultStore.getAutoDownloadPreference(false)).toBe(true);
  imageResultStore.setAutoDownloadPreference(false);
  expect(useSelectionStore.getState().autoDownloadOnSuccess).toBe(false);
});
