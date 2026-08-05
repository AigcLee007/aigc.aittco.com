const {
  normalizePublicVideoFrameUrl,
  toAbsolutePublicUrl,
} = require('./videoFrameUpload.cjs');

const toArray = (value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

const materializeVideoReferenceMedia = (body = {}, req, baseDir) => ({
  ...body,
  referenceImages: toArray(body.referenceImages).map((value, index) =>
    normalizePublicVideoFrameUrl(value, req, `reference-${index + 1}`, baseDir),
  ),
  referenceVideos: toArray(body.referenceVideos).map((value) => toAbsolutePublicUrl(value, req)),
});

module.exports = { materializeVideoReferenceMedia, toArray };
