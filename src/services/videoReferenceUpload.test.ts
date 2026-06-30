import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./accountIdentity', () => ({
  getAuthorizedBillingHeaders: vi.fn(async () => ({
    'X-Auth-Session': 'session-token',
  })),
}));

import { uploadVideoReferenceFile } from './videoReferenceUpload';

describe('videoReferenceUpload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a local video file and returns the public url', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'reference.mp4', {
      type: 'video/mp4',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ url: '/uploads/video-references/reference.mp4' }),
      })),
    );

    await expect(uploadVideoReferenceFile(file)).resolves.toBe(
      '/uploads/video-references/reference.mp4',
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/video-reference/upload',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Auth-Session': 'session-token',
        }),
      }),
    );
  });

  it('rejects when the server returns an error', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'reference.mp4', {
      type: 'video/mp4',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: '上传失败' }),
      })),
    );

    await expect(uploadVideoReferenceFile(file)).rejects.toThrow('上传失败');
  });
});
