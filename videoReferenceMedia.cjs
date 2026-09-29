const {
  normalizePublicVideoFrameUrl,
  toAbsolutePublicUrl,
} = require('./videoFrameUpload.cjs');

const toArray = (value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const materializeFrameValue = (value, req, label, baseDir) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.url !== undefined) return { ...value, url: normalizePublicVideoFrameUrl(value.url, req, label, baseDir) };
    return value;
  }
  return normalizePublicVideoFrameUrl(value, req, label, baseDir);
};
const materializeVideoReferenceMedia = (body = {}, req, baseDir) => {
  const next = {
    ...body,
    referenceImages: toArray(body.referenceImages).map((value, index) => normalizePublicVideoFrameUrl(value, req, `reference-${index + 1}`, baseDir)),
    referenceVideos: toArray(body.referenceVideos).map((value) => toAbsolutePublicUrl(value, req)),
  };
  for (const [key, label] of [['startFrame', 'start-frame'], ['lastFrame', 'last-frame'], ['firstFrame', 'first-frame'], ['endFrame', 'end-frame'], ['start_frame', 'start-frame'], ['last_frame', 'last-frame'], ['end_frame', 'end-frame']]) {
    if (next[key] !== undefined) next[key] = materializeFrameValue(next[key], req, label, baseDir);
  }
  if (next.image !== undefined) next.image = materializeFrameValue(next.image, req, 'image', baseDir);
  if (Array.isArray(next.keyframes)) next.keyframes = next.keyframes.map((frame, index) => ({ ...frame, image: materializeFrameValue(frame?.image || frame?.url, req, `keyframe-${index + 1}`, baseDir) }));
  return next;
};
module.exports = { materializeVideoReferenceMedia, toArray };
