const { toNonNegativePoint } = require('./pointMath.cjs');
const targetCatalog = require('./config/pixelhubVideoCatalog.json');
const TARGET_MODEL_IDS = new Set((targetCatalog.models || []).map((model) => String(model.id || '')));
const GROK_MODEL_ID = 'grok-imagine-video-1.5';
const OMNI_FLASH_MODEL_ID = 'omni_flash-10s';

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
    if (!/^https:\/\//i.test(url)) throw badRequest('reference media URLs must use https');
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
  if (model.referenceImageMode === 'frames' && videos.length > 0 && model.supportsVideoReference !== true) {
    throw badRequest('reference videos are not supported by the selected model');
  }
};

const requirePromptLength = (prompt, maxLength) => {
  if (maxLength !== null && maxLength !== undefined && prompt.length > Number(maxLength)) {
    throw badRequest(`prompt exceeds the ${maxLength} character limit`);
  }
};

const normalizeMode = (value, body) => {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'image_to_video' || raw === 'image') return 'image';
  if (raw === 'reference_to_video' || raw === 'reference' || raw === 'references') return 'reference';
  if (raw === 'first_last' || raw === 'firstlast' || raw === 'frames' || raw === 'start_end') return 'first_last';
  if (raw === 'keyframe' || raw === 'keyframes') return 'keyframes';
  if (raw === 'text_to_video' || raw === 'text') return 'text';
  if (body?.keyframes) return 'keyframes';
  if (body?.startFrame || body?.lastFrame || body?.firstFrame || body?.endFrame) return 'first_last';
  if (body?.image) return 'image';
  if (Array.isArray(body?.referenceImages) && body.referenceImages.length > 1) return 'reference';
  if (Array.isArray(body?.referenceImages) && body.referenceImages.length === 1) return 'image';
  return 'text';
};

const normalizeHttpsUrl = (value, label) => {
  const rawValue = value && typeof value === 'object' ? value.url : value;
  const url = String(rawValue || '').trim();
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) throw badRequest(`${label} URL must use https`);
  return url;
};

