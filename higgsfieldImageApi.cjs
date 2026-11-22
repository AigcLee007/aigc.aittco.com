const { setTimeout: delay } = require('node:timers/promises');
const { isPublicImageUrl } = require('./imageJobAssets.cjs');

const HIGGSFIELD_ORIGIN = 'https://api.higgsfield.ai';
const HIGGSFIELD_IMAGE_TRANSPORT = 'higgsfield-image';
const HIGGSFIELD_IMAGE_MODELS = {
  'higgsfield-soul-2': {
    generate: '/higgsfield-ai/soul/v2/standard',
    edit: '/higgsfield-ai/soul/v2/image-to-image',
  },
  'higgsfield-soul-cinema': { generate: '/higgsfield-ai/soul/cinema' },
};
const ASPECT_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'];
const RESOLUTIONS = ['720p', '1080p'];
const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const isHiggsfieldImageModel = id => Object.hasOwn(HIGGSFIELD_IMAGE_MODELS, id);
const isHiggsfieldImageRoute = route => route?.transport === HIGGSFIELD_IMAGE_TRANSPORT;
const hasHiggsfieldImageKey = (key = process.env.HIGGSFIELD_API_KEY) =>
  /^[^:\s]+:[^:\s]+$/.test(String(key || '').trim());

const invalidInput = message => Object.assign(new Error(message), { status: 400 });

