const { normalizeMidjourneyImageRequest } = require('./midjourneyImagePolicy.cjs');
const ROUTE_ID = 'midjourney-v8.2-mouxihub-fast';
const isMouxihubMidjourneyRoute = route => route?.id === ROUTE_ID;
const validTaskId = /^[a-zA-Z0-9_-]{1,128}$/;

const inputError = message => Object.assign(new Error(message), { status: 400 });
const getMidjourneyApiKey = route => String(route.apiKey || (route.apiKeyEnv && process.env[route.apiKeyEnv]) || '').trim().replace(/^Bearer\s+/i, '');
const isMidjourneyRouteReady = route => route.pointCost > 0 && (route.hasApiKey || Boolean(getMidjourneyApiKey(route)));

function buildMidjourneyInput(body) {
  const normalized = normalizeMidjourneyImageRequest(body);
  const references = normalized.images || (normalized.image ? [normalized.image] : []);
  const base64Array = [];
  const referenceUrls = [];
  for (const reference of references) {
    if (reference.startsWith('data:')) {
      base64Array.push(reference);
    } else {
      let url;
      try { url = new URL(reference); } catch { throw inputError('Midjourney 参考图 URL 无效'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw inputError('Midjourney 参考图 URL 无效');
      referenceUrls.push(url.href);
    }
  }
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const ratioPattern = /(?:^|\s)--(?:ar|aspect)(?:\s+|=)(\d+:\d+)(?=\s|$)/gi;
  const ratio = normalized.size;
  const prompt = rawPrompt
    .replace(ratioPattern, ' ')
    .replace(/(?:^|\s)--(?:v|version|niji)(?:\s+(?!--)\S+|=\S+)?(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)--(?:fast|relax|turbo)(?=\s|$)/gi, ' ')
    .trim();
  if (!prompt) throw inputError('请输入图片提示词');
  return { aspectRatio: ratio, payload: { prompt: [...referenceUrls, prompt, `--ar ${ratio} --v 8.2`].join(' '), base64Array } };
}

async function requestMidjourney(url, key, { payload, signal }) {
  const endpoint = new URL(url);
  if (endpoint.origin !== 'https://api.mouxihub.com' || endpoint.username || endpoint.password) {
    throw new Error('Midjourney 渠道地址必须使用 https://api.mouxihub.com');
  }
  if (!key) throw new Error('Midjourney 渠道未配置上游密钥');
  const response = await fetch(endpoint.href, {
    method: payload ? 'POST' : 'GET', signal, redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Midjourney 上游请求失败（HTTP ${response.status}）`), { status: response.status });
  }
  const raw = await response.text();
  return { raw, value: JSON.parse(raw) };
}

const providerError = (value, key, message) => typeof value === 'string' && value.trim()
  ? value.trim().split(key).join('[REDACTED]').slice(0, 500) : message;

async function submitMidjourneyImage(url, key, payload, signal) {
  const { raw, value } = await requestMidjourney(url, key, { payload, signal });
  if (![1, 22].includes(Number(value?.code))) {
    throw new Error(providerError(value?.description, key, 'Midjourney 未接受绘图任务'));
  }
  let taskId = value.result;
  if (typeof taskId === 'number') {
    // The upstream examples include numeric Discord IDs larger than Number.MAX_SAFE_INTEGER.
    const literal = [...raw.matchAll(/"result"\s*:\s*(\d+)(?=\s*[,}])/g)];
    taskId = literal.length === 1 ? literal[0][1] : '';
  }
  if (typeof taskId !== 'string' || !validTaskId.test(taskId)) throw new Error('Midjourney 未返回有效任务 ID');
  return taskId;
}

function imageResultUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value.trim())) return '';
  try {
    const url = new URL(value.trim());
    return url.username || url.password ? '' : value.trim();
  } catch {
    return '';
  }
}

function readImageResults(value) {
  for (const field of [value.imageUrls, value.image_urls]) {
    let items = field;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { continue; }
    }
    if (!Array.isArray(items)) continue;
    const results = [...new Set(items.map(item => imageResultUrl(item?.url ?? item)).filter(Boolean))];
    if (results.length) return results;
  }
  const fallback = imageResultUrl(value.imageUrl) || imageResultUrl(value.image_url);
  return fallback ? [fallback] : [];
}

async function pollMidjourneyImage(url, key, signal) {
  let value;
  try {
    ({ value } = await requestMidjourney(url, key, { signal }));
  } catch (error) {
    if ([400, 401, 403].includes(error.status)) return { status: 'failed', error: error.message };
    throw error;
  }
  const status = String(value?.status || '').toUpperCase();
  if (status === 'SUCCESS') {
    return { status: 'success', results: readImageResults(value) };
  }
  if (['FAILURE', 'FAILED', 'CANCEL', 'CANCELLED', 'MODAL'].includes(status)) {
    return { status: 'failed', error: providerError(value.failReason || value.description, key, `Midjourney 任务状态：${status}`) };
  }
  if (value?.code != null && ![1, 22].includes(Number(value.code))) {
    return { status: 'failed', error: providerError(value.description, key, 'Midjourney 查询任务失败') };
  }
  return { status: 'processing', progress: value?.progress };
}

module.exports = { ROUTE_ID, isMouxihubMidjourneyRoute, getMidjourneyApiKey, isMidjourneyRouteReady, buildMidjourneyInput, submitMidjourneyImage, pollMidjourneyImage };
