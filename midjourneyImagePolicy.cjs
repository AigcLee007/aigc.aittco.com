const MODEL_ID = 'midjourney-v8.2-tehui';
const UPSTREAM_MODEL = 'Midjourney-全系列';
const RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'];
const QUALITIES = ['0.25', '0.5', '1', '2'];
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const isMidjourneyImageRoute = (route = {}) => route.modelFamily === MODEL_ID;

const normalizeMidjourneyImageRequest = (body = {}) => {
  if (body.n !== undefined && Number(body.n) !== 1) invalid('Midjourney 每次请求固定 n=1，一组生成四张图片');
  if (body.mask) invalid('Midjourney 不支持蒙版编辑');
  const size = String(body.image_size || body.imageSize || body.size || '1k').trim().toLowerCase();
  if (size !== '1k' && !RATIOS.includes(size)) invalid('Midjourney 当前仅支持标准画质');
  const ratio = String(body.aspect_ratio || body.aspectRatio || (RATIOS.includes(size) ? size : '1:1')).trim();
  if (!RATIOS.includes(ratio)) invalid('Midjourney 不支持所选画面比例');
  const quality = String(body.quality ?? 'auto').trim();
  if (quality !== 'auto' && !QUALITIES.includes(quality)) invalid('Midjourney 不支持所选画质');
  if (body.hd !== undefined && body.hd !== false) invalid('Midjourney 当前仅支持标准画质');
  const images = [...new Set([...(Array.isArray(body.images) ? body.images : []), ...(Array.isArray(body.image) ? body.image : body.image ? [body.image] : [])].filter(Boolean))];
  if (images.length > 1) invalid('Midjourney 最多支持一张参考图');
  if (images.some(image => typeof image !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(image))) invalid('Midjourney 参考图须为公网 URL 或图片 data URL');
  return {
    model: UPSTREAM_MODEL, prompt: body.prompt, size: ratio, n: 1, version: '8.2',
    response_format: 'url', stream: false,
    ...(images.length ? { image: images[0] } : {}),
  };
};

const normalizeMidjourneyImageTask = (payload = {}) => {
  const items = Array.isArray(payload.result?.data) ? payload.result.data : Array.isArray(payload.data) ? payload.data : [];
  const taskId = payload.task_id || payload.taskId || payload.id || '';
  return {
    ...(taskId ? { id: taskId, task_id: taskId } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    ...(payload.progress !== undefined ? { progress: payload.progress } : {}),
    ...(payload.error ? { error: payload.error } : {}),
    ...(payload.message ? { message: payload.message } : {}),
    ...(payload.failure_reason ? { failure_reason: payload.failure_reason } : {}),
    data: items.filter(item => item && (typeof item.url === 'string' || typeof item.b64_json === 'string'))
      .map(item => item.url ? { url: item.url } : { b64_json: item.b64_json }),
  };
};

module.exports = { MODEL_ID, DISCOUNT_ROUTE_ID: 'midjourney-v8.2-osodm-tehui', UPSTREAM_MODEL, RATIOS, QUALITIES, isMidjourneyImageRoute, normalizeMidjourneyImageRequest, normalizeMidjourneyImageTask };