function buildHiggsfieldImageInput(modelId, body) {
  if (!isHiggsfieldImageModel(modelId)) throw invalidInput('Higgsfield 图片模型无效');
  const model = HIGGSFIELD_IMAGE_MODELS[modelId];
  const prompt = String(body.prompt || '').replace(/\s+--ar\s+\d+(?:\.\d+)?:\d+(?:\.\d+)?\s*$/i, '').trim();
  if (!prompt) throw invalidInput('请输入图片提示词');

  const requestedRatio = String(body.aspect_ratio || body.aspectRatio || (/^\d+:\d+$/.test(body.size) ? body.size : '')).trim().toLowerCase();
  const aspectRatio = ['', 'auto', 'smart'].includes(requestedRatio) ? '1:1' : requestedRatio;
  if (!ASPECT_RATIOS.includes(aspectRatio)) throw invalidInput('Higgsfield 不支持所选画幅比例');

  const size = String(body.resolution || body.image_size || body.imageSize || body.size || '').trim().toLowerCase();
  const resolution = !size || size === 'auto' || /^\d+:\d+$/.test(size) ? '720p' : size;
  if (!RESOLUTIONS.includes(resolution)) throw invalidInput('Higgsfield 分辨率仅支持 720p 或 1080p');
  const batchSize = Number(body.batch_size ?? body.n ?? 1);
  if (![1, 4].includes(batchSize)) throw invalidInput('Higgsfield 单次请求只支持 1 或 4 张图片');

  const candidates = [
    ...(Array.isArray(body.images) ? body.images : []),
    ...(Array.isArray(body.image_urls) ? body.image_urls : []),
    body.image,
    body.image_url,
  ];
  const references = [...new Set(candidates.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  if (references.length > 1) throw invalidInput('Higgsfield Soul 2.0 每次仅支持一张参考图');
  const reference = references[0] || '';
  if (body.mask) throw invalidInput('Higgsfield 不支持蒙版编辑');
  if (reference && !model.edit) throw invalidInput('Higgsfield Soul Cinema 不支持上传参考图');
  if (reference && !isHttpsImageUrl(reference)) getUploadFile(reference);

  return {
    path: reference ? model.edit : model.generate,
    input: { prompt, aspect_ratio: aspectRatio, resolution, batch_size: batchSize },
    reference,
  };
}

function isHttpsImageUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') && isPublicImageUrl(value);
}

function getUploadFile(reference) {
  const dataUrl = /^data:(image\/[\w.+-]+);base64,([a-z0-9+/]+=*)$/i.exec(reference);
  const encoded = dataUrl?.[2] || reference;
  const mime = dataUrl?.[1]?.toLowerCase() || (
    encoded.startsWith('/9j/') ? 'image/jpeg' : encoded.startsWith('UklGR') ? 'image/webp'
      : encoded.startsWith('R0lGOD') ? 'image/gif' : 'image/png'
  );
  if (!UPLOAD_MIME_TYPES.includes(mime) || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw invalidInput('参考图须为公开 HTTPS 图片或 PNG、JPEG、WebP、GIF 文件');
  }
  return { mime, buffer: Buffer.from(encoded, 'base64') };
}

function getAuthorization(key = process.env.HIGGSFIELD_API_KEY) {
  if (!hasHiggsfieldImageKey(key)) {
    throw Object.assign(new Error('Higgsfield 服务端密钥尚未配置'), { status: 503 });
  }
  return `Key ${key.trim()}`;
}

const HTTP_MESSAGES = {
  400: 'Higgsfield 拒绝了请求参数',
  401: 'Higgsfield 密钥无效，请联系管理员',
  403: 'Higgsfield 余额不足或当前账户无权调用',
  404: 'Higgsfield 当前账户无法访问该模型或任务',
  422: 'Higgsfield 未接受生成参数',
  423: 'Higgsfield 模型暂不可用',
  429: 'Higgsfield 请求过多，请稍后再试',
};

async function requestHiggsfield(path, options, { fetch = globalThis.fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(`${HIGGSFIELD_ORIGIN}${path}`, {
    ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw Object.assign(new Error(HTTP_MESSAGES[response.status] || 'Higgsfield 服务暂不可用'), {
      status: response.status,
    });
  }
  return response.json();
}

async function uploadReference(reference, authorization, options) {
  if (isHttpsImageUrl(reference)) return reference;
  const { mime, buffer } = getUploadFile(reference);
  const upload = await requestHiggsfield('/files/generate-upload-url', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: mime }),
  }, options);
  if (!isHttpsImageUrl(upload.upload_url) || !isHttpsImageUrl(upload.public_url)) {
    throw new Error('Higgsfield 返回了无效的参考图上传地址');
  }
  const headers = Object.fromEntries(Object.entries(upload.upload_headers || {}).filter(([name]) =>
    !['authorization', 'proxy-authorization', 'cookie', 'hf-api-key', 'hf-secret'].includes(name.toLowerCase()),
  ));
  if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['Content-Type'] = mime;
  const timeout = AbortSignal.timeout(30000);
  const response = await (options.fetch || globalThis.fetch)(upload.upload_url, {
    method: 'PUT', headers, body: buffer, redirect: 'error',
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('参考图上传到 Higgsfield 失败');
  return upload.public_url;
}

async function submitHiggsfieldImage(modelId, body, idempotencyKey, options = {}) {
  const authorization = getAuthorization(options.key);
  const { path, input, reference } = buildHiggsfieldImageInput(modelId, body);
  if (reference) input.image_url = await uploadReference(reference, authorization, options);
  const submit = () => requestHiggsfield(path, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }, options);
  let result;
  try {
    result = await submit();
  } catch (error) {
    if ((error.status && error.status < 500) || options.signal?.aborted) throw error;
    await delay(500, undefined, { signal: options.signal });
    result = await submit();
  }
  const requestId = result.request_id;
  if (typeof requestId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(requestId)) {
    throw new Error('Higgsfield 未返回有效的任务编号');
  }
  return requestId;
}

async function pollHiggsfieldImage(requestId, options = {}) {
  if (typeof requestId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(requestId)) {
    return { status: 'failed', error: 'Higgsfield 任务编号无效' };
  }
  let result;
  try {
    result = await requestHiggsfield(`/requests/${requestId}/status`, {
      method: 'GET', headers: { Authorization: getAuthorization(options.key) },
    }, options);
  } catch (error) {
    if ([400, 401, 403, 404, 422].includes(error.status) || !hasHiggsfieldImageKey(options.key)) {
      return { status: 'failed', error: error.message };
    }
    throw error;
  }
  switch (result.status) {
    case 'completed': {
      const results = (Array.isArray(result.images) ? result.images : []).map(image => image?.url).filter(isHttpsImageUrl);
      return results.length ? { status: 'succeeded', results } : { status: 'failed', error: 'Higgsfield 未返回图片' };
    }
    case 'failed': return { status: 'failed', error: 'Higgsfield 图片生成失败' };
    case 'nsfw': return { status: 'failed', error: 'Higgsfield 内容审核未通过' };
    case 'canceled': return { status: 'failed', error: 'Higgsfield 图片任务已取消' };
    case 'queued': return { status: 'queued' };
    default: return { status: 'processing' };
  }
}

module.exports = {
  HIGGSFIELD_IMAGE_TRANSPORT, isHiggsfieldImageModel, isHiggsfieldImageRoute, hasHiggsfieldImageKey,
  buildHiggsfieldImageInput, submitHiggsfieldImage, pollHiggsfieldImage,
};
