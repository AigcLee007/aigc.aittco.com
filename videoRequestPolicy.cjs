const { toNonNegativePoint } = require('./pointMath.cjs');
const targetCatalog = require('./config/pixelhubVideoCatalog.json');
const TARGET_MODEL_IDS = new Set((targetCatalog.models || []).map((model) => String(model.id || '')));

const badRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const uniqueUrls = (value) => {
  if (!Array.isArray(value)) {
    if (value === undefined || value === null) return [];
    throw badRequest('reference media must be an array');
  }

  const urls = [];
  for (const item of value) {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) throw badRequest('reference media URLs must use http or https');
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
};

const requireAllowedValue = (label, value, allowedValues) => {
  const values = Array.isArray(allowedValues) ? allowedValues.map((item) => String(item)) : [];
  if (!values.includes(value)) throw badRequest(`${label} is not supported by the selected model`);
};

const requireReferenceLimits = ({ images, videos, model }) => {
  const maxImages = Math.max(0, Number(model.maxReferenceImages || 0));
  const maxVideos = Math.max(0, Number(model.maxReferenceVideos || 0));
  const maxTotal = Math.max(0, Number(model.maxTotalReferences || 0));
  if (images.length > maxImages) throw badRequest(`reference image limit is ${maxImages}`);
  if (videos.length > maxVideos) throw badRequest(`reference video limit is ${maxVideos}`);
  if (images.length + videos.length > maxTotal) throw badRequest(`total reference limit is ${maxTotal}`);
  if (model.referenceImageMode === 'frames' && videos.length) throw badRequest('reference videos are not supported by the selected model');
};

const requirePromptLength = (prompt, maxLength) => {
  if (maxLength !== null && maxLength !== undefined && prompt.length > Number(maxLength)) {
    throw badRequest(`prompt exceeds the ${maxLength} character limit`);
  }
};

const normalizePixelHubVideoRequest = ({ body = {}, model, upstreamModel }) => {
  if (!model || typeof model !== 'object') throw badRequest('video model is required');
  if (!TARGET_MODEL_IDS.has(String(model.id || ''))) throw badRequest('upstream model does not match the selected model');
  const prompt = String(body.prompt || '').trim();
  const aspectRatio = String(body.aspectRatio || '').trim();
  const resolution = String(body.resolution || '').trim().toLowerCase();
  const duration = Number(body.duration);
  const images = uniqueUrls(body.referenceImages);
  const videos = uniqueUrls(body.referenceVideos);

  if (!prompt) throw badRequest('prompt is required');
  if (!Number.isInteger(duration)) throw badRequest('duration must be an integer');
  if (body.quantity !== undefined && Number(body.quantity) !== 1) throw badRequest('video quantity must be one');
  for (const field of ['video_reference', 'start_frame', 'end_frame', 'hd']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw badRequest(`${field} is not supported by the PixelHub request contract`);
    }
  }

  const expectedModel = String(model.requestModel || model.id || '').trim();
  if (!expectedModel || String(upstreamModel || '').trim() !== expectedModel) {
    throw badRequest('upstream model does not match the selected model');
  }
  requireAllowedValue('aspect ratio', aspectRatio, model.aspectRatioOptions);
  requireAllowedValue('resolution', resolution, model.resolutionOptions);
  requireAllowedValue('duration', String(duration), model.durationOptions);
  requireReferenceLimits({ images, videos, model });
  requirePromptLength(prompt, model.promptMaxLength);

  const upstreamBody = {
    model: expectedModel,
    prompt,
    aspect_ratio: aspectRatio,
    duration,
    resolution,
    generate_audio: true,
  };
  if (model.referenceImageMode === 'frames') {
    if (images.length) upstreamBody.image_urls = images;
  } else {
    if (images.length) upstreamBody.reference_image_urls = images;
    if (videos.length) upstreamBody.reference_videos = videos;
  }

  return {
    upstreamBody,
    pointCost: toNonNegativePoint(duration * Number(model.pointCostPerSecond || 0), 0),
  };
};

module.exports = { normalizePixelHubVideoRequest };
