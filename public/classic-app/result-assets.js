(function (root) {
  'use strict';
  const store = root.ImageResultStore;
  const runtime = root.ClassicImageRuntime;
  const fetchBlob = root.fetchClassicImageBlob;
  if (!store || !runtime || !fetchBlob) return;
  const originals = runtime.createPreviewDecodeQueue(1, { maxPending: 120, waitMs: 180000 });
  const downloads = runtime.createPreviewDecodeQueue(1, { maxPending: 120, waitMs: 180000 });
  const lifecycle = runtime.createPreviewDecodeQueue(1, { maxPending: 120, waitMs: 600000 });
  const decoders = runtime.createPreviewDecodeQueue(1);
  const pending = new Map(), caching = new Map();
  let reader, readerOwner;
  const owner = () => String(root.classicImageJobOwner || '');
  const usable = blob => blob?.size > 0 && (!blob.type || blob.type.startsWith('image/'));
  const time = value => typeof value === 'number' ? value : Date.parse(value || '') || 0;
  const current = expected => { if (expected !== owner()) throw new Error('账号已切换，请在当前账号重试'); };
  const bindings = () => typeof classicImageBindings !== 'undefined' ? classicImageBindings : new Map();
  const previewMeta = preview => ({ previewVersion: 1, ...(preview.originalWidth ? { width: preview.originalWidth, height: preview.originalHeight } : {}) });
  async function infoFor(id, src) {
    const expected = owner();
    let info;
    if (id?.startsWith('result:v1:')) info = await store.getState(id).catch(() => null);
    current(expected);
    if (!info && !src && id && expected) info = await store.find(expected, id);
    current(expected);
    if (!info && src && expected) info = await store.find(expected, src);
    current(expected);
    return info?.ownerId === expected ? info : null;
  }
  async function localOriginal(info) {
    const shared = await store.getOriginal(info.id).catch(() => null); current(info.ownerId);
    if (usable(shared)) return shared;
    const old = await root.readClassicImageCache?.('images', info.legacyClassicId || info.id).catch(() => null);
    current(info.ownerId);
    return usable(old?.blob) ? old.blob : null;
  }
  async function localPreview(info) {
    const shared = await store.getPreview(info.id).catch(() => null); current(info.ownerId);
    if (usable(shared)) return { blob: shared, version: 1, width: info.width, height: info.height };
    const old = await root.readClassicImageCache?.('previews', info.legacyClassicId || info.id).catch(() => null);
    current(info.ownerId);
    return usable(old?.blob) ? old : null;
  }
  async function cacheState(info) {
    const state = await store.getState(info.id); current(info.ownerId);
    // Badges query keys only; never clone every full-resolution Blob to count
    // cache availability. Legacy bytes remain in their original database.
    const old = await root.getClassicImageCacheState?.(info.legacyClassicId || info.id).catch(() => null);
    current(info.ownerId);
    if (old?.originalCached) state.originalCached = true;
    if (old?.previewCached) state.previewCached = true;
    if (state.originalCached && state.previewCached) state.cacheError = null;
    else if (state.originalCached && !state.previewCacheError) state.cacheError = null;
    return state;
  }
  async function ensureOriginal(info, signal) {
    current(info.ownerId);
    const existing = pending.get(info.id); if (existing) return existing;
    const work = originals.run(async () => {
      current(info.ownerId);
      const unpin = store.pin(info.id);
      try {
        const local = await localOriginal(info).catch(error => {
          root.console?.warn('本浏览器缓存暂不可读，尝试云端原图', error); return null;
        });
        current(info.ownerId);
        if (usable(local)) return local;
        // Durable original preparation is shared with background caching; an
        // offscreen preview cancelling its lease must not cancel other readers.
        let blob;
        try { blob = await fetchBlob(info.originalUrl); }
        catch (error) {
          const latest = await store.getState(info.id);
          current(info.ownerId);
          if (!latest.originalUrl || latest.originalUrl === info.originalUrl) throw error;
          blob = await fetchBlob(latest.originalUrl);
        }
        current(info.ownerId);
        if (!usable(blob)) throw new Error('返回内容不是有效图片');
        try { await store.putOriginal(info.id, blob); }
        catch (error) { root.console?.warn('原图可读取，但本浏览器缓存写入失败', error); }
        current(info.ownerId);
        return blob;
      } finally { unpin(); }
    });
    pending.set(info.id, work);
    try { return await work; } finally { if (pending.get(info.id) === work) pending.delete(info.id); }
  }
  async function readOriginal(src, id, signal) {
    const expected = owner();
    const info = await infoFor(id, src);
    current(expected);
    if (info) return ensureOriginal(info, signal);
    const candidates = [id, src].filter(Boolean);
    for (const candidate of candidates) {
      const cached = await root.readClassicImageCache?.('images', candidate).catch(() => null);
      current(expected);
      if (usable(cached?.blob)) return cached.blob;
    }
    // Unowned legacy bytes are read only through an explicit legacy record ID.
    const blob = await fetchBlob(src, signal); current(expected); return blob;
  }
  async function refreshBadge(card, id, details) {
    if (!card?.isConnected) return;
    const expected = owner();
    const info = await infoFor(id, card.dataset.fullUrl).catch(() => null);
    let state = details;
    if (info) state = await cacheState(info).catch(() => details || { cacheError: 'CACHE_UNAVAILABLE' });
    if (!card.isConnected || expected !== owner()) return;
    const badge = card.querySelector('.history-cache-badge'); if (!badge) return;
    const cacheError = state?.cacheError;
    let label = state?.originalCached ? '原图已缓存（本浏览器）' : state?.previewCached ? '仅预览已缓存，请下载原图' : '云端暂存 · 请尽快下载';
    if (!state?.originalCached && info?.cloudExpiresAt && info.cloudExpiresAt <= Date.now()) label = state?.previewCached
      ? '仅预览已缓存 · 云端原图已过期，可从本地文件恢复' : '云端原图已过期 · 从本地文件恢复';
    if (cacheError) label += cacheError === 'QUOTA' || cacheError.name === 'QuotaExceededError' ? ' · 缓存空间不足' : ' · 缓存暂不可读';
    if (state?.downloadState === 'started') label += ' · 已发起下载';
    if (state?.downloadState === 'claimed') label += ' · 请核对下载记录，可手动下载';
    // A small icon: quiet when the original is safe, coloured only when the
    // user should act. The full sentence stays as accessible text and tooltip.
    const expired = !state?.originalCached && info?.cloudExpiresAt && info.cloudExpiresAt <= Date.now();
      const tone = cacheError || expired ? 'alert' : state?.originalCached ? 'local' : 'cloud';
    renderBadge(badge, tone, label, '浏览器缓存可能被清理；已发起下载不代表浏览器已完成文件保存，请检查下载记录。');
  }
  const BADGE_ICONS = { local: '✓', cloud: '☁', alert: '!', syncing: '…' };
  function renderBadge(badge, tone, label, note = '') {
    badge.className = 'history-cache-badge ' + tone;
    badge.textContent = '';
    const icon = root.document.createElement('span');
    icon.className = 'history-cache-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = BADGE_ICONS[tone] || '•';
    const text = root.document.createElement('span');
    text.className = 'history-cache-label'; text.textContent = label;
    badge.append(icon, text);
    badge.title = note ? `${label}\n${note}` : label;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', label);
  }
  root.renderClassicCacheBadge = renderBadge;
  // Touch screens have no hover tooltip; a tap shows the full status instead.
  root.document.addEventListener('click', event => {
    const badge = event.target?.closest?.('.history-cache-badge');
    if (!badge) return;
    event.stopPropagation();
    const label = badge.querySelector('.history-cache-label')?.textContent || badge.textContent;
    if (label) root.showSoftToast?.(label);
  }, true);
  function refreshCards(id) {
    root.document.querySelectorAll('[data-asset-id]').forEach(card => { if (card.dataset.assetId === id) void refreshBadge(card, id); });
  }
  function filename(info, prompt, blob) {
    const label = String(prompt || '生成图片').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 50);
    const ext = blob.type.includes('webp') ? 'webp' : blob.type.includes('jpeg') ? 'jpg' : 'png';
    return label + '-' + String(info.jobId || info.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-32) + '-' + (info.outputIndex + 1) + '.' + ext;
  }
  function triggerDownload(blob, name) {
    const url = root.URL.createObjectURL(blob);
    try {
      const anchor = root.document.createElement('a'); anchor.href = url; anchor.download = name;
      root.document.body.appendChild(anchor); try { anchor.click(); } finally { anchor.remove(); }
    } finally { root.setTimeout(() => root.URL.revokeObjectURL(url), 2000); }
  }
  async function downloadResult(info, prompt, manual = false, preparedBlob) {
    return downloads.run(async () => {
      current(info.ownerId);
      if (!manual && !store.getAutoDownloadPreference()) return false;
      const state = await store.getState(info.id);
      if (!manual && state.downloadState) return false;
      const blob = preparedBlob || await ensureOriginal(info);
      current(info.ownerId);
      const token = await store.claimDownload(info.id, 'classic');
      if (!manual && !token) return false;
      current(info.ownerId);
      if (!manual && !store.getAutoDownloadPreference()) return false;
      triggerDownload(blob, filename(info, prompt, blob));
      if (token) await store.markDownloadStarted(info.id, token);
      refreshCards(info.id);
      return true;
    });
  }
  async function registerResult(record) {
    const expected = String(record.ownerId || owner());
    if (!expected || expected !== owner()) return;
    const jobId = String(record.jobId || record.taskId || record.id || '');
    if (!jobId) return;
    const info = await store.register({
      ownerId: expected, jobId, outputIndex: record.outputIndex || 0,
      originalUrl: record.fullUrl || record.originalUrl || record.url,
      previewUrl: record.previewUrl || '', createdAt: time(record.createdAt),
      cloudExpiresAt: time(record.cloudExpiresAt) || undefined,
      cloudBacked: Boolean(record.cloudExpiresAt),
      storageStatus: record.storageStatus || '',
      legacyClassicId: record.legacyId || '',
    });
    current(expected);
    await store.linkLegacySource(info.id, expected);
    current(expected);
    return store.getState(info.id);
  }
  async function cacheResult(record) {
    const info = await registerResult(record);
    if (!info) return;
    const id = info.id, expected = info.ownerId;
    if (caching.has(id)) return caching.get(id);
    const work = lifecycle.run(async () => {
      current(expected);
      const latest = await store.getState(id);
      const blob = await ensureOriginal(latest);
      current(expected);
      if (record.autoDownloadEligible !== false && store.getAutoDownloadPreference()) {
        try { await downloadResult(info, record.prompt, false, blob); }
        catch (error) { root.console?.warn('自动下载未发起，请手动下载原图', error); }
      }
      try {
        if (!(await cacheState(latest)).previewCached) {
          const prepared = await decoders.run(async () => {
            current(expected);
            if (latest.previewUrl && latest.previewUrl !== latest.originalUrl) {
              try {
                const source = await fetchBlob(latest.previewUrl); current(expected);
                const preview = await runtime.makeBrowserPreview(source); current(expected);
                return { preview, metadata: { previewVersion: 1 } };
              } catch (error) { current(expected); root.console?.warn('服务端预览暂不可读，使用原图制作预览', error); }
            }
            return { preview: await runtime.makeBrowserPreview(blob), metadata: null };
          });
          current(expected);
          await store.putPreview(id, prepared.preview.blob, prepared.metadata || previewMeta(prepared.preview));
        }
      } catch (error) { root.console?.warn('原图可读取，预览缓存未保存', error); }
      current(expected);
      refreshCards(info.id);
      return cacheState(info);
    });
    caching.set(id, work);
    try { return await work; } finally { if (caching.get(id) === work) caching.delete(id); }
  }
  async function restoreFile(id, file) {
    const info = await infoFor(id); if (!info) throw new Error('请先登录对应账号再恢复这张图片');
    if (!usable(file) || file.size > 100 * 1024 * 1024) throw new Error('请选择小于100MB的图片原文件');
    current(info.ownerId);
    await store.putOriginal(info.id, file);
    const preview = await decoders.run(() => runtime.makeBrowserPreview(file));
    current(info.ownerId);
    await store.putPreview(info.id, preview.blob, previewMeta(preview));
    bindings().forEach((input, img) => {
      if (input.id === info.id || input.src === info.originalUrl) {
        if (typeof classicImageBinder !== 'undefined') { classicImageBinder?.unbind(img); classicImageBinder?.bind(img, { ...input, id: info.id, retry: true }); }
      }
    });
    refreshCards(info.id);
  }
  root.ClassicResultAssets = { cacheResult, registerResult, readOriginal, refreshBadge, restoreFile, downloadResult };
  root.cacheClassicResult = cacheResult;
  root.refreshClassicCacheBadge = refreshBadge;
  root.restoreClassicLocalFile = (id, src) => {
    const picker = root.document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*';
    picker.onchange = async () => {
      const info = await infoFor(id, src);
      try { if (info && picker.files?.[0]) { await restoreFile(info.id, picker.files[0]); root.showSoftToast?.('原图已恢复到本浏览器'); } }
      catch (error) { root.showSoftToast?.(error.message || '恢复失败，请重试'); }
    };
    picker.click();
  };
  getClassicImageReader = function () {
    const activeOwner = owner();
    if (reader && readerOwner === activeOwner) return reader;
    readerOwner = activeOwner;
    reader = runtime.createAssetReader({
      decodeQueue: decoders,
      readOriginal: async (id, src) => {
        const expected = owner();
        const info = await infoFor(id, src);
        current(expected);
        if (info) {
          return localOriginal(info);
        }
        const old = await root.readClassicImageCache?.('images', id).catch(() => null);
        current(expected);
        return old?.blob || null;
      },
      readPreview: async id => {
        const expected = owner();
        const info = await infoFor(id);
        if (info) {
          return localPreview(info);
        }
        const old = await root.readClassicImageCache?.('previews', id); current(expected); return old;
      },
      writeOriginal: async (id, blob) => {
        const info = await infoFor(id);
        if (info) await store.putOriginal(info.id, blob);
        else if (!owner()) await root.writeClassicImageCache?.('images', id, { blob });
        else throw new Error('图片尚未登记，原图缓存等待恢复');
      },
      writePreview: async (id, preview) => {
        const info = await infoFor(id);
        if (info) await store.putPreview(info.id, preview.blob, previewMeta(preview));
        else if (!owner()) await root.writeClassicImageCache?.('previews', id, preview);
        else throw new Error('图片尚未登记，预览缓存等待恢复');
      },
      getCacheState: async id => {
        const info = await infoFor(id); return info ? cacheState(info) : null;
      },
      fetchBlob: async (src, signal) => {
        const expected = owner();
        const info = await infoFor('', src);
        current(expected);
        const blob = await (info && src === info.originalUrl ? ensureOriginal(info, signal) : fetchBlob(src, signal));
        current(expected); return blob;
      },
      validateOriginalBlob: async blob => usable(blob),
      validateBlob: async blob => {
        if (!usable(blob)) return false;
        const bitmap = await runtime.decodeBrowserBlob(blob);
        try { return bitmap.width > 0 && bitmap.height > 0; } finally { bitmap.close(); }
      },
      makePreview: runtime.makeBrowserPreview,
    });
    return reader;
  };
  const legacyState = root.setClassicImageState;
  async function showReadError(img, id, details) {
    const expected = owner();
    const info = await infoFor(id, bindings().get(img)?.src).catch(() => null);
    const state = info ? await cacheState(info).catch(() => null) : details;
    if (!img.isConnected || expected !== owner()) return;
    const message = img.parentElement.querySelector(':scope > .classic-image-status');
    if (!message || !message.firstChild || message.firstChild.nodeType !== 3) return;
    let label = '图片读取失败 · 请重试读取或从本地恢复';
    if (!state?.originalCached && info?.cloudExpiresAt && info.cloudExpiresAt <= Date.now()) label = '云端原图已过期 · 请从本地文件恢复';
    else if (state?.cacheError) label = state.cacheError === 'QUOTA' ? '缓存空间不足 · 请下载原图' : '缓存暂不可读 · 请重试读取';
    else if (/Invalid image|decode|不是有效图片/i.test(details?.error?.message || '')) label = '图片数据无法解码 · 请重试或从本地恢复';
    else if (/network|fetch|timed out|超时|读取失败 \(5/i.test(details?.error?.message || '')) label = '网络读取失败 · 请重试读取';
    message.firstChild.nodeValue = label;
  }
  setClassicImageState = function (img, state, details) {
    if (state !== 'ready' && state !== 'queued') legacyState?.(img, state);
    if (!img?.isConnected) return;
    const parent = img.parentElement;
    if (state === 'queued') {
      legacyState?.(img, 'reading');
      const label = parent.querySelector('.classic-image-status'); if (label) label.textContent = '等待读取…';
    }
    if (state === 'ready') parent.querySelector(':scope > .classic-image-status')?.remove();
    const card = img.closest('[data-asset-id], .history-item, .classic-live-card');
    if (card) void refreshBadge(card, card.dataset.assetId || bindings().get(img)?.id, details);
    if (state === 'failed' || state === 'missing') void showReadError(img, card?.dataset.assetId || bindings().get(img)?.id, details);
  };
  const legacyDownload = root.downloadSingleImg;
  downloadSingleImg = async function (src, id) {
    const expected = owner();
    try {
      const info = await infoFor(id, src); current(expected);
      if (!info) return legacyDownload?.(src);
      await downloadResult(info, '', true);
      root.showSoftToast?.('已发起原图下载，请查看浏览器下载记录');
    } catch (error) { root.showSoftToast?.(error.message || '原图读取失败，请重试或从本地恢复'); }
  };
  function syncPreference() {
    const checkbox = root.document.getElementById('classicAutoDownload');
    if (checkbox) checkbox.checked = store.getAutoDownloadPreference();
    syncTransferToggle();
  }
  // Fast transfer only changes anything on lines that return upstream links.
  function syncTransferToggle() {
    const toggle = root.document.getElementById('classicFastToggle');
    if (!toggle) return;
    const supported = root.getClassicSubmitRoute?.()?.resultKind === 'url';
    const active = supported && store.getStorageModePreference?.() === 'fast';
    toggle.disabled = !supported;
    toggle.setAttribute('aria-checked', String(active));
    toggle.classList.toggle('active', active);
    const state = toggle.querySelector('.classic-fast-state');
    if (state) state.textContent = !supported ? '此线路不支持' : active ? '开' : '关';
    toggle.title = !supported
      ? '此线路返回图片数据，固定经本站传输'
      : '从上游直接下载原图，本站只保留预览；关闭时经本站传输，原图暂存 5 小时';
    syncRetentionNotice(active);
  }
  // With fast transfer on, the original is not kept in the cloud.
  function syncRetentionNotice(fast) {
    root.document.querySelectorAll('[data-retention-notice]').forEach(notice => {
      notice.innerHTML = fast
        ? '已开启极速：原图<strong>不在云端保存</strong>，从上游直接下载，请及时保存到本地；预览保留 30 天，生成记录长期保留。'
        : '原图云端仅保留 <strong>4 小时</strong>，请尽快下载到本地；预览保留 30 天，生成记录长期保留。';
    });
  }
  root.syncClassicTransferToggle = syncTransferToggle;
  root.downloadClassicUnprocessed = async () => {
    const records = await root.readHistoryRecordsFromDB?.() || [];
    let started = 0;
    for (const record of records) {
      if (record.ownerId !== owner()) continue;
      const info = await infoFor(record.assetId || record.id, record.fullUrl);
      if (info && !(await store.getState(info.id)).downloadState) {
        try { if (await downloadResult(info, record.prompt, true)) started++; } catch (error) { root.console?.warn('原图下载失败', error); }
      }
    }
    root.showSoftToast?.('已发起 ' + started + ' 张原图下载，请查看浏览器下载记录');
  };
  root.document.addEventListener('DOMContentLoaded', () => {
    syncPreference();
    root.document.getElementById('classicAutoDownload')?.addEventListener('change', event => store.setAutoDownloadPreference(event.target.checked));
    // Shares the canvas preference; disabled on lines without upstream links.
    root.document.getElementById('classicFastToggle')?.addEventListener('click', event => {
      const toggle = event.currentTarget;
      if (toggle.disabled) return;
      store.setStorageModePreference?.(toggle.getAttribute('aria-checked') === 'true' ? 'standard' : 'fast');
    });
  });
  root.addEventListener('storage', syncPreference);
  root.addEventListener('image-auto-download-change', syncPreference);
  root.addEventListener('image-storage-mode-change', syncPreference);
  root.addEventListener('auth-session-change', () => { reader = null; readerOwner = undefined; });
})(window);
