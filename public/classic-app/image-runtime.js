(function (root) {
  'use strict';

  function withTimeout(work, timeoutMs = 15000, onTimeout) {
    let timer;
    return Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) onTimeout();
          reject(new Error('Image read timed out'));
        }, timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  function createPreviewDecodeQueue(concurrency = 1, { maxPending = 128, waitMs = 120000 } = {}) {
    const pending = [];
    let active = 0;
    const error = (message, code) => Object.assign(new Error(message), { code });
    function remove(item) {
      clearTimeout(item.timer);
      item.signal?.removeEventListener('abort', item.abort);
      const index = pending.indexOf(item);
      if (index >= 0) pending.splice(index, 1);
    }
    function drain() {
      while (active < concurrency && pending.length) {
        const item = pending.shift();
        remove(item);
        active += 1;
        item.onStart?.();
        Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => {
          active -= 1;
          drain();
        });
      }
    }
    return {
      run(work, { signal, onQueued, onStart } = {}) {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) { reject(error('Image read cancelled', 'CANCELLED')); return; }
          if (active >= concurrency && pending.length >= maxPending) { reject(error('Image queue is full', 'QUEUE_FULL')); return; }
          const item = { work, resolve, reject, signal, onStart };
          item.abort = () => { remove(item); reject(error('Image read cancelled', 'CANCELLED')); };
          signal?.addEventListener('abort', item.abort, { once: true });
          if (active >= concurrency) {
            onQueued?.();
            item.timer = setTimeout(() => { remove(item); reject(error('Image queue wait timed out', 'QUEUE_TIMEOUT')); }, waitMs);
          }
          pending.push(item);
          drain();
        });
      },
    };
  }

  async function decodeBrowserBlob(blob, timeoutMs = 15000) {
    if (!blob?.size || !blob.type?.startsWith('image/')) throw new Error('Invalid image data');
    if (typeof root.createImageBitmap === 'function') {
      let expired = false;
      const result = Promise.resolve().then(() => root.createImageBitmap(blob)).then((bitmap) => {
        if (expired) {
          bitmap.close();
          throw new Error('Image read timed out');
        }
        return bitmap;
      });
      return withTimeout(() => result, timeoutMs, () => { expired = true; });
    }
    const image = new root.Image();
    const url = root.URL.createObjectURL(blob);
    const close = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      root.URL.revokeObjectURL(url);
    };
    try {
      await withTimeout(() => new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Image decode failed'));
        image.src = url;
      }), timeoutMs, close);
      return { width: image.naturalWidth, height: image.naturalHeight, image, close };
    } catch (error) { close(); throw error; }
  }

  async function makeBrowserPreview(blob, options = {}) {
    const maxEdge = Number(options.maxEdge || 720);
    const bitmap = await decodeBrowserBlob(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width || 1, bitmap.height || 1));
    const width = Math.max(1, Math.round((bitmap.width || 1) * scale));
    const height = Math.max(1, Math.round((bitmap.height || 1) * scale));
    const canvas = root.document.createElement('canvas');
    try {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap.image || bitmap, 0, 0, width, height);
      const previewBlob = await withTimeout(() => new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Image preview encode failed')), options.mimeType || 'image/webp', 0.82);
      }), 15000);
      return { blob: previewBlob, width, height, originalWidth: bitmap.width, originalHeight: bitmap.height, version: 1 };
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  function createUrlRegistry() {
    const owners = new Map();
    const counts = new Map();
    function release(owner) {
      const url = owners.get(owner);
      if (!url) return;
      owners.delete(owner);
      const count = (counts.get(url) || 1) - 1;
      if (count > 0) counts.set(url, count);
      else {
        counts.delete(url);
        root.URL.revokeObjectURL(url);
      }
    }
    return {
      retain(owner, url) {
        if (owners.get(owner) === url) return;
        release(owner);
        owners.set(owner, url);
        counts.set(url, (counts.get(url) || 0) + 1);
      },
      release,
    };
  }

  function createAssetReader(options) {
    const entries = new Map();
    const pendingOriginals = new Map();
    const idsBySource = new Map();
    const queueOptions = { maxPending: options.maxPending || 128, waitMs: options.queueWaitMs || 120000 };
    const decodeQueue = options.decodeQueue || createPreviewDecodeQueue(1, queueOptions);
    // A full original is retained only by the currently preparing preview.
    const preparationQueue = createPreviewDecodeQueue(1, queueOptions);
    const timeoutMs = options.timeoutMs || 45000;
    const urlRegistry = createUrlRegistry();
    let ownerId = 0;

    function register(input) {
      if (input.id && input.src) idsBySource.set(input.src, input.id);
    }
    function trim() {
      let bytes = 0;
      const unused = [...entries.values()].filter((entry) => entry.refs === 0 && entry.result);
      unused.sort((a, b) => b.usedAt - a.usedAt);
      unused.forEach((entry, index) => {
        bytes += entry.result.blob?.size || 0;
        if (entry.variant === 'original' || index >= 12 || bytes > 8 * 1024 * 1024) {
          entries.delete(entry.key);
        }
      });
    }
    const validate = (blob, signal) => decodeQueue.run(() => withTimeout(() => options.validateBlob(blob), timeoutMs), { signal });
    const validateOriginal = (blob, signal) => options.validateOriginalBlob
      ? withTimeout(() => options.validateOriginalBlob(blob), timeoutMs)
      : validate(blob, signal);
    const persist = async (operation) => {
      try { await withTimeout(operation, Math.min(timeoutMs, 15000)); return { saved: true }; }
      catch (cacheError) { return { saved: false, cacheError }; }
    };
    const readLocal = async (operation) => {
      try { return await withTimeout(operation, Math.min(timeoutMs, 15000)); } catch (_) { return null; }
    };
    function readOriginal(id, src) {
      const key = src || id;
      if (!pendingOriginals.has(key)) {
        const pending = readLocal(() => options.readOriginal(id, src));
        pendingOriginals.set(key, pending);
        pending.finally(() => pendingOriginals.delete(key));
      }
      return pendingOriginals.get(key);
    }

    async function resolve(input, signal) {
      const id = input.id || idsBySource.get(input.src) || input.src;
      if (!id && !input.src && !input.previewSrc) return { status: 'missing' };
      const variant = input.variant || 'preview';
      const cache = { originalCached: false, previewCached: false, cacheError: null };
      const save = async (kind, operation) => {
        const result = await persist(operation);
        cache[`${kind}Cached`] = result.saved;
        if (result.cacheError) cache.cacheError = result.cacheError;
      };
      if (variant === 'preview') {
        const preview = await readLocal(() => options.readPreview(id));
        if (preview?.version === 1 && await validate(preview.blob, signal).catch(() => false)) {
          cache.previewCached = true;
          const saved = options.getCacheState ? await readLocal(() => options.getCacheState(id)) : null;
          return { ...preview, ...cache, ...(saved || {}), status: 'ready', source: 'local' };
        }
      }
      const original = await readOriginal(id, input.src);
      if (signal.aborted) throw new Error('Image read cancelled');
      if (original) {
        try {
          cache.originalCached = true;
          if (variant === 'preview') {
            const preview = await decodeQueue.run(() => {
              if (signal.aborted) throw new Error('Image read cancelled');
              return withTimeout(() => options.makePreview(original), timeoutMs);
            }, { signal });
            if (signal.aborted) throw new Error('Image read timed out');
            await save('preview', () => options.writePreview(id, preview));
            return { ...preview, ...cache, status: 'ready', source: 'local' };
          }
          if (await validateOriginal(original, signal)) return { blob: original, ...cache, status: 'ready', source: 'local' };
          cache.originalCached = false;
        } catch (_) { if (variant === 'original') cache.originalCached = false; /* Preview encoding failure preserves original bytes. */ }
      }
      const sources = variant === 'preview'
        ? [...new Set([input.previewSrc, input.src].filter(Boolean))]
        : [input.src].filter(Boolean);
      let error;
      for (const src of sources) {
        if (signal.aborted) throw new Error('Image read timed out');
        try {
          const blob = await withTimeout(() => options.fetchBlob(src, signal), Math.min(timeoutMs, 15000));
          if (signal.aborted) throw new Error('Image read timed out');
          if (variant === 'preview') {
            if (src === input.src && blob?.size && blob.type?.startsWith('image/')) await save('original', () => options.writeOriginal(id, blob));
            const preview = await decodeQueue.run(() => {
              if (signal.aborted) throw new Error('Image read cancelled');
              return withTimeout(() => options.makePreview(blob), timeoutMs);
            }, { signal });
            if (signal.aborted) throw new Error('Image read timed out');
            await save('preview', () => options.writePreview(id, preview));
            return { ...preview, ...cache, status: 'ready', source: 'remote' };
          }
          if (!await validateOriginal(blob, signal)) throw new Error('Invalid image data');
          if (signal.aborted) throw new Error('Image read timed out');
          await save('original', () => options.writeOriginal(id, blob));
          return { blob, ...cache, status: 'ready', source: 'remote' };
        } catch (caught) { error = caught; }
      }
      return { ...cache, status: error ? 'failed' : 'missing', error };
    }

    async function acquire(input = {}) {
      if (input.signal?.aborted) return { status: 'idle', release() {} };
      if (input.previewSrc === input.src) input = { ...input, previewSrc: '' };
      register(input);
      const variant = input.variant || 'preview';
      const key = `${variant}:${input.src || input.id || ''}:${input.previewSrc || ''}`;
      let entry = entries.get(key);
      if (input.retry && entry?.refs === 0) {
        entries.delete(key);
        entry = null;
      }
      if (!entry) {
        const controller = new AbortController();
        entry = { key, variant, refs: 0, usedAt: Date.now(), result: null, url: '' };
        entry.controller = controller;
        const work = () => {
          if (controller.signal.aborted) return { status: 'failed', error: new Error('Image read timed out') };
          return resolve(input, controller.signal);
        };
        entry.promise = (variant === 'preview' ? preparationQueue.run(() => withTimeout(work, timeoutMs, () => controller.abort()), {
          signal: controller.signal, onQueued: input.onQueued, onStart: input.onStart,
        }) : withTimeout(work, timeoutMs, () => controller.abort()))
          .catch((error) => ({ status: 'failed', error }))
          .then((result) => { entry.result = result; trim(); return result; });
        entries.set(key, entry);
      }
      entry.refs += 1;
      let abort;
      let cancelled = false;
      const cancellation = input.signal ? new Promise((resolve) => {
        abort = () => {
          cancelled = true;
          entry.refs -= 1;
          if (entry.refs === 0 && !entry.result) {
            entry.controller.abort();
            if (entries.get(key) === entry) entries.delete(key);
          }
          resolve({ status: 'idle' });
        };
        input.signal.addEventListener('abort', abort, { once: true });
      }) : null;
      let result = await (cancellation ? Promise.race([entry.promise, cancellation]) : entry.promise);
      if (options.getCacheState) {
        const refresh = readLocal(() => options.getCacheState(input.id || idsBySource.get(input.src) || input.src));
        const cache = await (cancellation ? Promise.race([refresh, cancellation]) : refresh);
        if (cache) {
          const unavailableOriginal = variant === 'original' && result.status !== 'ready' && result.originalCached === false;
          result = { ...result, ...cache };
          if (unavailableOriginal) result.originalCached = false;
        }
      }
      if (abort) input.signal.removeEventListener('abort', abort);
      if (cancelled) { trim(); return { status: 'idle', release() {} }; }
      if (result.status !== 'ready') {
        entry.refs -= 1;
        trim();
        return { ...result, release() {} };
      }
      if (!entry.url) entry.url = root.URL.createObjectURL(result.blob);
      const owner = ++ownerId;
      const url = entry.url;
      urlRegistry.retain(owner, url);
      let released = false;
      return {
        ...result, url,
        release() {
          if (released) return;
          released = true;
          urlRegistry.release(owner);
          entry.refs -= 1;
          entry.usedAt = Date.now();
          if (entry.refs === 0) entry.url = '';
          trim();
        },
      };
    }
    return { acquire, register };
  }

  function createImageBinder({ reader, onState = () => {}, IntersectionObserver: Observer = root.IntersectionObserver } = {}) {
    const bindings = new Map();
    const observer = Observer ? new Observer((entries) => {
      entries.forEach((entry) => {
        const binding = bindings.get(entry.target);
        if (!binding) return;
        if (entry.isIntersecting || entry.intersectionRatio > 0) load(binding);
        else {
          binding.generation += 1;
          release(binding);
        }
      });
    }) : null;
    function release(binding) {
      if (binding.controller) binding.controller.abort();
      binding.controller = null;
      binding.loading = false;
      if (binding.lease) {
        binding.lease.release();
        binding.lease = null;
      }
      if (binding.element) {
        if (binding.onError) binding.element.removeEventListener?.('error', binding.onError);
        binding.onError = null;
        binding.element.removeAttribute('src');
        binding.element.removeAttribute('data-image-state');
      }
    }
    async function load(binding) {
      if (binding.loading || binding.lease || !bindings.has(binding.element)) return;
      binding.loading = true;
      binding.controller = new AbortController();
      const generation = ++binding.generation;
      onState(binding.element, 'reading');
      try {
        const current = () => bindings.get(binding.element) === binding && generation === binding.generation;
        const lease = await reader.acquire({ ...binding.input, variant: 'preview', signal: binding.controller.signal,
          onQueued: () => { if (current()) onState(binding.element, 'queued'); },
          onStart: () => { if (current()) onState(binding.element, 'reading'); },
        });
        if (bindings.get(binding.element) !== binding || generation !== binding.generation || binding.element.isConnected === false) {
          lease.release();
          return;
        }
        if (lease.status !== 'ready') {
          onState(binding.element, lease.status || 'failed', lease);
          return;
        }
        binding.lease = lease;
        binding.onError = () => {
          release(binding);
          onState(binding.element, 'failed');
        };
        binding.element.addEventListener?.('error', binding.onError, { once: true });
        binding.element.src = lease.url;
        binding.element.dataset.imageState = 'ready';
        onState(binding.element, 'ready', lease);
      } catch (_) {
        if (bindings.get(binding.element) === binding && generation === binding.generation) onState(binding.element, 'failed');
      } finally {
        if (bindings.get(binding.element) === binding && generation === binding.generation) {
          binding.loading = false;
        }
      }
    }
    return {
      bind(element, input) {
        const old = bindings.get(element);
        if (old) {
          old.generation += 1;
          release(old);
        }
        const binding = { element, input, generation: 0, loading: false, lease: null };
        bindings.set(element, binding);
        if (observer) observer.observe(element);
        else load(binding);
        return () => this.unbind(element);
      },
      unbind(element) {
        const binding = bindings.get(element);
        if (!binding) return;
        binding.generation += 1;
        bindings.delete(element);
        if (observer) observer.unobserve(element);
        release(binding);
      },
    };
  }

  root.ClassicImageRuntime = { withTimeout, createPreviewDecodeQueue, createUrlRegistry, createAssetReader, decodeBrowserBlob, makeBrowserPreview, createImageBinder };
})(globalThis);
