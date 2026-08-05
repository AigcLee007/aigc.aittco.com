const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { materializeVideoReferenceMedia } = require('./videoReferenceMedia.cjs');

describe('materializeVideoReferenceMedia', () => {
  it('converts image data URLs and relative video URLs to absolute URLs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-media-'));
    const req = {
      protocol: 'http',
      get: (name) => ({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com', host: 'internal:3365' }[name]),
    };
    const result = materializeVideoReferenceMedia({
      referenceImages: ['data:image/png;base64,aGVsbG8='],
      referenceVideos: ['/uploads/video-references/ref.mp4'],
    }, req, root);
    assert.match(result.referenceImages[0], /^https:\/\/app\.example\.com\/uploads\/video-frames\//);
    assert.deepStrictEqual(result.referenceVideos, ['https://app.example.com/uploads/video-references/ref.mp4']);
  });
});
