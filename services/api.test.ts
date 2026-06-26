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
});