const normalizeGrokVideoRequest = ({ body = {}, model, upstreamModel }) => {
  const expectedModel = String(model.requestModel || model.id || '').trim();
  if (expectedModel !== GROK_MODEL_ID || String(upstreamModel || '').trim() !== GROK_MODEL_ID) {
    throw badRequest('upstream model does not match the selected model');
  }
  const prompt = String(body.prompt || '').trim();
  const aspectRatio = String(body.aspectRatio || body.aspect_ratio || '').trim();
  const resolution = String(body.resolution || '').trim().toLowerCase();
  const duration = Number(body.duration);
  const mode = normalizeMode(body.generationMode || body.videoMode || body.mode, body);
  const referenceImages = uniqueUrls(body.referenceImages);
  const referenceVideos = uniqueUrls(body.referenceVideos);
  const startFrame = normalizeHttpsUrl(body.startFrame || body.firstFrame || body.start_frame, 'start frame');
  const lastFrame = normalizeHttpsUrl(body.lastFrame || body.endFrame || body.last_frame || body.end_frame, 'last frame');
  const directImage = normalizeHttpsUrl(body.image?.url || body.image, 'image');
  const keyframes = Array.isArray(body.keyframes) ? body.keyframes : [];

  if (!Number.isInteger(duration) || duration < 1 || duration > 15) throw badRequest('duration must be an integer from 1 to 15 seconds');
  requireAllowedValue('aspect ratio', aspectRatio, model.aspectRatioOptions);
  requireAllowedValue('resolution', resolution, model.resolutionOptions);
  if (mode === 'reference' && resolution === '1080p') throw badRequest('reference video mode supports up to 720p');
  if (body.quantity !== undefined && Number(body.quantity) !== 1) throw badRequest('video quantity must be one');
  if (referenceVideos.length) throw badRequest('reference videos are not supported by Grok Imagine Video 1.5');
  requireReferenceLimits({ images: referenceImages, videos: [], model });
  if (mode === 'image' && (directImage || referenceImages[0])) {
    if (referenceImages.length > 1) throw badRequest('image to video accepts one image');
  }
  if (mode === 'first_last' && referenceImages.length > 2) throw badRequest('first and last frame accepts at most two images');
  if (mode === 'keyframes' && keyframes.length > 4) throw badRequest('keyframe limit is 4');
  if (keyframes.length > 4) throw badRequest('keyframe limit is 4');
  if (!prompt && !directImage && !referenceImages.length && !startFrame && !lastFrame && !keyframes.length) {
    throw badRequest('prompt is required when no media is provided');
  }
  requirePromptLength(prompt, model.promptMaxLength);

  const upstreamBody = { model: GROK_MODEL_ID };
  if (prompt) upstreamBody.prompt = prompt;
  // Mouxihub's strict video gateway expects the duration as a string in
  // `seconds`; it rejects the shared PixelHub `duration` field.
  upstreamBody.seconds = String(duration);
  upstreamBody.aspect_ratio = aspectRatio;
  upstreamBody.resolution = resolution;

  if (mode === 'image') {
    const url = directImage || referenceImages[0];
    if (!url) throw badRequest('image is required for image to video');
    upstreamBody.image = { url };
  } else if (mode === 'reference') {
    if (!referenceImages.length) throw badRequest('reference images are required for reference to video');
    upstreamBody.reference_images = referenceImages.map((url) => ({ url }));
  } else if (mode === 'first_last') {
    const first = startFrame || referenceImages[0];
    const last = lastFrame || referenceImages[1];
    if (!first && !last) throw badRequest('first or last frame is required');
    if (first) upstreamBody.image = { url: first };
    if (last) upstreamBody.last_frame = { url: last };
  } else if (mode === 'keyframes') {
    if (!keyframes.length) throw badRequest('keyframes are required');
    upstreamBody.keyframes = keyframes.map((item, index) => {
      const image = normalizeHttpsUrl(item?.image?.url || item?.image || item?.url, `keyframe ${index + 1}`);
      const timestamp = Number(item?.timestamp_s ?? item?.timestamp ?? item?.time);
      if (!image) throw badRequest(`keyframe ${index + 1} image is required`);
      if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp >= duration) throw badRequest('keyframe timestamp must be greater than 0 and less than duration');
      if (Math.abs(timestamp * 3 - Math.round(timestamp * 3)) > 1e-6) throw badRequest('keyframe timestamp must use a 1/3 second grid');
      return { image: { url: image }, timestamp_s: timestamp };
    });
  }

  return {
    upstreamBody,
    providerSummary: { model: GROK_MODEL_ID, generationMode: mode, duration, referenceImageCount: referenceImages.length, keyframeCount: keyframes.length },
    pointCost: toNonNegativePoint(model.pricingMode === 'per_second' ? duration * Number(model.pointCostPerSecond || 0) : Number(model.selectorCost || 0), 0),
  };
};

const normalizeOmniFlashVideoRequest = ({ body = {}, model, upstreamModel }) => {
  if (!model || String(model.id || '').trim() !== OMNI_FLASH_MODEL_ID || String(upstreamModel || '').trim() !== OMNI_FLASH_MODEL_ID) {
    throw badRequest('upstream model does not match the selected model');
  }

  const prompt = String(body.prompt || '').trim();
  const aspectRatio = String(body.aspectRatio || body.aspect_ratio || '').trim();
  const resolution = String(body.resolution || '').trim().toLowerCase();
  const duration = Number(body.duration);
  const mode = normalizeMode(body.generationMode || body.videoMode || body.mode, body);
  const images = uniqueUrls(body.referenceImages);
  const videos = uniqueUrls(body.referenceVideos);
  const startFrame = normalizeHttpsUrl(body.startFrame || body.firstFrame || body.start_frame, 'first frame');
  const lastFrame = normalizeHttpsUrl(body.lastFrame || body.endFrame || body.last_frame || body.end_frame, 'last frame');

  if (!prompt) throw badRequest('prompt is required');
  if (!Number.isInteger(duration)) throw badRequest('duration must be an integer');
  if (body.quantity !== undefined && Number(body.quantity) !== 1) throw badRequest('video quantity must be one');
  if (body.n !== undefined && Number(body.n) !== 1) throw badRequest('video quantity must be one');
  if (Object.prototype.hasOwnProperty.call(body, 'audioReference') || Object.prototype.hasOwnProperty.call(body, 'audio_reference')) {
    throw badRequest('audio reference is not supported by the selected model');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'seed') || Object.prototype.hasOwnProperty.call(body, 'preprocess')) {
    throw badRequest('seed and preprocess are not supported by the selected model');
  }
  if (mode === 'keyframes' || Array.isArray(body.keyframes)) throw badRequest('keyframes are not supported by the selected model');
  if (mode === 'first_last' && images.length > 2) throw badRequest('first and last frame accepts at most two images');
  if (mode === 'image' && images.length > 1) throw badRequest('image to video accepts one image');
  if (startFrame && images.length && startFrame !== images[0]) throw badRequest('first frame must match the first reference image');
  if (lastFrame && images.length > 1 && lastFrame !== images[1]) throw badRequest('last frame must match the second reference image');

  requireAllowedValue('aspect ratio', aspectRatio, model.aspectRatioOptions);
  requireAllowedValue('resolution', resolution, model.resolutionOptions);
  requireAllowedValue('duration', String(duration), model.durationOptions);
  requireReferenceLimits({ images, videos, model });
  requirePromptLength(prompt, model.promptMaxLength);

  const upstreamBody = {
    model: OMNI_FLASH_MODEL_ID,
    prompt,
    images,
    videos,
    aspect_ratio: aspectRatio,
    size: aspectRatio === '9:16' ? '720x1280' : '1280x720',
    resolution,
    duration: 10,
    generateAudio: true,
    n: 1,
  };

  const first = startFrame || images[0];
  const last = lastFrame || images[1];
  if (mode === 'first_last' || startFrame || lastFrame) {
    if (first) upstreamBody.first_frame_url = first;
    if (last) upstreamBody.last_frame_url = last;
  }

  return {
    upstreamBody,
    providerSummary: {
      model: OMNI_FLASH_MODEL_ID,
      generationMode: mode,
      referenceImageCount: images.length,
      referenceVideoCount: videos.length,
    },
    pointCost: toNonNegativePoint(Number(model.selectorCost || 0), 0),
  };
};

