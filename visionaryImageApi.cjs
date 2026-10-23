const normalizeVisionaryImageRequest = (requestBody = {}) => {
  const body = { ...requestBody };
  const imageSize =
    body.resolution || body.image_size || body.imageSize ||
    (/^(1k|2k|4k)$/i.test(String(body.size || '').trim()) ? body.size : '');
  const aspectRatio = body.aspect_ratio || body.aspectRatio || body.ratio;

  if (aspectRatio) body.size = String(aspectRatio).trim();
  else if (/^(1k|2k|4k)$/i.test(String(body.size || '').trim())) delete body.size;
  if (imageSize) body.resolution = String(imageSize).trim().toUpperCase();

  delete body.aspect_ratio;
  delete body.aspectRatio;
  delete body.image_size;
  delete body.imageSize;
  delete body.ratio;
  delete body.isSync;

  if (!Array.isArray(body.images) && body.image) body.images = [body.image];
  delete body.image;
  return body;
};

const getVisionaryDataItem = (payload = {}) =>
  Array.isArray(payload.data) ? payload.data[0] || {} : payload.data && typeof payload.data === 'object' ? payload.data : payload;

const extractVisionarySubmission = (payload = {}) => {
  const item = getVisionaryDataItem(payload);
  return {
    taskId: String(item.task_id || item.taskId || item.id || '').trim(),
    status: String(item.status || item.state || '').trim().toUpperCase(),
  };
};

const unwrapVisionaryTask = (payload = {}) => getVisionaryDataItem(payload);

module.exports = {
  normalizeVisionaryImageRequest,
  extractVisionarySubmission,
  unwrapVisionaryTask,
};
