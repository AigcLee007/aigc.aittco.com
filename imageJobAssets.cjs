const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const axios = require('axios');
const sharp = require('sharp');

const STORAGE_ROOT = path.join(__dirname, 'storage', 'image-jobs');
const TTL_MS = 5 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_TTL_MS = 30 * 60 * 1000;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' };
const statusError = (message, status = 404) => Object.assign(new Error(message), { status });
function publicAddress(address) {
  const ip = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  if (net.isIP(ip) === 6) {
    if (ip.startsWith('::ffff:')) {
      const tail = ip.slice(7);
      if (net.isIP(tail) === 4) return publicAddress(tail);
      const parts = tail.split(':');
      if (parts.length === 2) {
        const high = parseInt(parts[0], 16), low = parseInt(parts[1], 16);
        return publicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
      return false;
    }
    return !(/^(::|fc|fd|fe[89abcdef]|ff|2001:db8|64:ff9b|2002:)/.test(ip));
  }
  return false;
}
function isPublicImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (net.isIP(host)) return publicAddress(host);
    return host.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
  } catch { return false; }
}
function safeSegment(value) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(value || ''))) throw statusError('Invalid asset location');
  return String(value);
}
function limiter(concurrency, maxQueued = 64) {
  let active = 0;
  const waiting = [];
  return async work => {
    if (active >= concurrency) {
      if (waiting.length >= maxQueued) throw new Error('Image save queue is full');
      await new Promise(resolve => waiting.push(resolve));
    } else active++;
    try { return await work(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}
function createImageJobAssets(options = {}) {
  const root = path.resolve(options.root || STORAGE_ROOT);
  const assetRoot = path.join(root, 'assets');
  const now = options.now || Date.now;
  const configuredTtl = Number(options.ttlMs ?? process.env.IMAGE_JOB_RETENTION_MS);
  const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : TTL_MS;
  const configuredPreviewTtl = Number(options.previewTtlMs ?? process.env.IMAGE_PREVIEW_RETENTION_MS);
  const previewTtl = Number.isFinite(configuredPreviewTtl) && configuredPreviewTtl > 0 ? configuredPreviewTtl : PREVIEW_TTL_MS;
  const maxBytes = Math.max(1024, Number(options.maxBytes || process.env.GENERATED_ASSET_MAX_BYTES || 52428800));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS || 120000));
  const retries = Math.max(0, Math.min(2, Number(options.retries ?? 1)));
  const slot = limiter(Math.max(1, Math.min(4, Number(options.downloadConcurrency || 2))));
  const previewSlot = limiter(1);
  let keyPromise;
  const background = new Set();
  function track(work) {
    background.add(work);
    work.finally(() => background.delete(work)).catch(() => {});
  }
  const getKey = () => {
    if (!keyPromise) keyPromise = (async () => {
      await fs.mkdir(root, { recursive: true });
      const keyFile = path.join(root, 'asset-signing-key');
      try { await fs.writeFile(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const key = await fs.readFile(keyFile);
      if (key.length !== 32) throw new Error('Invalid asset signing key');
      return key;
    })().catch(error => { keyPromise = null; throw error; });
    return keyPromise;
  };
  const signature = async (userId, taskId, expires) => crypto.createHmac('sha256', await getKey()).update(`${userId}/${taskId}/${expires}`).digest('hex');
  const previewSignature = async (userId, taskId, filename) => crypto.createHmac('sha256', await getKey()).update(`preview/v1/${userId}/${taskId}/${filename}`).digest('hex');
  async function makeUrl(context, filename, expires) {
    const user = safeSegment(context.userId), task = safeSegment(context.taskId);
    return `/api/image-job-assets/${user}/${task}/${filename}?token=${expires}.${await signature(user, task, expires)}`;
  }
  async function atomicWrite(filename, data) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temp = `${filename}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, filename); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  async function metadata(buffer) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    if (buffer.length > maxBytes) throw new Error('Generated image exceeds save size limit');
    const meta = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata();
    if (meta.format === 'heif' && meta.compression === 'av1') meta.format = 'avif';
    if (!MIME[meta.format] || !meta.width || !meta.height) throw new Error('Generated result is not a supported image');
    return meta;
  }
  async function saveOriginal(buffer, context, expires) {
    const meta = await metadata(buffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const filename = `${hash}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
    const directory = path.join(assetRoot, safeSegment(context.userId), safeSegment(context.taskId));
    const absolute = path.join(directory, filename);
    await atomicWrite(absolute, buffer);
    return { absolute, directory, hash, url: await makeUrl(context, filename, expires), expires };
  }
  // A high-quality JPEG is far smaller than a PNG original for slow connections.
  async function saveFastCopy(asset, context, expires) {
    if (/\.jpe?g$/i.test(asset.absolute)) return null;
    const filename = `${asset.hash}.fast.jpg`;
    const buffer = await sharp(asset.absolute, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    if (buffer.length >= (await fs.stat(asset.absolute)).size * 0.8) return null;
    await atomicWrite(path.join(asset.directory, filename), buffer);
    return makeUrl(context, filename, expires);
  }
  async function savePreview(asset, context) {
    const filename = `${asset.hash}.preview.webp`;
    const buffer = await sharp(asset.absolute, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    await atomicWrite(path.join(asset.directory, filename), buffer);
    const user = safeSegment(context.userId), task = safeSegment(context.taskId);
    return `/api/image-job-assets/${user}/${task}/${filename}?token=preview.${await previewSignature(user, task, filename)}`;
  }
  function checkedLookup(hostname, lookupOptions, callback) {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) return callback(new Error('Private image source is not permitted'));
      const family = Number(lookupOptions?.family || 0);
      const matching = family ? addresses.filter(entry => entry.family === family) : addresses;
      if (!matching.length) return callback(new Error('Image source address unavailable'));
      if (lookupOptions?.all) callback(null, matching);
      else callback(null, matching[0].address, matching[0].family);
    });
  }
  async function download(source) {
    if (!isPublicImageUrl(source)) throw new Error('Unsupported image source');
    const httpAgent = new http.Agent({ lookup: checkedLookup });
    const httpsAgent = new https.Agent({ lookup: checkedLookup });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let stream;
    try {
      const response = await axios.get(source, {
        responseType: 'stream', timeout: timeoutMs, signal: controller.signal,
        httpAgent, httpsAgent, proxy: false, maxRedirects: 3,
        maxContentLength: maxBytes, maxBodyLength: maxBytes,
        headers: { Accept: 'image/*', 'Accept-Encoding': 'identity' },
        beforeRedirect: redirect => {
          const url = `${redirect.protocol}//${redirect.hostname}${redirect.path || '/'}`;
          if (!isPublicImageUrl(url)) throw new Error('Unsupported image redirect');
        },
      });
      stream = response.data;
      if (Number(response.headers['content-length'] || 0) > maxBytes) throw new Error('Image exceeds save size limit');
      const chunks = []; let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('Image exceeds save size limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, bytes);
    } finally {
      clearTimeout(timer); controller.abort(); stream?.destroy(); httpAgent.destroy(); httpsAgent.destroy();
    }
  }
  function compact(payload, urls, previewUrl, storageStatus) {
    return {
      ...(payload?.model ? { model: String(payload.model).slice(0, 120) } : {}),
      ...(payload?.text ? { text: String(payload.text).slice(0, 4000) } : {}),
      status: 'succeeded', images: urls, results: urls, data: urls.map(url => ({ url })),
      preview_url: previewUrl || null, thumbnail_url: previewUrl || null, storage_status: storageStatus,
    };
  }
  // storageMode: 'auto' | 'stable' keep a server original; 'speed' keeps only a
  // preview and leaves upstream links (or a short delivery copy for inline
  // bytes). Severe disk pressure applies speed handling to every request.
  async function prepare({ payload = null, resultUrls = [], context, onSaved, storageMode = 'auto' } = {}) {
    safeSegment(context?.userId); safeSegment(context?.taskId);
    const sources = [...new Set(resultUrls.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    if (!sources.length || sources.length > 12) throw new Error('Invalid generated image count');
    const speed = storageMode === 'speed' || Boolean(health.disk && health.disk.usedRatio >= 0.92);
    // Inline bytes have no upstream link, so speed mode still needs a brief copy to deliver them.
    const expires = now() + (speed ? Math.min(ttl, DELIVERY_TTL_MS) : ttl);
    const info = { model: payload?.model, text: payload?.text };
    const entries = [];
    const remote = [];
    for (const source of sources) {
      const match = source.match(/^data:image\/(png|jpe?g|webp|gif|avif);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (match) {
        if (match[2].length > Math.ceil(maxBytes * 4 / 3) + 8) throw new Error('Generated image exceeds save size limit');
        const buffer = Buffer.from(match[2], 'base64');
        const asset = await saveOriginal(buffer, context, expires);
        entries.push({ url: asset.url, asset, state: 'saved' });
      } else if (/^\/generated-assets\/line4\/(original|thumb)\//.test(source)) {
        // The legacy provider already saved this image on a mounted volume.
        entries.push({ url: source, state: 'saved', preview: source.replace('/original/', '/thumb/').replace(/\.[a-zA-Z0-9]+(?=$|[?#])/, '.webp') });
      } else if (source.startsWith('/api/image-job-assets/')) {
        const url = new URL(source, 'https://asset.local');
        const parts = url.pathname.split('/');
        if (parts[3] !== context.userId || parts[4] !== context.taskId) throw new Error('Image source belongs to another task');
        const absolute = await resolveAsset({ userId: parts[3], taskId: parts[4], filename: parts[5], token: url.searchParams.get('token') });
        entries.push({ url: source, state: 'saved', asset: { absolute, directory: path.dirname(absolute), hash: parts[5].split('.')[0] } });
      } else if (isPublicImageUrl(source)) {
        // The upstream link is offered for direct download in every mode.
        const entry = { url: source, state: 'pending', direct: source };
        entries.push(entry); remote.push({ source, entry });
      } else throw new Error('Unsupported generated image source');
    }
    const snapshot = () => {
      const urls = entries.map(entry => entry.url);
      const storageStatus = entries.some(entry => entry.state === 'pending' || (entry.asset && !entry.preview && !entry.previewFailed))
        ? 'pending' : entries.some(entry => entry.state === 'failed' || entry.previewFailed) ? 'failed' : 'saved';
      const previewUrl = entries[0]?.preview || null;
      const previewUrls = entries.map(entry => entry.preview || null);
      // Fast copies and direct links are optional alternatives per output.
      const fastUrls = entries.map(entry => entry.fast || null);
      const directUrls = entries.map(entry => entry.direct || null);
      const storageError=entries.find(entry=>entry.error)?.error||null;
      return { payload: { ...compact(info, urls, previewUrl, storageStatus), preview_urls: previewUrls, fast_urls: fastUrls, direct_urls: directUrls, storage_mode: speed ? 'speed' : storageMode }, resultUrls: urls, previewUrl, previewUrls, fastUrls, directUrls, storageMode: speed ? 'speed' : storageMode, storageStatus, storageError };
    };
    const notify = async () => {
      if (onSaved) await onSaved(snapshot());
    };
    const preview = async entry => {
      try {
        for (let attempt = 0; ; attempt++) {
          try { entry.preview = await previewSlot(() => savePreview(entry.asset, context)); break; }
          catch (error) { if (attempt >= 1) throw error; }
        }
        // The fast copy only helps downloads; its failure never affects the result.
        if (!entry.direct || !speed) entry.fast = await previewSlot(() => saveFastCopy(entry.asset, context, entry.asset.expires || expires)).catch(error => {
          options.logger?.warn?.({ type: 'Image fast copy failed', taskId: context.taskId, message: error.message }); return null;
        });
      }
      catch (error) {
        entry.previewFailed = true;
        entry.error = String(error.message||'Image preview save failed').slice(0,1000);
        options.logger?.warn?.({ type: 'Image preview save failed', taskId: context.taskId, message: error.message });
        await notify().catch(() => {});
        return; // Original is already available; never refund a successful generation.
      }
      await notify().catch(() => {});
    };
    // Commit previews before returning saved inline/local originals. A process
    // restart after success must not lose the only long-term representation.
    for (const entry of entries) if (entry.asset) await preview(entry);
    // Speed-mode delivery copies of inline bytes go once their short link expires;
    // the regular sweep removes them later if the process restarts first.
    if (speed) for (const entry of entries) if (entry.asset && !entry.direct) {
      const timer = setTimeout(() => {
        for (const file of [entry.asset.absolute, path.join(entry.asset.directory, `${entry.asset.hash}.fast.jpg`)]) fs.unlink(file).catch(() => {});
      }, Math.max(0, expires - now()));
      timer.unref?.();
    }
    const initial = snapshot();
    for (const { source, entry } of remote) track(slot(async () => {
      try {
        let buffer;
        for (let attempt = 0; ; attempt++) {
          try { buffer = await (options.download || download)(source); break; }
          catch (error) {
            if (attempt >= retries) throw error;
            await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 1000));
          }
        }
        entry.asset = await saveOriginal(Buffer.from(buffer), context, expires);
        // Speed mode keeps the upstream link as the result; the copy only feeds the preview.
        if (!speed) entry.url = entry.asset.url;
        entry.state = 'saved';
        // Publishing is metadata work; it cannot change a successfully saved original.
        await preview(entry);
        if (speed) { await fs.unlink(entry.asset.absolute).catch(() => {}); entry.asset.removed = true; }
        await notify().catch(() => {});
      } catch (error) {
        entry.state = 'failed'; entry.error=String(error.message||'Image save failed').slice(0,1000);await notify().catch(() => {});
      }
    }).catch(async error => { entry.state = 'failed';entry.error=String(error.message||'Image save failed').slice(0,1000);await notify().catch(() => {}); }));
    return initial;
  }
  async function resolveAsset({ userId, taskId, filename, token }) {
    const user = safeSegment(userId), task = safeSegment(taskId);
    if (!/^[a-f0-9]{64}(\.preview|\.fast)?\.(png|jpg|webp|avif|gif)$/.test(String(filename))) throw statusError('Asset not found');
    const permanent = String(token || '').match(/^preview\.([a-f0-9]{64})$/);
    const isPreview = /^[a-f0-9]{64}\.preview\.webp$/.test(filename);
    const match = String(token || '').match(/^(\d+)\.([a-f0-9]{64})$/);
    if ((!permanent && !match) || (permanent && !isPreview)) throw statusError('Asset not found');
    const expected = permanent ? await previewSignature(user, task, filename) : await signature(user, task, match[1]);
    const supplied = permanent ? permanent[1] : match[2];
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw statusError('Asset not found');
    // Valid old preview links remain readable after upgrade. Original access
    // still requires an unexpired original capability.
    if (!isPreview && Number(match[1]) <= now()) throw statusError('云端原图已过期，请使用已下载的本地原图', 410);
    const absolute = path.join(assetRoot, user, task, filename);
    try { await fs.access(absolute); } catch { throw statusError('Asset not found'); }
    return absolute;
  }
  // Disk pressure shortens how long originals stay; previews keep their own period.
  const statfs = options.statfs || (fs.statfs ? directory => fs.statfs(directory) : null);
  async function diskUsage() {
    try {
      const stat = await statfs?.(root);
      const total = Number(stat?.blocks) * Number(stat?.bsize), free = Number(stat?.bavail) * Number(stat?.bsize);
      return total > 0 && Number.isFinite(free) ? { usedRatio: 1 - free / total, freeBytes: free, totalBytes: total } : null;
    } catch { return null; }
  }
  const originalTtlFor = disk => !disk ? ttl : disk.usedRatio >= 0.92 ? Math.min(ttl, 15 * 60 * 1000) : disk.usedRatio >= 0.85 ? Math.min(ttl, 60 * 60 * 1000) : ttl;
  const health = { lastSuccessAt: null, lastError: null, consecutiveFailures: 0, overdueOriginals: 0, removedOriginals: 0, removedPreviews: 0, originalTtlMs: ttl, previewTtlMs: previewTtl, disk: null };
  async function cleanup() {
    try {
      const disk = await diskUsage();
      const originalTtl = originalTtlFor(disk);
      const originalCutoff = now() - originalTtl, previewCutoff = now() - previewTtl;
      // Originals left more than an hour past their period mean cleanup is not keeping up.
      const overdueCutoff = originalCutoff - 60 * 60 * 1000;
      let removedOriginals = 0, removedPreviews = 0, overdueOriginals = 0;
      async function visit(directory) {
        let children; try { children = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const child of children) {
          const full = path.join(directory, child.name);
          if (child.isDirectory()) {
            await visit(full);
            // Fresh empty directories may belong to a write between mkdir and rename.
            const stat = await fs.stat(full).catch(() => null);
            if (stat && stat.mtimeMs < Math.min(originalCutoff, previewCutoff)) await fs.rmdir(full).catch(() => {});
          } else if (child.isFile()) {
            const isPreview = /^[a-f0-9]{64}\.preview\.webp$/.test(child.name);
            const stat = await fs.stat(full).catch(() => null);
            if (!stat || stat.mtimeMs >= (isPreview ? previewCutoff : originalCutoff)) continue;
            const removed = await fs.unlink(full).then(() => true, () => false);
            if (removed) isPreview ? removedPreviews++ : removedOriginals++;
            else if (!isPreview && stat.mtimeMs < overdueCutoff) overdueOriginals++;
          }
        }
      }
      await visit(assetRoot);
      Object.assign(health, { lastSuccessAt: new Date(now()).toISOString(), lastError: null, consecutiveFailures: 0, overdueOriginals, removedOriginals, removedPreviews, originalTtlMs: originalTtl, disk });
      if (originalTtl < ttl) options.logger?.warn?.({ type: 'Image storage pressure', message: `磁盘已用 ${Math.round(disk.usedRatio * 100)}%，原图保留缩短为 ${Math.round(originalTtl / 60000)} 分钟` });
      return { ...health };
    } catch (error) {
      health.consecutiveFailures++; health.lastError = String(error.message || error).slice(0, 500);
      throw error;
    }
  }
  const getHealth = () => ({ ...health });
  async function drain() { while (background.size) await Promise.allSettled([...background]); }
  return { prepare, resolveAsset, cleanup, drain, getHealth };
}
module.exports = { createImageJobAssets, STORAGE_ROOT, isPublicImageUrl };