const normalizePixelHubVideoRequest = ({ body = {}, model, upstreamModel, transport, route } = {}) => {
  const isGrok = String(model?.id || '') === GROK_MODEL_ID || String(model?.requestModel || '') === GROK_MODEL_ID || String(upstreamModel || '') === GROK_MODEL_ID;
  if (isGrok) return normalizeGrokVideoRequest({ body, model, upstreamModel });
  if (!model || typeof model !== 'object') throw badRequest('video model is required');
  if (!TARGET_MODEL_IDS.has(String(model.id || ''))) throw badRequest('upstream model does not match the selected model');
  if (String(model.id || '').trim() === OMNI_FLASH_MODEL_ID) {
    return normalizeOmniFlashVideoRequest({ body, model, upstreamModel });
  }
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
    if (Object.prototype.hasOwnProperty.call(body, field)) throw badRequest(`${field} is not supported by the PixelHub request contract`);
  }
  const expectedModel = String(model.requestModel || model.id || '').trim();
  if (!expectedModel || String(upstreamModel || '').trim() !== expectedModel) throw badRequest('upstream model does not match the selected model');
  requireAllowedValue('aspect ratio', aspectRatio, model.aspectRatioOptions);
  requireAllowedValue('resolution', resolution, model.resolutionOptions);
  requireAllowedValue('duration', String(duration), model.durationOptions);
  requireReferenceLimits({ images, videos, model });
  requirePromptLength(prompt, model.promptMaxLength);
  const upstreamBody = { model: expectedModel, prompt, aspect_ratio: aspectRatio, duration, resolution };
  if (expectedModel === 'gemini-omni-1.1-flash') {
    if (images[0]) upstreamBody.first_frame_url = images[0];
    if (images[1]) upstreamBody.last_frame_url = images[1];
    if (videos.length) upstreamBody.videos = videos;
    upstreamBody.generateAudio = true;
    upstreamBody.n = 1;
  } else if (expectedModel === 'gemini-omni-flash') {
    if (images.length) upstreamBody.image_urls = images;
    if (videos.length) upstreamBody.video_urls = videos;
  } else if (model.referenceImageMode === 'frames') {
    if (images.length) upstreamBody.image_urls = images;
    upstreamBody.generate_audio = true;
  } else {
    if (images.length) upstreamBody.reference_image_urls = images;
    if (videos.length) upstreamBody.reference_videos = videos;
    upstreamBody.generate_audio = true;
  }
  return { upstreamBody, providerSummary: { model: expectedModel, referenceImageCount: images.length, referenceVideoCount: videos.length }, pointCost: toNonNegativePoint(model.pricingMode === 'per_second' ? duration * Number(model.pointCostPerSecond || 0) : Number(model.selectorCost || 0), 0) };
};

module.exports = { normalizePixelHubVideoRequest, normalizeGrokVideoRequest, normalizeOmniFlashVideoRequest };
