(function (root) {
  'use strict';
  if (root.ImageResultStore) return;
  const DB_NAME = 'keyval-store', STORE_NAME = 'keyval';
  const PREF_KEY = 'image-auto-download-v1';
  const STORAGE_MODE_KEY = 'image-storage-mode-v1';
  const STORAGE_MODES = ['standard', 'fast'];
  const isBlob = value => value instanceof root.Blob && value.size > 0 && (!value.type || value.type.startsWith('image/'));
  const resultId = (ownerId, jobId, outputIndex = 0) => {
    if (!String(ownerId || '').trim() || !String(jobId || '').trim()) throw new Error('Result owner and job are required');
    return `result:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(jobId)}:${Math.max(0, Math.floor(Number(outputIndex) || 0))}`;
  };
  const infoKey = id => `result-info-${id}`;
  const sourceKey = (owner, source) => `result-source-${encodeURIComponent(owner)}-${encodeURIComponent(source)}`;
  // Provider bytes and truncated diagnostic strings are not reusable addresses.
  // Large IndexedDB keys are repeated in LevelDB table boundaries and manifests.
  const malformedSource = source => typeof source !== 'string' || /\[truncated\]/i.test(source)
    || /^\/9j\/[A-Za-z0-9+/=\s]{32,}$/.test(source)
    || source.length > 8192 && !/^(data:|blob:)/i.test(source);
  const aliasableSource = source => !!source && !malformedSource(source) && source.length <= 8192
    && /^(https?:\/\/|\/(?!\/)|asset:)/i.test(source) && !/^\/9j\//.test(source);
  const makeToken = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function createStore(options = {}) {
    let connection, opening, sourceMaintenance;
    const timeoutMs = options.timeoutMs || 15000;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(root.navigator?.userAgent || '');
    // Fixed defaults until the browser reports its real quota (adaptBudget).
    // An explicit budget (tests, constrained callers) is never adapted.
    const adaptive = options.budgetBytes === undefined && options.previewBudgetBytes === undefined;
    let budgetBytes = options.budgetBytes ?? (mobile ? 128 : 384) * 1024 * 1024;
    let previewBudgetBytes = options.previewBudgetBytes ?? (mobile ? 24 : 64) * 1024 * 1024;
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
    function pruneOversizedAliases() {
      if (!sourceMaintenance) sourceMaintenance = transact('readwrite', (store, ctx) => {
        let removed = 0;
        // Scan keys only; never clone or delete an original, preview or record.
        const request = store.openKeyCursor(root.IDBKeyRange.bound('result-source-', 'result-source-\uffff'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { ctx.setResult(removed); return; }
          const key = String(cursor.key);
          if (key.length > 128 * 1024 || /%5Btruncated%5D/i.test(key)) { store.delete(cursor.primaryKey); removed++; }
          cursor.continue();
        };
      });
      return sourceMaintenance;
    }
    function requireInfo(info, ctx) { if (!info) { ctx.fail(new Error('Unknown image result')); return false; } return true; }
    const api = {
      resultId,
      async register(input) {
        const id = resultId(input.ownerId, input.jobId, input.outputIndex);
        await pruneOversizedAliases().catch(error => root.console?.warn('Image source alias maintenance failed', error));
        return transact('readwrite', (store, ctx) => {
          const request = store.get(infoKey(id));
          request.onsuccess = () => {
            try {
              const previous = request.result || {};
              const info = { ...previous, id, ownerId: String(input.ownerId), jobId: String(input.jobId), outputIndex: Math.max(0, Math.floor(Number(input.outputIndex) || 0)), createdAt: previous.createdAt || input.createdAt || Date.now(), updatedAt: Date.now() };
              for (const field of ['originalUrl','previewUrl']) if (info[field] && malformedSource(info[field])) delete info[field];
              for (const field of ['originalUrl','previewUrl','cloudExpiresAt','cloudBacked','storageStatus','legacyClassicId']) {
                if (input[field] === undefined || input[field] === '') continue;
                if ((field === 'originalUrl' || field === 'previewUrl') && malformedSource(input[field])) continue;
                info[field] = input[field];
              }
              store.put(info, infoKey(id));
              for (const source of [input.originalUrl, input.previewUrl]) if (aliasableSource(source)) store.put(id, sourceKey(info.ownerId, source));
              ctx.setResult(info);
            } catch (error) { ctx.fail(error); }
          };
        });
      },
      async find(ownerId, source) { if (!aliasableSource(source)) return undefined; const id = await read(sourceKey(ownerId, source)); return id ? read(infoKey(id)) : undefined; },
      async getOriginal(id) {
        const value = await read(`asset-${id}`); if (isBlob(value)) return value;
        const info = await read(infoKey(id));
        const legacy = info?.legacySourceAssetId ? await read(`asset-${info.legacySourceAssetId}`) : undefined;
        return isBlob(legacy) ? legacy : undefined;
      },
      async getPreview(id) {
        const value = await read(`asset-preview-${id}`); if (isBlob(value)) return value;
        const info = await read(infoKey(id));
        const legacy = info?.legacySourceAssetId ? await read(`asset-preview-${info.legacySourceAssetId}`) : undefined;
        return isBlob(legacy) ? legacy : undefined;
      },
      // The authenticated record establishes the exact source URL. Link only
      // that canvas alias, retaining its bytes without copying a second original.
      async linkLegacySource(id, confirmedOwnerId) {
        return transact('readwrite', (store, ctx) => {
          const request = store.get(infoKey(id)); request.onsuccess = () => {
            const info = request.result;
            if (!info || !confirmedOwnerId || info.ownerId !== String(confirmedOwnerId)) { ctx.fail(new Error('Legacy ownership must be explicitly confirmed')); return; }
            if (info.legacySourceAssetId || !info.originalUrl) return;
            const alias = store.get(`asset-source-${info.originalUrl}`);
            alias.onsuccess = () => {
              const legacyId = alias.result;
              // Stable shared IDs have their own owner; never treat them as an
              // ownerless canvas UUID or create chains between result records.
              if (typeof legacyId !== 'string' || !legacyId || legacyId.startsWith('result:')) return;
              const metaRequest = store.get(`asset-meta-${legacyId}`);
              metaRequest.onsuccess = () => {
                const meta = metaRequest.result;
                let left = 2, exists = false;
                [`asset-${legacyId}`, `asset-preview-${legacyId}`].forEach(key => {
                  const source = store.getKey(key); source.onsuccess = () => {
                    exists ||= source.result !== undefined;
                    if (--left || !exists) return;
                    store.put({ ...info, legacySourceAssetId: legacyId,
                      width: info.width || meta?.width, height: info.height || meta?.height,
                      previewVersion: info.previewVersion || meta?.previewVersion,
                    }, infoKey(id));
                    // Check source existence and protect it in this transaction,
                    // serialized with canvas cleanup in other tabs.
                    store.put({ ...meta, sharedResult: true }, `asset-meta-${legacyId}`);
                  };
                });
              };
            };
          };
        });
      },
      async getState(id) {
        return transact('readonly', (store, ctx) => {
          const values = {}, keys = [infoKey(id), `asset-${id}`, `asset-preview-${id}`]; let remaining = keys.length;
          function finish() {
            const info = values[0] || { id };
            const originalCached = values[1] !== undefined && Number(info.originalBytes) > 0 || values[3] !== undefined;
            const previewCached = values[2] !== undefined && Number(info.previewBytes) > 0 || values[4] !== undefined && info.previewVersion === 1;
            const originalCacheError = originalCached ? null : errors.get(id)?.original || info.originalCacheError || null;
            const previewCacheError = previewCached ? null : errors.get(id)?.preview || info.previewCacheError || null;
            ctx.setResult({ ...info, originalCached, previewCached, originalCacheError, previewCacheError,
              cacheError: originalCacheError || previewCacheError || (!originalCached && !previewCached ? info.cacheError : null) || null,
              downloadState: info.download?.state || null });
          }
          function finishPrimary() {
            const legacyId = values[0]?.legacySourceAssetId;
            if (!legacyId) { finish(); return; }
            let left = 2;
            [`asset-${legacyId}`, `asset-preview-${legacyId}`].forEach((key, index) => {
              const request = store.getKey(key); request.onsuccess = () => { values[3 + index] = request.result; if (--left === 0) finish(); };
            });
          }
          keys.forEach((key, index) => { const request = index === 0 ? store.get(key) : store.getKey(key); request.onsuccess = () => { values[index] = request.result; if (--remaining === 0) finishPrimary(); }; });
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
      // standard: the server keeps the original for 5 hours;
      // fast: link lines download straight from the upstream, server keeps a preview.
      getStorageModePreference() {
        try {
          const value = root.localStorage?.getItem(STORAGE_MODE_KEY);
          // Earlier builds stored auto / stable / speed.
          if (value === 'speed') return 'fast';
          if (STORAGE_MODES.includes(value)) return value;
        } catch {}
        return 'standard';
      },
      setStorageModePreference(mode) {
        const value = mode === 'speed' ? 'fast' : STORAGE_MODES.includes(mode) ? mode : 'standard';
        try { root.localStorage?.setItem(STORAGE_MODE_KEY, value); root.dispatchEvent?.(new root.CustomEvent('image-storage-mode-change', { detail: value })); } catch {}
      },
      // Ask the browser not to evict this site's cache under storage pressure,
      // then size the original cache from the real quota: 10% of it, between
      // the fixed default and 4 GB (1 GB on phones). Safe to call repeatedly.
      async prepareStorage() {
        const storage = root.navigator?.storage;
        let persisted = false;
        try { persisted = await storage?.persisted?.() || await storage?.persist?.() || false; } catch {}
        if (adaptive) {
          try {
            const { quota } = await storage?.estimate?.() || {};
            if (Number(quota) > 0) {
              const ceiling = (mobile ? 1024 : 4096) * 1024 * 1024;
              budgetBytes = Math.max(budgetBytes, Math.min(ceiling, Math.floor(quota * 0.1)));
              previewBudgetBytes = Math.max(previewBudgetBytes, Math.min(512 * 1024 * 1024, Math.floor(quota * 0.02)));
            }
          } catch {}
        }
        return { persisted, budgetBytes, previewBudgetBytes };
      },
      // Bytes this cache holds, its budget, and the browser's own figures.
      async getStorageSummary() {
        const summary = { originalBytes: 0, previewBytes: 0, results: 0, cachedOriginals: 0, budgetBytes, previewBudgetBytes, usage: null, quota: null, persisted: null };
        await transact('readonly', store => {
          const cursor = store.openCursor(root.IDBKeyRange.bound('result-info-', 'result-info-￿'));
          cursor.onsuccess = () => {
            const item = cursor.result; if (!item) return;
            const info = item.value || {};
            summary.results++;
            summary.originalBytes += Math.max(0, Number(info.originalBytes) || 0);
            summary.previewBytes += Math.max(0, Number(info.previewBytes) || 0);
            if (Number(info.originalBytes) > 0) summary.cachedOriginals++;
            item.continue();
          };
        }).catch(() => {});
        try { const estimate = await root.navigator?.storage?.estimate?.(); summary.usage = estimate?.usage ?? null; summary.quota = estimate?.quota ?? null; } catch {}
        try { summary.persisted = await root.navigator?.storage?.persisted?.() ?? null; } catch {}
        return summary;
      },
      close() { connection?.close(); connection = undefined; },
    };
    async function putBlob(id, blob, preview, metadata) {
      if (!isBlob(blob)) throw new Error('Invalid image blob');
      try {
        await transact('readwrite', (store, ctx) => {
          const infos = [], metas = new Map(), activePins = new Set(); let total = 0;
          let scansRemaining = 3;
          for (const prefix of ['result-info-', 'asset-meta-', 'result-pin-']) {
            // Prefix ranges exclude original/preview Blob values entirely.
            const cursor = store.openCursor(root.IDBKeyRange.bound(prefix, `${prefix}\uffff`));
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (item) {
                if (prefix === 'result-info-') infos.push(item.value);
                else if (prefix === 'asset-meta-' && String(item.key).startsWith('asset-meta-result:v1:')) {
                  const meta = item.value;
                  metas.set(item.key, meta);
                  total += Math.max(0, Number(preview ? meta.previewBytes : meta.bytes) || 0);
                }
                else if (prefix === 'result-pin-') { const pin = item.value; if (pin.expiresAt > Date.now()) activePins.add(pin.id); else store.delete(item.key); }
                item.continue(); return;
              }
              if (--scansRemaining === 0) commit();
            };
          }
          function commit() {
            try {
              const info = infos.find(value => value.id === id); if (!requireInfo(info, ctx)) return;
              const priorBytes = preview ? info.previewBytes || 0 : info.originalBytes || 0;
              let needed = total + blob.size - priorBytes - (preview ? previewBudgetBytes : budgetBytes);
              const candidates = infos.filter(value => value.id !== id && value.cloudBacked === true && Number(value.cloudExpiresAt) > Date.now() + 300000 && !pins.has(value.id) && !activePins.has(value.id)).sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
              for (const value of candidates) {
                if (needed <= 0) break;
                const field = preview ? 'previewBytes' : 'originalBytes';
                const reclaimed = value[field] || 0; if (!reclaimed) continue;
                store.delete(`${preview ? 'asset-preview-' : 'asset-'}${value.id}`);
                store.put({ ...value, [field]: 0 }, infoKey(value.id));
                store.put({ ...metas.get(`asset-meta-${value.id}`), bytes: preview ? value.originalBytes || 0 : 0, previewBytes: preview ? 0 : value.previewBytes || 0, sharedResult: true }, `asset-meta-${value.id}`);
                needed -= reclaimed;
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
  // Both layouts load this file; preparing once here covers canvas and classic.
  if (root.navigator?.storage) root.ImageResultStore.prepareStorage().catch(() => {});
})(globalThis);
