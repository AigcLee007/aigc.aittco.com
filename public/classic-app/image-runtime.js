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

  function createPreviewDecodeQueue(concurrency = 1) {
    const pending = [];
    let active = 0;
    function drain() {
      while (active < concurrency && pending.length) {
        const item = pending.shift();
        active += 1;
        Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => {
          active -= 1;
          drain();
        });
      }
    }
    return {
      run(work) {
        return new Promise((resolve, reject) => {
          pending.push({ work, resolve, reject });
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
      return { blob: previewBlob, width, height, version: 1 };
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
    const decodeQueue = createPreviewDecodeQueue(1);
    const preparationQueue = createPreviewDecodeQueue(1);
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
    const validate = (blob) => decodeQueue.run(() => options.validateBlob(blob));
    const persist = async (operation) => {
      try { await operation(); } catch (_) { /* Storage is optional when unavailable or full. */ }
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
      if (variant === 'preview') {
        const preview = await readLocal(() => options.readPreview(id));
        if (preview?.version === 1 && await validate(preview.blob).catch(() => false)) {
          return { ...preview, status: 'ready', source: 'local' };
        }
      }
      const original = await readOriginal(id, input.src);
      if (signal.aborted) throw new Error('Image read cancelled');
      if (original) {
        try {
          if (variant === 'preview') {
            const preview = await decodeQueue.run(() => {
              if (signal.aborted) throw new Error('Image read cancelled');
              return options.makePreview(original);
            });
            if (signal.aborted) throw new Error('Image read timed out');
            await persist(() => options.writePreview(id, preview));
            return { ...preview, status: 'ready', source: 'local' };
          }
          if (await validate(original)) return { blob: original, status: 'ready', source: 'local' };
        } catch (_) { /* Try the canonical remote source without deleting local bytes. */ }
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
            const preview = await decodeQueue.run(() => {
              if (signal.aborted) throw new Error('Image read cancelled');
              return options.makePreview(blob);
            });
            if (signal.aborted) throw new Error('Image read timed out');
            if (src === input.src) await persist(() => options.writeOriginal(id, blob));
            await persist(() => options.writePreview(id, preview));
            return { ...preview, status: 'ready', source: 'remote' };
          }
          if (!await validate(blob)) throw new Error('Invalid image data');
          if (signal.aborted) throw new Error('Image read timed out');
          await persist(() => options.writeOriginal(id, blob));
          return { blob, status: 'ready', source: 'remote' };
        } catch (caught) { error = caught; }
      }
      return { status: error ? 'failed' : 'missing', error };
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
        entry.promise = withTimeout(() => variant === 'preview' ? preparationQueue.run(work) : work(), timeoutMs, () => controller.abort())
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
      const result = await (cancellation ? Promise.race([entry.promise, cancellation]) : entry.promise);
      if (abort) input.signal.removeEventListener('abort', abort);
      if (cancelled) return { status: 'idle', release() {} };
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
        const lease = await reader.acquire({ ...binding.input, variant: 'preview', signal: binding.controller.signal });
        if (bindings.get(binding.element) !== binding || generation !== binding.generation || binding.element.isConnected === false) {
          lease.release();
          return;
        }
        if (lease.status !== 'ready') {
          onState(binding.element, lease.status || 'failed');
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
        onState(binding.element, 'ready');
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
