import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const {
  parseVideoReferenceDataUrl,
  validateVideoReferenceUpload,
  VIDEO_REFERENCE_MAX_BYTES,
} = require('./videoReferenceUpload.cjs');

describe('video reference upload helpers', () => {
  it('parses supported video data urls', () => {
    const parsed = parseVideoReferenceDataUrl('data:video/mp4;base64,AQIDBA==');
    expect(parsed).toMatchObject({
      mime: 'video/mp4',
      ext: 'mp4',
    });
    expect(parsed.buffer.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  it('rejects unsupported mime types', () => {
    expect(() =>
      validateVideoReferenceUpload('data:video/avi;base64,AQIDBA=='),
    ).toThrow('参考视频格式无效，仅支持 MP4、WEBM、MOV');
  });

  it('rejects oversized videos', () => {
    const payload = Buffer.alloc(VIDEO_REFERENCE_MAX_BYTES + 1, 1).toString('base64');
    expect(() =>
      validateVideoReferenceUpload(`data:video/mp4;base64,${payload}`),
    ).toThrow('参考视频不能超过 50MB');
  });
});
