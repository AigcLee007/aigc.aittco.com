import { describe, expect, it } from 'vitest';
import { findAllUrlsInObject, normalizeImageResultValue } from './api';

describe('image result URL parsing', () => {
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
