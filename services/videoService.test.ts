import { describe, expect, it } from 'vitest';
import {
  buildInternalVideoRequest,
  extractVideoOutputUrl,
  isVideoTaskInProgressStatus,
  VIDEO_POLL_DEADLINE_MS,
  VIDEO_POLL_INTERVAL_MS,
} from './videoService';

describe('videoService internal request contract', () => {
  it('polls RollDek every 15 seconds for at most 30 minutes', () => {
    expect(VIDEO_POLL_INTERVAL_MS).toBe(15_000);
    expect(VIDEO_POLL_DEADLINE_MS).toBe(30 * 60 * 1000);
  });

  it('builds the sole internal API body with normalized duration and deduplicated references', () => {
    expect(
      buildInternalVideoRequest({
        modelId: 'gemini-omni-1.1-flash',
        routeId: 'gemini-omni-1.1-flash-line1',
        prompt: '  a cinematic river  ',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: '5',
        referenceImages: [
          ' data:image/jpeg;base64,one ',
          'https://example.com/ref.jpg',
          'data:image/jpeg;base64,one',
          '',
        ],
        referenceVideos: [
          ' https://example.com/reference.mp4 ',
          'https://example.com/reference.mp4',
          '',
        ],
      }),
    ).toEqual({
      modelId: 'gemini-omni-1.1-flash',
      routeId: 'gemini-omni-1.1-flash-line1',
      prompt: 'a cinematic river',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 5,
      referenceImages: [
        'data:image/jpeg;base64,one',
        'https://example.com/ref.jpg',
      ],
      referenceVideos: ['https://example.com/reference.mp4'],
    });
  });

  it('keeps an invalid numeric duration as NaN for server-side request validation', () => {
    const request = buildInternalVideoRequest({
      modelId: 'gemini-omni-1.1-flash',
      routeId: 'gemini-omni-1.1-flash-line1',
      prompt: 'test',
      aspectRatio: '9:16',
      resolution: '720p',
      duration: 'not-a-number',
    });

    expect(Number.isNaN(request.duration)).toBe(true);
    expect(request.referenceImages).toEqual([]);
    expect(request.referenceVideos).toEqual([]);
  });

  it('extracts RollDek metadata URLs and prefers the local video URL', () => {
    expect(extractVideoOutputUrl({
      video_url: '/api/video/task/local/content',
      metadata: { url: 'https://rolldek.com/video.mp4' },
      data: { metadata: { url: 'https://nested.example/video.mp4' } },
    })).toBe('/api/video/task/local/content');
    expect(extractVideoOutputUrl({ metadata: { url: 'https://rolldek.com/video.mp4' } }))
      .toBe('https://rolldek.com/video.mp4');
  });

  it('treats RollDek in_progress as a nonterminal task status', () => {
    expect(isVideoTaskInProgressStatus('in_progress')).toBe(true);
    expect(isVideoTaskInProgressStatus('queued')).toBe(true);
    expect(isVideoTaskInProgressStatus('completed')).toBe(false);
  });
});
