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
  async function prepare({ payload = null, resultUrls = [], context, onSaved } = {}) {
    safeSegment(context?.userId); safeSegment(context?.taskId);
    const sources = [...new Set(resultUrls.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    if (!sources.length || sources.length > 12) throw new Error('Invalid generated image count');
    const expires = now() + ttl;
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
        const entry = { url: source, state: 'pending' };
        entries.push(entry); remote.push({ source, entry });
      } else throw new Error('Unsupported generated image source');
    }
    const snapshot = () => {
      const urls = entries.map(entry => entry.url);
      const storageStatus = entries.some(entry => entry.state === 'pending' || (entry.asset && !entry.preview && !entry.previewFailed))
        ? 'pending' : entries.some(entry => entry.state === 'failed' || entry.previewFailed) ? 'failed' : 'saved';
      const previewUrl = entries[0]?.preview || null;
      const previewUrls = entries.map(entry => entry.preview || null);
      return { payload: { ...compact(info, urls, previewUrl, storageStatus), preview_urls: previewUrls }, resultUrls: urls, previewUrl, previewUrls, storageStatus };
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
      }
      catch (error) {
        entry.previewFailed = true;
        options.logger?.warn?.({ type: 'Image preview save failed', taskId: context.taskId, message: error.message });
        await notify().catch(() => {});
        return; // Original is already available; never refund a successful generation.
      }
      await notify().catch(() => {});
    };
    // Commit previews before returning saved inline/local originals. A process
    // restart after success must not lose the only long-term representation.
    for (const entry of entries) if (entry.asset) await preview(entry);
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
        entry.url = entry.asset.url; entry.state = 'saved';
        // Publishing is metadata work; it cannot change a successfully saved original.
        await preview(entry); await notify().catch(() => {});
      } catch {
        entry.state = 'failed'; await notify().catch(() => {});
      }
    }).catch(async () => { entry.state = 'failed'; await notify().catch(() => {}); }));
    return initial;
  }
  async function resolveAsset({ userId, taskId, filename, token }) {
    const user = safeSegment(userId), task = safeSegment(taskId);
    if (!/^[a-f0-9]{64}(\.preview)?\.(png|jpg|webp|avif|gif)$/.test(String(filename))) throw statusError('Asset not found');
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
  async function cleanup() {
    const cutoff = now() - ttl;
    async function visit(directory) {
      let children; try { children = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const child of children) {
        const full = path.join(directory, child.name);
        if (child.isDirectory()) {
          await visit(full);
          // Fresh empty directories may belong to a write between mkdir and rename.
          const stat = await fs.stat(full).catch(() => null);
          if (stat && stat.mtimeMs < cutoff) await fs.rmdir(full).catch(() => {});
        } else if (child.isFile()) {
          if (/^[a-f0-9]{64}\.preview\.webp$/.test(child.name)) continue;
          const stat = await fs.stat(full).catch(() => null);
          if (stat && stat.mtimeMs < cutoff) await fs.unlink(full).catch(() => {});
        }
      }
    }
    await visit(assetRoot);
  }
  async function drain() { while (background.size) await Promise.allSettled([...background]); }
  return { prepare, resolveAsset, cleanup, drain };
}
module.exports = { createImageJobAssets, STORAGE_ROOT, isPublicImageUrl };
