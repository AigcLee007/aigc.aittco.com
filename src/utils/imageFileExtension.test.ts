import { expect, it } from 'vitest';
import { imageFileExtension } from './imageFileExtension';

it('uses the GIF MIME for signed, blob and misleading upstream URLs', () => {
  for (const src of ['blob:download', '/api/image-job-relay/job/0?token=test', 'https://cdn.test/image.png']) {
    expect(imageFileExtension(src, 'image/gif')).toBe('gif');
  }
  expect(imageFileExtension('/original.gif?token=test')).toBe('gif');
  expect(imageFileExtension('data:image/gif;base64,R0lGODlh')).toBe('gif');
  expect(imageFileExtension('/original', 'image/jpeg')).toBe('jpg');
});
