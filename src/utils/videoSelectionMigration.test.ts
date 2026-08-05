import { describe, expect, it } from 'vitest';
import { migrateVideoSelectionState } from './videoSelectionMigration';

describe('migrateVideoSelectionState', () => {
  it('maps legacy HD and single video reference fields', () => {
    expect(migrateVideoSelectionState({ videoHd: true, videoReferenceUrl: 'https://app.test/ref.mp4' }))
      .toMatchObject({ videoResolution: '1080p', videoReferenceVideos: [{ url: 'https://app.test/ref.mp4' }] });
  });

  it('uses Gemini defaults for empty legacy state', () => {
    expect(migrateVideoSelectionState({})).toMatchObject({
      videoModel: 'gemini-omni-flash', videoResolution: '720p', videoReferenceVideos: [],
    });
  });
});
