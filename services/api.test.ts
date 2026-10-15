import { describe, expect, it } from 'vitest';
import { findAllUrlsInObject, normalizeImageResultValue } from './api';

describe('image result URL parsing', () => {
  it('treats JPEG base64 as image bytes instead of a site path', () => {
    const base64 = `/9j/${'A'.repeat(120)}`;
    expect(normalizeImageResultValue(base64)).toBe(`data:image/jpeg;base64,${base64}`);
    const results: string[] = [];
    findAllUrlsInObject({ data: [{ b64_json: base64 }] }, results);
    expect(results).toEqual([`data:image/jpeg;base64,${base64}`]);
    expect(normalizeImageResultValue(`data:image/jpg;base64,${base64.match(/.{1,60}/g)!.join('\n')}`)).toBe(`data:image/jpeg;base64,${base64}`);
  });

  it('preserves the MIME type of supported image base64 and keeps local asset URLs', () => {
    for (const [prefix, mime] of [['iVBOR', 'png'], ['UklGR', 'webp'], ['R0lGOD', 'gif']]) {
      const base64 = `${prefix}${'A'.repeat(120)}`;
      expect(normalizeImageResultValue(base64)).toBe(`data:image/${mime};base64,${base64}`);
    }
    expect(normalizeImageResultValue('/api/image-job-assets/user/job/image.jpg?token=test')).toBe('/api/image-job-assets/user/job/image.jpg?token=test');
  });

  it('does not wrap http image URLs as base64 data URLs', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(normalizeImageResultValue(url)).toBe(url);
  });

  it('unwraps http URLs that were incorrectly stored as base64 data URLs', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(normalizeImageResultValue(`data:image/png;base64,${url}`)).toBe(url);
  });

  it('extracts Visionary results URLs without corrupting them', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';
    const results: string[] = [];

    findAllUrlsInObject(
      {
        id: 'id',
        status: 'succeeded',
        results: [{ url, content: '' }],
      },
      results,
    );

    expect(results).toEqual([url]);
  });

  it('extracts b64_json URL values without corrupting them', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';
    const results: string[] = [];

    findAllUrlsInObject(
      {
        id: 'id',
        status: 'succeeded',
        data: [{ b64_json: `data:image/png;base64,${url}` }],
      },
      results,
    );

    expect(results).toEqual([url]);
  });
});
