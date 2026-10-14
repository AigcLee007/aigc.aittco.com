(function (root) {
  'use strict';
  if (root.ImageResultStore) return;
  const DB_NAME = 'keyval-store', STORE_NAME = 'keyval';
  const PREF_KEY = 'image-auto-download-v1';
  const isBlob = value => value instanceof root.Blob && value.size > 0 && (!value.type || value.type.startsWith('image/'));
  const resultId = (ownerId, jobId, outputIndex = 0) => {
    if (!String(ownerId || '').trim() || !String(jobId || '').trim()) throw new Error('Result owner and job are required');
    return `result:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(jobId)}:${Math.max(0, Math.floor(Number(outputIndex) || 0))}`;
  };
  const infoKey = id => `result-info-${id}`;
  const sourceKey = (owner, source) => `result-source-${encodeURIComponent(owner)}-${encodeURIComponent(source)}`;
  const makeToken = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function createStore(options = {}) {
    let connection, opening;
    const timeoutMs = options.timeoutMs || 15000;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(root.navigator?.userAgent || '');
    const budgetBytes = options.budgetBytes ?? (mobile ? 128 : 384) * 1024 * 1024;
    const errors = new Map(), pins = new Map();
    const tabId = makeToken();
    function open() {
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        let done = false;
        const request = (options.indexedDB || root.indexedDB).open(DB_NAME);
        const timer = setTimeout(() => finish(new Error('Local cache open timed out')), timeoutMs);
        function finish(error, db) {
          if (done) { if (db) db.close(); return; }
          done = true; clearTimeout(timer);
          if (error) reject(error); else { connection = db; db.onversionchange = () => { db.close(); if (connection === db) connection = undefined; }; resolve(db); }
        }
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
        request.onsuccess = () => finish(null, request.result);
        request.onerror = () => finish(request.error || new Error('Local cache unavailable'));
        // A blocked open is bounded by the same deadline; it may resume if another tab closes.
      }).finally(() => { opening = undefined; });
      return opening;
    }
    async function transact(mode, run) {
      const db = await open();
      return new Promise((resolve, reject) => {
        let transaction, result, failure, done = false;
        const timer = setTimeout(() => { failure = new Error('Local cache transaction timed out'); try { transaction?.abort(); } catch {} finish(failure); }, timeoutMs);
        function finish(error) { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(result); }
        try {
          transaction = db.transaction(STORE_NAME, mode);
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(failure || transaction.error || new Error('Local cache transaction aborted'));
          transaction.onerror = () => { failure ||= transaction.error; };
          const store = transaction.objectStore(STORE_NAME);
          const context = { setResult: value => { result = value; }, fail: error => { failure = error; try { transaction.abort(); } catch {} finish(error); } };
          run(store, context);
        } catch (error) { failure = error; try { transaction?.abort(); } catch {} finish(error); }
      });
    }
    const read = key => transact('readonly', (store, ctx) => { const request = store.get(key); request.onsuccess = () => ctx.setResult(request.result); });
    function requireInfo(info, ctx) { if (!info) { ctx.fail(new Error('Unknown image result')); return false; } return true; }
    const api = {
      resultId,
      async register(input) {
        const id = resultId(input.ownerId, input.jobId, input.outputIndex);
        return transact('readwrite', (store, ctx) => {
          const request = store.get(infoKey(id));
          request.onsuccess = () => {
            try {
              const previous = request.result || {};
              const info = { ...previous, id, ownerId: String(input.ownerId), jobId: String(input.jobId), outputIndex: Math.max(0, Math.floor(Number(input.outputIndex) || 0)), createdAt: previous.createdAt || input.createdAt || Date.now(), updatedAt: Date.now() };
              for (const field of ['originalUrl','previewUrl','cloudExpiresAt','cloudBacked','storageStatus']) if (input[field] !== undefined && input[field] !== '') info[field] = input[field];
              store.put(info, infoKey(id));
              for (const source of [input.originalUrl, input.previewUrl]) if (source && !/^(blob:|data:)/i.test(source)) store.put(id, sourceKey(info.ownerId, source));
              ctx.setResult(info);
            } catch (error) { ctx.fail(error); }
          };
        });
      },
      async find(ownerId, source) { const id = await read(sourceKey(ownerId, source)); return id ? read(infoKey(id)) : undefined; },
      async getOriginal(id) { const value = await read(`asset-${id}`); return isBlob(value) ? value : undefined; },
      async getPreview(id) { const value = await read(`asset-preview-${id}`); return isBlob(value) ? value : undefined; },
      async getState(id) {
        return transact('readonly', (store, ctx) => {
          const values = {}, keys = [infoKey(id), `asset-${id}`, `asset-preview-${id}`]; let remaining = keys.length;
          keys.forEach((key, index) => { const request = index === 0 ? store.get(key) : store.getKey(key); request.onsuccess = () => { values[index] = request.result; if (--remaining === 0) ctx.setResult({ ...(values[0] || { id }), originalCached: values[1] !== undefined && Number(values[0]?.originalBytes) > 0, previewCached: values[2] !== undefined && Number(values[0]?.previewBytes) > 0, cacheError: errors.get(id)?.original || errors.get(id)?.preview || values[0]?.originalCacheError || values[0]?.previewCacheError || values[0]?.cacheError || null, downloadState: values[0]?.download?.state || null }); }; });
        });
      },
      async putOriginal(id, blob, meta = {}) { return putBlob(id, blob, false, meta); },
      async putPreview(id, blob, meta = {}) { return putBlob(id, blob, true, meta); },
      async adoptLegacy(id, legacyAssetId, confirmedOwnerId) {
        const info = await read(infoKey(id));
        if (!info || !confirmedOwnerId || info.ownerId !== String(confirmedOwnerId)) throw new Error('Legacy ownership must be explicitly confirmed');
        const [original, preview, meta] = await Promise.all([read(`asset-${legacyAssetId}`), read(`asset-preview-${legacyAssetId}`), read(`asset-meta-${legacyAssetId}`)]);
        const metadata = { width: meta?.width, height: meta?.height, previewVersion: meta?.previewVersion, legacyAssetId };
        // Each copy uses the same committed write and budget checks as new images.
        // The legacy source is retained even when either migration write fails.
        if (isBlob(original)) await api.putOriginal(id, original, metadata);
        if (isBlob(preview)) await api.putPreview(id, preview, metadata);
        return isBlob(original) || isBlob(preview);
      },
      async claimDownload(id, claimant = tabId) {
        return transact('readwrite', (store, ctx) => {
          const request = store.get(infoKey(id)); request.onsuccess = () => {
            const info = request.result; if (!requireInfo(info, ctx)) return;
            if (info.download) { ctx.setResult(null); return; }
            const token = makeToken();
            store.put({ ...info, download: { state: 'claimed', claimant, token, claimedAt: Date.now() } }, infoKey(id)); ctx.setResult(token);
          };
        });
      },
      async markDownloadStarted(id, token) {
        return transact('readwrite', (store, ctx) => {
          const request = store.get(infoKey(id)); request.onsuccess = () => {
            const info = request.result;
            if (!info?.download || info.download.token !== token) { ctx.setResult(false); return; }
            store.put({ ...info, download: { ...info.download, state: 'started', startedAt: Date.now() } }, infoKey(id)); ctx.setResult(true);
          };
        });
      },
      pin(id) {
        const count = pins.get(id)?.count || 0;
        if (!count) {
          const refresh = () => { void transact('readwrite', store => store.put({ id, expiresAt: Date.now() + 90000 }, `result-pin-${tabId}-${id}`)).catch(() => {}); };
          refresh(); const timer = setInterval(refresh, 30000); pins.set(id, { count: 1, timer });
        } else pins.get(id).count++;
        let released = false;
        return () => { if (released) return; released = true; const pin = pins.get(id); if (!pin || --pin.count) return; clearInterval(pin.timer); pins.delete(id); void transact('readwrite', store => store.delete(`result-pin-${tabId}-${id}`)).catch(() => {}); };
      },
      getAutoDownloadPreference(fallback = true) {
        try {
          const value = root.localStorage?.getItem(PREF_KEY); if (value !== null && value !== undefined) return value === 'true' || value === '1';
          const legacy = JSON.parse(root.localStorage?.getItem('selection-storage') || 'null')?.state?.autoDownloadOnSuccess;
          if (typeof legacy === 'boolean') fallback = legacy;
          api.setAutoDownloadPreference(fallback);
        } catch {}
        return !!fallback;
      },
      setAutoDownloadPreference(enabled) {
        try { root.localStorage?.setItem(PREF_KEY, String(!!enabled)); root.dispatchEvent?.(new root.CustomEvent('image-auto-download-change', { detail: !!enabled })); } catch {}
      },
      close() { connection?.close(); connection = undefined; },
    };
    async function putBlob(id, blob, preview, metadata) {
      if (!isBlob(blob)) throw new Error('Invalid image blob');
      try {
        await transact('readwrite', (store, ctx) => {
          const infos = [], activePins = new Set(); let total = 0;
          let scansRemaining = 3;
          for (const prefix of ['result-info-', 'asset-meta-', 'result-pin-']) {
            // Prefix ranges exclude original/preview Blob values entirely.
            const cursor = store.openCursor(root.IDBKeyRange.bound(prefix, `${prefix}\uffff`));
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (item) {
                if (prefix === 'result-info-') infos.push(item.value);
                else if (prefix === 'asset-meta-') { const meta = item.value; total += Math.max(0, Number(meta.bytes) || 0) + Math.max(0, Number(meta.previewBytes) || 0); }
                else { const pin = item.value; if (pin.expiresAt > Date.now()) activePins.add(pin.id); else store.delete(item.key); }
                item.continue(); return;
              }
              if (--scansRemaining === 0) commit();
            };
          }
          function commit() {
            try {
              const info = infos.find(value => value.id === id); if (!requireInfo(info, ctx)) return;
              const priorBytes = preview ? info.previewBytes || 0 : info.originalBytes || 0;
              let needed = total + blob.size - priorBytes - budgetBytes;
              const candidates = infos.filter(value => value.id !== id && value.cloudBacked === true && Number(value.cloudExpiresAt) > Date.now() + 300000 && !pins.has(value.id) && !activePins.has(value.id)).sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
              for (const value of candidates) {
                if (needed <= 0) break;
                const reclaimed = (value.originalBytes || 0) + (value.previewBytes || 0); if (!reclaimed) continue;
                store.delete(`asset-${value.id}`); store.delete(`asset-preview-${value.id}`); store.delete(`asset-meta-${value.id}`);
                store.put({ ...value, originalBytes: 0, previewBytes: 0 }, infoKey(value.id)); needed -= reclaimed;
              }
              if (needed > 0) { ctx.fail(new DOMException('Local image cache budget is full', 'QuotaExceededError')); return; }
              const updated = { ...info, ...metadata, id, ownerId: info.ownerId, jobId: info.jobId, outputIndex: info.outputIndex, createdAt: info.createdAt, ...(!preview ? { mime: blob.type } : {}), [preview ? 'previewBytes' : 'originalBytes']: blob.size, [preview ? 'previewCacheError' : 'originalCacheError']: null, cacheError: preview ? info.originalCacheError || null : info.previewCacheError || null, updatedAt: Date.now() };
              store.put(blob, `${preview ? 'asset-preview-' : 'asset-'}${id}`);
              store.put(updated, infoKey(id));
              store.put({ createdAt: info.createdAt, bytes: updated.originalBytes || 0, previewBytes: updated.previewBytes || 0, mime: preview ? info.mime || '' : blob.type, width: updated.width, height: updated.height, previewVersion: updated.previewVersion, sharedResult: true }, `asset-meta-${id}`);
              ctx.setResult(updated);
            } catch (error) { ctx.fail(error); }
          }
        });
        const priorErrors = errors.get(id); if (priorErrors) { delete priorErrors[preview ? 'preview' : 'original']; if (!priorErrors.original && !priorErrors.preview) errors.delete(id); }
        return api.getState(id);
      } catch (error) {
        const code = error?.name === 'QuotaExceededError' ? 'QUOTA' : 'CACHE_UNAVAILABLE'; errors.set(id, { ...errors.get(id), [preview ? 'preview' : 'original']: code });
        await transact('readwrite', (store,ctx) => { const request = store.get(infoKey(id)); request.onsuccess = () => { try { if (request.result) store.put({ ...request.result, [preview ? 'previewCacheError' : 'originalCacheError']: code, cacheError: code }, infoKey(id)); } catch (writeError) {ctx.fail(writeError);} }; }).catch(() => {});
        throw error;
      }
    }
    return api;
  }
  root.ImageResultStore = Object.assign(createStore(), { createStore });
})(globalThis);
