// Saves finished originals into a folder the user picked (File System Access
// API, Chrome / Edge desktop). The folder handle is kept in IndexedDB so the
// choice survives reloads; the browser asks again for permission when needed.
// Where the API is missing the module reports unsupported and callers keep
// using normal downloads.
(function (root) {
  'use strict';
  if (root.LocalFolderSave) return;
  const DB_NAME = 'local-folder-save-v1', STORE = 'handles', KEY = 'target';
  const supported = typeof root.showDirectoryPicker === 'function' && root.isSecureContext !== false;
  const listeners = new Set();
  let cached; // { handle, name } | null, undefined until first read

  function db() {
    return new Promise((resolve, reject) => {
      const open = root.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  async function idb(mode, run) {
    const conn = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = conn.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { conn.close(); }
  }
  async function readTarget() {
    if (cached !== undefined) return cached;
    try { const value = await idb('readonly', store => store.get(KEY)); cached = value?.handle ? value : null; }
    catch { cached = null; }
    return cached;
  }
  const notify = () => listeners.forEach(fn => { try { fn(); } catch {} });

  // 'granted' | 'prompt' | 'denied' | 'none' (no folder chosen) | 'unsupported'
  async function getStatus() {
    if (!supported) return { state: 'unsupported', name: '' };
    const target = await readTarget();
    if (!target) return { state: 'none', name: '' };
    let state = 'prompt';
    try { state = await target.handle.queryPermission({ mode: 'readwrite' }); } catch {}
    return { state, name: target.name || target.handle.name || '' };
  }

  // Must run from a user gesture (click).
  async function chooseFolder() {
    if (!supported) throw new Error('当前浏览器不支持选择保存文件夹，请使用 Chrome 或 Edge 桌面版');
    const handle = await root.showDirectoryPicker({ id: 'image-results', mode: 'readwrite' });
    cached = { handle, name: handle.name };
    await idb('readwrite', store => store.put(cached, KEY));
    notify();
    return cached.name;
  }
  async function forgetFolder() {
    cached = null;
    try { await idb('readwrite', store => store.delete(KEY)); } catch {}
    notify();
  }
  // Re-grant after a reload; needs a user gesture.
  async function requestAccess() {
    const target = await readTarget();
    if (!target) return false;
    const state = await target.handle.requestPermission({ mode: 'readwrite' });
    notify();
    return state === 'granted';
  }

  const safeName = name => String(name || 'image.png').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'image.png';
  async function uniqueName(dir, name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 0; i < 50; i++) {
      const candidate = i ? `${base} (${i})${ext}` : name;
      try { await dir.getFileHandle(candidate); } catch (error) { if (error?.name === 'NotFoundError') return candidate; throw error; }
    }
    return `${base}-${Date.now()}${ext}`;
  }

  // Writes without prompting. Returns the saved file name, or null when no
  // folder is chosen or permission is not currently granted (caller falls
  // back to a normal download).
  async function saveBlob(blob, name) {
    if (!supported || !blob) return null;
    const target = await readTarget();
    if (!target) return null;
    let state = 'prompt';
    try { state = await target.handle.queryPermission({ mode: 'readwrite' }); } catch {}
    if (state !== 'granted') return null;
    const fileName = await uniqueName(target.handle, safeName(name));
    const file = await target.handle.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(blob); } finally { await writable.close(); }
    return fileName;
  }

  // Images in the chosen folder, newest first. Read-only; no prompt.
  // Returns [] when no folder is chosen or permission is not granted.
  const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
  async function listImages(limit = 60) {
    if (!supported) return [];
    const target = await readTarget();
    if (!target) return [];
    let state = 'prompt';
    try { state = await target.handle.queryPermission({ mode: 'readwrite' }); } catch {}
    if (state !== 'granted') return [];
    const files = [];
    for await (const entry of target.handle.values()) {
      if (entry.kind !== 'file' || !IMAGE_FILE.test(entry.name)) continue;
      try { const file = await entry.getFile(); files.push({ name: entry.name, size: file.size, lastModified: file.lastModified, file }); }
      catch {}
    }
    return files.sort((a, b) => b.lastModified - a.lastModified).slice(0, Math.max(1, limit));
  }

  root.LocalFolderSave = {
    supported, getStatus, chooseFolder, forgetFolder, requestAccess, saveBlob, listImages,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
