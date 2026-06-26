import { describe, expect, it } from 'vitest';
import { findAllUrlsInObject, normalizeImageResultValue } from './api';

describe('image result URL parsing', () => {
  it('does not wrap http image URLs as base64 data URLs', () => {
    const url = 'https://visionary.beer/api/generations/id/image?token=abc';

    expect(normalizeImageResultValue(url)).toBe(url);
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

  it('extracts local generated asset URLs returned after server-side persistence', () => {
    const url = '/generated-assets/line4/original/2026/06/27/test/image.png';
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
});
